/**
 * diffmap.js —— 差异热区：把「哪里被改了、改了多少」画成一层半透明暖色
 *
 * ## 为什么需要它
 *
 * 咨询师走查（Stage 34）最刺眼的一幕：调完苹果肌、泪沟、下巴之后切到对照视图，
 * 两张照片肉眼几乎一模一样 —— 颏尖拉到满档也只推动 0.65% 面宽（约 1.2mm），
 * 缩到画布上就是两三个像素。客户当场就会问「你调了半天，变化在哪？」
 * 而这正是整个咨询流程里最关键的一次说服：形变是真实的，但**看不见**。
 *
 * 这一层的任务不是让形变变大（那是假的），而是把已经发生的形变**标出来**：
 * 哪里动了、动了多少。它不改动照片本身，只在动过的地方叠一层暖色。
 *
 * ## 模型
 *
 *   位移场  d(x,y) = Σ wᵢ·|dstᵢ − srcᵢ| / Σ wᵢ     wᵢ = exp(−3·(distᵢ/R)²)
 *   热区    alpha ∝ d / 参考尺度，颜色固定暖色
 *
 * 与 relief.js 同构：同样先在粗网格（6px）上算、再放大绘制，避免逐像素上百万次
 * 采样掉帧。位移场用 Shepard 式反距离加权（除以权重和，而不是简单累加），
 * 这样单点剧烈位移不会把邻域一起拉爆，热区边界才贴合实际动过的区域。
 *
 * ## 硬约束：没动的地方必须完全透明
 *
 * 任何「有变化才显示」的图层，若在零位移处留下底色，整张脸就会平白无故
 * 蒙上一层颜色 —— 客户会觉得照片发脏。故 d≈0 的格子 alpha 必须为 0。
 * 此约束由 test/diffmap.test.mjs 守卫。
 */

/** 位移场网格步长（画布像素）。与 relief 的 GRID_STEP 一致，6px 足够平滑 */
export const DIFF_STEP = 6

/** 影响半径占面宽的比例。约为一个部位的大小，热区才能连成片而不是散点 */
const RADIUS_RATIO = 0.22

/**
 * 位移低于此像素值视为没动，直接跳过该点（省掉一轮高斯累加）。
 * 取值很小是因为医美部位的实际位移本就只有零点几像素（见 shadeDisplacement
 * 的自适应浓度注释），0.35 会把苹果肌这类常用部位整片过滤掉。
 */
const MOVE_EPS = 0.05

/**
 * 热区参考尺度：位移达到「面宽的 GAIN_FULL_RATIO」时热区打满。
 *
 * 这个值决定档位与热区浓度的对应关系，实测标定（颏部，位移 ∝ 面宽故与分辨率无关）：
 *   0.012 → 15 档就打满，30 档和 15 档看不出区别（失去反馈）
 *   0.035 → 5 档淡（约 26%）、15 档中等（约 77%）、满档刚好打满
 * 取 0.035：常用档位区间保留浓度梯度，客户能看出「调多调少」的差别。
 */
const GAIN_FULL_RATIO = 0.035

/** 热区最大不透明度。再高就盖住照片本身的观感了 */
export const DIFF_ALPHA_MAX = 0.55

/**
 * 位移场（每格的位移像素数）
 *
 * @param {Point[]} srcPts 原始 68 点（画布像素坐标）
 * @param {Point[]} dstPts 形变后 68 点，长度需与 srcPts 一致
 * @param {Object} opts
 * @param {number} opts.w   画布宽（像素）
 * @param {number} opts.h   画布高
 * @param {number} opts.W   面宽（像素），用于把半径换算成尺度无关的比例
 * @param {number} [opts.k] 画布相对自然像素的缩放（默认 1）
 * @param {number} [opts.step] 网格步长（默认 DIFF_STEP）
 * @returns {{gw:number, gh:number, step:number, data:Float32Array, peak:number}}
 */
