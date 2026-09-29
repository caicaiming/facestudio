/**
 * layers.js —— 统一图层栈
 *
 * 出发点：画布上的每一个叠加内容都该是一个「图层」，是图层就能操作。
 * 之前只有手动画的箭头 / 文字 / 素材算图层，而照片、网格、点位、医美部位、
 * 基准点这些叠加内容全靠散落的开关（overlay 单选、showAnchors 布尔）控制，
 * 既不能单独调浓淡，也不能锁住防误拖，更谈不上排序。
 *
 * 这里把两者合成一张栈，统一具备四种基本操作：
 *   ① 显示 / 隐藏（眼）  ② 锁定（锁：不参与画布拾取，防误拖）
 *   ③ 不透明度          ④ 上移 / 下移（层序）
 * 内容层（素材、画线、文字）额外可缩放 / 旋转 / 重命名 / 删除；
 * 标记层额外可调整「标记大小」（点位太小看不清时放大标记，不动点位数据）。
 *
 * ── 层序的物理约束（band）────────────────────────────────
 * 层序不能任意穿越：素材必须垫在点位【下】（否则整张示意图糊住 68 点），
 * 而箭头文字要压在点位的【上】（它们指着点位讲方案）。这两条是 Stage 28.1
 * 用真实反馈换来的，不能为了「看起来能随便排」而破坏。
 * 因此排序只在 band 内部进行，跨 band 的按钮直接禁用：
 *
 *   band 0  底图照片（永远最底，DOM 就是 img）
 *   band 1  形变预览（覆盖在照片上，DOM 就是 warp canvas）
 *   band 2  素材      ← 点位之下
 *   band 3  标记层    ← 网格/点位/三庭五眼/对称/医美部位/自定义点/基准点
 *   band 4  画线文字  ← 点位之上
 *
 * 本模块只出纯函数与常量，不碰 React、不碰 DOM，便于单测。
 */

const STORE_KEY = 'facestudio_layers_v1'

/** 标记层：都画在同一张 mesh 画布上，彼此可以任意排序 */
export const MARKER_KEYS = ['mesh', 'points', 'three', 'symmetry', 'sites', 'custom', 'anchors']

/** 叠加预设按钮能管的四个键（对应工具栏那排 seg） */
export const OVERLAY_KEYS = ['mesh', 'points', 'three', 'symmetry']

/**
 * 系统层定义。
 * band 见文件头；def 为该层默认是否可见；fixed 表示层序固定（不可上下移）。
 */
export const SYS_LAYERS = [
  { key: 'photo', name: '底图照片', band: 0, icon: '▣', fixed: true, def: true,
    hint: '原始照片本身。调淡可以突出标注线稿，隐藏后只剩点位与标注。' },
  { key: 'warp', name: '形变预览', band: 1, icon: '◫', fixed: true, def: false,
    hint: '按当前点位形变后的照片。默认关闭，打开可在原图上直接对照调整效果。' },
  { key: 'mesh', name: '三角网格', band: 3, icon: '◺', def: true,
    hint: '68 点连成的三角网格 —— 形变的实际作用域，自带小点位做参照。' },
  { key: 'points', name: '68 点位', band: 3, icon: '⁘', def: false,
    hint: 'face-api 检测到的 68 个特征点，带编号，便于对照面板定位。' },
  { key: 'three', name: '三庭五眼', band: 3, icon: '≡', def: false,
    hint: '三庭五眼参考线；自带淡点位做参照，故关掉「68 点位」仍能看到点。' },
  { key: 'symmetry', name: '对称参考', band: 3, icon: '⇹', def: false,
    hint: '左右镜像对称线，用来判断脸型偏斜，自带淡点位。' },
  { key: 'sites', name: '医美部位', band: 3, icon: '✚', def: true,
    hint: '注射 / 手术作用点。68 点里不存在，是规范坐标系外推出的虚拟控制点。' },
  { key: 'custom', name: '自定义点位', band: 3, icon: '✦', def: true,
    hint: '手动添加的点位，可单独拖动，用于补 68 点覆盖不到的位置。' },
  { key: 'anchors', name: '基准点', band: 3, icon: '⌖', def: true,
    hint: '坐标系原点与尺度基准（两眼中点 / 瞳距），可拖动校准。' },
]

export const SYS_KEYS = SYS_LAYERS.map((l) => l.key)

const SYS_MAP = new Map(SYS_LAYERS.map((l) => [l.key, l]))

const DEFAULT_ORDER = ['mesh', 'points', 'three', 'symmetry', 'sites', 'custom', 'anchors']

export const MARKER_SCALE_MIN = 0.5
export const MARKER_SCALE_MAX = 2.5

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt)

