/**
 * 纯函数层单元测试（node --test）
 * 用例编号与《开发文档》9.4 测试计划一一对应。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  measureFace,
  getDeformedPoints,
  generateLandmarks,
  RIGHT_HALF,
  LEFT_HALF,
  MID_LINE,
} from '../src/measure.js'
import { analyzeFace, scoreByDeviation, DEFAULT_PARAMS, SLIDERS } from '../src/analyze.js'

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
