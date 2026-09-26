/**
 * warp.js —— 三角形仿射纹理映射（image warping）
 *
 * 把原图按三角网格逐块「贴图」到形变后的位置，使照片本身跟随滑块变形，
 * 而不只是网格线在动。
 *
 * 算法：对每个三角形，求 src→dst 的仿射变换，裁剪到目标三角形后绘制。
 * 性能：源点集在一次检测内固定，故每个三角形的源纹理块只预渲染一次并缓存，
 *       之后每次重绘只剩 142 次小块 drawImage，可满足拖动实时性。
 *
 * 三角表可由调用方传入：用户添加自定义控制点后点集拓扑改变，需按新点集
 * 重新剖分（见 delaunay.js）；无自定义点时沿用构建期固化的 TRIANGLES。
 */

import { TRIANGLES } from './triangles.js'

const EPS = 1e-9

/**
 * 求 src 三角形 → dst 三角形的仿射变换。
 * canvas transform(a,b,c,d,e,f) 语义：x' = a·x + c·y + e ; y' = b·x + d·y + f
 * @returns {?object} {a,b,c,d,e,f}；退化三角形返回 null
 */
function affine(sA, sB, sC, dA, dB, dC) {
  // src 边向量
  const ux = sB.x - sA.x
  const uy = sB.y - sA.y
  const vx = sC.x - sA.x
  const vy = sC.y - sA.y
  const det = ux * vy - uy * vx
  if (Math.abs(det) < EPS) return null

  // dst 边向量
  const Ux = dB.x - dA.x
  const Uy = dB.y - dA.y
  const Vx = dC.x - dA.x
  const Vy = dC.y - dA.y

  // 线性部分 L = [U V] · inv([u v])
  const a = (Ux * vy - Vx * uy) / det
  const c = (Vx * ux - Ux * vx) / det
  const b = (Uy * vy - Vy * uy) / det
  const d = (Vy * ux - Uy * vx) / det

  // 平移部分：dA = L·sA + t
  const e = dA.x - (a * sA.x + c * sA.y)
  const f = dA.y - (b * sA.x + d * sA.y)

  if (!Number.isFinite(a + b + c + d + e + f)) return null
  return { a, b, c, d, e, f }
}

/**
 * 三角形外扩像素。
 * 源与目标两侧按同一数值外扩 —— 关键点：若只在源空间外扩固定像素，
 * 大剪切三角形会把该缝隙放大成明显裂纹（露出底图形成条纹）；
 * 两侧同值外扩后，目标空间的重叠量恒定，与形变幅度无关。
 */
const TILE_GROW = 0.75

/** 把三角形三个顶点沿「重心 → 顶点」方向外扩 d 像素 */
function growTri(ax, ay, bx, by, cx, cy, d) {
  const gx = (ax + bx + cx) / 3
  const gy = (ay + by + cy) / 3
  const g = (px, py) => {
    const dx = px - gx
    const dy = py - gy
    const L = Math.hypot(dx, dy) || 1
    return [px + (dx / L) * d, py + (dy / L) * d]
  }
  const A = g(ax, ay)
  const B = g(bx, by)
  const C = g(cx, cy)
  return [A[0], A[1], B[0], B[1], C[0], C[1]]
}

/**
 * 预渲染一个三角形的源纹理块（外扩三角形内部，其余透明）。
 * @returns {?object} {canvas, x, y, verts}；verts 为外扩后的源顶点（供仿射计算）
 */
function buildTile(img, src, tri) {
  const [i, j, k] = tri
  const [ax, ay, bx, by, cx, cy] = growTri(
    src[i].x, src[i].y, src[j].x, src[j].y, src[k].x, src[k].y, TILE_GROW,
  )

  const x0 = Math.floor(Math.min(ax, bx, cx))
  const y0 = Math.floor(Math.min(ay, by, cy))
  const w = Math.ceil(Math.max(ax, bx, cx)) - x0
  const h = Math.ceil(Math.max(ay, by, cy)) - y0
  if (w <= 0 || h <= 0) return null

  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')
  if (!ctx) return null

  ctx.beginPath()
  ctx.moveTo(ax - x0, ay - y0)
  ctx.lineTo(bx - x0, by - y0)
  ctx.lineTo(cx - x0, cy - y0)
  ctx.closePath()
  ctx.clip() // 仅构建期执行一次，运行期不再 clip
  ctx.drawImage(img, -x0, -y0)

  return {
    canvas: cv,
    x: x0,
    y: y0,
    verts: [
      { x: ax, y: ay },
      { x: bx, y: by },
      { x: cx, y: cy },
    ],
  }
}

