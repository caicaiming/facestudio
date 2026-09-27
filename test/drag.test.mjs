/**
 * drag.test.mjs —— 拖动阻尼模型（T15）
 *
 * 背景（用户反馈）：在照片上拖点位「没有阻力，很容易就拖大了拖小了」。
 * 根因是屏幕像素与原图像素之间存在隐藏倍率 k = 原图宽 / 显示宽，
 * 高分辨率图上 k 可达 10，手抖 3px 就是脸上 8px 以上。
 *
 * 这一层只验纯数学：增益选择、修饰键覆盖、上限裁剪、滑块相对拖动。
 * 浏览器端的接线由 scripts/smoke-drag.mjs 端到端守住。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DRAG_GAINS,
  DEFAULT_DRAG_GAIN_KEY,
  TEMP_GAIN,
  dampDelta,
  effectiveGain,
  gainOf,
  hitSliderThumb,
  sliderTravelToValue,
  SLIDER_TRAVEL,
} from '../src/drag.js'

const r2 = (v) => Math.round(v * 1e6) / 1e6

// ---------------------------------------------------------------- T15a 增益查表

test('T15a 默认档为阻尼 ½，未知 key 回落到默认', () => {
  assert.equal(DEFAULT_DRAG_GAIN_KEY, 'half')
  assert.equal(gainOf('half'), 0.5)
  assert.equal(gainOf('fine'), 0.25)
  assert.equal(gainOf('full'), 1)
  assert.equal(gainOf('__nope__'), gainOf(DEFAULT_DRAG_GAIN_KEY))
  assert.equal(gainOf(undefined), gainOf(DEFAULT_DRAG_GAIN_KEY))
})

test('T15b 档位表单调且都落在 (0,1]，越靠前越重手', () => {
  assert.deepEqual(
    DRAG_GAINS.map((g) => g.gain),
    [0.25, 0.5, 1],
  )
  for (const g of DRAG_GAINS) assert.ok(g.gain > 0 && g.gain <= 1, `bad gain ${g.key}`)
})

// ---------------------------------------------------------------- T15c 修饰键

test('T15c Shift/Alt 临时覆盖档位，优先级高于任何档', () => {
  for (const g of DRAG_GAINS) {
    assert.equal(effectiveGain(g.key, { shift: true }), TEMP_GAIN.shift)
    assert.equal(effectiveGain(g.key, { alt: true }), TEMP_GAIN.alt)
    assert.equal(effectiveGain(g.key, {}), g.gain)
  }
  // Shift 与 Alt 同时按下时以 Shift 为准（精细优先）
  assert.equal(effectiveGain('full', { shift: true, alt: true }), TEMP_GAIN.shift)
})

// ---------------------------------------------------------------- T15d 阻尼换算

test('T15d 默认档只施加一半位移', () => {
  const g = gainOf('half')
  let total = 0
  // 连续 10 帧、每帧 +3px：结果必须是 15，而不是 30
  for (let i = 0; i < 10; i++) total += dampDelta(3, 0, { gain: g }).dx
  assert.equal(r2(total), 15)
})

test('T15d2 增益不逐帧复利：一次拖动的总位移与帧数无关', () => {
  const mk = (frames) => {
    let sum = 0
    for (let i = 0; i < frames; i++) sum += dampDelta(10 / frames, 0, { gain: 0.5 }).dx
    return r2(sum)
  }
  assert.equal(mk(1), mk(4))
  assert.equal(mk(4), mk(50))
  assert.equal(mk(50), 5)
})

test('T15e 死区：轻微手抖不产生位移', () => {
  const a = dampDelta(0.3, 0.4, { gain: 1, deadZone: 1 })
  assert.equal(a.dx, 0)
  assert.equal(a.dy, 0)
  assert.equal(a.skipped, true)
  // 超过死区则照常通过（不因为小而再打折）
  const b = dampDelta(2, 0, { gain: 1, deadZone: 1 })
  assert.equal(b.dx, 2)
  assert.equal(b.skipped, false)
})

test('T15f 单次位移上限：超出部分按比例压缩而非丢弃', () => {
  const r = dampDelta(60, 80, { gain: 1, maxStep: 10 })
  assert.equal(r.clamped, true)
  assert.equal(r2(Math.hypot(r.dx, r.dy)), 10)
  // 方向保持不变
  assert.equal(r2(r.dy / r.dx), r2(80 / 60))
})

test('T15g 上限不误伤正常位移，0 表示不限', () => {
  assert.equal(dampDelta(4, 0, { gain: 1, maxStep: 10 }).clamped, false)
  assert.equal(dampDelta(400, 0, { gain: 1, maxStep: 0 }).dx, 400)
  // 阻尼与上限叠加：先乘增益再判上限
  const r = dampDelta(100, 0, { gain: 0.5, maxStep: 10 })
  assert.equal(r.dx, 10)
  assert.equal(r.clamped, true)
})

test('T15h 零位移 / 非法输入一律跳过', () => {
  assert.equal(dampDelta(0, 0).skipped, true)
  assert.equal(dampDelta(NaN, 1).skipped, true)
  assert.equal(dampDelta(1, Infinity).skipped, true)
})

// ---------------------------------------------------------------- T15i 滑块相对拖动

test('T15i 行程倍率生效：拖满轨道远到不了量程上限', () => {
  const range = { min: -15, max: 15, step: 1 }
  const v = sliderTravelToValue(0, 180, 180, range)
  // 拖满整条轨道：原生 range 会给到量程上限 15，这里只有 30/3 = 10
  const native = 15
  assert.ok(v < native, `行程放大失效：拖满轨道的值 ${v}`)
  assert.equal(v, 10) // 量化到 step 网格后的确定值
})

test('T15j Shift 精调约为默认灵敏度的 1/4 上下', () => {
  const range = { min: -15, max: 15, step: 1 }
  const normal = sliderTravelToValue(0, 100, 200, range)
  const fine = sliderTravelToValue(0, 100, 200, range, { fine: true })
  assert.ok(Math.abs(fine) < Math.abs(normal) / 3, `Shift 未生效：${fine} vs ${normal}`)
  assert.equal(fine, 1)
  assert.equal(normal, 5)
})

test('T15k 滑块结果量化到 step 网格并钳制在量程内', () => {
  const range = { min: -50, max: 50, step: 0.5 }
  // 量化
  const v = sliderTravelToValue(0, 37, 200, range)
  assert.equal(v % 0.5, 0)
  // 钳制
  assert.equal(sliderTravelToValue(0, 99999, 200, range), 50)
  assert.equal(sliderTravelToValue(0, -99999, 200, range), -50)
  // 起点值也被尊重：从 12 出发向右拖不应先跳回 0
  assert.ok(sliderTravelToValue(12, 5, 200, range) >= 12)
})

test('T15l 浮点尾巴被抹掉', () => {
  const range = { min: -15, max: 15, step: 0.1 }
  for (const dx of [13, 27, 51, 93]) {
    const v = sliderTravelToValue(0, dx, 180, range)
    const tail = String(v).replace('-', '').split('.')[1]?.length ?? 0
    assert.ok(tail <= 1, `dx=${dx} 得到浮点尾巴 ${v}`)
    // 必须落在 0.1 的网格上
    assert.equal(r2(Math.abs(v / 0.1 - Math.round(v / 0.1))), 0)
  }
})

test('T15m 轨道宽度为 0 / 量程非法时按兵不动', () => {
  assert.equal(sliderTravelToValue(3, 50, 0, { min: 0, max: 10, step: 1 }), 3)
  assert.equal(sliderTravelToValue(3, 50, 100, { min: 10, max: 10, step: 1 }), 3)
})

test('T15n 只有按在滑块上才接管拖动', () => {
  const rect = { left: 0, width: 200 }
  const range = { min: -15, max: 15 }
  // value=0 → thumb 居中（x=100）
  assert.equal(hitSliderThumb(100, rect, 0, range), true)
  assert.equal(hitSliderThumb(104, rect, 0, range), true)
  assert.equal(hitSliderThumb(160, rect, 0, range), false)
  // value=15 → thumb 在最右（x=200）
  assert.equal(hitSliderThumb(198, rect, 15, range), true)
  assert.equal(hitSliderThumb(100, rect, 15, range), false)
})

test('T15o 行程常量为正且精细远大于常规', () => {
  assert.ok(SLIDER_TRAVEL.normal > 1)
  assert.ok(SLIDER_TRAVEL.fine > SLIDER_TRAVEL.normal * 3)
})
