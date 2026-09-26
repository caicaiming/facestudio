/**
 * analyze.js —— 评分、处方、文案层
 * 纯函数模块：零 React 依赖，可在 Node.js 环境单独测试。
 * 依赖 measure.js 的输出结构（Metrics）。
 *
 * 🔴 红线约束：文案中出现的所有百分比数值必须直接来自 measure.js 的计算结果，
 *    严禁引入任何自由生成的数值。此约束由 test/measure.test.mjs 的 T3 用例守卫。
 */

import { IDEAL } from './measure.js'

// ---------------------------------------------------------------- 配置

export const WEIGHTS = {
  three: 0.3,
  five: 0.2,
  symmetry: 0.2,
  golden: 0.2,
  balance: 0.1,
}

/** 滑块定义：UI 层必须遍历此常量渲染，禁止硬编码 */
export const SLIDERS = [
  { key: 'mouth', label: '嘴巴', min: -15, max: 15, step: 1, hint: '− 缩小 / ＋ 放大' },
  { key: 'chin', label: '下巴', min: -15, max: 15, step: 1, hint: '− 缩短 / ＋ 加长' },
  { key: 'jawline', label: '下颌线', min: -15, max: 15, step: 1, hint: '− 收窄 / ＋ 加宽' },
  { key: 'forehead', label: '额头', min: -15, max: 15, step: 1, hint: '− 收缩 / ＋ 加高' },
  { key: 'cheekbone', label: '颧骨', min: -15, max: 15, step: 1, hint: '− 内收 / ＋ 外扩' },
]

export const THRESHOLDS = {
  three: 0.04,
  five: 0.05,
  symmetry: 15,
  golden: 0.05,
  balance: 0.05,
}

export const DEFAULT_PARAMS = {
  mouth: 0,
  chin: 0,
  jawline: 0,
  forehead: 0,
  cheekbone: 0,
}

// ---------------------------------------------------------------- 评分

/** 偏差 → 分数。偏差在阈值内满分，超出后线性衰减 */
export function scoreByDeviation(dev, threshold) {
  if (!Number.isFinite(dev)) return 0
  if (dev <= threshold) return 100
  const overflow = (dev - threshold) / threshold
  return Math.max(0, Math.round(100 - overflow * 60))
}

function scoreThree(three) {
  if (!three || !Number.isFinite(three.upper)) return 0
  const dev = Math.max(
    Math.abs(three.upper - IDEAL.three),
    Math.abs(three.middle - IDEAL.three),
    Math.abs(three.lower - IDEAL.three),
  )
  return scoreByDeviation(dev, THRESHOLDS.three)
}

function gradeOf(total) {
  if (total >= 85) return '协调'
  if (total >= 70) return '较协调'
  if (total >= 55) return '可优化'
  return '明显失衡'
}

// ---------------------------------------------------------------- 处方

/** 格式化为百分数字符串（保留 1 位小数），供文案与处方共用，保证数值一致 */
function pct(v) {
  return (v * 100).toFixed(1)
}

