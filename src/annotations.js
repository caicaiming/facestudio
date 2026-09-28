/**
 * annotations.js —— 标注图层数据模型（纯逻辑 + Canvas 绘制）
 *
 * 融合自自研「图片融合」工具（49.51.250.197:8088）的画线能力，按 Face Studio
 * 的坐标体系重写：
 *
 * 坐标语义
 * - 所有几何坐标存【图片自然像素】（与 68 点位一致），缩放 / 平移 / 导出全链路
 *   无需二次换算；
 * - 粗细 / 字号 / 箭头大小存「100% 缩放时的屏幕像素」，绘制时乘 k0
 *   （自然宽 ÷ 100% 显示宽）。这样标注「钉在照片上」：放大看细节时箭头尖端
 *   仍指向原特征，不会和照片脱节 —— 这是与点标记（恒定屏幕尺寸）的关键差异，
 *   对「指着鼻尖讲解」的场景是正确取舍。
 *
 * 图层栈
 * - 每个画布（原始图 / 预览图）各一个数组，标注与素材同栈，数组序即 z 序
 *   （末尾 = 最上层）；
 * - 撤销 / 重做由上层（App）做整栈快照，本模块不持有状态。
 */

// ---------------------------------------------------------------- 常量

/** 工具清单（era=对象级橡皮，move=移动图层） */
export const ANN_TOOLS = [
  { key: 'pen', label: '画笔', icon: '✏️' },
  { key: 'line', label: '直线', icon: '／' },
  { key: 'arrow', label: '箭头', icon: '➤' },
  { key: 'rect', label: '矩形', icon: '▭' },
  { key: 'ellipse', label: '椭圆', icon: '◯' },
  { key: 'text', label: '文字', icon: 'T' },
  { key: 'era', label: '橡皮', icon: '🩹' },
  { key: 'move', label: '移动', icon: '✥' },
]

/** 画线类工具（落点-拖动-抬起点位式） */
export const DRAW_TOOLS = new Set(['pen', 'line', 'arrow', 'rect', 'ellipse'])

/** 色板：红橙黄绿蓝紫黑白（与融合工具一致，医美讲解高饱和场景够用） */
export const ANN_COLORS = [
  '#e02020',
  '#ff7a00',
  '#ffc400',
  '#22b573',
  '#2f7bff',
  '#9b59ff',
  '#1a1a1a',
  '#ffffff',
]

/** 默认样式（对应融合工具的出厂值） */
export const defaultAnnStyle = () => ({
  color: '#e02020',
  width: 10, // px @100%
  alpha: 100, // %
  dash: false,
  fill: false,
  shape: false, // 45° 吸附
  arrowH: 24, // 箭头翼长 px @100%
  font: 48, // 字号 px @100%
  outline: true, // 文字描边
  bold: false,
  bg: false, // 文字底衬
})

/** 素材初始尺寸：占画布短边的比例（融合工具 ≈ 60% 高，取同值） */
export const MAT_INIT_RATIO = 0.6

// ---------------------------------------------------------------- id

let __seq = 0
/** 图层 id：会话内自增即可（撤销快照不落盘） */
export const nextLayerId = () => `ly${(++__seq).toString(36)}_${Math.random().toString(36).slice(2, 6)}`

// ---------------------------------------------------------------- 构造

/** 样式 → 图层公共字段 */
const styleFields = (s) => ({
  color: s.color,
  alpha: Math.max(0.1, Math.min(1, s.alpha / 100)),
  dash: !!s.dash,
})

/**
 * 画线类图层的落笔。a/b 为自然坐标。
 * 直线 / 箭头支持 45° 吸附：把终点投影到最近的 45° 倍数射线上。
 */
export function beginStroke(kind, a, b, style) {
  const item = {
    id: nextLayerId(),
    kind,
    visible: true,
    width: style.width,
    ...styleFields(style),
  }
  if (kind === 'pen') {
    item.pts = [a, b]
  } else {
    if (style.shape && (kind === 'line' || kind === 'arrow')) {
      b = snapPoint45(a, b)
    }
    item.x1 = a.x
    item.y1 = a.y
    item.x2 = b.x
    item.y2 = b.y
    if (kind === 'arrow') item.arrowH = style.arrowH
    if (kind === 'rect' || kind === 'ellipse') item.fill = !!style.fill
  }
  return item
}

