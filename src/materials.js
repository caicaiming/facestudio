/**
 * materials.js —— 内置标注素材清单
 *
 * 10 张透明 PNG 迁自自研「图片融合」工具的 base64 内联素材，已落为
 * public/annotations/*.png（w/h 为原始像素，添加到画布时按短边 60% 折算）。
 * 路径走 BASE_URL，与模型目录同一规则（子路径部署 / 自定义域名免改）。
 */

export const MATERIALS = [
  { slug: 'face-contour', name: '面部轮廓标注', w: 1002, h: 982 },
  { slug: 'highlight-points', name: '面部高光点位', w: 651, h: 641 },
  { slug: 'eye-muscles', name: '眼周肌肉走向', w: 283, h: 671 },
  { slug: 'c1c2-nodes', name: 'C1C2 节点示意', w: 452, h: 261 },
  { slug: 'arc-1c-6c', name: '弧形轨迹 1C-6C', w: 374, h: 371 },
  { slug: 'bone-points', name: '骨相高点标注', w: 488, h: 504 },
  { slug: 'nose-structure', name: '鼻部结构标注', w: 461, h: 347 },
  { slug: 'light-shadow', name: '明暗面结构', w: 533, h: 258 },
  { slug: 'eye-zones', name: '眼周分区标注', w: 152, h: 259 },
  { slug: 'aesthetic-zones', name: '面部美学分区', w: 803, h: 1014 },
]

/** 素材文件 URL（相对 base，子路径部署安全） */
export function materialUrl(m) {
  return `${import.meta.env.BASE_URL}annotations/${m.slug}.png`
}

/** 缩略图 URL（同一文件，CSS 控制显示尺寸） */
export const thumbUrl = materialUrl

// ---------------------------------------------------------------- 图片缓存
/**
 * 素材图的解码缓存：src → HTMLImageElement（未就绪为 null）。
 *
 * 标注画布与导出共用同一个缓存 —— 否则导出时素材还没解码完，画出来就是
 * 空层。模块级而非组件级，也顺带让「多次添加同一素材」只解码一次。
 */
export const MAT_IMG_CACHE = new Map()

/** 订阅者：某张图解码完成后要重画的地方（画布 / 导出按钮） */
const WAITERS = new Map()

export function getMaterialImage(src) {
  return MAT_IMG_CACHE.get(src) || null
}

/**
 * 确保素材已开始解码，完成后回调（可重复调用，只解码一次）。
 * 浏览器对同一 URL 有 HTTP 缓存，二次添加瞬间命中。
 */
export function ensureMaterial(src, onChange) {
  if (!src) return
  if (MAT_IMG_CACHE.has(src)) return
  const w = WAITERS.get(src)
  if (w) {
    if (onChange && !w.includes(onChange)) w.push(onChange)
    return
  }
  const list = onChange ? [onChange] : []
  WAITERS.set(src, list)
  const img = new Image()
  const done = (v) => {
    MAT_IMG_CACHE.set(src, v)
    const ls = WAITERS.get(src) || []
    WAITERS.delete(src)
    for (const f of ls) {
      try {
        f(src)
      } catch {
        /* 回调抛错不该影响其他订阅者 */
      }
    }
  }
  img.onload = () => done(img)
  // 解码失败存 null：drawLayer 会跳过该层，不会整栈崩掉
  img.onerror = () => done(null)
  img.src = src
}

/** 素材是否可用（导出前据此等待） */
export function materialReady(src) {
  return !!MAT_IMG_CACHE.get(src)
}