// ---------------------------------------------------------------- 默认状态

/** 每层默认 meta：visible / alpha / lock / marker（标记缩放倍数） */
function defaultMeta() {
  const meta = {}
  for (const l of SYS_LAYERS) {
    meta[l.key] = {
      visible: l.def !== false,
      alpha: 1,
      lock: false,
      marker: 1,
    }
  }
  return meta
}

export function defaultLayerState() {
  return { v: 1, order: DEFAULT_ORDER.slice(), meta: defaultMeta() }
}

/**
 * 校验并补齐外部数据（localStorage / 旧版本）。
 * 原则：认不出的键一律丢弃，缺的键一律补默认 —— 宁可回到默认值，
 * 也不要让半个坏状态把画布画成空白（这类 bug 极难复现）。
 */
export function sanitizeLayerState(raw) {
  const def = defaultLayerState()
  if (!raw || typeof raw !== 'object') return def

  const meta = { ...def.meta }
  const src = raw.meta && typeof raw.meta === 'object' ? raw.meta : {}
  for (const k of SYS_KEYS) {
    const m = src[k]
    if (!m || typeof m !== 'object') continue
    meta[k] = {
      visible: m.visible !== false,
      alpha: clamp(num(m.alpha, 1), 0.05, 1),
      lock: !!m.lock,
      marker: clamp(num(m.marker, 1), MARKER_SCALE_MIN, MARKER_SCALE_MAX),
    }
  }

  // 顺序：只保留认识的标记键，缺的补在末尾，保证 MARKER_KEYS 全覆盖
  const order = []
  const seen = new Set()
  for (const k of Array.isArray(raw.order) ? raw.order : []) {
    if (MARKER_KEYS.includes(k) && !seen.has(k)) {
      order.push(k)
      seen.add(k)
    }
  }
  for (const k of MARKER_KEYS) if (!seen.has(k)) order.push(k)

  return { v: 1, order, meta }
}

export function loadLayerState() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return defaultLayerState()
    return sanitizeLayerState(JSON.parse(raw))
  } catch {
    return defaultLayerState()
  }
}

export function saveLayerState(st) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(st))
  } catch {
    /* 隐私模式下写不了，不影响本次使用 */
  }
}

// ---------------------------------------------------------------- 读写单层

/** 取某系统层的 meta，永远返回完整对象（键被改坏也能兜住） */
export function layerMeta(st, key) {
  const m = st?.meta?.[key]
  if (m && typeof m === 'object') return m
  return { visible: SYS_MAP.get(key)?.def !== false, alpha: 1, lock: false, marker: 1 }
}

export const isLayerOn = (st, key) => layerMeta(st, key).visible !== false
export const layerAlpha = (st, key) => clamp(num(layerMeta(st, key).alpha, 1), 0.05, 1)
export const layerLock = (st, key) => !!layerMeta(st, key).lock
export const layerMarkerScale = (st, key) =>
  clamp(num(layerMeta(st, key).marker, 1), MARKER_SCALE_MIN, MARKER_SCALE_MAX)

/** 给某系统层打补丁，返回新 state（不改原对象） */
export function patchLayer(st, key, patch) {
  if (!SYS_MAP.has(key)) return st
  const cur = layerMeta(st, key)
  const next = { ...cur, ...patch }
  if (next.alpha != null) next.alpha = clamp(num(next.alpha, 1), 0.05, 1)
  if (next.marker != null) next.marker = clamp(num(next.marker, 1), MARKER_SCALE_MIN, MARKER_SCALE_MAX)
  return { ...st, meta: { ...st.meta, [key]: next } }
}

/** 切换可见性（点眼睛） */
export function toggleLayer(st, key) {
  return patchLayer(st, key, { visible: !isLayerOn(st, key) })
}

// ---------------------------------------------------------------- 排序

/**
 * 标记层上下移一层。dir=+1 上移（更靠前显示），dir=-1 下移。
 * 到头了就原样返回 —— 由调用方据此禁用按钮，避免「点了没反应」。
 */
export function moveMarker(st, key, dir) {
  const order = (st?.order || []).slice()
  const i = order.indexOf(key)
  const j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return st
  const next = order.slice()
  next[i] = order[j]
  next[j] = order[i]
  return { ...st, order: next }
}

/**
 * 标记层的绘制顺序：state.order 里认得出的键按原序，缺的一律补在末尾。
 * 画布与图层面板必须共用这一个函数，否则两边会画出不同的层序。
 */