/** 画笔 / 图形拖动中更新终点 */
export function updateStroke(item, p, snap = false) {
  if (item.kind === 'pen') {
    const last = item.pts[item.pts.length - 1]
    // 亚像素抖动直接吞掉，避免存一堆零长度段
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.8) return item
    item.pts.push(p)
  } else {
    let q = p
    if (snap && (item.kind === 'line' || item.kind === 'arrow')) {
      q = snapPoint45({ x: item.x1, y: item.y1 }, p)
    }
    item.x2 = q.x
    item.y2 = q.y
  }
  return item
}

/** 文字图层 */
export function makeText(x, y, text, style) {
  return {
    id: nextLayerId(),
    kind: 'text',
    visible: true,
    x,
    y,
    text: String(text ?? ''),
    font: style.font,
    color: style.color,
    alpha: Math.max(0.1, Math.min(1, style.alpha / 100)),
    outline: !!style.outline,
    bold: !!style.bold,
    bg: !!style.bg,
  }
}

/** 素材图层（w/h 为自然像素，添加时由调用方按图片尺寸折算） */
export function makeMaterial(src, name, x, y, w, h) {
  return {
    id: nextLayerId(),
    kind: 'material',
    visible: true,
    src,
    name,
    x, // 中心
    y,
    w,
    h,
    rot: 0,
    alpha: 1,
  }
}

// ---------------------------------------------------------------- 几何

/**
 * 45° 吸附：把 b 点吸附到以 a 为原点、最近的 45° 倍数方向上，半径保持 |ab|。
 */
export function snapPoint45(a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const r = Math.hypot(dx, dy)
  if (r < 1e-6) return { ...b }
  const step = Math.PI / 4
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: a.x + Math.cos(ang) * r, y: a.y + Math.sin(ang) * r }
}

/** 点到线段距离（命中测试的基础） */
export function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** 文字估宽（无 ctx 时的命中兜底）：CJK 记 1.0 字宽，ASCII 记 0.55 */
export function textExtent(item) {
  const fs = item.font
  let w = 0
  for (const ch of item.text) w += fs * (ch.charCodeAt(0) > 0x2e7f ? 1.0 : 0.55)
  return { w, h: fs * 1.25 }
}

/** 绕 c 点旋转 deg 度（顺时针为正） */
export function rotatePoint(q, c, deg) {
  const r = (deg * Math.PI) / 180
  const co = Math.cos(r)
  const si = Math.sin(r)
  const dx = q.x - c.x
  const dy = q.y - c.y
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co }
}

/**
 * 变换框：{ cx, cy, w, h, rot }（自然像素，rot 为度）。
 *
 * 与 layerBounds 的分工：bounds 只给轴对齐外包（命中测试 / 选中虚线框用），
 * 这里给【旋转后中心 + 本地尺寸】，缩放手柄必须挂在旋转后的框上，否则手柄
 * 会和图形分离 —— 转过的素材尤其明显。
 */
export function layerBox(item) {
  if (!item) return null
  const pad = item.kind === 'material' ? 0 : item.width || 0
  if (item.kind === 'pen') {
    let x1 = Infinity
    let y1 = Infinity
    let x2 = -Infinity
    let y2 = -Infinity
    for (const p of item.pts) {
      x1 = Math.min(x1, p.x)
      y1 = Math.min(y1, p.y)
      x2 = Math.max(x2, p.x)
      y2 = Math.max(y2, p.y)
    }
    if (!Number.isFinite(x1)) return null
    return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2, rot: 0 }
  }
  if (item.kind === 'text') {
    const e = textExtent(item)
    return { cx: item.x + e.w / 2, cy: item.y - e.h / 2, w: e.w, h: e.h, rot: item.rot || 0 }
  }
  if (item.kind === 'material') {
    return { cx: item.x, cy: item.y, w: item.w, h: item.h, rot: item.rot || 0 }
  }
  const x1 = Math.min(item.x1, item.x2)
  const y1 = Math.min(item.y1, item.y2)
  const x2 = Math.max(item.x1, item.x2)
  const y2 = Math.max(item.y1, item.y2)
  return {
    cx: (x1 + x2) / 2,
    cy: (y1 + y2) / 2,
    w: x2 - x1 + pad * 2,
    h: y2 - y1 + pad * 2,
    rot: item.rot || 0,
  }
}

