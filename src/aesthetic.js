/**
 * aesthetic.js —— 医美方案层
 *
 * ## 它解决什么
 *
 * 到 zones.js 为止，工具能「把脸调成某个样子」，但输出的是档位和分值 ——
 * 咨询师没法拿这个跟顾客或医生沟通。医美沟通用的是另一套语言：
 *
 *   「颏部玻尿酸 1.0ml，颏长增加约 2.4mm，下庭占比从 27.3% 提到 30.5%」
 *
 * 本层负责三件事：
 *   1. 把归一化比例换算成【毫米】（医美通用尺度）；
 *   2. 把咨询师调的每一处翻译成【部位 + 项目 + 幅度 + 参考剂量】；
 *   3. 基于实测指标生成【保守的自动建议】，并明确标注推断依据与不确定性。
 *
 * ## 毫米从哪来
 *
 * 规范坐标系的单位是眼间距（IPD），而成年人瞳距差异极小且稳定，
 * 是可用的天然标尺：女性约 62mm、男性约 64mm、默认 63mm。
 * 于是 mmPerPixel = ipdMm / 实测瞳距像素数。
 *
 * ⚠️ 这是估算，不是测量：没有参照物、镜头畸变、拍摄距离都会带来误差，
 *    通常 ±5% 左右。方案里所有 mm 值都必须按估算呈现，不能当精确值用。
 *
 * ## 红线
 *
 * 二维正面照【无法判断容量缺损】—— 照片上看不出「太阳穴凹了 2mm」，
 * 只能看出轮廓形态。因此：
 *   - 自动建议只基于能测到的比例指标，绝不编造「凹陷」「下垂」这类诊断；
 *   - 每一条建议都必须带 evidence（依据的具体数值）；
 *   - 方案全文必须带免责声明，且不得省略。
 *
 * 纯函数层：零 React 依赖，可直接 node --test。
 */

import { frameOf, frameFaceWidth } from './frame.js'
import { SITES, siteOf } from './zones.js'

// ---------------------------------------------------------------- 尺度

/** 瞳距参考值（mm）。来源：成年人瞳距统计均值 */
export const IPD_MM = {
  female: 62,
  male: 64,
  default: 63,
}

/** 男性 / 女性瞳距差 ±1mm，加镜头与姿态误差，实测量级约 ±5% */
export const MM_ESTIMATE_TOLERANCE = 0.05

/**
 * 计算毫米尺度。
 * @param {Point[]} points 68 点
 * @param {{ipdMm?:number, gender?:'female'|'male'|null}} opts
 * @returns {{ok:boolean, mmPerPixel:number, ipdPx:number, ipdMm:number,
 *            faceWidthMm:number, faceHeightMm:number, note:string}}
 */
export function mmScale(points, opts = {}) {
  const frame = frameOf(points)
  const ipdPx = frame.ipd
  if (!frame.valid || !(ipdPx > 0)) {
    return {
      ok: false,
      mmPerPixel: 0,
      ipdPx: 0,
      ipdMm: 0,
      faceWidthMm: 0,
      faceHeightMm: 0,
      note: '瞳距不可用，无法换算毫米',
    }
  }
  const ipdMm =
    Number.isFinite(opts.ipdMm) && opts.ipdMm > 0
      ? opts.ipdMm
      : opts.gender === 'female'
        ? IPD_MM.female
        : opts.gender === 'male'
          ? IPD_MM.male
          : IPD_MM.default

  const mmPerPixel = ipdMm / ipdPx
  const faceWidthMm = frameFaceWidth(points, frame) * mmPerPixel
  const faceHeightMm = Number.isFinite(opts.faceHeightPx)
    ? opts.faceHeightPx * mmPerPixel
    : 0
  return {
    ok: true,
    mmPerPixel,
    ipdPx,
    ipdMm,
    faceWidthMm,
    faceHeightMm,
    note: `按瞳距 ${ipdMm}mm 估算，误差约 ±${Math.round(MM_ESTIMATE_TOLERANCE * 100)}%`,
  }
}

/**
 * 把部位档位换算成控制点处的峰值位移（mm）。
 * 档位 ±15 → 位移 = (v/100) × scale × 面宽（像素）→ × mmPerPixel。
 *
 * @returns {{mm:number, ok:boolean}} mm 带符号：正 = 填充 / 外扩
 */
export function siteAmplitude(points, siteKey, value, scale, opts = {}) {
  const site = siteOf(siteKey)
  if (!site || !Number.isFinite(value) || value === 0 || !scale?.ok) return { mm: 0, ok: false }
  const frame = frameOf(points)
  const W = frameFaceWidth(points, frame)
  if (!(W > 0)) return { mm: 0, ok: false }
  const px = (value / 100) * site.scale * W
  return { mm: px * scale.mmPerPixel, ok: true }
}