/**
 * 创建形变器。源点集固定期间可复用，纹理块与底图只构建一次。
 * @param {HTMLImageElement} img 已加载的原图
 * @param {Point[]} srcPts      完整源点集（68 关键点 + 8 锚点 [+ 自定义点]）
 * @param {number} scale        画布缩放系数（超大图降采样用）
 * @param {number[][]} triangles 三角剖分索引表，默认用构建期固化的 TRIANGLES
 */
export function createWarper(img, srcPts, scale = 1, triangles = TRIANGLES) {
  if (!img || !srcPts) return null

  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return null

  // 底图预缩放：避免每帧对原图做一次全尺寸缩放
  const cw = Math.round(iw * scale)
  const ch = Math.round(ih * scale)
  const base = document.createElement('canvas')
  base.width = cw
  base.height = ch
  const bctx = base.getContext('2d')
  if (!bctx) return null
  bctx.drawImage(img, 0, 0, cw, ch)

  const tiles = new Array(triangles.length)
  for (let t = 0; t < triangles.length; t++) {
    tiles[t] = buildTile(img, srcPts, triangles[t])
  }

  return {
    cw,
    ch,

    /**
     * 把形变结果绘制到 ctx（含底图）。
     * 运行期热路径：每个三角形仅 setTransform + drawImage，
     * 不调用 save/restore/clip —— 这三者是主要开销来源。
     * @param {CanvasRenderingContext2D} ctx
     * @param {Point[]} dstPts 完整目标点集（与 srcPts 等长）
     */
    draw(ctx, dstPts) {
      if (!dstPts || dstPts.length < srcPts.length) return

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, cw, ch)
      ctx.drawImage(base, 0, 0)

      for (let t = 0; t < triangles.length; t++) {
        const tile = tiles[t]
        if (!tile) continue
        const [i, j, k] = triangles[t]
        const dA = dstPts[i]
        const dB = dstPts[j]
        const dC = dstPts[k]
        if (!dA || !dB || !dC) continue

        // 目标顶点同样外扩固定像素，保证与源空间重叠量一致（见 TILE_GROW 说明）
        const g = growTri(dA.x, dA.y, dB.x, dB.y, dC.x, dC.y, TILE_GROW)
        const s0 = tile.verts[0]
        const s1 = tile.verts[1]
        const s2 = tile.verts[2]

        const ux = s1.x - s0.x
        const uy = s1.y - s0.y
        const vx = s2.x - s0.x
        const vy = s2.y - s0.y
        const det = ux * vy - uy * vx
        if (Math.abs(det) < EPS) continue

        const Ux = g[2] - g[0]
        const Uy = g[3] - g[1]
        const Vx = g[4] - g[0]
        const Vy = g[5] - g[1]

        const a = (Ux * vy - Vx * uy) / det
        const c = (Vx * ux - Ux * vx) / det
        const b = (Uy * vy - Vy * uy) / det
        const d = (Vy * ux - Uy * vx) / det
        const e = g[0] - (a * s0.x + c * s0.y)
        const f = g[1] - (b * s0.x + d * s0.y)

        // 与底图缩放 base=[s,0,0,s,0,0] 复合：base ∘ M
        ctx.setTransform(scale * a, scale * b, scale * c, scale * d, scale * e, scale * f)
        ctx.drawImage(tile.canvas, tile.x, tile.y)
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0)
    },

    /** 释放缓存（换图时调用） */
    dispose() {
      for (const t of tiles) {
        if (t) {
          t.canvas.width = 0
          t.canvas.height = 0
        }
      }
      base.width = 0
      base.height = 0
    },
  }
}

/**
 * 判断是否有任何形变发生（全零参数可跳过重绘）。
 * @param {Params} params
 */
export function isIdentity(params) {
  if (!params) return true
  for (const k of Object.keys(params)) {
    if (params[k] !== 0) return false
  }
  return true
}