/** 手柄 id → 局部方向符号（[-1|0|1, -1|0|1]），0 表示该轴不动 */
export const HANDLE_DIRS = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
}

export const HANDLES = Object.keys(HANDLE_DIRS)

/** 本地坐标（相对框心、未旋转）→ 自然坐标 */
export function boxToNatural(box, lx, ly) {
  const r = (box.rot * Math.PI) / 180
  const co = Math.cos(r)
  const si = Math.sin(r)
  return { x: box.cx + lx * co - ly * si, y: box.cy + lx * si + ly * co }
}

/** 自然坐标 → 本地坐标（相对框心、按 rot 反旋） */
export function boxToLocal(box, p) {
  const r = (-box.rot * Math.PI) / 180
  const co = Math.cos(r)
  const si = Math.sin(r)
  const dx = p.x - box.cx
  const dy = p.y - box.cy
  return { x: dx * co - dy * si, y: dx * si + dy * co }
}

/**
 * 变换手柄的自然坐标（8 个缩放 + 1 个旋转）。
 * lift：旋转手柄再往上抬的距离（自然像素，调用方按屏幕像素折算）。
 */
export function handlePoints(item, lift = 0) {
  const box = layerBox(item)
  if (!box) return []
  const out = HANDLES.map((id) => {
    const [sx, sy] = HANDLE_DIRS[id]
    return { id, ...boxToNatural(box, (sx * box.w) / 2, (sy * box.h) / 2) }
  })
  out.push({ id: 'rot', ...boxToNatural(box, 0, -box.h / 2 - lift) })
  return out
}

/** 命中手柄返回 id（'nw'…'w' / 'rot'），否则 null。旋转手柄优先（在框外）。 */
export function hitHandle(p, item, tol) {
  if (!item || item.visible === false) return null
  const pts = handlePoints(item, tol * 3)
  for (let i = pts.length - 1; i >= 0; i--) {
    if (Math.hypot(p.x - pts[i].x, p.y - pts[i].y) <= tol * 1.6) return pts[i].id
  }
  return null
}

/** 数值夹取 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * 缩放图层：绕 anchor（自然坐标）在 rot 局部坐标系下按 sx / sy 缩放。
 *
 * 各类别的「大小」字段同步缩放，否则会出现「框变大了、线还是那么细」的怪相：
 * - 线宽 / 箭头翼长按几何平均缩放（夹在合理区间，避免缩到看不见或糊成一片）；
 * - 文字按几何平均改字号（文字只有 font 一个尺度，无法非等比）；
 * - 素材改 w / h。
 */
export function scaleLayer(item, sx, sy, anchor, rot = 0) {
  if (!item) return item
  const r = (rot * Math.PI) / 180
  const co = Math.cos(r)
  const si = Math.sin(r)
  const f = (q) => {
    const dx = q.x - anchor.x
    const dy = q.y - anchor.y
    const lx = dx * co + dy * si
    const ly = -dx * si + dy * co
    const nx = lx * sx
    const ny = ly * sy
    return { x: anchor.x + nx * co - ny * si, y: anchor.y + nx * si + ny * co }
  }
  const avg = Math.sqrt(Math.abs(sx * sy)) || 1
  const w = clamp((item.width || 1) * avg, 1, 400)

  if (item.kind === 'pen') {
    return { ...item, pts: item.pts.map(f), width: w }
  }
  if (item.kind === 'line' || item.kind === 'arrow') {
    const a = f({ x: item.x1, y: item.y1 })
    const b = f({ x: item.x2, y: item.y2 })
    const next = { ...item, x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: w }
    if (item.kind === 'arrow') next.arrowH = clamp((item.arrowH || 24) * avg, 6, 400)
    return next
  }
  if (item.kind === 'rect' || item.kind === 'ellipse') {
    const a = f({ x: item.x1, y: item.y1 })
    const b = f({ x: item.x2, y: item.y2 })
    return { ...item, x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: w }
  }
  if (item.kind === 'text') {
    const o = f({ x: item.x, y: item.y })
    return { ...item, x: o.x, y: o.y, font: clamp(item.font * avg, 8, 400) }
  }
  if (item.kind === 'material') {
    const o = f({ x: item.x, y: item.y })
    return {
      ...item,
      x: o.x,
      y: o.y,
      w: Math.max(8, item.w * Math.abs(sx)),
      h: Math.max(8, item.h * Math.abs(sy)),
    }
  }
  return item
}

