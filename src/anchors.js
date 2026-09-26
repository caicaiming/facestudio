/**
 * 外围锚点（anchor points）
 *
 * 为什么需要：68 个关键点最上只到眉毛（17–26），三角网格顶边就是眉线，
 * 额头与发际线区域完全落在网格之外。若只用 68 点做纹理映射，额头滑块
 * 无论怎么拖都无法让照片的额头产生形变。
 *
 * 因此在 68 点之外追加 8 个几何推导的锚点（索引 68–75），围成包裹整张脸
 * 与额头的闭合轮廓。锚点由 68 点纯几何推导，故在标准模板与真实照片上
 * 拓扑一致 —— 三角剖分可在构建期预计算并固化。
 *
 * 锚点在形变时【保持不动】，充当边界约束：脸部关键点位移，外圈固定，
 * 中间由三角形插值平滑过渡，避免整块平移导致的背景撕裂。
 *
 * ⚠️ 本文件被 scripts/gen-triangles.mjs 直接 import，两份公式必须同源。
 */

/** 锚点数量 */
export const ANCHOR_COUNT = 8

/** 锚点在完整点集中的起始索引 */
export const ANCHOR_BASE = 68

/** 完整点集长度（68 关键点 + 8 锚点） */
export const FULL_COUNT = 68 + ANCHOR_COUNT

/**
 * 由 68 点推导 8 个外围锚点。
 * @param {Point[]} pts 68 个关键点
 * @returns {Point[]} 8 个锚点，顺序固定
 */
export function buildAnchors(pts) {
  const cx = (pts[0].x + pts[16].x) / 2
  const halfW = Math.abs(pts[16].x - pts[0].x) / 2

  let browTop = Infinity
  for (let i = 17; i <= 26; i++) browTop = Math.min(browTop, pts[i].y)
  const chinY = pts[8].y
  const H = chinY - browTop // 眉线→下巴，近似中庭+下庭高度

  // 顺时针：左上 → 顶 → 右上 → 右外 → 右下 → 左下 → 左外
  // 顶部抬到眉线上方 0.75H，足以覆盖发际线与部分头发
  return [
    { x: cx - 1.15 * halfW, y: browTop - 0.55 * H }, // 68 左上
    { x: cx - 0.4 * halfW, y: browTop - 0.75 * H }, // 69 顶左
    { x: cx + 0.4 * halfW, y: browTop - 0.75 * H }, // 70 顶右
    { x: cx + 1.15 * halfW, y: browTop - 0.55 * H }, // 71 右上
    { x: cx + 1.45 * halfW, y: browTop + 0.35 * H }, // 72 右外
    { x: cx + 1.15 * halfW, y: chinY + 0.45 * H }, // 73 右下
    { x: cx - 1.15 * halfW, y: chinY + 0.45 * H }, // 74 左下
    { x: cx - 1.45 * halfW, y: browTop + 0.35 * H }, // 75 左外
  ]
}

/**
 * 组装完整点集：68 关键点 + 8 锚点。
 * @param {Point[]} pts       68 个关键点
 * @param {?Point[]} anchors  可选，直接指定锚点。形变时应传入【原始】锚点以固定边界。
 */
export function buildFullPoints(pts, anchors = null) {
  return pts.concat(anchors || buildAnchors(pts))
}

/** 反距离加权取最近的关键点数 */
const NEAREST = 4

/**
 * 按邻近关键点的位移做反距离加权跟随（软跟随）。
 *
 * 为什么需要：完全固定的外圈点在脸颊/下颌大幅形变时会与移动的关键点之间
 * 产生剧烈剪切，把侧面头发纹理拉成横向条纹。取最近 4 个关键点位移的
 * 反距离平方加权平均，形变被分摊到外圈，剪切显著减小。
 *
 * @param {Point[]} pts     需要跟随位移的点（锚点或自定义点），原始位置
 * @param {Point[]} src68   原始 68 关键点
 * @param {Point[]} dst68   形变后 68 关键点
 * @returns {Point[]} 跟随移动后的点位
 */
export function displaceByIDW(pts, src68, dst68) {
  const ds = new Array(68)
  return pts.map((a) => {
    for (let i = 0; i < 68; i++) {
      const dx = a.x - src68[i].x
      const dy = a.y - src68[i].y
      ds[i] = [dx * dx + dy * dy, i]
    }
    ds.sort((p, q) => p[0] - q[0])

    let wx = 0
    let wy = 0
    let ws = 0
    for (let n = 0; n < NEAREST; n++) {
      const d2 = ds[n][0]
      const i = ds[n][1]
      const w = 1 / (d2 + 1)
      wx += w * (dst68[i].x - src68[i].x)
      wy += w * (dst68[i].y - src68[i].y)
      ws += w
    }
    return { x: a.x + wx / ws, y: a.y + wy / ws }
  })
}

/**
 * 锚点软跟随（displaceByIDW 的语义化包装）。
 * @param {Point[]} anchors 原始锚点（8 个）
 * @param {Point[]} src68   原始 68 关键点
 * @param {Point[]} dst68   形变后 68 关键点
 * @returns {Point[]} 平滑移动后的锚点
 */
export function displaceAnchors(anchors, src68, dst68) {
  return displaceByIDW(anchors, src68, dst68)
}
