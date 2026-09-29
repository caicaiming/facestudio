/**
 * measure.js —— 几何测量层
 * 纯函数模块：零 React 依赖、零副作用，可在 Node.js 环境单独测试。
 *
 * 68 点索引规范见《开发文档》第 4 章：
 *   0-16 下颌 | 17-21 右眉 | 22-26 左眉 | 27 眉心 | 28-30 鼻梁 | 31-35 鼻翼
 *   36-41 右眼（36=外眦, 39=内眦） | 42-47 左眼（42=内眦, 45=外眦）
 *   48-59 外唇 | 60-67 内唇
 * 左右一律以「被拍摄者本人」为准（图像左侧 = 被拍摄者右侧）。
 * 坐标一律为【图片自然像素坐标】。
 */

import { buildFrame, alongX, alongY, frameFaceWidth, frameAxis, project } from './frame.js'

// ---------------------------------------------------------------- 索引常量

/** 中轴点，共 10 个，不参与对称计算 */
export const MID_LINE = [8, 27, 28, 29, 30, 33, 51, 57, 62, 66]

/** 右半脸（图像左侧），29 个 */
export const RIGHT_HALF = [
  0, 1, 2, 3, 4, 5, 6, 7,
  17, 18, 19, 20, 21,
  31, 32,
  36, 37, 38, 39, 40, 41,
  48, 49, 50,
  58, 59,
  60, 61, 67,
]

/** 左半脸（图像右侧），29 个。与 RIGHT_HALF 按下标一一对应 */
export const LEFT_HALF = [
  16, 15, 14, 13, 12, 11, 10, 9,
  26, 25, 24, 23, 22,
  35, 34,
  45, 44, 43, 42, 47, 46,
  54, 53, 52,
  56, 55,
  64, 63, 65,
]

export const IDEAL = {
  three: 1 / 3,
  fiveSeg: 0.2,
  /**
   * 下庭占下面部（中庭＋下庭）的比例，理想 0.5 ＝ 中庭与下庭等长。
   *
   * ⚠️ 字段名叫 `golden` 是历史遗留（旧版语义为「黄金分割＝中庭/下庭，理想 0.618」）。
   * 0.618 与三庭均等在数学上互斥 —— 三庭 1:1:1 时中庭/下庭恰好 1.0，该项恒 0 分，
   * 教科书标准脸只得 79.9 分、综合分上限被压到 87.4。故改为与三庭兼容的 0.5。
   * UI 上已改称「下庭占比」，勿再按黄金比 0.618 理解此值。
   */
  golden: 0.5,
  balance: 0.55,
}

// ---------------------------------------------------------------- 基础工具

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function isValidPoints(points) {
  return (
    Array.isArray(points) &&
    points.length === 68 &&
    points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  )
}

/** 最小二乘拟合直线（PCA 主方向），返回点 + 单位方向向量 */
export function fitLine(pts) {
  const n = pts.length
  let cx = 0
  let cy = 0
  for (const p of pts) {
    cx += p.x
    cy += p.y
  }
  cx /= n
  cy /= n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of pts) {
    const dx = p.x - cx
    const dy = p.y - cy
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return { cx, cy, dx: Math.cos(theta), dy: Math.sin(theta) }
}

/** 关于直线做镜像 */
export function mirrorPoint(p, L) {
  const vx = p.x - L.cx
  const vy = p.y - L.cy
  const proj = vx * L.dx + vy * L.dy
  return {
    x: L.cx + 2 * proj * L.dx - vx,
    y: L.cy + 2 * proj * L.dy - vy,
  }
}

function centroid(arr) {
  let sx = 0
  let sy = 0
  for (const p of arr) {
    sx += p.x
    sy += p.y
  }
  return { x: sx / arr.length, y: sy / arr.length }
}

function emptyMetrics(reason) {
  return {
    three: { upper: null, middle: null, lower: null, estimated: true, source: 'none' },
    five: { segments: [], ratios: [], deviation: null },
    symmetry: null,
    golden: null,
    balance: null,
    focal: null,
    yaw: null,
    confidence: 0,
    faceTop: null,
    faceHeight: null,
    valid: false,
    reason,
  }
}

// ---------------------------------------------------------------- 主测量函数

/**
 * 计算全部几何指标
 * @param {Point[]} points 68 点，图片自然像素坐标
 * @param {number} imageW  图片宽度（用于焦距估算）
 * @param {number} imageH  图片高度
 * @param {?Box}   box     检测器包围盒；可为 null
 * @param {number} confidence 检测置信度 0–1
 * @param {?number} hairlineY 图像实测发际线 y（见 hairline.js）；可为 null
 * @returns {Metrics} 恒返回对象，绝不抛出
 */