/**
 * 旋转图层（顺时针 deg 度）。
 *
 * 素材 / 矩形 / 椭圆 / 文字带 rot 字段，绘制时整体旋转；
 * 线段与画笔是「两个点 / 一串点」，直接把角度烤进坐标更省事 ——
 * 一条线绕中点转端点即可，不需要额外字段，命中测试也天然跟着走。
 */
export function rotateLayer(item, deg) {
  if (!item) return item
  const d = ((deg % 360) + 360) % 360
  if (item.kind === 'material' || item.kind === 'text' || item.kind === 'rect' || item.kind === 'ellipse') {
    return { ...item, rot: (((item.rot || 0) + d) % 360 + 360) % 360 }
  }
  const box = layerBox(item)
  if (!box) return item
  const c = { x: box.cx, y: box.cy }
  if (item.kind === 'pen') {
    return { ...item, pts: item.pts.map((q) => rotatePoint(q, c, d)) }
  }
  const a = rotatePoint({ x: item.x1, y: item.y1 }, c, d)
  const b = rotatePoint({ x: item.x2, y: item.y2 }, c, d)
  return { ...item, x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

/** 图层包围盒（自然像素）。文字用估宽，画笔含线宽余量。 */
export function layerBounds(item) {
  if (!item) return null
  const pad = item.kind === 'material' ? 0 : item.width || 0
  if (item.kind === 'pen') {
    let x1 = Infinity
    let y1 = Infinity
    let x2 = -Infinity
    let y2 = -Infinity
    for (const p of item.pts) {
      x1 = Math.min(x1, p.x)
      y1 = Math.min(y1, p.y)
      x2 = Math.max(x2, p.x)
      y2 = Math.max(y2, p.y)
    }
    if (!Number.isFinite(x1)) return null
    return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 }
  }
  if (item.kind === 'text') {
    const e = textExtent(item)
    return { x: item.x, y: item.y - e.h, w: e.w, h: e.h }
  }
  if (item.kind === 'material') {
    // 旋转素材取外接圆半径的包围盒（保守但简单，命中容差足够）
    const r = Math.hypot(item.w, item.h) / 2
    return { x: item.x - r, y: item.y - r, w: r * 2, h: r * 2 }
  }
  const x1 = Math.min(item.x1, item.x2) - pad
  const y1 = Math.min(item.y1, item.y2) - pad
  const x2 = Math.max(item.x1, item.x2) + pad
  const y2 = Math.max(item.y1, item.y2) + pad
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** 单个图层命中（tol 为自然像素容差） */
export function hitLayer(p, item, tol) {
  if (item.visible === false) return false
  if (item.kind === 'material') {
    // 旋转到素材本地坐标（与融合工具 hit() 同法）
    const a = (-(item.rot || 0) * Math.PI) / 180
    const dx = p.x - item.x
    const dy = p.y - item.y
    const rx = dx * Math.cos(a) - dy * Math.sin(a)
    const ry = dx * Math.sin(a) + dy * Math.cos(a)
    return Math.abs(rx) <= item.w / 2 + tol && Math.abs(ry) <= item.h / 2 + tol
  }
  if (item.kind === 'pen') {
    if (item.pts.length === 1) return Math.hypot(p.x - item.pts[0].x, p.y - item.pts[0].y) <= tol + item.width
    for (let i = 1; i < item.pts.length; i++) {
      const a = item.pts[i - 1]
      const b = item.pts[i]
      if (segDist(p.x, p.y, a.x, a.y, b.x, b.y) <= tol + item.width / 2) return true
    }
    return false
  }
  if (item.kind === 'line' || item.kind === 'arrow') {
    return segDist(p.x, p.y, item.x1, item.y1, item.x2, item.y2) <= tol + item.width / 2
  }
  if (item.kind === 'rect' || item.kind === 'ellipse') {
    // 旋转过的图形：把点反旋回本地系再测，否则「看得见的图形点不中」
    if (item.rot) {
      const c = { x: (item.x1 + item.x2) / 2, y: (item.y1 + item.y2) / 2 }
      p = rotatePoint(p, c, -(item.rot || 0))
    }
    const x1 = Math.min(item.x1, item.x2)
    const y1 = Math.min(item.y1, item.y2)
    const x2 = Math.max(item.x1, item.x2)
    const y2 = Math.max(item.y1, item.y2)
    const inside = p.x >= x1 - tol && p.x <= x2 + tol && p.y >= y1 - tol && p.y <= y2 + tol
    if (item.fill) return inside
    if (!inside) return false
    // 空心：只命中边缘带（tol+线宽）
    const edge = tol + item.width
    const nearX = p.x <= x1 + edge || p.x >= x2 - edge
    const nearY = p.y <= y1 + edge || p.y >= y2 - edge
    if (item.kind === 'rect') return nearX || nearY
    // 椭圆：粗略按内切/外切矩形环带（讲解场景够用，不搞解析法）
    const cx = (x1 + x2) / 2
    const cy = (y1 + y2) / 2
    const rx = (x2 - x1) / 2
    const ry = (y2 - y1) / 2
    if (rx < 1 || ry < 1) return true
    const norm = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry)
    return norm > 0.8 || nearX || nearY
  }
  if (item.kind === 'text') {
    if (item.rot) p = rotatePoint(p, { x: item.x, y: item.y }, -(item.rot || 0))
    const b = layerBounds(item)
    return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol
  }
  return false
}

/** 自顶向下找第一个命中的图层，返回索引（-1 = 无） */
export function hitLayers(p, items, tol) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (hitLayer(p, items[i], tol)) return i
  }
  return -1
}

