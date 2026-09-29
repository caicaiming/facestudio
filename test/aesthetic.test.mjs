/**
 * aesthetic.test.mjs —— 医美方案层
 * 覆盖：毫米标定（跨分辨率一致 / 性别）、档位↔毫米互逆、自动建议的触发与抑制、
 *       方案组装排序、文本导出的数值一致性与免责声明。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generateLandmarks, measureFace } from '../src/measure.js'
import { analyzeFace } from '../src/analyze.js'
import { frameFaceWidth, frameOf } from '../src/frame.js'
import { emptySites, siteOf, SITE_RANGE } from '../src/zones.js'
import {
  IPD_MM,
  buildPlan,
  fmtMm,
  isInjectable,
  levelForMm,
  mmScale,
  peakDisplacementMm,
  pxToMm,
  renderPlanText,
  siteAmplitude,
  sliderAmplitudeMm,
  subunitAmplitudeMm,
  suggestFromMetrics,
} from '../src/aesthetic.js'
import { getDeformedPoints } from '../src/measure.js'
import { SUBUNITS, applySubunitOffsets, coreIndicesOf } from '../src/subunits.js'

const ideal = () => generateLandmarks(1)
const scaled = (k) => generateLandmarks(k)

const M = (pts) => measureFace(pts, 600, 800, null, 1, null)
const A = (m) => analyzeFace(m)

// ---------------------------------------------------------------- 1. 毫米标定

test('T11a 毫米标定：瞳距像素 → mmPerPixel，面宽换算合理', () => {
  const pts = ideal()
  const s = mmScale(pts)
  assert.ok(s.ok)
  assert.ok(Math.abs(s.mmPerPixel - s.ipdMm / s.ipdPx) < 1e-12)
  // 成年人面宽约 130–150mm，模板脸按标准比例应在该量级
  assert.ok(s.faceWidthMm > 100 && s.faceWidthMm < 180, `面宽量级异常: ${s.faceWidthMm}`)
  assert.equal(s.ipdMm, IPD_MM.default)
})

test('T11b 毫米标定：性别与自定义瞳距生效', () => {
  const pts = ideal()
  assert.equal(mmScale(pts, { gender: 'female' }).ipdMm, 62)
  assert.equal(mmScale(pts, { gender: 'male' }).ipdMm, 64)
  assert.equal(mmScale(pts, { ipdMm: 70 }).ipdMm, 70)
  // 自定义瞳距优先于性别
  assert.equal(mmScale(pts, { gender: 'male', ipdMm: 58 }).ipdMm, 58)
})

test('T11c 毫米标定：照片放大后 mmPerPixel 变小，但面宽 mm 不变', () => {
  const a = mmScale(scaled(1))
  const b = mmScale(scaled(4))
  assert.ok(b.mmPerPixel < a.mmPerPixel, '放大后每像素代表的毫米应更小')
  assert.ok(Math.abs(a.faceWidthMm - b.faceWidthMm) < 1e-9, '同一张脸的面宽 mm 应一致')
})

test('T11d 毫米标定：瞳距不可用时不抛异常且 ok=false', () => {
  const s = mmScale([])
  assert.equal(s.ok, false)
  assert.equal(s.mmPerPixel, 0)
  assert.ok(s.note.length > 0)
})

// ---------------------------------------------------------------- 2. 档位 ↔ 毫米

test('T11e 档位 → 毫米：幅度与档位成正比，正负对称', () => {
  const pts = ideal()
  const s = mmScale(pts)
  const a = siteAmplitude(pts, 'chin', 10, s)
  const b = siteAmplitude(pts, 'chin', 5, s)
  const neg = siteAmplitude(pts, 'chin', -10, s)
  assert.ok(a.ok && a.mm > 0)
  assert.ok(Math.abs(a.mm - 2 * b.mm) < 1e-9, '幅度应与档位成正比')
  assert.ok(Math.abs(a.mm + neg.mm) < 1e-9, '正负档位应对称')
})

test('T11f 档位 ↔ 毫米互逆（round-trip）', () => {
  const pts = ideal()
  const s = mmScale(pts)
  // 取 1.5mm：所有测试部位都在 ±15 档位范围内，不触发钳制（钳制另见 T11h）
  for (const key of ['chin', 'malar', 'temple', 'noseDorsum', 'masseter']) {
    const target = 1.5
    const level = levelForMm(pts, key, target, s)
    assert.ok(Math.abs(level) < 15, `${key} 档位应未触发钳制: ${level}`)
    const back = siteAmplitude(pts, key, level, s)
    assert.ok(Math.abs(back.mm - target) < 1e-9, `${key} round-trip 失败: ${back.mm} ≠ ${target}`)
  }
})

test('T11g 档位 → 毫米：档位为 0 或尺度不可用时返回 ok=false', () => {
  const pts = ideal()
  const s = mmScale(pts)
  assert.equal(siteAmplitude(pts, 'chin', 0, s).ok, false)
  assert.equal(siteAmplitude(pts, 'chin', 10, mmScale([])).ok, false)
  assert.equal(siteAmplitude(pts, '不存在的部位', 10, s).ok, false)
})

test('T11h 档位钳制：levelForMm 结果不超过档位上限（跟随 SITE_RANGE）', () => {
  const pts = ideal()
  const s = mmScale(pts)
  assert.equal(levelForMm(pts, 'chin', 999, s), SITE_RANGE.max)
  assert.equal(levelForMm(pts, 'chin', -999, s), SITE_RANGE.min)
})

test('T11h2 档位上限放宽后，反算不再被旧的 ±15 截断', () => {
  const pts = ideal()
  const s = mmScale(pts)
  // 6mm 的实际建议幅度，按 chin 的 scale 反算应当超过旧的 15 档上限
  const lv = levelForMm(pts, 'chin', 6, s)
  assert.ok(
    Math.abs(lv) <= SITE_RANGE.max && Number.isFinite(lv),
    `档位应落在 ±${SITE_RANGE.max} 内: ${lv}`,
  )
  // 反算回来的毫米必须与输入一致（上限没被悄悄卡住才会成立）
  const back = siteAmplitude(pts, 'chin', lv, s)
  assert.ok(Math.abs(back.mm - 6) < 0.2, `档位 ${lv.toFixed(1)} 反算回 ${back.mm}mm ≠ 6mm`)
})

// ---------------------------------------------------------------- 3. 自动建议

test('T11i 自动建议：下庭偏短 → 建议颏部填充，带依据数值', () => {
  const pts = ideal()
  const m = M(pts)
  const s = mmScale(pts, { faceHeightPx: m.faceHeight })
  // 人为压短下庭
  const short = { ...m, three: { ...m.three, lower: 0.26 } }
  const out = suggestFromMetrics(pts, short, s, {})
  const chin = out.find((o) => o.key === 'chin')
  assert.ok(chin, '下庭偏短应给出颏部建议')
  assert.ok(chin.mm > 0 && chin.mm <= 6, `建议幅度异常: ${chin.mm}`)
  assert.ok(chin.evidence.includes('26.0%'), `依据应包含实测数值: ${chin.evidence}`)
  assert.ok(chin.evidence.includes('下庭占比'))
})

test('T11j 自动建议：已手动设定的部位不再重复建议', () => {
  const pts = ideal()
  const m = M(pts)
  const s = mmScale(pts, { faceHeightPx: m.faceHeight })
  const short = { ...m, three: { ...m.three, lower: 0.26 } }
  const out = suggestFromMetrics(pts, short, s, { chin: 8 })
  assert.ok(!out.some((o) => o.key === 'chin'), '已设定的颏部不应再建议')
})

test('T11k 自动建议：对称偏差过大 → 给排查提示而非项目建议', () => {
  const pts = ideal()
  const m = M(pts)
  const s = mmScale(pts, { faceHeightPx: m.faceHeight })
  const asym = { ...m, symmetry: 28 }
  const out = suggestFromMetrics(pts, asym, s, {})
  const sym = out.find((o) => o.key === '__symmetry__')
  assert.ok(sym, '应给出对称排查提示')
  assert.equal(sym.confidence, 'high')
  assert.ok(sym.reason.includes('拍摄'), '应提示排查拍摄条件')
  assert.ok(sym.evidence.includes('28.0'), '应带实测数值')
})

test('T11l 自动建议：上庭偏长 → 明确归为非注射项目', () => {
  const pts = ideal()
  const m = M(pts)
  const s = mmScale(pts, { faceHeightPx: m.faceHeight })
  const tall = { ...m, three: { ...m.three, upper: 0.42 } }
  const out = suggestFromMetrics(pts, tall, s, {})
  const h = out.find((o) => o.key === '__hairline__')
  assert.ok(h, '应给出发际线提示')
  assert.ok(h.reason.includes('注射'), '应说明注射类项目无法改善')
  assert.equal(h.mm, 0, '不应给出注射幅度')
})

test('T11m 自动建议：指标无效或尺度不可用时返回空', () => {
  const pts = ideal()
  assert.deepEqual(suggestFromMetrics(pts, null, mmScale(pts), {}), [])
  assert.deepEqual(suggestFromMetrics(pts, { valid: false }, mmScale(pts), {}), [])
  assert.deepEqual(suggestFromMetrics(pts, M(pts), mmScale([]), {}), [])
})

// ---------------------------------------------------------------- 4. 方案组装

test('T11n 方案组装：已设定部位进入 items，含项目 / 剂量 / 风险', () => {
  const pts = ideal()
  const m = M(pts)
  const plan = buildPlan(pts, {
    metrics: m,
    score: A(m).score,
    siteValues: { ...emptySites(), temple: 8, chin: 6 },
  })
  assert.equal(plan.items.length, 2)
  const temple = plan.items.find((i) => i.key === 'temple')
  assert.ok(temple.mm > 0)
  assert.ok(temple.projects.length > 0)
  assert.ok(temple.doseRef.length > 0)
  assert.equal(temple.risk, 'high')
  assert.ok(temple.riskText.includes('高风险'))
})

test('T11o 方案组装：高风险部位排在前面', () => {
  const pts = ideal()
  const plan = buildPlan(pts, {
    metrics: M(pts),
    siteValues: { ...emptySites(), chin: 10, temple: 5, upperLip: 8 },
  })
  const risks = plan.items.map((i) => i.risk)
  const order = { high: 0, mid: 1, low: 2 }
  for (let i = 1; i < risks.length; i++) {
    assert.ok(order[risks[i - 1]] <= order[risks[i]], '风险等级应非递减')
  }
})

test('T11p 方案组装：高风险部位触发警告，对称偏差触发警告', () => {
  const pts = ideal()
  const m = M(pts)
  const p1 = buildPlan(pts, { metrics: m, siteValues: { ...emptySites(), temple: 6 } })
  assert.ok(p1.warnings.some((w) => w.includes('高风险部位')))

  const p2 = buildPlan(pts, { metrics: { ...m, symmetry: 25 }, siteValues: {} })
  assert.ok(p2.warnings.some((w) => w.includes('对称')))
})

test('T11q 方案组装：空档位时 items 为空且不抛异常', () => {
  const pts = ideal()
  const plan = buildPlan(pts, { metrics: M(pts), siteValues: emptySites() })
  assert.equal(plan.items.length, 0)
  assert.ok(plan.text.includes('未设定任何部位调整'))
})

// ---------------------------------------------------------------- 5. 文本导出

test('T11r 文本导出：含免责声明、尺度说明、项目与测量数据', () => {
  const pts = ideal()
  const m = M(pts)
  const sc = A(m).score
  const plan = buildPlan(pts, {
    metrics: m,
    score: sc,
    adjustedMetrics: m,
    adjustedScore: sc,
    siteValues: { ...emptySites(), chin: 7 },
  })
  const t = plan.text
  assert.ok(t.includes('非医疗建议'), '应含非医疗建议声明')
  assert.ok(t.includes('不构成医疗诊断'), '应含免责声明全文')
  assert.ok(t.includes('瞳距'), '应含尺度标定说明')
  assert.ok(t.includes('颏尖'), '应含项目名')
  assert.ok(t.includes('玻尿酸隆颏'), '应含具体项目')
  assert.ok(t.includes('三庭'), '应含测量数据')
  assert.ok(t.includes(sc.grade), '应含评级')
})

test('T11s 文本导出：数值与测量值一致（红线约束）', () => {
  const pts = ideal()
  const m = M(pts)
  const plan = buildPlan(pts, { metrics: m, score: A(m).score, siteValues: {} })
  const lower = (m.three.lower * 100).toFixed(1)
  assert.ok(plan.text.includes(`${lower}%`), `文本应含实测下庭占比 ${lower}%`)
  const sym = m.symmetry.toFixed(1)
  assert.ok(plan.text.includes(`${sym}%`), `文本应含实测对称偏差 ${sym}%`)
})

test('T11t 文本导出：纯函数，同一输入两次渲染一致', () => {
  const pts = ideal()
  const m = M(pts)
  const p = {
    scale: mmScale(pts),
    items: [],
    suggestions: [],
    warnings: ['测试警告'],
    disclaimer: 'D',
    metrics: m,
  }
  assert.equal(renderPlanText(p), renderPlanText(p))
})

test('T11u 注射类判定：填充 / 隆鼻 / 肉毒为注射类，纯收紧类不是', () => {
  assert.equal(isInjectable(siteOf('chin')), true) // 玻尿酸隆颏
  assert.equal(isInjectable(siteOf('temple')), true) // 玻尿酸填充
  assert.equal(isInjectable(siteOf('masseter')), true) // 肉毒
  assert.equal(isInjectable(siteOf('jawline')), true) // 含肉毒素（颈阔肌）
  assert.equal(isInjectable(siteOf('jowl')), false) // 仅收紧 / 溶脂，无注射项目
  assert.equal(isInjectable(null), false)
})

test('T11v 面宽毫米与规范面宽一致（跨分辨率）', () => {
  const a = mmScale(scaled(1))
  const b = mmScale(scaled(3))
  const wa = frameFaceWidth(scaled(1), frameOf(scaled(1)))
  const wb = frameFaceWidth(scaled(3), frameOf(scaled(3)))
  assert.ok(Math.abs(wa * a.mmPerPixel - wb * b.mmPerPixel) < 1e-9)
})

// ---------------------------------------------------------------- 8. 档位 → 毫米

test('T11w 峰值位移：零位移为 0，标定不可用返回 null', () => {
  const pts = ideal()
  const s = mmScale(pts)
  assert.equal(peakDisplacementMm(pts, pts, s), 0)
  assert.equal(peakDisplacementMm(pts, pts, { ok: false }), null)
  assert.equal(peakDisplacementMm(null, pts, s), null)
  const moved = pts.map((p) => ({ x: p.x + 10, y: p.y }))
  assert.ok(Math.abs(peakDisplacementMm(pts, moved, s) - 10 * s.mmPerPixel) < 1e-9)
})

test('T11x 5 路滑块：档位 → mm 跨分辨率一致（这是显示 mm 的全部意义）', () => {
  const a = mmScale(scaled(1))
  const b = mmScale(scaled(3))
  for (const key of ['mouth', 'chin', 'jawline', 'forehead', 'cheekbone']) {
    const ma = sliderAmplitudeMm(scaled(1), key, 8, a)
    const mb = sliderAmplitudeMm(scaled(3), key, 8, b)
    assert.ok(ma > 0, `${key} 应产生位移`)
    // 同一档位在 1× 与 3× 分辨率下必须是同一个物理长度
    assert.ok(Math.abs(ma - mb) < 0.05, `${key} 跨分辨率不一致: ${ma} vs ${mb}`)
  }
})

test('T11y 5 路滑块：档位为 0 返回 null，档位翻倍 mm 翻倍', () => {
  const pts = ideal()
  const s = mmScale(pts)
  assert.equal(sliderAmplitudeMm(pts, 'chin', 0, s), null)
  const m1 = sliderAmplitudeMm(pts, 'chin', 4, s)
  const m2 = sliderAmplitudeMm(pts, 'chin', 8, s)
  assert.ok(Math.abs(m2 - 2 * m1) < 1e-6, `非线性: ${m1} → ${m2}`)
})

test('T11z 亚单位：档位 → mm，只带自身一个亚单位', () => {
  const pts = ideal()
  const s = mmScale(pts)
  const su = SUBUNITS[0]
  assert.equal(subunitAmplitudeMm(pts, su.key, 0, s), null)
  const m5 = subunitAmplitudeMm(pts, su.key, 5, s)
  const m10 = subunitAmplitudeMm(pts, su.key, 10, s)
  assert.ok(m5 > 0 && m10 > 0, '应有位移')
  assert.ok(Math.abs(m10 - 2 * m5) < 1e-6, `非线性: ${m5} → ${m10}`)
  // 峰值应落在自身核心点上，而不是被某个远处的点抢走
  const moved = applySubunitOffsets(pts, { [su.key]: 10 })
  let best = -1
  let bestI = -1
  for (let i = 0; i < 68; i++) {
    const d = Math.hypot(moved[i].x - pts[i].x, moved[i].y - pts[i].y)
    if (d > best) {
      best = d
      bestI = i
    }
  }
  assert.ok(coreIndicesOf(su).includes(bestI), `峰值落在 ${bestI}，不在核心点内`)
})

test('T12a px → mm：同一个像素值在大图上代表更小的实际长度', () => {
  const a = mmScale(scaled(1))
  const b = mmScale(scaled(3))
  // 3× 大图上 1px 只对应 1/3 的实际长度 —— 这正是必须显示 mm 的理由
  assert.ok(Math.abs(pxToMm(30, a) - 3 * pxToMm(30, b)) < 1e-9)
  assert.equal(pxToMm(-30, a), pxToMm(30, a)) // 峰值不带方向
  assert.equal(pxToMm(30, { ok: false }), null)
})

test('T12b 毫米格式化：低于阈值不显示，正常值保留 1 位小数', () => {
  assert.equal(fmtMm(null), null)
  assert.equal(fmtMm(0.01), null) // 0.0mm 没有意义，不如不显示
  assert.equal(fmtMm(2.44), '2.4mm')
  assert.equal(fmtMm(10), '10.0mm')
})