function buildAdvice(metrics, params) {
  const list = []
  const { three, five, symmetry, golden } = metrics
  const p = params || DEFAULT_PARAMS

  if (Number.isFinite(three.lower) && three.lower < 0.3 && (p.chin ?? 0) < 5) {
    list.push({
      target: '下巴',
      action: '下巴长度可提升',
      delta: Math.round((IDEAL.three - three.lower) * 1000) / 10,
      reason: `下庭占比 ${pct(three.lower)}%，低于 30% 参考下限`,
      priority: 'high',
    })
  }
  if (Number.isFinite(three.upper) && three.upper > 0.38 && (p.forehead ?? 0) > -5) {
    list.push({
      target: '额头',
      action: '额头高度可收缩',
      delta: Math.round((three.upper - IDEAL.three) * 1000) / 10,
      reason: `上庭占比 ${pct(three.upper)}%，高于 38% 参考上限（估算值）`,
      priority: 'mid',
    })
  }
  if (Number.isFinite(five.deviation) && five.deviation > THRESHOLDS.five) {
    list.push({
      target: '五眼分布',
      action: '眼距与面宽比例可微调',
      delta: Math.round(five.deviation * 1000) / 10,
      reason: `五眼平均偏差 ${pct(five.deviation)}%，超出 5% 可接受范围`,
      priority: 'mid',
    })
  }
  if (Number.isFinite(symmetry) && symmetry > 20) {
    list.push({
      target: '左右对称',
      action: '建议先排查拍摄条件',
      delta: symmetry,
      reason: `对称度偏差 ${symmetry.toFixed(1)}%，显著偏大，需确认光源与拍摄角度`,
      priority: 'high',
    })
  }
  if (Number.isFinite(golden) && golden > 0.65) {
    list.push({
      target: '中庭',
      action: '中庭偏长，可适度提升下巴',
      delta: Math.round((golden - IDEAL.golden) * 1000) / 10,
      reason: `黄金分割比 ${golden.toFixed(3)}，高于 0.65`,
      priority: 'low',
    })
  }
  if (Number.isFinite(golden) && golden < 0.58) {
    list.push({
      target: '下庭',
      action: '下庭偏短，可考虑下巴微调',
      delta: Math.round((IDEAL.golden - golden) * 1000) / 10,
      reason: `黄金分割比 ${golden.toFixed(3)}，低于 0.58`,
      priority: 'low',
    })
  }

  if (list.length === 0) {
    list.push({
      target: '整体',
      action: '比例协调，无需调整',
      delta: 0,
      reason: `各项指标偏差均在可接受阈值内，综合评级 ${gradeOf(
        Math.round(
          WEIGHTS.three * scoreThree(three) +
            WEIGHTS.five * scoreByDeviation(five.deviation, THRESHOLDS.five) +
            WEIGHTS.symmetry * scoreByDeviation(symmetry, THRESHOLDS.symmetry) +
            WEIGHTS.golden * scoreByDeviation(Math.abs(golden - IDEAL.golden), THRESHOLDS.golden) +
            WEIGHTS.balance * scoreByDeviation(Math.abs(metrics.balance - IDEAL.balance), THRESHOLDS.balance),
        ),
      )}`,
      priority: 'low',
    })
  }

  const order = { high: 0, mid: 1, low: 2 }
  return list.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 5)
}

// ---------------------------------------------------------------- 文案

function buildCopy(metrics, score) {
  const { three, five, symmetry, golden } = metrics
  const fin = (v) => Number.isFinite(v)
  // 段评语：阈值与 6.2.4 处方规则保持一致（0.30 / 0.38）
  const comment = (v, long, short) => (!fin(v) ? '无法测量' : v > 0.38 ? long : v < 0.3 ? short : '比例适中')
  const upper = fin(three.upper) ? pct(three.upper) : '—'
  const middle = fin(three.middle) ? pct(three.middle) : '—'
  const lower = fin(three.lower) ? pct(three.lower) : '—'
  const fiveDev = fin(five.deviation) ? pct(five.deviation) : '—'
  const sym = fin(symmetry) ? symmetry.toFixed(1) : '—'
  const gold = fin(golden) ? golden.toFixed(3) : '—'

  return [
    `上庭占比 ${upper}%，${comment(three.upper, '略显偏长', '略显偏短')}；`,
    `中庭占比 ${middle}%，${comment(three.middle, '略显偏长', '略显偏短')}；`,
    `下庭占比 ${lower}%，${comment(three.lower, '相对偏长', '相对偏短')}。`,
    `五眼分布偏差 ${fiveDev}%，左右对称度偏差 ${sym}%，`,
    `黄金分割比 ${gold}（理想值 0.618）。`,
    `综合评级：${score.grade}（${score.total} 分）。`,
  ].join('')
}

// ---------------------------------------------------------------- 主入口

/**
 * @param {Metrics} metrics measureFace 的输出
 * @param {Params}  params  当前滑块值（用于抑制已调整项的建议）
 * @returns {{ score: Score|null, advice: Advice[], copy: string }}
 */
export function analyzeFace(metrics, params = DEFAULT_PARAMS) {
  if (!metrics || !metrics.valid) {
    return {
      score: null,
      advice: [],
      copy: '当前照片无法完成测量，请更换正面清晰照片后重试。',
    }
  }

  const items = {
    three: scoreThree(metrics.three),
    five: scoreByDeviation(metrics.five.deviation, THRESHOLDS.five),
    symmetry: scoreByDeviation(metrics.symmetry, THRESHOLDS.symmetry),
    golden: scoreByDeviation(Math.abs(metrics.golden - IDEAL.golden), THRESHOLDS.golden),
    balance: scoreByDeviation(Math.abs(metrics.balance - IDEAL.balance), THRESHOLDS.balance),
  }

  const total = Math.round(
    Object.keys(WEIGHTS).reduce((sum, k) => sum + WEIGHTS[k] * items[k], 0),
  )
  const score = { total, grade: gradeOf(total), items }

  return {
    score,
    advice: buildAdvice(metrics, params),
    copy: buildCopy(metrics, score),
  }
}
