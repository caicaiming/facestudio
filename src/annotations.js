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
    ctx.beginPath()
    if (item.kind === 'rect') {
      ctx.rect(x, y, w, h)
    } else {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
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
    return
  }
  if (item.kind === 'text') {
    const fs = px(item.font)
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
