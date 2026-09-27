/**
 * detect.test.mjs —— 检测输入的尺寸归一化（T14）
 *
 * 背景（可复现的线上 bug）：同一张脸等比放大到 3×/4× 后，检测框宽高比
 * 从 1.35 塌到 1.02，点位被挤成一团，平均偏差 78px。根因是检测器把大图
 * 一次性双线性缩到 416，比例越极端越糊。解法是检测前先降采样再还原坐标。
 *
 * 这里守的是「还原」这一步的纯数学部分：缩放系数与坐标映射，
 * 保证任意尺寸下点位回到原图坐标系后与尺寸无关。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DETECT_MAX_EDGE,
  detectScale,
  mapPointsBack,
  mapBoxBack,
} from '../src/detect.js'

const PTS = [
  { x: 100, y: 120 },
  { x: 400, y: 300 },
  { x: 800, y: 640 },
]

test('T14a 小图不缩放：系数恒为 1', () => {
  assert.equal(detectScale(640, 480), 1)
  assert.equal(detectScale(1024, 1024), 1)
  assert.equal(detectScale(DETECT_MAX_EDGE, DETECT_MAX_EDGE), 1)
})

test('T14b 大图按最长边缩到上限内', () => {
  const s = detectScale(4000, 3000)
  assert.ok(Math.abs(s - DETECT_MAX_EDGE / 4000) < 1e-12)
  assert.ok(4000 * s <= DETECT_MAX_EDGE + 1e-9)
  // 短边同比缩放，宽高比不变
  assert.ok(Math.abs(3000 * s - 1200) < 1e-9)
})

test('T14c 竖图同样按最长边算（不能拿宽当基准）', () => {
  const s = detectScale(3024, 4032) // 手机竖拍
  assert.ok(Math.abs(s - DETECT_MAX_EDGE / 4032) < 1e-12)
  assert.ok(4032 * s <= DETECT_MAX_EDGE + 1e-9)
})

test('T14d 非法尺寸不炸，退化为 1', () => {
  assert.equal(detectScale(0, 100), 1)
  assert.equal(detectScale(100, 0), 1)
  assert.equal(detectScale(-5, -5), 1)
})

test('T14e 点位还原：先缩后还原回到原坐标（往返一致）', () => {
  const s = 0.4
  const back = mapPointsBack(PTS.map((p) => ({ x: p.x * s, y: p.y * s })), s)
  for (let i = 0; i < PTS.length; i++) {
    assert.ok(Math.abs(back[i].x - PTS[i].x) < 1e-9)
    assert.ok(Math.abs(back[i].y - PTS[i].y) < 1e-9)
  }
})

test('T14f 点位还原：scale=1 或非法值原样返回（不产生 NaN）', () => {
  assert.deepEqual(mapPointsBack(PTS, 1), PTS)
  assert.deepEqual(mapPointsBack(PTS, 0), PTS)
  assert.deepEqual(mapPointsBack(PTS, undefined), PTS)
  assert.equal(mapPointsBack(null, 0.5), null)
})

test('T14g 检测框还原：Box 的 getter 逐个取值后再缩放', () => {
  // face-api 的 Box.x/y/width/height 是原型 getter，{...box} 会全丢
  const box = { x: 200, y: 150, width: 800, height: 600 }
  const back = mapBoxBack(box, 0.5)
  assert.deepEqual(back, { x: 400, y: 300, width: 1600, height: 1200 })
  assert.deepEqual(mapBoxBack(box, 1), box)
})

test('T14h 尺寸无关性：同一张脸不同尺寸，还原后坐标一致', () => {
  // 模拟「同一张脸被放大 3 倍」：检测用图坐标随倍数线性放大
  const base = [0, 1, 2].map((i) => ({ x: 100 + i * 50, y: 200 + i * 30 }))
  for (const S of [1, 2, 3, 4, 6]) {
    const s = detectScale(1024 * S, 1024 * S)
    const detected = base.map((p) => ({ x: p.x * S * s, y: p.y * S * s }))
    const restored = mapPointsBack(detected, s)
    for (let i = 0; i < base.length; i++) {
      // 还原到「检测用图」尺度后应与基准严格成 S 倍关系
      assert.ok(Math.abs(restored[i].x - base[i].x * S) < 1e-9)
      assert.ok(Math.abs(restored[i].y - base[i].y * S) < 1e-9)
    }
  }
})