export function markerOrderOf(st) {
  const order = []
  const seen = new Set()
  for (const k of st?.order || []) {
    if (MARKER_KEYS.includes(k) && !seen.has(k)) {
      order.push(k)
      seen.add(k)
    }
  }
  for (const k of MARKER_KEYS) if (!seen.has(k)) order.push(k)
  return order
}

/** 内容层的 band：素材垫在点位下，画线文字压在点位上 */
export const bandOfItem = (it) => (it?.kind === 'material' ? 2 : 4)

/**
 * 内容层在【自己 band 内】上下移一层。
 * 素材与画线混在同一个数组里，跨 band 移动会破坏「素材必在点位下」的约定，
 * 所以只在同 band 的相邻元素之间换位。
 */
export function moveContent(items, index, dir) {
  const src = items || []
  const it = src[index]
  if (!it || !src.length) return src
  const band = bandOfItem(it)
  const idxs = []
  for (let i = 0; i < src.length; i++) if (bandOfItem(src[i]) === band) idxs.push(i)

  const pos = idxs.indexOf(index)
  const np = pos + dir
  // 到头了：返回原引用，调用方据此判断「移不动」，React 也能省掉一次无效更新
  if (np < 0 || np >= idxs.length) return src

  const list = src.slice()
  const anchorIdx = idxs[np]
  const rest = list.filter((_, i) => i !== index)
  const anchorPos = anchorIdx > index ? anchorIdx - 1 : anchorIdx
  rest.splice(dir > 0 ? anchorPos + 1 : anchorPos, 0, it)
  return rest
}

// ---------------------------------------------------------------- 叠加预设

/**
 * 工具栏那排 seg 现在只是「预设」：一次点开一组叠加层，而不是独立状态。
 * three / symmetry 自带淡点位（见 SYS_LAYERS 的 hint），所以不必额外开点位层。
 */
export function overlayPreset(st, key) {
  let next = st
  for (const k of OVERLAY_KEYS) next = patchLayer(next, k, { visible: k === key })
  return next
}

/**
 * 由图层状态反推当前该高亮哪个预设按钮。
 * 面板里单独改动过 → 可能四个都不匹配，此时返回 'multi'（不高亮任何按钮）。
 */
export function overlayOf(st) {
  const on = OVERLAY_KEYS.filter((k) => isLayerOn(st, k))
  if (on.length === 0) return 'none'
  if (on.length === 1) return on[0]
  return 'multi'
}

// ---------------------------------------------------------------- 展示栈

/**
 * 把「系统层 + 内容层」摊平成一条从下到上的栈，供图层面板与画布共用。
 *
 * 每项：{ id, sys, key, index, name, icon, visible, alpha, lock, marker, band, item }
 *   sys=true  → key 是系统层键；sys=false → index 是它在内容数组里的下标
 */
export function flattenStack(st, contentItems = []) {
  const state = st || defaultLayerState()
  const sys = SYS_LAYERS.filter((l) => l.band <= 1).map((l) => {
    const m = layerMeta(state, l.key)
    return {
      id: `sys:${l.key}`, sys: true, key: l.key, index: -1,
      name: m.name || l.name, icon: l.icon, band: l.band, hint: l.hint,
      visible: m.visible !== false, alpha: m.alpha, lock: !!m.lock, marker: m.marker,
      fixed: !!l.fixed, item: null,
    }
  })

  const mats = []
  const rest = []
  for (let i = 0; i < contentItems.length; i++) {
    const it = contentItems[i]
    if (!it) continue
    const row = {
      id: it.id, sys: false, key: it.kind, index: i,
      name: null, icon: it.kind === 'material' ? '🞕' : '✎', band: bandOfItem(it),
      visible: it.visible !== false, alpha: it.alpha ?? 1, lock: !!it.lock, marker: 1,
      fixed: false, item: it,
    }
    if (it.kind === 'material') mats.push(row)
    else rest.push(row)
  }

  const markers = markerOrderOf(state).map((k) => {
    const l = SYS_MAP.get(k)
    const m = layerMeta(state, k)
    return {
      id: `sys:${k}`, sys: true, key: k, index: -1,
      name: m.name || l.name, icon: l.icon, band: 3, hint: l.hint,
      visible: m.visible !== false, alpha: m.alpha, lock: !!m.lock, marker: m.marker,
      fixed: false, item: null,
    }
  })

  return [...sys, ...mats, ...markers, ...rest]
}

/** 某行能否再往上 / 往下移（band 边界与首尾都会挡住） */
export function canMove(stack, rowId, dir) {
  const i = stack.findIndex((r) => r.id === rowId)
  if (i < 0) return false
  const row = stack[i]
  if (row.fixed) return false
  const j = i + dir
  if (j < 0 || j >= stack.length) return false
  return stack[j].band === row.band
}