export function measureFace(
  points,
  imageW,
  imageH,
  box = null,
  confidence = 1,
  hairlineY = null,
) {
  if (!isValidPoints(points)) return emptyMetrics('INVALID_LANDMARKS')

  // ---- 基准坐标系（两眼中点 + 眼间距，见 frame.js）----
  // 之后所有距离一律沿基准轴投影，而非图像 x / y 轴差值：
  // 脸歪时图像轴投影会失真，基准轴投影不会。
  const frame = buildFrame(points)
  const W = frame.valid ? frameFaceWidth(points, frame) : Math.abs(points[16].x - points[0].x)
  if (!(W > 0)) return emptyMetrics('INVALID_LANDMARKS')

  // ---- 发际线估算（三级方案，见文档 6.1.2）----
  // 1) 图像实测：沿眉心中线扫描皮肤→头发的分界（hairline.js）
  // 2) 检测器框顶：TinyFaceDetector 框通常紧贴眉线，仅作参考
  // 3) 几何兜底：眉上缘 - 5.5 × 平均眼裂高度（与中庭/下庭相互独立，保证指标有分辨力）
  // 沿基准垂直轴取「最靠上」的眉点，而非图像 y 最小 —— 脸歪时两者不同
  let browTopY = Infinity
  for (let i = 17; i <= 26; i++) {
    const v = alongY(points[27], points[i], frame)
    browTopY = Math.min(browTopY, points[27].y + v)
  }
  const eyeOpening =
    (Math.abs(alongY(points[37], points[41], frame)) +
      Math.abs(alongY(points[38], points[40], frame)) +
      Math.abs(alongY(points[43], points[47], frame)) +
      Math.abs(alongY(points[44], points[46], frame))) /
    4

  // `estimated` 恒为 true：发际线永远不像眉心/鼻下/颏尖那样是明确的解剖标志，
  // 三种方案本质上都是推断。真正影响可信度的是**用了哪一级方案**，记在 source：
  //   scan      图像实测（hairline.js 沿眉心中线扫描皮肤→头发分界）—— 可信度最高
  //   box       检测器框顶 —— TinyFaceDetector 框通常贴着眉线，只作粗略参考
  //   geometric 几何兜底（眉上缘 − 5.5 × 眼裂）—— 与脸型无关，最不可信
  // 评分层据此决定上庭是否参与计分（见 analyze.js 的 scoreThree）。
  const estimated = true
  let faceTop
  let hairlineSource = 'geometric'
  if (Number.isFinite(hairlineY) && hairlineY < browTopY) {
    faceTop = hairlineY
    hairlineSource = 'scan'
  } else if (box && Number.isFinite(box.height) && box.height > 0) {
    faceTop = box.y
    hairlineSource = 'box'
  } else {
    faceTop = browTopY - 5.5 * eyeOpening
  }

  // faceTop 是一个 y 值（发际线扫描结果）。沿基准垂直轴把它变成一个点再测距，
  // 这样脸歪时「上庭长度」仍等于沿脸纵轴的距离，而不是图像纵向的投影。
  const faceTopPt = { x: points[27].x, y: faceTop }
  const faceHeight = alongY(faceTopPt, points[8], frame)
  if (!(faceHeight > 0)) return emptyMetrics('INVALID_LANDMARKS')

  // ---- 三庭（沿基准垂直轴）----
  const three = {
    upper: alongY(faceTopPt, points[27], frame) / faceHeight,
    middle: alongY(points[27], points[33], frame) / faceHeight,
    lower: alongY(points[33], points[8], frame) / faceHeight,
    estimated,
    source: hairlineSource,
  }

  // ---- 五眼（沿基准水平轴）----
  const segments = [
    Math.abs(alongX(points[0], points[36], frame)), // 右耳根 → 右眼外眦
    Math.abs(alongX(points[36], points[39], frame)), // 右眼宽
    Math.abs(alongX(points[39], points[42], frame)), // 两眼间距（内眦 → 内眦）
    Math.abs(alongX(points[42], points[45], frame)), // 左眼宽
    Math.abs(alongX(points[45], points[16], frame)), // 左眼外眦 → 左耳根
  ]
  const ratios = segments.map((s) => s / W)
  const five = {
    segments,
    ratios,
    deviation: ratios.reduce((a, r) => a + Math.abs(r - IDEAL.fiveSeg), 0) / 5,
  }

  // ---- 对称（以规范面宽归一化，跨分辨率可比）----
  // 中轴改用过原点、方向为基准垂直轴的直线：与水平轴严格正交，
  // 且不受 8/27/30 三点抖动影响（旧版用这三点拟合，鼻梁一歪轴就歪）。
  const axis = frame.valid ? frameAxis(frame) : fitLine([points[8], points[27], points[30]])
  let symSum = 0
  for (let i = 0; i < RIGHT_HALF.length; i++) {
    const m = mirrorPoint(points[RIGHT_HALF[i]], axis)
    symSum += dist(m, points[LEFT_HALF[i]])
  }
  const symmetry = (symSum / RIGHT_HALF.length / W) * 100

  // ---- 下庭占比（沿基准垂直轴）----
  // 旧版这里是「黄金分割 = 中庭 / 下庭」，理想值取 0.618。那是**数学上不可能
  // 与三庭同时成立**的指标：三庭均等时中庭/下庭 = 1.0，偏差 0.382、阈值 0.05，
  // 得分恒为 0 —— 教科书标准脸反而被判「失衡」，而想让这项及格，下巴必须长得
  // 比中庭长 1.6 倍。两项权重合计 0.5、区间完全不相交，综合分上限被压到 87.4。
  //
  // 改为「下庭占下面部（中庭＋下庭）的比例」，理想 0.5（＝中庭与下庭等长），
  // 与三庭标准兼容：三庭均等时两项同时满分，综合分可达 100。
  // 它仍是比例的另一种写法，但落在 0–1 区间、语义直观（下庭越长越显成熟），
  // 且不再与自家指标打架。
  const midLen = alongY(points[27], points[33], frame)
  const lowLen = alongY(points[33], points[8], frame)
  const golden = midLen + lowLen > 0 ? lowLen / (midLen + lowLen) : null

  // ---- 视觉重心（沿基准垂直轴，faceHeight 同量纲）----
  const featureV =
    [27, 30, 33, 51, 57].reduce((a, i) => a + alongY(faceTopPt, points[i], frame), 0) / 5
  const balance = featureV / faceHeight

  // ---- 焦距（仅信息提示，不参与评分）----
  const focal = (imageW * 0.9) / (2 * Math.tan((35 * Math.PI) / 180))

  // ---- 偏航角代理值：鼻尖偏离面宽中点的横向距离 / 面宽 ----
  const faceMid = {
    x: (points[0].x + points[16].x) / 2,
    y: (points[0].y + points[16].y) / 2,
  }
  const yaw = Math.abs(alongX(faceMid, points[30], frame)) / W

  return {
    three,
    five,
    symmetry,
    golden,
    balance,
    focal,
    yaw,
    confidence,
    // 绘制辅助字段（供 FaceCanvas 画三庭分界线）
    faceTop,
    faceHeight,
    // 基准坐标系诊断（供 UI 显示姿态 / 校准状态）
    frame,
    valid: Number.isFinite(golden) && Number.isFinite(symmetry),
    reason: null,
  }
}

