/**
 * 纯函数层单元测试（node --test）
 * 用例编号与《开发文档》9.4 测试计划一一对应。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  IDEAL,
  measureFace,
  getDeformedPoints,
  generateLandmarks,
  RIGHT_HALF,
  LEFT_HALF,
  MID_LINE,
} from '../src/measure.js'
import {
  analyzeFace,
  scoreByDeviation,
  upperThirdScored,
  DEFAULT_PARAMS,
  SLIDERS,
} from '../src/analyze.js'

/** 构造一张「长脸」：把中庭拉长 20% */
function makeLongFace() {
  const pts = generateLandmarks(1)
  const pivot = pts[33].y
  for (const p of pts) {
    if (p.y > pivot) p.y = pivot + (p.y - pivot) * 1.2
  }
  return pts
}

// ---------------------------------------------------------------- T1

test('T1 镜像对应表完整性：29 对 + 10 中轴 = 68', () => {
  assert.equal(RIGHT_HALF.length, 29)
  assert.equal(LEFT_HALF.length, 29)
  const all = new Set([...RIGHT_HALF, ...LEFT_HALF, ...MID_LINE])
  assert.equal(all.size, 68)
  for (let i = 0; i < 68; i++) assert.ok(all.has(i), `缺少索引 ${i}`)
  // 两侧不得有交集
  const right = new Set(RIGHT_HALF)
  for (const i of LEFT_HALF) assert.ok(!right.has(i), `索引 ${i} 同时出现在两侧`)
})

// ---------------------------------------------------------------- T2

test('T2 指标分辨力：标准脸与长脸的三庭结果必须不同', () => {
  const box = { x: 0, y: 10, width: 100, height: 100 }
  const a = measureFace(generateLandmarks(1), 100, 120, box, 1)
  const b = measureFace(makeLongFace(), 100, 120, box, 1)
  assert.ok(a.valid && b.valid)
  const diff = Math.abs(a.three.lower - b.three.lower)
  assert.ok(diff > 0.02, `下庭差异仅 ${diff}，指标疑似常数化`)
})

test('T2b 分辨率无关性：同一比例的脸在 1x 与 4x 下指标一致', () => {
  const box = (s) => ({ x: 0, y: 10 * s, width: 100 * s, height: 100 * s })
  const a = measureFace(generateLandmarks(1), 100, 120, box(1), 1)
  const b = measureFace(generateLandmarks(4), 400, 480, box(4), 1)
  assert.ok(Math.abs(a.golden - b.golden) < 1e-6)
  assert.ok(Math.abs(a.symmetry - b.symmetry) < 1e-6)
})

test('T2c 完美对称脸的对称偏差应接近 0', () => {
  const m = measureFace(generateLandmarks(1), 100, 120, null, 1)
  assert.ok(m.valid)
  assert.ok(m.symmetry < 1, `标准模板对称偏差为 ${m.symmetry}，过大`)
})

// ---------------------------------------------------------------- T3

test('T3 文案数值一致性：所有百分比数字必须来自 metrics', () => {
  const pts = makeLongFace()
  const metrics = measureFace(pts, 100, 120, { x: 0, y: 10, width: 100, height: 100 }, 0.9)
  const { copy } = analyzeFace(metrics, DEFAULT_PARAMS)

  const allowed = new Set([
    (metrics.three.upper * 100).toFixed(1),
    (metrics.three.middle * 100).toFixed(1),
    (metrics.three.lower * 100).toFixed(1),
    (metrics.five.deviation * 100).toFixed(1),
    metrics.symmetry.toFixed(1),
  ])

  const found = copy.match(/(\d+(?:\.\d+)?)%/g) || []
  assert.ok(found.length > 0, '文案中未找到任何百分比数值')
  for (const token of found) {
    const num = token.replace('%', '')
    assert.ok(allowed.has(num), `文案中的 ${token} 在 metrics 中找不到来源`)
  }
})

test('T3b 处方中的百分比数值同样必须来自 metrics', () => {
  const pts = makeLongFace()
  const metrics = measureFace(pts, 100, 120, { x: 0, y: 10, width: 100, height: 100 }, 0.9)
  const { advice } = analyzeFace(metrics, DEFAULT_PARAMS)
  assert.ok(advice.length > 0)

  const allowed = new Set([
    (metrics.three.upper * 100).toFixed(1),
    (metrics.three.lower * 100).toFixed(1),
    (metrics.five.deviation * 100).toFixed(1),
    metrics.symmetry.toFixed(1),
  ])
  for (const a of advice) {
    for (const token of a.reason.match(/(\d+(?:\.\d+)?)%/g) || []) {
      assert.ok(allowed.has(token.replace('%', '')), `处方中的 ${token} 来源不明`)
    }
  }
})

// ---------------------------------------------------------------- T4

