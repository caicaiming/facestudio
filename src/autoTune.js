/**
 * 目标分数反解器（纯函数层，零 React 依赖，可用 node --test 直接验证）。
 *
 * ── 问题 ────────────────────────────────────────────────────────────
 * 已知：点位 → 几何指标 → 综合评分。
 * 未知：要达到某个分数，参数该取多少 —— 5 维以上、无解析梯度的搜索问题。
 *
 * 评分经过「距离 → 分段打分 → 加权取整」，既非单调也不连续可导；
 * 暴力枚举 5 路滑块是 31^5 ≈ 2860 万次评估，不可行。
 *
 * ── 为什么必须带上「点位自由度」─────────────────────────────────────
 * 实测：5 路预设形变里只有「下巴」能明显改变分数 —— 额头/颧骨/嘴巴的推拉
 * 根本不触及评分所用的采样点（鼻子 Platforms、下颌角、眼角间距），
 * 于是 draw 再多也压不动分数。真正决定各分项的关键点是：
 *   three(0.3)   ← 8/27/33 的 y       five(0.2) ← 0/16/36/39/42/45 的 x
 *   golden(0.2)  ← 27/33/8 的 y       balance(0.1) ← 27/30/33/51/57 的 y
 * 因此求解器在滑块之外，额外开放一组「对称位移」变量（成对移动镜像点，
 * 避免把对称分拉垮），两者在同一轮坐标下降里竞争。
 *
 * ── 算法 ────────────────────────────────────────────────────────────
 * 坐标下降 + 递减步长（pattern search）：
 *   每个变量依次试 ±step，只在代价下降时接受；步长由粗到细（先定位盆地，
 *   再逐位精修），并以「分数误差」为主导、「形变总量」为 tie-break ——
 *   同样是 78 分时，优先选动得最少的那组参数。
 */
import { analyzeFace, DEFAULT_PARAMS, SLIDERS } from './analyze.js'
import {
  applyPointOffsets,
  fitLine,
  getDeformedPoints,
  measureFace,
  mirrorPoint,
  LEFT_HALF,
  RIGHT_HALF,
} from './measure.js'
import { frameOf, frameFaceWidth } from './frame.js'

/** 单次评估约 0.2ms，但组合搜索会跑上千次，留一道上限防止退化输入下卡死 */
const MAX_EVALS = 8000

/**
 * 点位自由度：成对（或单点）位移的单位方向。
 * dx / dy 为方向权重，实际位移 = 方向 × 变量值 × 面宽单位。
 * 成对移动镜像点是为了不牺牲「对称」分。
 */
export const POINT_MOVES = [
  { key: 'chinY', label: '下巴尖', moves: [[8, 0, 1]] },
  { key: 'noseRootY', label: '鼻根', moves: [[27, 0, 1]] },
  { key: 'noseTipY', label: '鼻尖', moves: [[33, 0, 1]] },
  { key: 'faceWidth', label: '面宽', moves: [[0, -1, 0], [16, 1, 0]] },
  { key: 'eyeSpan', label: '眼距', moves: [[36, -1, 0], [45, 1, 0]] },
]

/**
 * 「对称化」自由度：朝镜像位置插值的强度，0 = 不动，0.6 = 高度对称。
 * 权重 0.2 的对称分只能靠它提升；上限刻意不取 1，避免把半张脸完全复制
 * 到另一侧（那样五官会失真，也失去了自动化妆的价值）。
 */
export const MIRROR_KEY = 'mirror'
export const MIRROR_LIMIT = 0.6

/** 滑块整数步进序列；点位位移用面宽百分比步进 */
const SLIDER_STEPS = [8, 4, 2, 1]
const MOVE_STEPS = [0.06, 0.03, 0.015, 0.0075]
/** 点位位移上限（面宽占比）：超过这个量，脸型会被拉得失真 */
const MOVE_LIMIT = 0.14

const clampRange = (v, min, max) => (v < min ? min : v > max ? max : v)

/**
 * 单位换算：以面宽为尺度，保证不同分辨率的照片用同一套步长。
 * measureFace 里 W = |points[16].x - points[0].x|
 */
function faceUnitOf(points) {
  const f = frameOf(points)
  const w = f.valid ? frameFaceWidth(points, f) : Math.abs(points[16].x - points[0].x)
  return w > 0 ? w : 1
}

/**
 * 把点位插到镜像位置所需的位移表（单位向量形式：t=1 时完全对称）。
 * 结构与 measureFace 的对称计算保持一致 —— 同样用 [8,27,30] 拟合中轴。
 */
