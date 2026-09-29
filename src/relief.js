/**
 * relief.js —— 凹凸（深度）光影层
 *
 * ## 它解决什么
 *
 * 到此为止工具只有两个自由度：X 与 Y —— 都是**平面内的位移**，回答的是
 * 「轮廓往哪挪」。但医美沟通里还有第三类诉求，它根本不在平面内：
 *
 *   「苹果肌这里填起来一点」「面颊这块吸掉一些」「太阳穴凹了，要撑起来」
 *
 * 这些说的是**深度**——垂直于照片平面的凸起与凹陷。二维正面照当然测不出
 * 真实深度（没有参照物、没有第二个视角），但**画面上完全可以把它画出来**：
 * 凸起处迎光面变亮、背光面变暗，凹陷处正好相反。这正是人眼判断凹凸的
 * 唯一依据，也是 3D 里 bump mapping 的原理。
 *
 * ## 模型
 *
 *   高度场  h(x,y) = Σ 档位 × scale × 面宽 × exp(−3·(d/r)²)
 *   法线    n = normalize(−∂h/∂x, −∂h/∂y, 1)
 *   光照    Lambert + 环境光，光源默认左上前方
 *
 * 高度场与 `zones.js` 的位移形变**共用同一套高斯核**——同一个部位，凸起的
 * 位置和它外扩的位置是一致的，观感才对得上。
 *
 * ## 为什么先算成低分辨率网格
 *
 * 光影是**低频信息**：一个部位的半径就有几十像素，8px 一个采样点足够，
 * 放大时浏览器自带双线性平滑，看不出格子。1600×1200 的画布逐像素要 190 万次
 * 采样（拖动时会掉帧），降到 1/6 分辨率只剩 5 万次，不到 5ms。
 *
 * ## 归一化：平坦面必须等于「无变化」
 *
 * 光照值不能直接当亮度用——平坦面上法线是 (0,0,1)，与光源点积是 L.z，
 * 不等于 1，整张脸会平白无故变暗。故除以平坦面的基准值，保证
 * h ≡ 0 时 shade ≡ 1，画面零变化。凸起迎光 >1（高光），背光 <1（阴影）。
 *
 * 纯函数层：零 React 依赖，可直接 `node --test`。
 */

/** 默认光源：左上前方 45°，标准人像光位（z 越大越正面、越平） */
export const LIGHT_DEFAULT = { x: -0.42, y: -0.52, z: 0.74 }

/** 高度场网格步长（画布像素）。光影低频，6px 足够，放大后平滑 */
export const GRID_STEP = 6

/** 高斯权重低于此值视为无贡献，跳过（exp(−3·2²) ≈ 6e−6） */
const W_MIN = 0.002

function norm3(v) {
  const n = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}

const clamp1 = (v) => (v > 1 ? 1 : v < -1 ? -1 : v)

/**
 * 部位凹凸档位 → 高度场。
 *
 * 与 `applySiteOffsets` 同一套高斯核与同一套档位换算，只是方向不在平面内：
 * 位移沿 `dir` 推点位，高度沿 z 推「虚拟深度」，专供光影使用。
 *
 * @param {Array<{site,pts:Point[]}>} anchors  `siteAnchors` 的输出
 * @param {?Object<string,number>} values     {siteKey: 凹凸档位}，−15…＋15；＋ 凸起 / − 凹陷
 * @param {{w:number,h:number,W:number,k?:number,step?:number}} opts
 *        w/h 画布尺寸，W 面宽（**图像像素**），k 图像→画布缩放
 * @returns {?{gw:number,gh:number,step:number,data:Float32Array,w:number,h:number}}
 *          全为 0 档位时返回 null（调用方可据此整层跳过绘制）
 */
export function heightField(anchors, values, opts = {}) {
  const { w, h, W, k = 1, step = GRID_STEP } = opts
  if (!Array.isArray(anchors) || !(w > 0) || !(h > 0) || !(W > 0)) return null

  const live = []
  for (const a of anchors) {
    const v = values?.[a.site.key]
    if (Number.isFinite(v) && v !== 0 && a.pts?.length) live.push({ a, v })
  }
  if (live.length === 0) return null

  const gw = Math.max(2, Math.ceil(w / step) + 1)
  const gh = Math.max(2, Math.ceil(h / step) + 1)
  const data = new Float32Array(gw * gh)

  for (const { a, v } of live) {
    const site = a.site
    const amp = ((v / 100) * site.scale * W) * k
    const r = site.radius * W * k
    if (!(r > 0)) continue
    const inv2 = 1 / (r * r)

    // 只遍历该部位真正覆盖到的格子：半径外的高斯权重已是 1e−6 量级
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const p of a.pts) {
      x0 = Math.min(x0, (p.x * k - 2 * r) / step)
      x1 = Math.max(x1, (p.x * k + 2 * r) / step)
      y0 = Math.min(y0, (p.y * k - 2 * r) / step)
      y1 = Math.max(y1, (p.y * k + 2 * r) / step)
    }
    const gx0 = Math.max(0, Math.floor(x0))
    const gx1 = Math.min(gw - 1, Math.ceil(x1))
    const gy0 = Math.max(0, Math.floor(y0))
    const gy1 = Math.min(gh - 1, Math.ceil(y1))

    for (let gy = gy0; gy <= gy1; gy++) {
      const y = gy * step
      const row = gy * gw
      for (let gx = gx0; gx <= gx1; gx++) {
        const x = gx * step
        // 成对部位取最强的一个控制点（左右各自成峰，不叠加）
        let wMax = 0
        for (const p of a.pts) {
          const dx = x - p.x * k
          const dy = y - p.y * k
          const ww = Math.exp(-3 * (dx * dx + dy * dy) * inv2)
          if (ww > wMax) wMax = ww
        }
        if (wMax > W_MIN) data[row + gx] += amp * wMax
      }
    }
  }
  return { gw, gh, step, data, w, h }
}

