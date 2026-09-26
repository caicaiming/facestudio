/**
 * hairline.js —— 基于图像像素的发际线估计（浏览器专用，依赖 canvas，故不放入纯函数层 measure.js）
 *
 * 原理：发际线之上是头发/背景（非皮肤），之下是额头（皮肤）。在眉心上方的一列像素里，
 * 找出「与眉上缘相连的最长连续皮肤段」，其顶端即发际线。
 *
 * 为什么不用「自下而上找第一个非皮肤像素」：深棕色头发的高光在 RGB 上与肤色接近，
 * 逐像素判会被误判，导致发际线严重偏高（实测会扫到头顶）。
 * 「最长皮肤段」策略对零星高光、碎发鲁棒——额头是眉上方最大的连续皮肤区域。
 *
 * 失败（刘海遮挡、图像污染、无足够皮肤段）一律返回 null，由调用方走兜底方案。
 */

const COLUMN_FRACTIONS = [-0.3, -0.15, 0, 0.15, 0.3] // 相对双眉峰间距的横向采样位置

/**
 * @param {HTMLImageElement} img 已加载的原图
 * @param {Point[]} points 68 点（自然像素坐标）
 * @returns {number|null} 发际线 y 坐标；null 表示估计失败
 */
export function estimateHairline(img, points) {
  try {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return null

    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, w, h).data

    const at = (x, y) => {
      const i = (y * w + x) * 4
      return [data[i], data[i + 1], data[i + 2]]
    }
    // 启发式皮肤判定：r 通道占优 + 一定亮度。灰背景（r≈g≈b）与深色头发（整体暗）均不满足
    const isSkin = (r, g, b) => r > 60 && r > g + 8 && g >= b - 5 && r + g + b > 150

    let browTop = Infinity
    for (let i = 17; i <= 26; i++) browTop = Math.min(browTop, points[i].y)
    const chinY = points[8].y
    const browChin = chinY - browTop
    const yBottom = Math.max(0, Math.round(browTop) - 2)
    const yTop = Math.max(0, Math.round(browTop - browChin * 0.55)) // 最多上扫 55% 眉下巴距
    const minRun = Math.max(6, browChin * 0.06) // 皮肤段最短长度，防碎片误判

    const scan = (cx0) => {
      let best = null // [topY, bottomY]
      let runStart = null
      for (let y = yTop; y <= yBottom; y++) {
        const x = Math.min(w - 1, Math.max(0, Math.round(cx0)))
        const [r, g, b] = at(x, y)
        if (isSkin(r, g, b)) {
          if (runStart === null) runStart = y
        } else if (runStart !== null) {
          if (best === null || y - 1 - runStart > best[1] - best[0]) best = [runStart, y - 1]
          runStart = null
        }
      }
      if (runStart !== null && (best === null || yBottom - runStart > best[1] - best[0])) {
        best = [runStart, yBottom]
      }
      // 皮肤段必须延伸到接近眉上缘，否则视为「与额头不相连」而舍弃
      if (!best || best[1] < browTop - 25 || best[1] - best[0] < minRun) return null
      return best[0]
    }

    // 横向取 5 列（中分发际、两侧额部），取中位数。
    // 只测中线会被中分/美人尖发型带偏，两侧额部的发际线在发型间更稳定。
    const cx = (points[19].x + points[24].x) / 2 // 双眉峰中点
    const spread = Math.abs(points[24].x - points[19].x) // 双眉峰间距
    const results = COLUMN_FRACTIONS.map((f) => scan(cx + f * spread)).filter(
      (v) => v !== null,
    )
    if (results.length < 3) return null // 至少 3 列成功才采信
    results.sort((a, b) => a - b)
    return results[Math.floor(results.length / 2)]
  } catch {
    return null
  }
}