export function displacementField(srcPts, dstPts, opts = {}) {
  const { w, h, W, k = 1, step = DIFF_STEP } = opts
  const gw = Math.max(2, Math.ceil((w || 1) / step))
  const gh = Math.max(2, Math.ceil((h || 1) / step))
  const data = new Float32Array(gw * gh)
  const wsum = new Float32Array(gw * gh)
  const n = Math.min(srcPts?.length ?? 0, dstPts?.length ?? 0)

  // 与 relief.js 同构：点坐标、位移、半径一律先乘 k 换算到画布像素
  // （w/h/W 与点坐标可以不在同一坐标系，warp 为超大图做过降采样）
  const R = Math.max(8, RADIUS_RATIO * (W || Math.min(w || 1, h || 1)) * k)
  // exp(−3·2²) ≈ 6e−6：超出 2R 的贡献可忽略，据此裁掉搜索框
  const box = R * 2
  const invR2 = 1 / (R * R)

  for (let i = 0; i < n; i++) {
    const a = srcPts[i]
    const b = dstPts[i]
    if (!a || !b) continue
    const d = Math.hypot(b.x - a.x, b.y - a.y) * k
    if (!(d > MOVE_EPS)) continue
    const ax = a.x * k
    const ay = a.y * k

    const gx0 = Math.max(0, Math.floor((ax - box) / step))
    const gx1 = Math.min(gw - 1, Math.ceil((ax + box) / step))
    const gy0 = Math.max(0, Math.floor((ay - box) / step))
    const gy1 = Math.min(gh - 1, Math.ceil((ay + box) / step))

    for (let gy = gy0; gy <= gy1; gy++) {
      const ddy = gy * step - ay
      for (let gx = gx0; gx <= gx1; gx++) {
        const pdx = gx * step - ax
        const q = (pdx * pdx + ddy * ddy) * invR2
        if (q > 4) continue
        const wt = Math.exp(-3 * q)
        const idx = gy * gw + gx
        data[idx] += wt * d
        wsum[idx] += wt
      }
    }
  }

  let peak = 0
  for (let i = 0; i < data.length; i++) {
    if (wsum[i] > 0) {
      data[i] /= wsum[i]
      if (data[i] > peak) peak = data[i]
    } else {
      data[i] = 0
    }
  }
  return { gw, gh, step, data, peak }
}

/**
 * 位移场 → RGBA 热区
 *
 * @param {Object} field displacementField 的输出
 * @param {Object} opts
 * @param {number} opts.W        面宽（像素），决定「打到满强度」的位移尺度
 * @param {number} [opts.k]      缩放（默认 1）
 * @param {number} [opts.strength] 整体强度 0–1（图层不透明度，默认 1）
 * @param {number} [opts.alphaMax] 最大不透明度（默认 DIFF_ALPHA_MAX）
 * @param {number[]} [opts.rgb]  热区颜色，默认暖橙
 * @returns {{gw:number, gh:number, data:Uint8ClampedArray}}
 */
export function shadeDisplacement(field, opts = {}) {
  const { W, k = 1, strength = 1, alphaMax = DIFF_ALPHA_MAX, rgb = [255, 138, 76] } = opts
  const { gw, gh, data, peak } = field
  const full = Math.max(1, GAIN_FULL_RATIO * (W || 1) * k)
  // 自适应浓度：位移整体偏小时按峰值缩放，保证改得最多的地方至少可见。
  //
  // 为什么需要：实测医美部位的实际位移远小于理论幅度（苹果肌 12 档在
  // 1024px 照片上只有 0.3px），若一律按绝对尺度着色，热区浓度不到 3%，
  // 等于没画 —— 而这一层存在的唯一理由就是「让客户看见改了哪里」。
  // peak 超过半程后分母回到 full，恢复正常的档位浓度梯度。
  const denom = peak > 0 ? Math.min(full, peak * 1.6) : full
  const out = new Uint8ClampedArray(gw * gh * 4)

  for (let i = 0; i < data.length; i++) {
    const d = data[i]
    // 没动 → 完全透明。留一点底色整张脸都会发脏，客户会以为照片坏了
    if (!(d > MOVE_EPS)) continue
    const t = d / denom
    const a = (t > 1 ? alphaMax : alphaMax * t) * strength
    if (!(a > 0.004)) continue
    const o = i * 4
    out[o] = rgb[0]
    out[o + 1] = rgb[1]
    out[o + 2] = rgb[2]
    out[o + 3] = Math.round(a * 255)
  }
  return { gw, gh, data: out }
}

/**
 * 一步到位：算出热区并画到目标 canvas 上（放大绘制，浏览器负责平滑）
 *
 * @param {?CanvasRenderingContext2D} ctx
 * @param {Point[]} srcPts
 * @param {Point[]} dstPts
 * @param {Object} opts 同 displacementField + shadeDisplacement
 * @returns {boolean} 是否确有变化（false 表示无需绘制）
 */
export function drawDiffMap(ctx, srcPts, dstPts, opts = {}) {
  if (!ctx || !srcPts || !dstPts) return false
  const field = displacementField(srcPts, dstPts, opts)
  if (!(field.peak > MOVE_EPS)) return false
  const shaded = shadeDisplacement(field, opts)
  const { gw, gh, step } = field
  const cw = opts.w || gw * step
  const ch = opts.h || gh * step

  // 借用一张离屏画布把「格子」放大成像素，避免逐格 fillRect 上千次
  let off = drawDiffMap._off
  if (!off) {
    off = document.createElement('canvas')
    drawDiffMap._off = off
  }
  if (off.width < gw || off.height < gh) {
    off.width = Math.max(off.width, gw)
    off.height = Math.max(off.height, gh)
  }
  const octx = off.getContext('2d')
  if (!octx) return false
  const img = octx.createImageData(gw, gh)
  img.data.set(shaded.data)
  octx.putImageData(img, 0, 0)

  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(off, 0, 0, gw, gh, 0, 0, cw, ch)
  ctx.restore()
  return true
}