// ---------------------------------------------------------------- 形变函数

/** 嘴巴：以唇部中心为原点做二维缩放，影响 48–67 */
function deformMouth(pts, v) {
  const out = pts.map((p) => ({ x: p.x, y: p.y }))
  const c = centroid(pts.slice(48, 60))
  const k = 1 + v / 100
  for (let i = 48; i <= 67; i++) {
    out[i].x = c.x + (pts[i].x - c.x) * k
    out[i].y = c.y + (pts[i].y - c.y) * k
  }
  return out
}

/** 下巴：以 8 号点为峰值的纵向位移，0–16 号按索引距离衰减 */
function deformChin(pts, v) {
  const out = pts.map((p) => ({ x: p.x, y: p.y }))
  const W = Math.abs(pts[16].x - pts[0].x)
  const amp = (v / 100) * 0.35 * W
  for (let i = 0; i <= 16; i++) {
    const decay = Math.max(0, 1 - Math.abs(i - 8) * 0.2)
    out[i].y += amp * decay
  }
  return out
}

/** 下颌线：以面宽中线为基准横向缩放，越靠近下巴变化越小 */
function deformJawline(pts, v) {
  const out = pts.map((p) => ({ x: p.x, y: p.y }))
  const midX = (pts[0].x + pts[16].x) / 2
  const k = v / 100
  for (let i = 0; i <= 16; i++) {
    const decay = Math.abs(i - 8) / 8
    out[i].x = midX + (pts[i].x - midX) * (1 + k * decay)
  }
  return out
}

/** 颧骨：颊部横向平移，按到 3/13 号点的距离衰减 */
function deformCheekbone(pts, v) {
  const out = pts.map((p) => ({ x: p.x, y: p.y }))
  const W = Math.abs(pts[16].x - pts[0].x)
  const amp = (v / 100) * 0.25 * W
  for (let i = 1; i <= 6; i++) out[i].x += -amp * Math.max(0, 1 - Math.abs(i - 3) * 0.15)
  for (let i = 10; i <= 15; i++) out[i].x += amp * Math.max(0, 1 - Math.abs(i - 13) * 0.15)
  return out
}

