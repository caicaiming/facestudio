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
 *   光照   主光 Lambert + 镜面高光 + 环境光遮蔽
 *
 * 高度场与 `zones.js` 的位移形变**共用同一套高斯核**——同一个部位，凸起的
 * 位置和它外扩的位置是一致的，观感才对得上。
 *
 * ## 三项光影（Stage 33）
 *
 * 单光源 Lambert 只能给出「亮 / 暗」两个层次，看久了像浮雕拓片，缺了皮肤该有的
 * 通透感。补上两项后层次分明（灰度层次 80 → 119，单点凸起明暗差 13 → 27）：
 *
 *   1. **镜面高光** —— Blinn-Phong，皮肤用低指数（16）取宽而柔的高光，
 *      不是塑料球那种一点白。它**只提亮迎光面、完全不动背光面**
 *      （实测 135→149 / 122→122），所以是纯赚的对比度。这是「填起来的地方
 *      看起来饱满水润」的关键。
 *   2. **环境光遮蔽** —— 低于四周、且自身低于基准面的地方进光少，理应更暗。
 *      两道门缺一不可：只留第一道，凸起周围会被压出一圈不自然的暗环。
 *      它让「吸脂 / 收紧」这类**负档位**一眼看得出深度。
 *
 * **试过但否掉了的：多光源。** 见 `LIGHT_RIG` 的注释 —— 补光会把明暗对比
 * 填平，在这里是负优化。
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
 * **新增的两项也必须各自在平坦面归零**，否则脸会被平白压暗或提亮：
 *
 *   - 镜面高光：减去平坦面的基准高光 `half.z^shininess`，且只取正增量。
 *     于是它**只提亮、绝不压暗** —— 背光面本来就没有高光，不该再扣一次分，
 *     压暗交给漫反射负责。
 *   - 环境光遮蔽：取局部均值与自身高度之差，再 clamp 掉负值。平坦面差为 0，
 *     凸起差为负（高于四周）被 clamp 成 0，只有凹陷为正 —— 于是它
 *     **只压凹陷、绝不压凸起**。
 *
 * 纯函数层：零 React 依赖，可直接 `node --test`。
 */

/** 默认主光：左上前方 45°，标准人像光位（z 越大越正面、越平） */
export const LIGHT_DEFAULT = { x: -0.42, y: -0.52, z: 0.74 }

/**
 * 光源组。默认**只有一个主光**——这不是偷懒，是测出来的。
 *
 * 直觉上「三点布光（主光 + 补光 + 轮廓光）」更高档，实测恰恰相反：
 *
 *   档位 30，开启高光与 AO：
 *     仅主光        平均偏离 23.93   灰度层次 119   ← 最强
 *     主光 + 轮廓光  平均偏离 23.60   灰度层次 115
 *     主光 + 补光    平均偏离 21.19   灰度层次 103   ← 明确变差
 *
 * 原因：补光从右前方补光，**把主光造出来的明暗对比填平了**。摄影里补光是
 * 为了保住暗部细节，可我们要的恰恰是对比本身——凹凸全靠明暗差才看得出来，
 * 对比被抹平，立体感就没了。而且这里压根没有死黑问题（实测死黑像素 0），
 * 补光想解决的毛病并不存在。
 *
 * w 是相对权重（会归一化，所以绝对值不重要、比例才重要）。`rig` 参数留着，
 * 将来若要换光位直接传数组即可，不必改函数。
 */
export const LIGHT_RIG = [{ x: -0.42, y: -0.52, z: 0.74, w: 1.0 }]

/**
 * 镜面高光。皮肤不是塑料，指数要低（16）＝高光宽而柔；
 * strength 0.28 是「看得出水润感但不糊成一片油光」的取值。
 */
export const SPEC_DEFAULT = { strength: 0.28, shininess: 16 }