/**
 * 高度场 → 光影 RGBA（灰度 + alpha），可直接 `putImageData` 到 gw×gh 的小画布，
 * 再放大贴满整张脸。
 *
 * 输出语义：灰度 128 = 无变化；>128 提亮（迎光凸起）；<128 压暗（背光/凹陷）。
 * 配合 `mix-blend-mode: soft-light` 叠加，皮肤纹理与色斑不会被洗掉。
 *
 * @param {{gw,gh,step,data}} field  `heightField` 的输出
 * @param {{light?,ambient?,gain?,strength?}} opts
 * @returns {{gw:number,gh:number,data:Uint8ClampedArray}}
 */
export function shadeField(field, opts = {}) {
  // gain 是视觉强度：3.2 时六档就打到纯黑纯白（观感生硬），2.2 下要到满档才饱和，
  // 中间档位保留层次。想再强一点请调图层的不透明度，而不是把 gain 拉爆。
  const { light = LIGHT_DEFAULT, ambient = 0.55, gain = 2.2, strength = 1 } = opts
  const { gw, gh, step, data } = field
  const L = norm3(light)
  // 平坦面（法线 = +z）的光照值，用作归一化基准 —— 保证 h≡0 时画面零变化
  const base = ambient + (1 - ambient) * L.z
  const out = new Uint8ClampedArray(gw * gh * 4)

  for (let gy = 0; gy < gh; gy++) {
    const row = gy * gw
    const gyUp = gy > 0 ? gy - 1 : gy
    const gyDn = gy < gh - 1 ? gy + 1 : gy
    // 边界退化成单侧差分：那里已是画布边缘，差半个格子无所谓
    const spanY = (gyDn - gyUp) * step
    for (let gx = 0; gx < gw; gx++) {
      const l = gx > 0 ? gx - 1 : gx
      const r = gx < gw - 1 ? gx + 1 : gx
      const spanX = (r - l) * step
      const dhx = spanX > 0 ? (data[row + r] - data[row + l]) / spanX : 0
      const dhy = spanY > 0 ? (data[gyDn * gw + gx] - data[gyUp * gw + gx]) / spanY : 0

      // 曲面 z = h(x,y) 的法线 = (−∂h/∂x, −∂h/∂y, 1)
      const nx = -dhx
      const ny = -dhy
      const nl = Math.sqrt(nx * nx + ny * ny + 1) || 1
      const nd = Math.max(0, (nx * L.x + ny * L.y + L.z) / nl)
      const shade = (ambient + (1 - ambient) * nd) / base

      const t = clamp1((shade - 1) * gain)
      const i = (row + gx) * 4
      if (Math.abs(t) < 0.004) {
        // 平坦处完全透明：soft-light 下 128 本就无变化，透明还能省一次合成
        out[i + 3] = 0
        continue
      }
      const g = 128 + t * 127
      out[i] = g
      out[i + 1] = g
      out[i + 2] = g
      out[i + 3] = 255 * strength
    }
  }
  return { gw, gh, data: out }
}

/**
 * 高度场的峰值（画布像素，取绝对值最大的那个），用于把挡位换算成物理深度。
 * @returns {{up:number,down:number}} 正峰（凸起）与负峰（凹陷）高度
 */
export function heightPeak(field) {
  if (!field) return { up: 0, down: 0 }
  let up = 0
  let down = 0
  for (let i = 0; i < field.data.length; i++) {
    const v = field.data[i]
    if (v > up) up = v
    if (v < down) down = v
  }
  return { up, down }
}

/**
 * 一步到位：部位档位 → 可贴的 RGBA 网格。UI 里通常就用这一个。
 * @returns {?{gw,gh,data:Uint8ClampedArray}} 无档位时 null
 */
export function reliefOf(anchors, values, opts = {}) {
  const f = heightField(anchors, values, opts)
  if (!f) return null
  return shadeField(f, opts)
}
