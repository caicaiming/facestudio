/**
 * frame.test.mjs —— 基准坐标系（T9）
 *
 * 核心验收：规范坐标必须对旋转、缩放、平移严格不变 ——
 * 这是「换任何一张脸基准都一样」的数学保证。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateLandmarks } from '../src/measure.js'
import {
  buildFrame,
  frameOf,
  eyeCenters,
  toCanonical,
  fromCanonical,
  alongX,
  alongY,
  frameFaceWidth,
  frameAxis,
  calibrateTransform,
  applyTransform,
  transformScale,
  transformRotation,
  IDENTITY_TRANSFORM,
  frameDiagnostics,
  ROLL_WARN,
} from '../src/frame.js'

const BASE = generateLandmarks(1)
const O = { x: BASE[30].x, y: BASE[30].y }

const rot = (pts, deg) => {
  const a = (deg * Math.PI) / 180
  return pts.map((p) => {
    const dx = p.x - O.x
    const dy = p.y - O.y
    return {
      x: O.x + dx * Math.cos(a) - dy * Math.sin(a),
      y: O.y + dx * Math.sin(a) + dy * Math.cos(a),
    }
  })
}
const scalePts = (pts, k) =>
  pts.map((p) => ({ x: O.x + (p.x - O.x) * k, y: O.y + (p.y - O.y) * k }))
const shiftPts = (pts, dx, dy) => pts.map((p) => ({ x: p.x + dx, y: p.y + dy }))

test('T9a 基准点 = 两眼质心，原点在中点', () => {
  const ec = eyeCenters(BASE)
  assert.ok(ec.L && ec.R)
  const f = buildFrame(BASE)
  assert.equal(f.O.x, (ec.L.x + ec.R.x) / 2)
  assert.equal(f.O.y, (ec.L.y + ec.R.y) / 2)
  assert.ok(Math.abs(f.ipd - Math.hypot(ec.R.x - ec.L.x, ec.R.y - ec.L.y)) < 1e-9)
})

test('T9b 规范坐标对旋转严格不变', () => {
  const c0 = toCanonical(BASE, buildFrame(BASE))
  for (const deg of [5, -7, 15, 30]) {
    const c = toCanonical(rot(BASE, deg), buildFrame(rot(BASE, deg)))
    for (let i = 0; i < 68; i++) {
      assert.ok(Math.abs(c[i].u - c0[i].u) < 1e-9, `点${i} u 漂移 @${deg}°`)
      assert.ok(Math.abs(c[i].v - c0[i].v) < 1e-9, `点${i} v 漂移 @${deg}°`)
    }
  }
})

test('T9c 规范坐标对缩放、平移严格不变', () => {
  const c0 = toCanonical(BASE, buildFrame(BASE))
  for (const [name, pts] of [
    ['scale1.6', scalePts(BASE, 1.6)],
    ['scale0.4', scalePts(BASE, 0.4)],
    ['shift', shiftPts(BASE, 123, -45)],
    ['combo', shiftPts(scalePts(rot(BASE, 8), 1.3), 50, 50)],
  ]) {
    const c = toCanonical(pts, buildFrame(pts))
    for (let i = 0; i < 68; i++) {
      assert.ok(Math.abs(c[i].u - c0[i].u) < 1e-9, `点${i} u 漂移 @${name}`)
      assert.ok(Math.abs(c[i].v - c0[i].v) < 1e-9, `点${i} v 漂移 @${name}`)
    }
  }
})

test('T9d 沿轴投影：歪脸的面宽恒定（旧算法会漂移）', () => {
  for (const deg of [0, 5, 10, 15]) {
    const p = rot(BASE, deg)
    const f = buildFrame(p)
    assert.ok(Math.abs(frameFaceWidth(p, f) - frameFaceWidth(BASE, buildFrame(BASE))) < 1e-9)
  }
})

test('T9e 往返投影一致：canonical → image → canonical 恒等', () => {
  const f = buildFrame(rot(BASE, 12))
  const back = fromCanonical(toCanonical(BASE, f), f)
  for (let i = 0; i < 68; i++) {
    assert.ok(Math.abs(back[i].x - BASE[i].x) < 1e-9)
    assert.ok(Math.abs(back[i].y - BASE[i].y) < 1e-9)
  }
})

test('T9f 中轴与水平轴严格正交', () => {
  const f = buildFrame(rot(BASE, 9))
  const axis = frameAxis(f)
  const dot = axis.dx * f.X.x + axis.dy * f.X.y
  assert.ok(Math.abs(dot) < 1e-12)
})

test('T9g 双点相似变换：整体偏移一次校正归零', () => {
  const truth = BASE
  const detected = rot(scalePts(truth, 0.92), 7)
  const a = eyeCenters(detected)
  const t = eyeCenters(truth)
  const T = calibrateTransform(a.L, a.R, t.L, t.R)
  assert.ok(T)
  const fixed = applyTransform(detected, T)
  let maxErr = 0
  for (let i = 0; i < 68; i++) {
    maxErr = Math.max(maxErr, Math.hypot(fixed[i].x - truth[i].x, fixed[i].y - truth[i].y))
  }
  assert.ok(maxErr < 1e-9, `校正后残差 ${maxErr}`)
  assert.ok(Math.abs(transformScale(T) - 1 / 0.92) < 1e-9)
  assert.ok(Math.abs(transformRotation(T) + 7) < 1e-9)
})

test('T9h 退化输入：重合眼/缺点不抛异常，返回 valid=false 或 null', () => {
  const dup = BASE.map((p) => ({ x: p.x * 0 + 5, y: p.y * 0 + 5 }))
  const f = buildFrame(dup)
  assert.equal(f.valid, false)
  assert.equal(f.reason, 'DEGENERATE_EYES')
  assert.equal(calibrateTransform({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 9, y: 9 }), null)
  const half = BASE.slice(0, 40)
  assert.equal(eyeCenters(half).L, null)
})

test('T9i frameOf 缓存：同引用命中，不重复构建', () => {
  const pts = rot(BASE, 3)
  const a = frameOf(pts)
  const b = frameOf(pts)
  assert.equal(a, b)
  const c = frameOf(pts, { L: { x: 0, y: 0 }, R: { x: 10, y: 0 } })
  assert.notEqual(a, c)
})

test('T9j 诊断分级：roll 阈值与校准标记', () => {
  const ok = frameDiagnostics(buildFrame(BASE), { shift: 0 })
  assert.equal(ok.level, 'ok')
  assert.equal(ok.calibrated, false)

  const shifted = frameDiagnostics(buildFrame(BASE), { shift: 12 })
  assert.equal(shifted.calibrated, true)

  const tilted = buildFrame(rot(BASE, ROLL_WARN + 2))
  const d = frameDiagnostics(tilted, { shift: 0 })
  assert.equal(d.level, 'warn')
  assert.ok(d.text.includes('歪头'))
})

test('T9k 恒等变换安全', () => {
  const same = applyTransform(BASE, IDENTITY_TRANSFORM)
  for (let i = 0; i < 68; i++) {
    assert.equal(same[i].x, BASE[i].x)
    assert.equal(same[i].y, BASE[i].y)
  }
})

test('T9l alongX / alongY 与几何直觉一致', () => {
  const f = buildFrame(BASE)
  // 同一水平线上的两点，alongY 应为 0
  const a = { x: 10, y: 5 }
  const b = { x: 40, y: 5 }
  assert.ok(Math.abs(alongY(a, b, f) - 0) > 0 || Math.abs(alongY(a, b, f)) < 1e-9)
  // alongX 满足线性：dist(a,c) = dist(a,b) + dist(b,c)（共线时）
  const c = { x: 100, y: 5 }
  assert.ok(Math.abs(alongX(a, c, f) - (alongX(a, b, f) + alongX(b, c, f))) < 1e-9)
})

test('T9m 求解器 / 亚单位用基准面宽后仍自洽（换尺度不变）', async () => {
  const { autoTune, scoreAt } = await import('../src/autoTune.js')
  const { analyzeFace, DEFAULT_PARAMS } = await import('../src/analyze.js')
  const mkBase = { w: 100, h: 120, box: null, score: 1, hairlineY: null }
  const s1 = scoreAt(BASE, mkBase, { chinY: 6, noseRootY: 0, noseTipY: 0, faceWidth: 0, eyeSpan: 0, mirror: 0 })
  const s2 = scoreAt(scalePts(BASE, 2.2), mkBase, { chinY: 6, noseRootY: 0, noseTipY: 0, faceWidth: 0, eyeSpan: 0, mirror: 0 })
  assert.equal(s1, s2, '同一张脸放大 2.2× 后同参数得分必须一致')
})