/**
 * 环境光遮蔽。
 *
 * radius 默认 `'auto'`：按面宽取（0.18 × 面宽，再换算成格子）。
 * 这个自适应是必须的 —— 遮蔽比的是「自己 vs 周围」，窗口必须跟部位尺度
 * 相当才算得出差值。固定 3 格（18px）时，部位半径动辄 60–90px，窗口里
 * 全是跟自己差不多的高度，均值≈自身，遮蔽恒等于 0，等于白算。
 * 好消息是滑动窗口的开销与半径无关，放大窗口不花钱。
 */
export const AO_DEFAULT = { strength: 0.3, radius: 'auto' }

/** auto 半径：遮蔽窗口取 0.18 × 面宽（画布像素）→ 格子数 */
export const AO_RADIUS_RATIO = 0.18

/** 高度场网格步长（画布像素）。光影低频，6px 足够，放大后平滑 */
export const GRID_STEP = 6

/** 高斯权重低于此值视为无贡献，跳过（exp(−3·2²) ≈ 6e−6） */
const W_MIN = 0.002

function norm3(v) {
  const n = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}

const clamp1 = (v) => (v > 1 ? 1 : v < -1 ? -1 : v)

const clampIdx = (i, n) => (i < 0 ? 0 : i > n - 1 ? n - 1 : i)

/**
 * v^(2^k)：重复 k 次平方。高光指数固定用 2 的幂，比 Math.pow 快数倍 ——
 * 5 万个格子每帧算一次，省下来的是实打实的帧时间。
 */
const ipow2 = (v, k) => {
  let r = v
  for (let i = 0; i < k; i++) r *= r
  return r
}

/**
 * 高度场的局部均值：可分离滑动窗口盒式模糊，横竖各一遍，O(n) 而非 O(n·r²)。
 *
 * 环境光遮蔽要拿「周围的高度」当参照，直接按半径取邻域在 5 万格子上是
 * 25 倍开销；滑动窗口两遍就够，边界按 clamp-to-edge 处理。
 *
 * @returns {Float32Array} 与 data 同尺寸
 */
export function blurField(data, gw, gh, radius) {
  const R = Math.max(1, Math.round(radius))
  const inv = 1 / (2 * R + 1)
  const tmp = new Float32Array(gw * gh)
  const out = new Float32Array(gw * gh)

  for (let y = 0; y < gh; y++) {
    const row = y * gw
    let acc = 0
    for (let x = -R; x <= R; x++) acc += data[row + clampIdx(x, gw)]
    for (let x = 0; x < gw; x++) {
      tmp[row + x] = acc * inv
      acc -= data[row + clampIdx(x - R, gw)]
      acc += data[row + clampIdx(x + R + 1, gw)]
    }
  }
  for (let x = 0; x < gw; x++) {
    let acc = 0
    for (let y = -R; y <= R; y++) acc += tmp[clampIdx(y, gh) * gw + x]
    for (let y = 0; y < gh; y++) {
      out[y * gw + x] = acc * inv
      acc -= tmp[clampIdx(y - R, gh) * gw + x]
      acc += tmp[clampIdx(y + R + 1, gh) * gw + x]
    }
  }
  return out
}