/** 整体平移图层（move 工具 / 方向微调） */
export function translateLayer(item, dx, dy) {
  if (item.kind === 'pen') {
    return { ...item, pts: item.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
  }
  if (item.kind === 'text' || item.kind === 'material') {
    return { ...item, x: item.x + dx, y: item.y + dy }
  }
  return { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy }
}

/**
 * 画笔的「有效长度」：判断是否误触（点一下就抬笔）。
 * <2 个点或总长 < 3px 视为无效，不上图层栈。
 */
export function strokeLength(item) {
  if (item.kind !== 'pen') return Math.hypot(item.x2 - item.x1, item.y2 - item.y1)
  let s = 0
  for (let i = 1; i < item.pts.length; i++) {
    s += Math.hypot(item.pts[i].x - item.pts[i - 1].x, item.pts[i].y - item.pts[i - 1].y)
  }
  return s
}

// ---------------------------------------------------------------- 绘制

/** setLineDash 兼容：alpha 与虚线统一处理 */
function applyStroke(ctx, item, k0) {
  ctx.strokeStyle = item.color
  ctx.globalAlpha = item.alpha ?? 1
  ctx.lineWidth = Math.max(1, item.width * k0)
  ctx.setLineDash(item.dash ? [item.width * k0 * 1.6, item.width * k0 * 1.1] : [])
}

/** 箭头两翼（终点处，指向线方向） */
function drawArrowHead(ctx, x1, y1, x2, y2, head, color, alpha) {
  const ang = Math.atan2(y2 - y1, x2 - x1)
  ctx.setLineDash([])
  ctx.strokeStyle = color
  ctx.globalAlpha = alpha ?? 1
  ctx.lineWidth = Math.max(1, head * 0.32)
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - Math.cos(ang - 0.42) * head, y2 - Math.sin(ang - 0.42) * head)
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - Math.cos(ang + 0.42) * head, y2 - Math.sin(ang + 0.42) * head)
  ctx.stroke()
}

/**
 * 绘制单个图层。k0 = 自然宽 ÷ 100% 显示宽（缩放随动）。
 * imgCache: Map<src, HTMLImageElement|null>，素材图未就绪时跳过该层。
 */