/** 反向：想要的毫米位移 → 档位（用于自动建议给出档位建议） */
export function levelForMm(points, siteKey, mm, scale) {
  const site = siteOf(siteKey)
  if (!site || !scale?.ok) return 0
  const frame = frameOf(points)
  const W = frameFaceWidth(points, frame)
  if (!(W > 0)) return 0
  const px = mm / scale.mmPerPixel
  const level = (px / (site.scale * W)) * 100
  return Math.max(-15, Math.min(15, level))
}

// ---------------------------------------------------------------- 自动建议

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * 基于实测指标生成自动建议。
 *
 * 只使用【二维正面照能测到的比例指标】，不推断容量缺损。
 * 每条建议带 evidence（依据数值）与 confidence。
 *
 * @param {Point[]} points
 * @param {Metrics} metrics 原始照片指标
 * @param {Object} scale    mmScale 的输出
 * @param {Object} values   当前部位档位（已设定的项不再重复建议）
 */
export function suggestFromMetrics(points, metrics, scale, values = {}) {
  const out = []
  if (!metrics || !metrics.valid || !scale.ok) return out

  const { three, five, golden, symmetry } = metrics
  const fhMm = scale.faceHeightMm
  const already = (k) => Number.isFinite(values[k]) && values[k] !== 0

  // 下庭偏短 → 颏部填充（颏尖下移直接增加下庭长度）
  if (Number.isFinite(three.lower) && three.lower < 0.3 && !already('chin') && fhMm > 0) {
    const needMm = (1 / 3 - three.lower) * fhMm
    out.push({
      key: 'chin',
      mm: clamp(needMm, 1, 6),
      evidence: `下庭占比 ${(three.lower * 100).toFixed(1)}%，低于 30% 参考下限`,
      confidence: 'mid',
      reason: '颏部加长可直接增加下庭长度',
    })
  }

  // 中庭相对下庭偏长 → 同样靠颏部平衡（黄金比偏大）
  if (Number.isFinite(golden) && golden > 0.65 && !already('chin') && fhMm > 0) {
    const needMm = clamp((golden - 0.618) * 8, 1, 5)
    out.push({
      key: 'chin',
      mm: needMm,
      evidence: `黄金分割比 ${golden.toFixed(3)}，高于 0.65（中庭相对下庭偏长）`,
      confidence: 'low',
      reason: '颏部适度加长可平衡中下庭比例',
    })
  }

  // 内眦间距偏宽 → 鼻根 / 鼻背填充（隆鼻在视觉上收窄内眦间距）
  if (
    Number.isFinite(five?.ratios?.[2]) &&
    five.ratios[2] > 0.24 &&
    !already('noseRoot') &&
    !already('noseDorsum')
  ) {
    const needMm = clamp((five.ratios[2] - 0.2) * 40, 0.8, 4)
    out.push({
      key: 'noseDorsum',
      mm: needMm,
      evidence: `内眦间距占面宽 ${(five.ratios[2] * 100).toFixed(1)}%，高于 20% 参考值`,
      confidence: 'low',
      reason: '鼻背抬高可在视觉上收窄眼距，但改善有限，重眼距需面诊评估',
    })
  }

  // 中庭偏短 → 鼻部填充（在视觉上拉长中庭）
  if (Number.isFinite(golden) && golden < 0.58 && !already('noseDorsum') && !already('noseRoot')) {
    out.push({
      key: 'noseRoot',
      mm: clamp((0.618 - golden) * 8, 0.8, 3),
      evidence: `黄金分割比 ${golden.toFixed(3)}，低于 0.58（中庭相对下庭偏短）`,
      confidence: 'low',
      reason: '鼻根抬高可增加中庭视觉长度',
    })
  }

  // 上庭偏长 → 这属于发际线范畴，不是注射项目，明确区分
  if (Number.isFinite(three.upper) && three.upper > 0.38) {
    out.push({
      key: '__hairline__',
      mm: 0,
      evidence: `上庭占比 ${(three.upper * 100).toFixed(1)}%，高于 38% 参考上限（估算值）`,
      confidence: 'low',
      reason: '上庭偏长通常属发际线问题，注射类项目无法改善，需考虑发际线调整（非本工具范围）',
    })
  }

  // 对称偏差过大 → 不下项目建议，只提示排查拍摄条件
  if (Number.isFinite(symmetry) && symmetry > 20) {
    out.push({
      key: '__symmetry__',
      mm: 0,
      evidence: `对称度偏差 ${symmetry.toFixed(1)}%，显著偏大`,
      confidence: 'high',
      reason: '如此大的偏差多来自拍摄角度或光源，而非真实不对称；先换正面标准照再评估',
    })
  }

  return out
}