test('T4 防御性：非法输入返回 valid=false 且不抛异常', () => {
  for (const bad of [null, undefined, [], new Array(67).fill({ x: 1, y: 1 })]) {
    const m = measureFace(bad, 100, 100, null, 1)
    assert.equal(m.valid, false)
    assert.equal(m.reason, 'INVALID_LANDMARKS')
  }
  const nan = generateLandmarks(1)
  nan[5] = { x: NaN, y: 1 }
  assert.equal(measureFace(nan, 100, 100, null, 1).valid, false)
})

test('T4b 无效指标不产生处方', () => {
  const { score, advice } = analyzeFace({ valid: false }, DEFAULT_PARAMS)
  assert.equal(score, null)
  assert.equal(advice.length, 0)
})

// ---------------------------------------------------------------- T5

test('T5 形变守恒：全 0 参数返回原点集', () => {
  const pts = generateLandmarks(1)
  const out = getDeformedPoints(pts, DEFAULT_PARAMS)
  for (let i = 0; i < 68; i++) {
    assert.equal(out[i].x, pts[i].x)
    assert.equal(out[i].y, pts[i].y)
  }
})

test('T5b 形变方向正确：滑块为正时对应部位朝预期方向变化', () => {
  const pts = generateLandmarks(1)
  const base = measureFace(pts, 100, 120, null, 1)

  // 下巴加长 → 下庭占比上升
  const chin = measureFace(getDeformedPoints(pts, { ...DEFAULT_PARAMS, chin: 15 }), 100, 120, null, 1)
  assert.ok(chin.three.lower > base.three.lower, '下巴滑块正值应使下庭变长')

  // 嘴巴放大 → 唇部宽度增加
  const p0 = pts[48]
  const p1 = getDeformedPoints(pts, { ...DEFAULT_PARAMS, mouth: 15 })
  assert.ok(Math.abs(p1[54].x - p1[48].x) > Math.abs(pts[54].x - p0.x), '嘴巴滑块正值应放大唇部')

  // 下颌线加宽 → 面宽增加
  const jaw = getDeformedPoints(pts, { ...DEFAULT_PARAMS, jawline: 15 })
  assert.ok(Math.abs(jaw[16].x - jaw[0].x) > Math.abs(pts[16].x - pts[0].x), '下颌线正值应加宽')

  // 额头加高 → 眉毛下移使上庭变长？此处仅验证眉毛发生位移
  const fh = getDeformedPoints(pts, { ...DEFAULT_PARAMS, forehead: 15 })
  assert.notEqual(fh[19].y, pts[19].y, '额头滑块应移动眉毛')
})

test('T5c 形变不级联放大：两路同时作用的位移等于各自位移之和', () => {
  const pts = generateLandmarks(1)
  const onlyChin = getDeformedPoints(pts, { ...DEFAULT_PARAMS, chin: 10 })
  const onlyJaw = getDeformedPoints(pts, { ...DEFAULT_PARAMS, jawline: 10 })
  const both = getDeformedPoints(pts, { ...DEFAULT_PARAMS, chin: 10, jawline: 10 })
  for (let i = 0; i < 68; i++) {
    const expected = pts[i].x + (onlyChin[i].x - pts[i].x) + (onlyJaw[i].x - pts[i].x)
    assert.ok(Math.abs(both[i].x - expected) < 1e-9, `索引 ${i} 的 x 位移被级联放大`)
  }
})

// ---------------------------------------------------------------- T6

test('T6 评分边界：偏差为 0 得满分', () => {
  assert.equal(scoreByDeviation(0, 0.05), 100)
  assert.equal(scoreByDeviation(0.05, 0.05), 100)
  assert.equal(scoreByDeviation(0.1, 0.05), 40) // overflow = 1 → 100 - 60
  assert.equal(scoreByDeviation(999, 0.05), 0)
})

test('T6b 滑块定义与默认参数一一对应', () => {
  for (const s of SLIDERS) {
    assert.ok(s.key in DEFAULT_PARAMS, `滑块 ${s.key} 缺少默认参数`)
    assert.ok(s.min < 0 && s.max > 0, `滑块 ${s.key} 必须是双向的`)
  }
})

// ---------------------------------------------------------------- T7 评分体系修复守卫
// 这一组锁的是咨询师走查（Stage 34）发现的两个硬伤：
//   ① 「黄金分割＝中庭/下庭，理想 0.618」与三庭均等数学互斥，标准脸恒 0 分；
//   ② 上庭来自发际线推断，却主导权重最高的三庭项。
// 两者都会让咨询师在客户面前报出一个自己解释不了的低分，故单独立一组防回归。

