/**
 * drag.js —— 拖动阻尼（灵敏度）模型
 *
 * ## 为什么需要它
 *
 * 点位坐标是【原图像素】，而拖动是在【屏幕像素】上发生的。二者之间有
 * 一个隐藏的放大系数 k = 原图宽 / 显示宽：1024px 的图只显示 372px 时
 * k ≈ 2.75，手机直出 4000px 的图甚至 k ≈ 10。
 *
 * 直觉上大家期待「手怎么动、点怎么动」，但 1:1 换算到原图坐标系之后，
 * 手腕一个 3px 的抖动就是脸上 8px 的位移 —— 于是拖动看起来没有阻尼、
 * 一碰就过头。本模块把这份倍率变成可调、可预测的参数。
 *
 * ## 设计取向
 *
 * 1. **默认阻尼 ½**：让「拖 2px 动 1px」成为常态。代价是点位会略微滞后于
 *    光标 —— 这里刻意选择「可控性优先于严格跟手」；要跟手就切到 1× 档。
 * 2. **临时修饰键优先于档位**：按住 Shift 直接降到最细 ¼（最后微调常用），
 *    按住 Alt 临时提到 1×（大范围粗定位），松手自动还原，不必来回切档。
 * 3. **行程≠结果**：增益只作用在「本帧增量」上，帧再多也不会累积漂移；
 *    上一帧的残差由 drag.js 的调用方用浮点 ref 保存，不会因舍入丢失。
 *
 * 纯函数层：零 React/DOM 依赖，可直接 node --test。
 */

/** 拖动灵敏度档位。gain = 实际位移 / 光标位移 */
export const DRAG_GAINS = [
  { key: 'fine', label: '¼', gain: 0.25, title: '精细 ¼：拖 4px 才动 1px，用于最后校准' },
  { key: 'half', label: '½', gain: 0.5, title: '阻尼 ½（默认）：手微抖基本不起作用' },
  { key: 'full', label: '1×', gain: 1, title: '跟手 1×：点位严格跟随光标，适合大范围移动' },
]

export const DEFAULT_DRAG_GAIN_KEY = 'half'

/** 修饰键的临时档位：Shift 取最细，Alt 取跟手 */
export const TEMP_GAIN = { shift: 0.25, alt: 1 }

/** 查表取增益；未知 key 回落到默认档 */
export function gainOf(key) {
  const g = DRAG_GAINS.find((x) => x.key === key)
  return g ? g.gain : gainOf(DEFAULT_DRAG_GAIN_KEY)
}

/**
 * 综合「当前档位 + 修饰键」得到一个增益。
 * @param {string} key  DRAG_GAINS 里的 key
 * @param {{shift?:boolean, alt?:boolean}} mods 当前按下的键
 */
export function effectiveGain(key, mods = {}) {
  if (mods.shift) return TEMP_GAIN.shift
  if (mods.alt) return TEMP_GAIN.alt
  return gainOf(key)
}

/**
 * 把一次 pointermove 的位移换算成真正施加的位移。
 *
 * @param {number} dx 本次的光标位移（x 分量，与 dy 同单位）
 * @param {number} dy
 * @param {object} opts
 * @param {number} [opts.gain=1]      灵敏度增益
 * @param {number} [opts.maxStep=0]   单次位移上限（0 表示不限）。防止浏览器
 *                                    丢帧 / 触摸板惯性造成的瞬移把脸拉飞。
 * @param {number} [opts.deadZone=0]  低于该量值的位移直接忽略（抗手抖），
 *                                    同样单位。
 * @returns {{dx:number, dy:number, skipped:boolean, clamped:boolean}}
 */
export function dampDelta(dx, dy, opts = {}) {
  const { gain = 1, maxStep = 0, deadZone = 0 } = opts
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    return { dx: 0, dy: 0, skipped: true, clamped: false }
  }
  // 判死区用【原始位移】：用户几乎没动时，任何增益都不该产生位移
  if (deadZone > 0 && Math.hypot(dx, dy) < deadZone) {
    return { dx: 0, dy: 0, skipped: true, clamped: false }
  }
  let ox = dx * gain
  let oy = dy * gain
  let clamped = false
  if (maxStep > 0) {
    const len = Math.hypot(ox, oy)
    if (len > maxStep) {
      const s = maxStep / len
      ox *= s
      oy *= s
      clamped = true
    }
  }
  return { dx: ox, dy: oy, skipped: false, clamped }
}

// ---------------------------------------------------------------- 滑块拖动

/**
 * 滑块行程倍率：拖满整个轨道需要走 travel 倍的行程。
 *
 * 原生 `<input type=range>` 是【位置映射】——拖到 60% 的位置就是 60% 的值，
 * 与像素长度无关，所以「轨道只有 180px 宽、值域 ±15」必然导致每 6px 跳一档，
 * 手感上就是「一拖就冲到底」。本模块把它改成【相对位移映射】，
 * 行程倍率越大越不容易冲过头。
 */
export const SLIDER_TRAVEL = {
  // 经验值：轨道约 180px、值域 ±15 时，原生 range 是「每 6px 跳一档」。
  // 取 3 相当于把它拉成「每 18px 走一档」，需要三倍于轨道的行程才走完量程 ——
  // 微调用得舒服，又不必提手太多次（点轨道任意位置仍会直接跳过去）。
  normal: 3,
  fine: 12, // 按住 Shift：约 1/4 的灵敏度，用于精确到一档的定位
}

/**
 * 相对拖动：把水平像素位移换算成目标值。
 *
 * @param {number} startValue 按下时的值（随后所有位移都相对它累加）
 * @param {number} dxPx       相对按下时的水平位移（像素，右为正）
 * @param {number} trackPx    轨道可用宽度（像素）
 * @param {{min:number,max:number,step:number}} range
 * @param {{fine?:boolean, travel?:number}} [opts]
 * @returns {number} 已量化到 step 网格、已钳制进 [min,max] 的值
 */
export function sliderTravelToValue(startValue, dxPx, trackPx, range, opts = {}) {
  const { min, max, step } = range
  if (!(trackPx > 0) || !(max > min)) return startValue
  const travel = opts.travel ?? (opts.fine ? SLIDER_TRAVEL.fine : SLIDER_TRAVEL.normal)
  const perStep = (max - min) / trackPx / travel
  let v = startValue + dxPx * perStep
  // 量化到 step 网格：step 为 0 / 非法时按连续值处理
  if (Number.isFinite(step) && step > 0) v = Math.round(v / step) * step
  v = Math.max(min, Math.min(max, v))
  // 消除浮点尾巴（0.30000000000000004）
  const decimals = step > 0 ? String(step).split('.')[1]?.length ?? 0 : 2
  return Number(v.toFixed(decimals + 1))
}

/**
 * 判断一次 pointerdown 是否落在滑块的滑块（thumb）上。
 *
 * 落在 thumb 上才接管为「相对拖动」；点在轨道别处保持原生行为
 * （直接跳到点击位置），否则用户会觉得「怎么点中间不动了」。
 *
 * @param {number} clientX   指针 x
 * @param {{left:number,width:number}} rect 轨道矩形
 * @param {number} value     当前值
 * @param {{min:number,max:number}} range
 * @param {number} [thumbPx=12]
 */
export function hitSliderThumb(clientX, rect, value, range, thumbPx = 14) {
  const { min, max } = range
  if (!(rect.width > 0) || !(max > min)) return false
  const frac = (clientX - rect.left) / rect.width
  const valFrac = (value - min) / (max - min)
  const half = thumbPx / rect.width
  return Math.abs(frac - valFrac) <= half
}
