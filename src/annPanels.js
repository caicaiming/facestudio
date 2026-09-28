/**
 * annPanels.js —— 标注面板的浮窗状态（是否浮出 + 位置尺寸）
 *
 * 位置尺寸要跨会话记住：咨询师通常会把素材面板拖到照片旁边、话术面板拖到
 * 另一边，然后固定下来 —— 每次打开都要重摆一遍的话，浮窗就不如不用。
 *
 * 存 localStorage；读取时按当前视口 clamp 一次 —— 上次是在 4K 屏上摆的位置，
 * 换到笔记本上会跑到屏幕外，找不到面板等于面板丢了。
 */

const KEY = 'facestudio_ann_panels_v1'

export const ANN_PANEL_KEYS = ['tools', 'materials', 'layers', 'phrases']

/** 各面板的出厂尺寸：按内容量给，素材/话术这类"要翻找"的给大一点 */
const SIZES = {
  tools: [340, 400],
  materials: [380, 520],
  layers: [300, 380],
  phrases: [400, 520],
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export function fitPanels(p) {
  const W = typeof window === 'undefined' ? 1600 : window.innerWidth
  const H = typeof window === 'undefined' ? 900 : window.innerHeight
  const out = {}
  for (const k of ANN_PANEL_KEYS) {
    const [dw, dh] = SIZES[k]
    const v = p?.[k] || {}
    const w = clamp(Number(v.w) || dw, 240, Math.max(240, W - 24))
    const h = clamp(Number(v.h) || dh, 180, Math.max(180, H - 48))
    out[k] = {
      float: !!v.float,
      w,
      h,
      x: clamp(Number(v.x) || Math.round(W * 0.06), 4, Math.max(4, W - w - 8)),
      y: clamp(Number(v.y) || Math.round(H * 0.12), 4, Math.max(4, H - 36)),
    }
  }
  return out
}

export function loadPanels() {
  try {
    const raw = localStorage.getItem(KEY)
    return fitPanels(raw ? JSON.parse(raw) : null)
  } catch {
    return fitPanels(null)
  }
}

export function savePanels(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* 隐私模式下写不了，忽略即可 */
  }
}
