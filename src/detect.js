/**
 * detect.js —— 检测输入的尺寸归一化
 *
 * 为什么需要它：TinyFaceDetector 会把输入一次性缩到 inputSize（416），
 * 这个缩放是一次粗暴的双线性，比例越极端（原图越大）越糊，特征丢失后
 * 检测框会明显走形 —— 实测同一张脸放大到 3×/4× 后，框宽高比从 1.35
 * 塌到 1.02，点位被挤成一小团，平均偏差 78px（原图尺度）。
 *
 * 解法：检测前先用 canvas 把大图降到「检测器工作区间」（最长边上限），
 * canvas 的 drawImage 缩放质量远好于单次大比例双线性，再按同一系数
 * 把结果换算回原图坐标。实测偏差从 78.65 降到 3 左右（与 2× 时
 * 检测器自身的抖动噪声同级）。
 *
 * 上限取 1600：与 FaceCanvas 的 MAX_EDGE 一致。实测 1024/1280/1600/2048
 * 都能消除偏差，取 1600 是「细节保留」与「远离失效区」的平衡点。
 */

/** 检测输入的最长边上限（像素） */
export const DETECT_MAX_EDGE = 1600

/**
 * 降采样系数：小图原样送检，大图缩到最长边不超过 maxEdge。
 * @param {number} w 原图宽
 * @param {number} h 原图高
 * @param {number} maxEdge
 * @returns {number} (0, 1]
 */
export function detectScale(w, h, maxEdge = DETECT_MAX_EDGE) {
  if (!(w > 0) || !(h > 0)) return 1
  return Math.min(1, maxEdge / Math.max(w, h))
}

/** 把检测结果的点位从「检测用图」坐标换算回原图坐标 */
export function mapPointsBack(pts, scale) {
  if (!pts) return pts
  if (!(scale > 0) || scale === 1) return pts
  return pts.map((p) => ({ x: p.x / scale, y: p.y / scale }))
}

/** 把检测框从「检测用图」坐标换算回原图坐标（Box 的字段是 getter，需逐个取） */
export function mapBoxBack(box, scale) {
  if (!box) return box
  const { x, y, width, height } = box
  if (!(scale > 0) || scale === 1) return { x, y, width, height }
  return { x: x / scale, y: y / scale, width: width / scale, height: height / scale }
}
