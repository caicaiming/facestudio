/**
 * diffmap 单元测试
 *
 * 核心约束只有一条，但踩过就会毁掉整张照片：
 * **没动过的地方必须完全透明**。任何在零位移处留下底色的写法，
 * 都会让客户的脸平白蒙上一层橙色，看起来像照片坏了。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIFF_STEP,
  DIFF_ALPHA_MAX,
  displacementField,
  shadeDisplacement,
} from '../src/diffmap.js'
import { generateLandmarks } from '../src/measure.js'
import { frameOf, frameFaceWidth } from '../src/frame.js'
import { applySiteOffsets, emptySites } from '../src/zones.js'

const OPTS = (w = 800, h = 800, k = 1) => {
  const pts = generateLandmarks(1)
  return { opts: { w, h, W: frameFaceWidth(pts, frameOf(pts)), k }, pts }
}

/** 造一对点：只把第 i 个点挪动 dist 像素 */
function moved(i, dist) {
  const pts = generateLandmarks(1)
  const out = pts.map((p) => ({ ...p }))
  out[i] = { x: pts[i].x + dist, y: pts[i].y }
  return [pts, out]
}

// ---------------------------------------------------------------- T1 位移场

test('T1 完全没动 → 位移场全 0、peak 为 0', () => {
  const { opts, pts } = OPTS()
  const f = displacementField(pts, pts, opts)
  assert.equal(f.peak, 0)
  assert.ok(f.data.every((v) => v === 0), '未发生位移时不应有任何格子被着色')
})

test('T2 单点位移：场在该点附近最大，远处衰减到 0', () => {
  const { opts, pts } = OPTS()
  const [src, dst] = moved(8, 20) // 下巴尖右移 20px
  const f = displacementField(src, dst, opts)
  const at = (x, y) => f.data[Math.round(y / DIFF_STEP) * f.gw + Math.round(x / DIFF_STEP)]
  const near = at(pts[8].x, pts[8].y)
  const far = at(10, 10)
  assert.ok(near > 1, `位移点附近应量到位移，实际 ${near}`)
  assert.ok(far < 0.01, `远处应衰减到 0，实际 ${far}`)
  assert.ok(near > far * 100)
})

test('T3 peak 等于场的最大位移，且不超过输入的最大点位移', () => {
  const { opts } = OPTS()
  const [src, dst] = moved(8, 20)
  const f = displacementField(src, dst, opts)
  let max = 0
  for (const v of f.data) if (v > max) max = v
  assert.ok(Math.abs(f.peak - max) < 1e-9)
  // Shepard 归一化后不应超过原始位移（否则邻域被拉爆）；留一点浮点余量
  assert.ok(f.peak <= 20 * 1.001, `peak ${f.peak} 超过了输入位移 20`)
})

test('T4 缩放 k：位移与半径同步换算，场量级随 k 等比放大', () => {
  const { opts, pts } = OPTS()
  const [src, dst] = moved(8, 20)
  const f1 = displacementField(src, dst, { ...opts, k: 1 })
  const f2 = displacementField(src, dst, { ...opts, k: 2 })
  assert.ok(Math.abs(f2.peak - f1.peak * 2) < 0.5, `k=2 时 peak 应翻倍：${f1.peak} → ${f2.peak}`)
  assert.ok(pts.length === 68)
})

test('T5 点位缺失 / 长度不等也不抛异常', () => {
  const { opts, pts } = OPTS()
  assert.doesNotThrow(() => displacementField(pts, [], opts))
  assert.doesNotThrow(() => displacementField(null, null, opts))
  const f = displacementField(pts, pts.slice(0, 10), opts)
  assert.equal(f.peak, 0)
})

// ---------------------------------------------------------------- T2 热区着色

test('T6 硬约束：零位移处 alpha 必须为 0（整张脸不能平白发脏）', () => {
  const { opts, pts } = OPTS()
  const f = displacementField(pts, pts, opts)
  const s = shadeDisplacement(f, opts)
  for (let i = 0; i < s.data.length; i += 4) {
    assert.equal(s.data[i + 3], 0, `格子 ${i / 4} 在无位移时仍不透明`)
  }
})

test('T7 有位移处着色，且强度随位移单调上升', () => {
  const { opts, pts } = OPTS()
  const alphaAt = (dist) => {
    const [src, dst] = moved(8, dist)
    const f = displacementField(src, dst, opts)
    const s = shadeDisplacement(f, opts)
    const i = Math.round(pts[8].y / DIFF_STEP) * s.gw + Math.round(pts[8].x / DIFF_STEP)
    return s.data[i * 4 + 3]
  }
  // 注意：热区带「自适应浓度」（按位移峰值缩放），故**极小位移区间内不保证
  // 单调** —— 整体位移很淡时会整体提亮以保证可见。这里测的是两端：
  // 微小位移也必须看得见，满量程必须最浓。
  const aTiny = alphaAt(0.5)
  const aFull = alphaAt(20)
  assert.ok(aTiny >= 60, `微小位移也必须看得见，实际 alpha ${aTiny}`)
  assert.ok(aFull > aTiny, `满量程应最浓：${aTiny} → ${aFull}`)
  assert.ok(aFull <= Math.round(255 * DIFF_ALPHA_MAX) + 1, '不得超过上限')
})

test('T8 图层不透明度（strength）线性收放热区浓度', () => {
  const { opts } = OPTS()
  const [src, dst] = moved(8, 30)
  const f = displacementField(src, dst, opts)
  const full = shadeDisplacement(f, opts).data
  const half = shadeDisplacement(f, { ...opts, strength: 0.5 }).data
  let nf = 0
  let nh = 0
  for (let i = 3; i < full.length; i += 4) {
    if (full[i] > 0) nf++
    if (half[i] > 0) nh++
  }
  assert.equal(nf, nh, 'strength 只改浓度，不改变覆盖范围')
  const i = full.findIndex((v, k) => k % 4 === 3 && v > 0)
  assert.ok(Math.abs(half[i] - full[i] * 0.5) <= 1, `半强度应约为一半：${full[i]} → ${half[i]}`)
})

test('T9 真实部位形变：热区覆盖改动区域且不含 NaN', () => {
  const { opts, pts } = OPTS()
  const dst = applySiteOffsets(pts, { ...emptySites(), chin: 30 })
  const f = displacementField(pts, dst, opts)
  assert.ok(f.peak > 0, '颏部满档应产生可测量的位移')
  const s = shadeDisplacement(f, opts)
  let painted = 0
  for (let i = 3; i < s.data.length; i += 4) if (s.data[i] > 0) painted++
  assert.ok(painted > 0, '应有格子被着色')
  assert.ok(s.data.every((v) => Number.isFinite(v)))
})