// ---------------------------------------------------------------- 方案组装

const RISK_TEXT = {
  high: '高风险部位：需经验丰富的执业医师操作，注意血管走行与栓塞风险',
  mid: '中风险：常规注射层次与剂量下可控',
  low: '低风险：浅层小剂量',
}

const DIRECTION_TEXT = (v) => (v > 0 ? '填充 / 外扩' : '收紧 / 内收')

/**
 * 组装完整方案。
 *
 * @param {Point[]} points 原始 68 点
 * @param {Object} ctx
 *   metrics         原始照片指标
 *   score           原始评分
 *   adjustedMetrics 调整后指标（可空）
 *   adjustedScore   调整后评分（可空）
 *   siteValues      部位档位
 *   hairlineY       实测发际线
 *   ipdMm / gender  毫米标定
 * @returns {{scale, items, suggestions, warnings, disclaimer, text}}
 */
export function buildPlan(points, ctx = {}) {
  const { metrics, score, adjustedMetrics, adjustedScore, siteValues = {}, hairlineY } = ctx

  const scale = mmScale(points, {
    ipdMm: ctx.ipdMm,
    gender: ctx.gender,
    faceHeightPx: metrics?.faceHeight,
  })

  // ---- 咨询师已设定的部位 ----
  const items = []
  for (const site of SITES) {
    const v = siteValues[site.key]
    if (!Number.isFinite(v) || v === 0) continue
    const amp = siteAmplitude(points, site.key, v, scale)
    items.push({
      key: site.key,
      zone: site.zone,
      label: site.label,
      level: v,
      direction: DIRECTION_TEXT(v),
      mm: amp.ok ? Math.round(amp.mm * 10) / 10 : null,
      projects: site.projects,
      doseRef: site.doseRef,
      risk: site.risk,
      riskText: RISK_TEXT[site.risk],
      note: site.note,
      source: 'manual',
      // virtual 部位（如耳部）在 68 点里没有对应点位，位置是几何推演出来的，
      // 必须在方案单里显式标注，否则会被误读成检测结果
      virtual: !!site.virtual,
      evidence: site.virtual ? '几何推演（该区域无检测点位，仅供参考）' : '咨询师手动设定',
    })
  }
  // 高风险在前，其次按幅度从大到小
  const riskOrder = { high: 0, mid: 1, low: 2 }
  items.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk] || Math.abs(b.mm ?? 0) - Math.abs(a.mm ?? 0))

  // ---- 自动建议 ----
  const suggestions = suggestFromMetrics(points, metrics, scale, siteValues)
    .map((s) => {
      if (s.key.startsWith('__')) {
        return {
          key: s.key,
          label: s.key === '__hairline__' ? '发际线（非注射）' : '拍摄条件排查',
          mm: null,
          level: Math.round(levelForMm(points, s.key, s.mm, scale) * 10) / 10,
          confidence: s.confidence,
          evidence: s.evidence,
          reason: s.reason,
          source: 'suggested',
        }
      }
      const site = siteOf(s.key)
      if (!site) return null
      return {
        key: s.key,
        zone: site.zone,
        label: site.label,
        mm: Math.round(s.mm * 10) / 10,
        level: Math.round(levelForMm(points, s.key, s.mm, scale) * 10) / 10,
        projects: site.projects,
        doseRef: site.doseRef,
        risk: site.risk,
        riskText: RISK_TEXT[site.risk],
        note: site.note,
        confidence: s.confidence,
        evidence: s.evidence,
        reason: s.reason,
        source: 'suggested',
      }
    })
    .filter(Boolean)

  // ---- 警告 ----
  const warnings = []
  if (items.some((i) => i.risk === 'high')) {
    warnings.push('方案含高风险部位（太阳穴 / 泪沟 / 鼻部），须由执业医师评估后操作。')
  }
  if (Number.isFinite(metrics?.symmetry) && metrics.symmetry > 20) {
    warnings.push(`对称度偏差 ${metrics.symmetry.toFixed(1)}% 偏大，建议先换正面标准照再评估。`)
  }
  if (Number.isFinite(metrics?.frame?.roll) && Math.abs(metrics.frame.roll) >= 8) {
    warnings.push(`照片歪头 ${metrics.frame.roll.toFixed(1)}°，测量已自动摆正，但透视畸变仍在。`)
  }
  if (!scale.ok) warnings.push('瞳距不可用，毫米数值已停用，方案仅保留部位与项目。')

  const disclaimer =
    '本方案由二维正面照的比例测量推导，用于沟通示意，不构成医疗诊断或处方。' +
    '二维图像无法判断容量缺损、皮肤厚度与组织下垂程度，毫米数值为瞳距估算（误差约 ±5%）。' +
    '实际方案须由执业医师结合侧面照、动态表情与面诊确定。'

  const text = renderPlanText({
    scale,
    items,
    suggestions,
    warnings,
    disclaimer,
    score,
    adjustedScore,
    metrics,
    adjustedMetrics,
  })

  return { scale, items, suggestions, warnings, disclaimer, text }
}