export function drawLayer(ctx, item, k0, imgCache) {
  if (!item || item.visible === false) return
  const px = (v) => v * k0

  if (item.kind === 'pen') {
    applyStroke(ctx, item, k0)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(item.pts[0].x, item.pts[0].y)
    for (let i = 1; i < item.pts.length; i++) ctx.lineTo(item.pts[i].x, item.pts[i].y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    return
  }
  if (item.kind === 'line' || item.kind === 'arrow') {
    applyStroke(ctx, item, k0)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(item.x1, item.y1)
    ctx.lineTo(item.x2, item.y2)
    ctx.stroke()
    ctx.setLineDash([])
    if (item.kind === 'arrow') {
      drawArrowHead(ctx, item.x1, item.y1, item.x2, item.y2, px(item.arrowH || 24), item.color, item.alpha)
    }
    ctx.globalAlpha = 1
    return
  }
  if (item.kind === 'rect' || item.kind === 'ellipse') {
    const x = Math.min(item.x1, item.x2)
    const y = Math.min(item.y1, item.y2)
    const w = Math.abs(item.x2 - item.x1)
    const h = Math.abs(item.y2 - item.y1)
    if (w < 1 || h < 1) return
    const cx = x + w / 2
    const cy = y + h / 2
    ctx.save()
    if (item.rot) {
      ctx.translate(cx, cy)
      ctx.rotate((item.rot * Math.PI) / 180)
      ctx.translate(-cx, -cy)
    }
    ctx.beginPath()
    if (item.kind === 'rect') {
      ctx.rect(x, y, w, h)
    } else {
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2)
    }
    if (item.fill) {
      ctx.fillStyle = item.color
      ctx.globalAlpha = (item.alpha ?? 1) * 0.35
      ctx.fill()
    }
    applyStroke(ctx, item, k0)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    ctx.restore()
    return
  }
  if (item.kind === 'text') {
    const fs = px(item.font)
    ctx.save()
    if (item.rot) {
      ctx.translate(item.x, item.y)
      ctx.rotate((item.rot * Math.PI) / 180)
      ctx.translate(-item.x, -item.y)
    }
    ctx.font = `${item.bold ? '700 ' : ''}${fs}px system-ui, "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.globalAlpha = item.alpha ?? 1
    const lines = String(item.text).split('\n')
    lines.forEach((line, i) => {
      const ly = item.y + i * fs * 1.25
      if (item.bg) {
        const tw = ctx.measureText(line).width
        ctx.fillStyle = 'rgba(255,255,255,0.82)'
        ctx.fillRect(item.x - fs * 0.18, ly - fs * 1.05, tw + fs * 0.36, fs * 1.32)
      }
      if (item.outline) {
        ctx.lineWidth = Math.max(2, fs * 0.14)
        ctx.strokeStyle = 'rgba(15,23,42,0.9)'
        ctx.lineJoin = 'round'
        ctx.strokeText(line, item.x, ly)
      }
      ctx.fillStyle = item.color
      ctx.fillText(line, item.x, ly)
    })
    ctx.globalAlpha = 1
    ctx.restore()
    return
  }
  if (item.kind === 'material') {
    const img = imgCache?.get(item.src)
    if (!img || !img.naturalWidth) return
    ctx.save()
    ctx.globalAlpha = item.alpha ?? 1
    ctx.translate(item.x, item.y)
    if (item.rot) ctx.rotate((item.rot * Math.PI) / 180)
    ctx.drawImage(img, -item.w / 2, -item.h / 2, item.w, item.h)
    // 选中态：外框提示
    if (item.__sel) {
      ctx.globalAlpha = 1
      ctx.strokeStyle = 'rgba(250,204,21,0.9)'
      ctx.lineWidth = Math.max(1.5, item.w * 0.004)
      ctx.setLineDash([item.w * 0.03, item.w * 0.02])
      ctx.strokeRect(-item.w / 2, -item.h / 2, item.w, item.h)
      ctx.setLineDash([])
    }
    ctx.restore()
  }
}

/**
 * 绘制整栈 + 呼吸草稿。draft 可为 {replaceIndex, item}（move 工具拖动中替换
 * 原位）或 {item}（画线中追加在顶）。
 */
export function drawLayers(ctx, items, k0, imgCache, draft) {
  for (let i = 0; i < items.length; i++) {
    if (draft && draft.replaceIndex === i) {
      drawLayer(ctx, draft.item, k0, imgCache)
      continue
    }
    const it = items[i]
    // 选中高亮：非素材画包围盒角标
    if (it.__sel && it.kind !== 'material') {
      const b = layerBounds(it)
      if (b) {
        ctx.save()
        ctx.strokeStyle = 'rgba(250,204,21,0.85)'
        ctx.lineWidth = Math.max(1.5, 2.5 * k0)
        ctx.setLineDash([6 * k0, 4 * k0])
        ctx.strokeRect(b.x, b.y, b.w, b.h)
        ctx.restore()
      }
    }
    drawLayer(ctx, it, k0, imgCache)
  }
  if (draft && draft.replaceIndex == null) drawLayer(ctx, draft.item, k0, imgCache)
}

/**
 * 选中态的变换手柄（8 个缩放方块 + 1 个旋转圆点）。
 *
 * hs = 手柄半边长、lift = 旋转点抬升距离（均为自然像素，由调用方按当前
 * 缩放折算，保证屏幕上恒定大小 —— 放大看细节时手柄不会变成大方块）。
 */
export function drawGizmo(ctx, item, hs, lift) {
  const box = layerBox(item)
  if (!box || box.w < 1e-6 || box.h < 1e-6) return
  const pts = handlePoints(item, lift)
  const at = (id) => pts.find((q) => q.id === id)
  ctx.save()
  ctx.setLineDash([])
  ctx.lineJoin = 'round'

  // 框：沿四角连线，旋转过的图形框也跟着斜
  ctx.strokeStyle = 'rgba(56,189,248,0.95)'
  ctx.lineWidth = Math.max(1, hs * 0.3)
  ctx.beginPath()
  const corners = ['nw', 'ne', 'se', 'sw'].map(at)
  ctx.moveTo(corners[0].x, corners[0].y)
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y)
  ctx.closePath()
  ctx.stroke()

  // 旋转手柄的引线
  const rp = at('rot')
  const np = at('n')
  ctx.beginPath()
  ctx.moveTo(np.x, np.y)
  ctx.lineTo(rp.x, rp.y)
  ctx.stroke()

  ctx.lineWidth = Math.max(1, hs * 0.28)
  for (const q of pts) {
    if (q.id === 'rot') {
      ctx.beginPath()
      ctx.arc(q.x, q.y, hs * 1.15, 0, Math.PI * 2)
      ctx.fillStyle = '#38bdf8'
      ctx.fill()
      ctx.strokeStyle = '#0b1220'
      ctx.stroke()
      continue
    }
    ctx.beginPath()
    ctx.rect(q.x - hs, q.y - hs, hs * 2, hs * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = '#0b1220'
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * 把图层栈拆成「素材」与「画线 / 文字」两组（草稿按原位替换或追加）。
 *
 * 为什么要拆：素材是一整张贴在脸上的示意图，画在点位的【下一层】才不会把
 * 68 点位糊住 —— 咨询师一边对点位讲方案、一边看素材，两者都要看得见。
 * 箭头和文字相反，它们指着点位讲，必须压在点位的【上一层】。
 */
export function splitStack(items, draft) {
  const list = (items || []).slice()
  if (draft && draft.replaceIndex != null) list[draft.replaceIndex] = draft.item
  else if (draft?.item) list.push(draft.item)
  const mats = []
  const rest = []
  for (const it of list) {
    if (!it) continue
    if (it.kind === 'material') mats.push(it)
    else rest.push(it)
  }
  return { mats, rest }
}

/** 整栈绘制（导出用）：素材垫底，画线文字在上 —— 与屏幕上的层序一致 */
export function drawStack(ctx, items, k0, imgCache) {
  const { mats, rest } = splitStack(items, null)
  for (const it of mats) drawLayer(ctx, it, k0, imgCache)
  for (const it of rest) drawLayer(ctx, it, k0, imgCache)
}

/** 图层显示名（图层面板用） */
export function layerName(item) {
  const t = ANN_TOOLS.find((x) => x.key === item.kind)
  if (item.kind === 'text') {
    const s = String(item.text).replace(/\n/g, ' ')
    return s.length > 10 ? `「${s.slice(0, 10)}…」` : `「${s}」`
  }
  if (item.kind === 'material') return item.name || '素材'
  return t ? t.label : item.kind
}