/** 额头：眉毛整体纵向平移，视觉上等价于额头高度反向变化 */
function deformForehead(pts, v) {
  const out = pts.map((p) => ({ x: p.x, y: p.y }))
  const W = Math.abs(pts[16].x - pts[0].x)
  const amp = (v / 100) * 0.2 * W
  for (let i = 17; i <= 26; i++) out[i].y += amp
  return out
}

const DEFORMERS = [
  ['mouth', deformMouth],
  ['chin', deformChin],
  ['jawline', deformJawline],
  ['cheekbone', deformCheekbone],
  ['forehead', deformForehead],
]

/**
 * 应用全部滑块形变。
 * 各路形变【均以原始点集为输入】计算权重，再把位移量累加，避免级联放大。
 * @param {Point[]} points 原始 68 点
 * @param {Params} params  滑块值
 */
export function getDeformedPoints(points, params) {
  if (!isValidPoints(points)) return points
  const base = points.map((p) => ({ x: p.x, y: p.y }))
  const out = points.map((p) => ({ x: p.x, y: p.y }))
  for (const [key, fn] of DEFORMERS) {
    const v = params && Number.isFinite(params[key]) ? params[key] : 0
    if (v === 0) continue
    const d = fn(base, v)
    for (let i = 0; i < 68; i++) {
      out[i].x += d[i].x - base[i].x
      out[i].y += d[i].y - base[i].y
    }
  }
  return out
}

/**
 * 应用逐点位移（在 5 路预设形变之后叠加）。
 * @param {Point[]} pts     已应用预设形变的 68 点
 * @param {?Array<{dx:number,dy:number}>} offsets 长度 68 的位移表，缺省项视为 0
 * @returns {Point[]} 新数组，不修改入参
 */
export function applyPointOffsets(pts, offsets) {
  if (!isValidPoints(pts)) return pts
  if (!offsets) return pts
  const out = pts.map((p) => ({ x: p.x, y: p.y }))
  for (let i = 0; i < 68; i++) {
    const o = offsets[i]
    if (!o) continue
    if (Number.isFinite(o.dx)) out[i].x += o.dx
    if (Number.isFinite(o.dy)) out[i].y += o.dy
  }
  return out
}

/** 创建一张空的位移表 */
export function emptyOffsets() {
  return Array.from({ length: 68 }, () => ({ dx: 0, dy: 0 }))
}

// ---------------------------------------------------------------- 模拟数据（开发期）

/**
 * 生成一份标准 68 点模板（用于无照片时跑通渲染链）。
 * 与 scripts/gen-triangles.mjs 中的模板保持一致。
 */
export function generateLandmarks(scale = 1) {
  const CX = 50
  const M = (x, y) => ({ x: (CX + x) * scale, y: y * scale })
  const pts = new Array(68)
  const R = 48
  const Y_TOP = 52
  const H_JAW = 53
  for (let i = 0; i <= 16; i++) {
    const t = (Math.PI * i) / 16
    pts[i] = M(-R * Math.cos(t), Y_TOP + H_JAW * Math.sin(t))
  }
  const browR = [[-38, 40], [-33, 33], [-27, 30], [-20, 32], [-12, 36]]
  const browL = [[12, 36], [20, 32], [27, 30], [33, 33], [38, 40]]
  for (let i = 0; i < 5; i++) pts[17 + i] = M(...browR[i])
  for (let i = 0; i < 5; i++) pts[22 + i] = M(...browL[i])
  pts[27] = M(0, 38)
  pts[28] = M(0, 48)
  pts[29] = M(0, 57)
  pts[30] = M(0, 66)
  pts[31] = M(-6, 72)
  pts[32] = M(-11, 74)
  pts[33] = M(0, 76)
  pts[34] = M(11, 74)
  pts[35] = M(6, 72)
  const eyeR = [[-30, 52], [-24, 46], [-18, 47], [-12, 52], [-18, 57], [-24, 57]]
  const eyeL = [[12, 52], [18, 47], [24, 46], [30, 52], [24, 57], [18, 57]]
  for (let i = 0; i < 6; i++) pts[36 + i] = M(...eyeR[i])
  for (let i = 0; i < 6; i++) pts[42 + i] = M(...eyeL[i])
  const lipOut = [
    [-20, 88], [-13, 85], [-6, 84], [0, 85], [6, 84], [13, 85],
    [20, 88], [13, 93], [6, 95], [0, 96], [-6, 95], [-13, 93],
  ]
  for (let i = 0; i < 12; i++) pts[48 + i] = M(...lipOut[i])
  const lipIn = [
    [-13, 88], [-6, 87], [0, 87.5], [6, 87], [13, 88], [6, 91], [0, 91.5], [-6, 91],
  ]
  for (let i = 0; i < 8; i++) pts[60 + i] = M(...lipIn[i])
  return pts
}
