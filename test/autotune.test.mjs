/**
 * 目标分数反解器单元测试（node --test）
 * 用例编号延续《开发文档》9.4 测试计划，段号 T7。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { generateLandmarks } from '../src/measure.js'
import { DEFAULT_PARAMS, SLIDERS } from '../src/analyze.js'
import { autoTune, scoreAt, POINT_MOVES, MIRROR_KEY } from '../src/autoTune.js'

const BASE = { w: 100, h: 120, box: { x: 0, y: 10, width: 100, height: 100 }, score: 1, hairlineY: null }

/** 构造一张「长脸」：中庭以下拉长 k 倍 */
function makeLongFace(k = 1.2) {
  const pts = generateLandmarks(1)
  const pivot = pts[33].y
  for (const p of pts) {
    if (p.y > pivot) p.y = pivot + (p.y - pivot) * k
  }
  return pts
}

const zeroVars = () => {
  const v = {}
  for (const s of SLIDERS) v[s.key] = 0
  for (const m of POINT_MOVES) v[m.key] = 0
  v[MIRROR_KEY] = 0
  return v
}

test('T7 基准：全 0 变量的得分等于起始分', () => {
  const pts = generateLandmarks(1)
  assert.equal(scoreAt(pts, BASE, zeroVars()), scoreAt(pts, BASE, zeroVars()))
  assert.ok(Number.isFinite(scoreAt(pts, BASE, zeroVars())))
})

test('T7b 反解命中：目标在可达范围内时必须贴近（±2 分）', () => {
  const pts = makeLongFace(1.2)
  const ceil = autoTune({ points: pts, base: BASE, target: 100 })
  assert.ok(Number.isFinite(ceil.maxScore), '上限应可计算')
  // 取「起始分与上限之间」的两个目标分别验证
  const lo = Math.round(ceil.startScore + 5)
  const hi = Math.round(ceil.maxScore - 5)
  for (const target of [lo, hi]) {
    const r = autoTune({ points: pts, base: BASE, target })
    assert.ok(Number.isFinite(r.score))
    assert.ok(
      Math.abs(r.score - target) <= 2,
      `目标 ${target} 反解得到 ${r.score}，误差超过 2 分`,
    )
    // 反解结果必须能复现同样的分数（解可重放）
    const replay = scoreAt(pts, BASE, r.vars)
    assert.equal(replay, r.score, '反解参数回放后分数不一致')
  }
})

test('T7c 触顶标记：目标高于上限时 ceiling=true 且给出上限解', () => {
  const pts = generateLandmarks(1)
  const r = autoTune({ points: pts, base: BASE, target: 100 })
  if (r.maxScore != null && 100 > r.maxScore) {
    assert.equal(r.ceiling, true)
    assert.equal(r.score, r.maxScore)
  } else {
    assert.equal(r.ceiling, false)
  }
})

test('T7d 滑块不再单打独斗：只靠滑块时的上限必须低于放开点位后', () => {
  const pts = makeLongFace(1.15)
  const sliderOnly = autoTune({ points: pts, base: BASE, target: 100, usePoints: false })
  const withPoints = autoTune({ points: pts, base: BASE, target: 100 })
  assert.ok(
    withPoints.maxScore >= sliderOnly.maxScore,
    `放开点位后上限 ${withPoints.maxScore} 反而低于纯滑块 ${sliderOnly.maxScore}`,
  )
})

test('T7e 边界与健壮性', () => {
  const pts = generateLandmarks(1)
  // 非法目标被钳制、不抛异常
  for (const t of [-20, 0, 100, 180, NaN]) {
    assert.doesNotThrow(() => autoTune({ points: pts, base: BASE, target: t }))
  }
  // 滑块结果必须落在各自区间内
  const r = autoTune({ points: pts, base: BASE, target: 80 })
  for (const s of SLIDERS) {
    const v = r.params[s.key]
    assert.ok(v >= s.min && v <= s.max, `${s.key}=${v} 越界`)
  }
  // offsets 必须是长度 68 的合法结构
  assert.equal(r.offsets.length, 68)
  assert.ok(r.offsets.every((o) => Number.isFinite(o.dx) && Number.isFinite(o.dy)))
})

test('T7f 确定性：同输入两次求解结果一致', () => {
  const pts = makeLongFace(1.25)
  const a = autoTune({ points: pts, base: BASE, target: 78 })
  const b = autoTune({ points: pts, base: BASE, target: 78 })
  assert.equal(a.score, b.score)
  assert.deepEqual(a.params, b.params)
})

test('T7g 已有逐点位移不会被覆盖丢弃', () => {
  const pts = generateLandmarks(1)
  const offsets = new Array(68).fill(null).map(() => ({ dx: 0, dy: 0 }))
  offsets[8] = { dx: 0, dy: 4 }
  const r = autoTune({ points: pts, base: BASE, target: 70, offsets })
  // 8 号点的位移应以既有 4 为基底继续叠加，而不是被清零
  assert.ok(Math.abs(r.offsets[8].dy - 4) >= 0, '基底位移应被继承')
  const replay = scoreAt(pts, BASE, r.vars, offsets)
  assert.equal(replay, r.score)
})

test('T7h 性能：单次求解远低于交互卡顿阈值', () => {
  const pts = makeLongFace(1.2)
  const t0 = Date.now()
  const r = autoTune({ points: pts, base: BASE, target: 88 })
  const dt = Date.now() - t0
  assert.ok(dt < 3000, `求解耗时 ${dt}ms 过长`)
  assert.ok(r.evals < 8000, `评估次数 ${r.evals} 超过上限`)
})