function mirrorDeltasOf(points) {
  const axis = fitLine([points[8], points[27], points[30]])
  const deltas = new Array(68)
  for (let i = 0; i < 68; i++) deltas[i] = { dx: 0, dy: 0 }
  for (let n = 0; n < 29; n++) {
    const r = points[RIGHT_HALF[n]]
    const l = points[LEFT_HALF[n]]
    if (!r || !l) continue
    const mr = mirrorPoint(r, axis)
    const ml = mirrorPoint(l, axis)
    deltas[RIGHT_HALF[n]] = { dx: mr.x - r.x, dy: mr.y - r.y }
    deltas[LEFT_HALF[n]] = { dx: ml.x - l.x, dy: ml.y - l.y }
  }
  return deltas
}

/** 把变量表展开成 (params, offsets)，offsets 以既有位移为基底叠加 */
function expand(vars, unit, baseOffsets, mirrorDeltas = null) {
  const params = { ...DEFAULT_PARAMS }
  for (const s of SLIDERS) params[s.key] = clampRange(vars[s.key] ?? 0, s.min, s.max)

  const offsets = new Array(68)
  for (let i = 0; i < 68; i++) offsets[i] = { dx: 0, dy: 0 }
  if (baseOffsets) {
    for (let i = 0; i < 68; i++) {
      const o = baseOffsets[i]
      if (!o) continue
      offsets[i] = { dx: o.dx || 0, dy: o.dy || 0 }
    }
  }
  for (const m of POINT_MOVES) {
    const v = vars[m.key] ?? 0
    if (!v) continue
    for (const [idx, wx, wy] of m.moves) {
      offsets[idx].dx += wx * v * unit
      offsets[idx].dy += wy * v * unit
    }
  }
  const t = vars[MIRROR_KEY] ?? 0
  if (t && mirrorDeltas) {
    for (let i = 0; i < 68; i++) {
      offsets[i].dx += mirrorDeltas[i].dx * t
      offsets[i].dy += mirrorDeltas[i].dy * t
    }
  }
  return { params, offsets }
}

/**
 * 计算某组变量下的综合得分。
 * @param {Point[]} points 原始 68 点
 * @param {Object} base    measureFace 基准信息（w/h/box/score/hairlineY）
 * @param {Object} vars    变量表（滑块 + 点位自由度）
 * @param {?Array} baseOffsets 已有的逐点位移
 */
export function scoreAt(points, base, vars, baseOffsets = null) {
  // 顺序必须与 App 里的 previewPoints 完全一致：预设形变 → 逐点位移
  const { params, offsets } = expand(
    vars,
    faceUnitOf(points),
    baseOffsets,
    mirrorDeltasOf(points),
  )
  const deformed = applyPointOffsets(getDeformedPoints(points, params), offsets)
  const m = measureFace(deformed, base.w, base.h, base.box, base.score, base.hairlineY)
  if (!m || !m.valid) return null
  return analyzeFace(m).score.total
}

/** 形变总量（滑块按档位归一，点位按面宽占比归一），用于同分时的 tie-break */
function deformAmount(vars) {
  let sum = 0
  for (const s of SLIDERS) sum += Math.abs(vars[s.key] ?? 0) / s.max
  for (const m of POINT_MOVES) sum += Math.abs(vars[m.key] ?? 0) / MOVE_LIMIT
  sum += Math.abs(vars[MIRROR_KEY] ?? 0) / MIRROR_LIMIT
  return sum
}

function emptyVars() {
  const v = {}
  for (const s of SLIDERS) v[s.key] = 0
  for (const m of POINT_MOVES) v[m.key] = 0
  v[MIRROR_KEY] = 0
  return v
}

/**
 * 坐标下降：按「粗 → 细」的步长轮次扫描全部变量，只接受代价下降的改动。
 * @param {(vars:Object)=>?number} evalScore
 * @param {(score:number, vars:Object)=>number} cost
 * @param {Object} start 起始变量
 * @param {Object} limits 每个变量的取值下限/上限
 */