// ---------------------------------------------------------------- 文本导出

const P1 = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—')

/**
 * 渲染可直接复制 / 打印的方案文本。
 * 所有数值均来自入参，不在此处生成任何新数值。
 */
export function renderPlanText(p) {
  const L = []
  L.push('面部美学设计方案（沟通示意 · 非医疗建议）')
  L.push('='.repeat(40))
  L.push('')

  if (p.scale?.ok) {
    L.push(`尺度标定：${p.scale.note}；面宽约 ${p.scale.faceWidthMm.toFixed(0)}mm`)
  } else {
    L.push('尺度标定：不可用（瞳距异常）')
  }
  if (p.metrics?.frame) {
    L.push(`拍摄姿态：歪头 ${p.metrics.frame.roll.toFixed(1)}°`)
  }
  if (p.score && p.adjustedScore) {
    L.push(`综合评分：${p.score.total} → ${p.adjustedScore.total}（${p.score.grade} → ${p.adjustedScore.grade}）`)
  }
  L.push('')

  if (p.items?.length) {
    L.push('一、本次设计项目')
    p.items.forEach((it, i) => {
      const mm = it.mm == null ? '—' : `${it.mm > 0 ? '+' : ''}${it.mm}mm`
      L.push(`${i + 1}. ${it.label}　${it.direction}　${mm}`)
      L.push(`   项目：${it.projects.join(' / ')}`)
      if (it.doseRef && it.doseRef !== '—') L.push(`   参考剂量：${it.doseRef}`)
      L.push(`   风险：${it.riskText}`)
      if (it.note) L.push(`   要点：${it.note}`)
    })
    L.push('')
  } else {
    L.push('一、本次设计项目')
    L.push('（未设定任何部位调整）')
    L.push('')
  }

  if (p.suggestions?.length) {
    L.push('二、系统建议（需面诊确认）')
    p.suggestions.forEach((s, i) => {
      const mm = s.mm == null ? '' : `　建议 ${s.mm > 0 ? '+' : ''}${s.mm}mm`
      L.push(`${i + 1}. ${s.label}${mm}`)
      L.push(`   依据：${s.evidence}`)
      L.push(`   说明：${s.reason}`)
      if (s.projects) L.push(`   项目：${s.projects.join(' / ')}`)
    })
    L.push('')
  }

  if (p.metrics?.valid) {
    L.push('三、测量数据')
    L.push(
      `三庭：上 ${P1(p.metrics.three.upper)} / 中 ${P1(p.metrics.three.middle)} / 下 ${P1(p.metrics.three.lower)}`,
    )
    L.push(`五眼偏差：${P1(p.metrics.five.deviation)}　对称偏差：${Number.isFinite(p.metrics.symmetry) ? p.metrics.symmetry.toFixed(1) + '%' : '—'}`)
    L.push(`黄金分割比：${Number.isFinite(p.metrics.golden) ? p.metrics.golden.toFixed(3) : '—'}`)
    if (p.adjustedMetrics?.valid) {
      L.push(
        `调整后三庭：上 ${P1(p.adjustedMetrics.three.upper)} / 中 ${P1(p.adjustedMetrics.three.middle)} / 下 ${P1(p.adjustedMetrics.three.lower)}`,
      )
    }
    L.push('')
  }

  if (p.warnings?.length) {
    L.push('四、风险提示')
    for (const w of p.warnings) L.push(`· ${w}`)
    L.push('')
  }

  L.push('五、免责声明')
  L.push(p.disclaimer)
  return L.join('\n')
}

/** 部位是否属于注射类（用于导出时区分「注射」与「仪器 / 手术」） */
export function isInjectable(site) {
  return (site?.projects || []).some((t) => t.includes('填充') || t.includes('隆') || t.includes('肉毒'))
}