/**
 * 部位凹凸档位 → 高度场。
 *
 * 与 `applySiteOffsets` 同一套高斯核与同一套档位换算，只是方向不在平面内：
 * 位移沿 `dir` 推点位，高度沿 z 推「虚拟深度」，专供光影使用。
 *
 * @param {Array<{site,pts:Point[]}>} anchors  `siteAnchors` 的输出
 * @param {?Object<string,number>} values     {siteKey: 凹凸档位}，范围见 SITE_RANGE；＋ 凸起 / − 凹陷
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
  const {
    light = LIGHT_DEFAULT,
    ambient = 0.55,
    gain = 2.2,
    strength = 1,
    rig = LIGHT_RIG,
    specular = SPEC_DEFAULT.strength,
    shininess = SPEC_DEFAULT.shininess,
    ao = AO_DEFAULT.strength,
    aoRadius = AO_DEFAULT.radius,
    aoScale = 0,
    W = 0,
    k = 1,
  } = opts
  const { gw, gh, step, data } = field

  /**
   * 光源表。显式传了 `light` 就退回单光源 —— 那是旧语义（`T20i` 换光源方向
   * 的用例就靠它），不能让三点布光把调用方的意图盖掉。
   */
  const lamps = opts.light
    ? [{ ...norm3(light), w: 1 }]
    : (Array.isArray(rig) && rig.length ? rig : [{ ...LIGHT_DEFAULT, w: 1 }]).map((l) => ({
        ...norm3(l),
        w: typeof l.w === 'number' ? l.w : 1,
      }))

  // 归一化基准：平坦面法线是 (0,0,1)，各光源的 n·L 之和即基准亮度
  let wsum = 0
  let baseDot = 0
  for (const l of lamps) {
    wsum += l.w
    baseDot += l.w * Math.max(0, l.z)
  }
  const invW = wsum > 0 ? 1 / wsum : 1
  const base = ambient + (1 - ambient) * baseDot * invW

  // 高光只对主光算（补光的高光太散，看不出形状还白白费算力）。视线固定正视。
  const key = lamps[0]
  let hx = key.x
  let hy = key.y
  let hz = key.z + 1
  const hn = Math.hypot(hx, hy, hz) || 1
  hx /= hn
  hy /= hn
  hz /= hn
  const specK = Math.max(1, Math.round(Math.log2(Math.max(2, shininess))))
  // 平坦面的高光基准：高光项要减掉它，才能保证「没凹凸就没有高光」
  const flatSpec = ipow2(Math.max(0, hz), specK)

  // 环境光遮蔽的参照高度 = 局部均值。尺度按面宽取，档位越大凹陷越深、遮蔽越强。
  const aoR =
    aoRadius == null || aoRadius === 'auto'
      ? Math.max(2, Math.round((AO_RADIUS_RATIO * W * k) / step))
      : aoRadius
  const local = ao > 0 ? blurField(data, gw, gh, aoR) : null
  // 0.05 × 面宽：档位约 −17 才吃满遮蔽，给 −5…−15 这些常用档位留出层次
  const aoScalePx = aoScale > 0 ? aoScale : Math.max(1, 0.05 * W * k)

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
      const invN = 1 / nl

      let dot = 0
      for (const lp of lamps) {
        dot += lp.w * Math.max(0, (nx * lp.x + ny * lp.y + lp.z) * invN)
      }
      // 归一化后平坦面恒等于 1 —— 画面零变化
      const diffuse = (ambient + (1 - ambient) * dot * invW) / base

      // 镜面高光：减掉平坦基准、只取正增量 → 只提亮，绝不压暗
      let spec = 0
      if (specular > 0) {
        const nh = Math.max(0, (nx * hx + ny * hy + hz) * invN)
        const s = ipow2(nh, specK)
        if (s > flatSpec) spec = specular * (s - flatSpec)
      }

      // 环境光遮蔽：只压**低于基准面的凹陷**，凸起与它的周围一律不吃
      let occ = 0
      if (local) {
        const h = data[row + gx]
        if (h < 0) {
          // ① 绝对深度（gate）：档位越深越暗，这是单调性的保证
          const gate = -h / aoScalePx
          // ② 相对四周的低洼（sink）：四周隆起才挡得住环境光
          const sink = (local[row + gx] - h) / aoScalePx
          /**
           * 遮挡强度以 ① 为主、② 只做 0.35–1 的调节。
           *
           * 反过来（以 ② 为主）会踩一个坑：极深凹陷的**坑底**四周一样深，
           * sink 反而趋近 0 —— 档位 −20 最暗（灰度 58），−25 回升到 62、
           * −30 更亮到 66。用户把档位调深，画面反而变亮，完全反直觉。
           */
          const mix = 0.35 + 0.65 * (sink > 1 ? 1 : sink > 0 ? sink : 0)
          occ = -ao * (gate > 1 ? 1 : gate) * mix
        }
      }

      const t = clamp1((diffuse - 1 + spec + occ) * gain)
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