function search(evalScore, cost, start, limits) {
  let vars = { ...start }
  let bestScore = evalScore(vars)
  let bestCost = bestScore == null ? Infinity : cost(bestScore, vars)
  let evals = 1

  // 同步推进两套步长：滑块走整数档，点位走面宽百分比
  for (let level = 0; level < SLIDER_STEPS.length && evals < MAX_EVALS; level++) {
    let improved = true
    let guard = 0
    while (improved && guard++ < 12 && evals < MAX_EVALS) {
      improved = false
      for (const s of SLIDERS) {
        const step = SLIDER_STEPS[level] * s.step
        for (const dir of [1, -1]) {
          const cur = vars[s.key] ?? 0
          const next = clampRange(cur + dir * step, s.min, s.max)
          if (next === cur) continue
          const cand = { ...vars, [s.key]: next }
          const sc = evalScore(cand)
          evals++
          if (sc == null) continue
          const c = cost(sc, cand)
          if (c < bestCost - 1e-9) {
            vars = cand
            bestScore = sc
            bestCost = c
            improved = true
          }
        }
      }
      for (const m of POINT_MOVES) {
        const step = MOVE_STEPS[level]
        for (const dir of [1, -1]) {
          const cur = vars[m.key] ?? 0
          const next = clampRange(cur + dir * step, -MOVE_LIMIT, MOVE_LIMIT)
          if (next === cur) continue
          const cand = { ...vars, [m.key]: next }
          const sc = evalScore(cand)
          evals++
          if (sc == null) continue
          const c = cost(sc, cand)
          if (c < bestCost - 1e-9) {
            vars = cand
            bestScore = sc
            bestCost = c
            improved = true
          }
        }
      }
      // 对称化单独一路：步长按 0.3 / 0.15 / 0.075 / 0.04 递减
      const mStep = MIRROR_LIMIT * MOVE_STEPS[level] * 2
      for (const dir of [1, -1]) {
        const cur = vars[MIRROR_KEY] ?? 0
        const next = clampRange(cur + dir * mStep, 0, MIRROR_LIMIT)
        if (next === cur) continue
        const cand = { ...vars, [MIRROR_KEY]: next }
        const sc = evalScore(cand)
        evals++
        if (sc == null) continue
        const c = cost(sc, cand)
        if (c < bestCost - 1e-9) {
          vars = cand
          bestScore = sc
          bestCost = c
          improved = true
        }
      }
    }
  }
  void limits
  return { vars, score: bestScore, cost: bestCost, evals }
}

/**
 * 反解：找到让综合评分最接近 target 的参数组合。
 *
 * 返回值里同时给出「这张脸的可达上限」，目标超出时明确标记 ceiling，
 * 而不是假装达成 —— UI 层据此提示用户改用逐点微调或换照片。
 *
 * @param {Object}  arg.points   原始 68 点
 * @param {Object}  arg.base     measureFace 基准信息
 * @param {number}  arg.target   目标分数 0–100
 * @param {?Array}  arg.offsets  已有的逐点位移（在其基础上继续优化）
 * @param {boolean} arg.usePoints 是否开放点位自由度（默认 true）
 * @returns {{params:Object, offsets:Array, score:?number, startScore:?number,
 *            maxScore:?number, maxParams:Object, maxOffsets:Array,
 *            reached:boolean, ceiling:boolean, evals:number, ms:number}}
 */
export function autoTune({ points, base, target, offsets = null, usePoints = true }) {
  const t0 = Date.now()
  const goal = clampRange(Math.round(target), 0, 100)
  const unit = faceUnitOf(points)
  const start = emptyVars()
  const mirrorDeltas = mirrorDeltasOf(points)
  const evalScore = (v) => scoreAt(points, base, v, offsets)
  const pack = (vars, score) => {
    const e = expand(vars, unit, offsets, mirrorDeltas)
    return { params: e.params, offsets: e.offsets, score, vars }
  }

  const startScore = evalScore(start)

  // ---- 第 1 段：探明这张脸的可达上限（纯最大化）----
  const maxCost = (sc, v) => -sc * 1000 + deformAmount(v)
  const trimmed = usePoints ? start : { ...start }
  const maxRun = usePoints
    ? search(evalScore, maxCost, start, null)
    : search(
        (v) => evalScore({ ...v, ...Object.fromEntries(POINT_MOVES.map((m) => [m.key, 0])) }),
        (sc, v) => maxCost(sc, v),
        trimmed,
        null,
      )
  const maxScore = maxRun.score

  if (maxScore == null || startScore == null) {
    return {
      ...pack(start, startScore),
      startScore,
      maxScore,
      maxParams: { ...DEFAULT_PARAMS },
      maxOffsets: offsets,
      reached: false,
      ceiling: false,
      evals: maxRun.evals,
      ms: Date.now() - t0,
    }
  }

  // 目标不低于上限：直接给出能达到的最高分
  if (goal >= maxScore) {
    return {
      ...pack(maxRun.vars, maxScore),
      startScore,
      maxScore,
      maxParams: pack(maxRun.vars, maxScore).params,
      maxOffsets: pack(maxRun.vars, maxScore).offsets,
      reached: goal === maxScore,
      ceiling: goal > maxScore,
      evals: maxRun.evals,
      ms: Date.now() - t0,
    }
  }

  // ---- 第 2 段：贴近目标（先命中分数，再在同分解里挑形变最小的）----
  const fitCost = (sc, v) => Math.abs(sc - goal) * 1000 + deformAmount(v)
  const fitRun = search(evalScore, fitCost, start, null)

  return {
    ...pack(fitRun.vars, fitRun.score),
    startScore,
    maxScore,
    maxParams: pack(maxRun.vars, maxScore).params,
    maxOffsets: pack(maxRun.vars, maxScore).offsets,
    reached: fitRun.score != null && Math.abs(fitRun.score - goal) <= 1,
    ceiling: false,
    evals: maxRun.evals + fitRun.evals,
    ms: Date.now() - t0,
  }
}