/** 直接构造 Metrics，绕开点位，精确控制每一项 */
function mkMetrics({ up = 1 / 3, mid = 1 / 3, low = 1 / 3, source = 'scan', balance = 0.55 } = {}) {
  return {
    three: { upper: up, middle: mid, lower: low, estimated: true, source },
    five: { segments: [], ratios: [0.2, 0.2, 0.2, 0.2, 0.2], deviation: 0 },
    symmetry: 0,
    golden: mid + low > 0 ? low / (mid + low) : null,
    balance,
    focal: null,
    yaw: 0,
    confidence: 0.9,
    faceTop: 0,
    faceHeight: 100,
    valid: true,
    reason: null,
  }
}

test('T7a 下庭占比的语义：下庭 /（中庭＋下庭），落在 0–1 且三庭均等时为 0.5', () => {
  assert.equal(IDEAL.golden, 0.5, '理想值必须是 0.5，0.618 与三庭互斥')
  const m = mkMetrics()
  assert.equal(m.golden, 0.5)
  // 下庭越长占比越高，方向与旧语义（中庭/下庭）相反
  assert.ok(mkMetrics({ up: 0.2, mid: 0.3, low: 0.5 }).golden > 0.5)
  assert.ok(mkMetrics({ up: 0.2, mid: 0.5, low: 0.3 }).golden < 0.5)
})

test('T7b 真实点位测出的 golden 与三庭自洽（下庭占比 = 下庭/(中庭+下庭)）', () => {
  const pts = generateLandmarks(1)
  const m = measureFace(pts, 800, 800, { x: 0, y: 0, width: 800, height: 800 }, 0.8, null)
  const expect = m.three.lower / (m.three.middle + m.three.lower)
  assert.ok(Math.abs(m.golden - expect) < 1e-9, `golden=${m.golden} 应等于 ${expect}`)
  assert.ok(m.golden > 0 && m.golden < 1, '占比必须落在 0–1')
})

test('T7c 互斥已解除：教科书标准脸（三庭 1:1:1）能拿到接近满分', () => {
  const s = analyzeFace(mkMetrics()).score
  assert.equal(s.items.three, 100)
  assert.equal(s.items.golden, 100, '三庭均等时下庭占比必须满分（旧定义此处恒为 0）')
  assert.ok(s.total >= 95, `标准脸综合分应接近满分，实际 ${s.total}`)
})

test('T7d 上庭只在发际线来自图像扫描时计分', () => {
  assert.equal(upperThirdScored(mkMetrics({ source: 'scan' }).three), true)
  assert.equal(upperThirdScored(mkMetrics({ source: 'box' }).three), false)
  assert.equal(upperThirdScored(mkMetrics({ source: 'geometric' }).three), false)
  assert.equal(upperThirdScored({ upper: null, source: 'scan' }), false, '上庭缺失同样不计分')
})

test('T7e 发际线不可信时，上庭偏大不再拖垮三庭得分', () => {
  // 上庭 40% 是推断值（可能只是发型造成的），中下庭真实且接近标准
  const asScan = analyzeFace(mkMetrics({ up: 0.4, mid: 0.31, low: 0.29, source: 'scan' })).score
  const asBox = analyzeFace(mkMetrics({ up: 0.4, mid: 0.31, low: 0.29, source: 'box' })).score
  assert.ok(asBox.items.three > asScan.items.three, '排除估算项后三庭得分应更高')
  assert.ok(asBox.items.three >= 90, `中下庭接近标准时不应被打低，实际 ${asBox.items.three}`)
  assert.ok(asScan.items.three < 70, 'scan 下上庭确实参与计分，应明显更低')
})

test('T7f 评级一律指向行动，不给客户负面定性', () => {
  const grades = [
    analyzeFace(mkMetrics()).score.grade,
    analyzeFace(mkMetrics({ up: 0.45, mid: 0.3, low: 0.25, balance: 0.68 })).score.grade,
    analyzeFace(mkMetrics({ up: 0.55, mid: 0.25, low: 0.2, balance: 0.75 })).score.grade,
  ]
  for (const g of grades) {
    assert.ok(!/失衡|差|缺陷|畸形/.test(g), `评级「${g}」含负面定性词`)
  }
  assert.equal(grades[0], '比例协调')
})

test('T7g 处方语义与阈值方向一致：下庭占比偏低才建议下巴', () => {
  // 中庭 0.45 / 下庭 0.35 → 下庭占比 0.4375（偏低）→ 应给下巴类建议
  const low = analyzeFace(mkMetrics({ up: 0.2, mid: 0.45, low: 0.35, source: 'box' })).advice
  assert.ok(low.length > 0, '下庭占比 0.4375 应至少产生一条建议')
  const chinish = low.filter((a) => /下巴|下庭|颏/.test(a.target + a.action))
  assert.ok(chinish.length > 0, '下庭占比偏低时应给出下巴相关建议')
  assert.ok(
    !low.some((a) => /中庭偏短/.test(a.action)),
    '下庭占比偏低时不应同时说中庭偏短（两条互斥）',
  )
})
