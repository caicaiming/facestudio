/**
 * delaunay.js —— Bowyer-Watson 增量 Delaunay 三角剖分
 *
 * 两个用途：
 *   1. 构建期：scripts/gen-triangles.mjs 用它对标准模板预计算固化表（src/triangles.js）
 *   2. 运行期：用户添加自定义控制点后，点集拓扑改变，需重新剖分
 *
 * 复杂度 O(n²)，n≈76 时约 1–3ms，仅在加/删自定义点时调用一次，
 * 不进入拖动时的每帧热路径。
 *
 * @module delaunay
 */

/** 外接圆求解的退化阈值：三点共线时分母趋零，视为无外接圆 */
const DEGENERATE = 1e-12

/**
 * @param {{x:number,y:number}[]} points
 * @returns {number[][]} 三角形索引三元组数组；点集不足 3 个或全共线时返回空数组
 */
export function delaunayTriangles(points) {
  const n = points.length
  if (n < 3) return []

  // ---- 超级三角形：足够大以覆盖全部点，保证所有点都落在它内部 ----
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const dMax = Math.max(maxX - minX, maxY - minY, 1) * 10
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2

  const coords = points.slice()
  coords.push({ x: midX - dMax, y: midY - dMax })
  coords.push({ x: midX + dMax, y: midY - dMax })
  coords.push({ x: midX, y: midY + dMax })
  const iA = n
  const iB = n + 1
  const iC = n + 2

  /** 三角形外接圆；退化返回 null（此时任何点都不算落在圆内） */
  const circum = (a, b, c) => {
    const ax = coords[a].x
    const ay = coords[a].y
    const bx = coords[b].x
    const by = coords[b].y
    const cx = coords[c].x
    const cy = coords[c].y
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if (Math.abs(d) < DEGENERATE) return null
    const a2 = ax * ax + ay * ay
    const b2 = bx * bx + by * by
    const c2 = cx * cx + cy * cy
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    const r = Math.hypot(ux - ax, uy - ay)
    return { x: ux, y: uy, r2: r * r }
  }

  let tris = [[iA, iB, iC]]
  let cache = [circum(iA, iB, iC)]

  for (let i = 0; i < n; i++) {
    const px = coords[i].x
    const py = coords[i].y
    const keep = []
    const edges = []

    // 外接圆被新点包含 → 该三角形作废，三条边进入候选边界
    for (let t = 0; t < tris.length; t++) {
      const c = cache[t]
      if (c && (px - c.x) ** 2 + (py - c.y) ** 2 <= c.r2 * (1 + 1e-12)) {
        const [a, b, cc] = tris[t]
        edges.push([a, b], [b, cc], [cc, a])
      } else {
        keep.push(t)
      }
    }

    // 只出现一次的边 = 空腔边界；出现两次的说明两侧都作废，是内部边
    const count = new Map()
    for (const [a, b] of edges) {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      count.set(k, (count.get(k) || 0) + 1)
    }

    const nTris = keep.map((t) => tris[t])
    const nCache = keep.map((t) => cache[t])
    for (const [a, b] of edges) {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      if (count.get(k) === 1) {
        nTris.push([a, b, i])
        nCache.push(circum(a, b, i))
      }
    }
    tris = nTris
    cache = nCache
  }

  // 剔除含超级三角形顶点的三角形，输出顺序固定，便于构建期产物可比对
  return tris
    .filter((t) => !t.some((v) => v >= n))
    .map((t) => t.slice().sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
}
