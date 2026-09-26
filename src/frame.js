/**
 * frame.js —— 面部基准坐标系（Canonical Frame）
 *
 * ## 为什么需要它
 *
 * 68 个关键点的原始坐标是「图像像素坐标」，直接拿来测量会有三个致命问题：
 *
 *   1. 姿态：脸一歪（roll），沿图像 x / y 轴的差值就不再等于真实的横向 / 纵向距离，
 *      三庭、五眼、对称全部失真；
 *   2. 尺度：同一张脸拍得远一点近一点，像素尺寸就变，跨照片无法比较；
 *   3. 位置：脸在画面左上角还是右下角，数值含义不变但绝对坐标完全不同。
 *
 * 解决办法是定义一个**对所有脸都成立**的基准坐标系，把点位投影进去再测量。
 *
 * ## 基准定义（不随照片变化）
 *
 *   L = centroid(36..41)       图像左眼质心（6 点平均，抗单点抖动）
 *   R = centroid(42..47)       图像右眼质心
 *   O = (L + R) / 2            原点：两眼中点
 *   X̂ = normalize(R − L)       水平轴：沿两眼连线（自动摆正歪头）
 *   Ŷ = perp(X̂) = (−X̂y, X̂x)   垂直轴：指向脸下方（图像 y 轴向下）
 *   S = |R − L|                尺度单位：眼间距 IPD（interpupillary distance）
 *
 * 选眼睛作基准的理由：
 *   - 眼区 contrast 强，是 68 点里检测最稳定的区域；质心再抹掉单点抖动；
 *   - 眼间距是标准人类学尺度基准，成年人差异极小，跨人可比；
 *   - 不受表情、胖瘦、发型影响（嘴角、脸颊、发际线都会）。
 *
 * 这套定义与照片无关：换任何一张脸，原点都在「两眼中点」、
 * 一个单位都是「一个眼间距」。
 *
 * ## 规范坐标
 *
 *   u = ((p − O) · X̂) / S      横向量（右为正）
 *   v = ((p − O) · Ŷ) / S      纵向量（下为正）
 *
 * 无量纲。同一个人的两张不同姿态、不同分辨率的照片，规范坐标应当高度重合。
 *
 * ## 基准点校准
 *
 * 检测器给出的眼睛位置仍可能有整体偏移。用户把基准点拖到正确位置后，
 * 用【双点相似变换】把 68 点整体校正过去 —— 平移 + 旋转 + 缩放，
 * 两点确定 4 个自由度，解唯一。这比逐个拖动 68 个点现实得多。
 *
 * 纯函数层：零 React 依赖，可直接 `node --test`。
 */

// ---------------------------------------------------------------- 常量

/** 图像左眼（36–41）与右眼（42–47），按 dlib 68 点约定 */
export const LEFT_EYE = [36, 37, 38, 39, 40, 41]
export const RIGHT_EYE = [42, 43, 44, 45, 46, 47]

/** 歪头角告警阈值（度）：超过则提示摆正，指标可信度下降 */
export const ROLL_WARN = 8
export const ROLL_BAD = 15

function centroidOf(points, idxs) {
  let sx = 0
  let sy = 0
  let n = 0
  for (const i of idxs) {
    const p = points[i]
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    sx += p.x
    sy += p.y
    n++
  }
  if (n === 0) return null
  return { x: sx / n, y: sy / n }
}

// ---------------------------------------------------------------- 构建

/**
 * 左右眼质心。
 * @returns {{L:?{x,y}, R:?{x,y}}}
 */
export function eyeCenters(points) {
  if (!Array.isArray(points) || points.length < 48) return { L: null, R: null }
  return { L: centroidOf(points, LEFT_EYE), R: centroidOf(points, RIGHT_EYE) }
}

/**
 * 构建基准坐标系。
 *
 * @param {Point[]} points 68 点（图像像素坐标）
 * @param {?{L:{x,y}, R:{x,y}}} anchors 用户校准后的基准点；缺省用自动检测的眼质心
 * @returns {Frame} 恒返回对象，失败时 valid=false
 */
export function buildFrame(points, anchors = null) {
  const auto = eyeCenters(points)
  const L = anchors?.L ?? auto.L
  const R = anchors?.R ?? auto.R
  if (!L || !R) {
    return {
      O: { x: 0, y: 0 },
      X: { x: 1, y: 0 },
      Y: { x: 0, y: 1 },
      S: 1,
      L: null,
      R: null,
      ipd: 0,
      roll: 0,
      valid: false,
      reason: 'NO_EYE_ANCHORS',
    }
  }
  const dx = R.x - L.x
  const dy = R.y - L.y
  const S = Math.hypot(dx, dy)
  if (!(S > 0)) {
    return {
      O: { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 },
      X: { x: 1, y: 0 },
      Y: { x: 0, y: 1 },
      S: 1,
      L,
      R,
      ipd: 0,
      roll: 0,
      valid: false,
      reason: 'DEGENERATE_EYES',
    }
  }
  const X = { x: dx / S, y: dy / S }
  // 图像 y 向下：X̂ 逆时针转 90° 恰好指向脸的下方
  const Y = { x: -X.y, y: X.x }
  return {
    O: { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 },
    X,
    Y,
    S,
    L,
    R,
    ipd: S,
    roll: (Math.atan2(dy, dx) * 180) / Math.PI,
    valid: true,
    reason: null,
  }
}

/**
 * 带缓存的 buildFrame。点集在一个求解 / 一帧渲染内通常不变，
 * 而 autoTune 单次求解要评估上千次，逐次重建会白烧 CPU。
 * 按点集【引用】缓存：传入同一个数组即命中。
 */
const _frameCache = new WeakMap()
export function frameOf(points, anchors = null) {
  if (anchors) return buildFrame(points, anchors)
  let f = _frameCache.get(points)
  if (!f) {
    f = buildFrame(points)
    _frameCache.set(points, f)
  }
  return f
}

// ---------------------------------------------------------------- 投影

/** 单个点 → 规范坐标 {u, v}（无量纲，单位 = 眼间距） */
export function project(p, frame) {
  const dx = p.x - frame.O.x
  const dy = p.y - frame.O.y
  return {
    u: (dx * frame.X.x + dy * frame.X.y) / frame.S,
    v: (dx * frame.Y.x + dy * frame.Y.y) / frame.S,
  }
}

/** 规范坐标 → 图像像素坐标 */
export function unproject(c, frame) {
  const du = c.u * frame.S
  const dv = c.v * frame.S
  return {
    x: frame.O.x + du * frame.X.x + dv * frame.Y.x,
    y: frame.O.y + du * frame.X.y + dv * frame.Y.y,
  }
}

export function toCanonical(points, frame) {
  return points.map((p) => project(p, frame))
}

export function fromCanonical(cpts, frame) {
  return cpts.map((c) => unproject(c, frame))
}

/**
 * 沿基准水平轴的投影距离（像素单位）。脸歪时仍等于真实的横向跨度。
 * 等价于「摆正后两点 x 坐标之差」。
 */
export function alongX(a, b, frame) {
  return (b.x - a.x) * frame.X.x + (b.y - a.y) * frame.X.y
}

/** 沿基准垂直轴的投影距离（像素单位）。 */
export function alongY(a, b, frame) {
  return (b.x - a.x) * frame.Y.x + (b.y - a.y) * frame.Y.y
}

/** 规范面宽（沿水平轴，像素单位）。替代原先的 |p16.x − p0.x|。 */
export function frameFaceWidth(points, frame) {
  return Math.abs(alongX(points[0], points[16], frame))
}

/** 中轴线：过原点、方向为垂直轴。用于对称计算，与水平轴严格正交。 */
export function frameAxis(frame) {
  return { cx: frame.O.x, cy: frame.O.y, dx: frame.Y.x, dy: frame.Y.y }
}

// ---------------------------------------------------------------- 校准变换

/**
 * 双点相似变换：把 autoL→userL 且 autoR→userR。
 *
 * 复数形式 z' = a·z + b，其中 a = ar + i·ai（缩放 + 旋转），b = br + i·bi（平移）。
 * 两点给定 4 个方程、4 个未知量，解唯一。
 *
 * @returns {?{ar,ai,br,bi}} 退化时返回 null
 */
export function calibrateTransform(autoL, autoR, userL, userR) {
  if (!autoL || !autoR || !userL || !userR) return null
  const ax = autoR.x - autoL.x
  const ay = autoR.y - autoL.y
  const ux = userR.x - userL.x
  const uy = userR.y - userL.y
  const den = ax * ax + ay * ay
  if (!(den > 1e-9)) return null
  // a = (ux + i·uy) / (ax + i·ay)
  const ar = (ux * ax + uy * ay) / den
  const ai = (uy * ax - ux * ay) / den
  const br = userL.x - (ar * autoL.x - ai * autoL.y)
  const bi = userL.y - (ar * autoL.y + ai * autoL.x)
  if (![ar, ai, br, bi].every(Number.isFinite)) return null
  return { ar, ai, br, bi }
}

/** 把相似变换应用到点集 */
export function applyTransform(points, T) {
  if (!T) return points
  const { ar, ai, br, bi } = T
  return points.map((p) => ({
    x: ar * p.x - ai * p.y + br,
    y: ar * p.y + ai * p.x + bi,
  }))
}

/** 变换的缩放倍率（校准前后尺度变化，1 表示纯刚体） */
export function transformScale(T) {
  return T ? Math.hypot(T.ar, T.ai) : 1
}

/** 变换的旋转角（度） */
export function transformRotation(T) {
  return T ? (Math.atan2(T.ai, T.ar) * 180) / Math.PI : 0
}

/** 恒等变换（未校准） */
export const IDENTITY_TRANSFORM = Object.freeze({ ar: 1, ai: 0, br: 0, bi: 0 })

// ---------------------------------------------------------------- 诊断

/**
 * 基准质量诊断：告诉用户这套点位能不能信。
 * @param {Frame} frame
 * @param {{shift?:number}} opts shift = 相对自动检测的平移量（像素）
 */
export function frameDiagnostics(frame, opts = {}) {
  const roll = frame.roll
  const absRoll = Math.abs(roll)
  const shift = opts.shift ?? 0
  const calibrated = shift > 0.5

  let level = 'ok'
  let text = '基准稳定，姿态端正。'
  if (absRoll >= ROLL_BAD) {
    level = 'bad'
    text = `歪头 ${roll.toFixed(1)}°，姿态偏差过大，透视畸变无法用二维摆正消除，建议换正面照。`
  } else if (absRoll >= ROLL_WARN) {
    level = 'warn'
    text = `歪头 ${roll.toFixed(1)}°，测量已按两眼连线自动摆正，但透视畸变仍在。`
  }
  return {
    roll,
    absRoll,
    ipd: frame.ipd,
    shift,
    calibrated,
    level,
    text,
  }
}
