// 开发期探针：直接调 face-api，比较不同输入尺寸下的检测框与关键点。
// 只在 vite dev 下由 diag-detect.html 加载，生产构建不会包含。
import * as faceapi from '@vladmandic/face-api'

window.__diag = {
  async init() {
    await faceapi.tf.setBackend('cpu')
    await faceapi.tf.ready()
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
    ])
    return 'ready'
  },
  /**
   * 先按 maxEdge 降采样再检测，最后把点位换算回原图坐标。
   * 用于验证「大图先缩再检测」能否消除尺寸相关的偏差。
   */
  async detectScaled(url, inputSize, maxEdge) {
    const img = new Image()
    img.src = url
    await img.decode()
    const s = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
    const cv = document.createElement('canvas')
    cv.width = Math.round(img.naturalWidth * s)
    cv.height = Math.round(img.naturalHeight * s)
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, cv.width, cv.height)
    const det = await faceapi
      .detectSingleFace(cv, new faceapi.TinyFaceDetectorOptions({ inputSize }))
      .withFaceLandmarks()
    if (!det) return { ok: false }
    const pts = det.landmarks.positions.map((p) => ({ x: p.x / s, y: p.y / s }))
    return {
      ok: true,
      nat: { w: img.naturalWidth, h: img.naturalHeight },
      used: { w: cv.width, h: cv.height, s },
      box: {
        x: det.detection.box.x / s,
        y: det.detection.box.y / s,
        width: det.detection.box.width / s,
        height: det.detection.box.height / s,
      },
      score: det.detection.score,
      pts,
    }
  },
  /**
   * 降采样 + 补成正方形：检测器的输入会被硬缩成 inputSize×inputSize 的方形，
   * 非正方形输入会被拉伸形变。先把图居中补成方形再送检，点位按同样的
   * 缩放与偏移还原回原图坐标。
   */
  async detectPadded(url, inputSize, maxEdge) {
    const img = new Image()
    img.src = url
    await img.decode()
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    const s = Math.min(1, maxEdge / Math.max(nw, nh))
    const side = Math.round(Math.max(nw, nh) * s)
    const cv = document.createElement('canvas')
    cv.width = side
    cv.height = side
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#808080'
    ctx.fillRect(0, 0, side, side)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    const dw = Math.round(nw * s)
    const dh = Math.round(nh * s)
    const ox = Math.round((side - dw) / 2)
    const oy = Math.round((side - dh) / 2)
    ctx.drawImage(img, ox, oy, dw, dh)
    const det = await faceapi
      .detectSingleFace(cv, new faceapi.TinyFaceDetectorOptions({ inputSize }))
      .withFaceLandmarks()
    if (!det) return { ok: false }
    const back = (v, o) => (v - o) / s
    return {
      ok: true,
      nat: { w: nw, h: nh },
      used: { w: side, h: side, s, ox, oy },
      box: {
        x: back(det.detection.box.x, ox),
        y: back(det.detection.box.y, oy),
        width: det.detection.box.width / s,
        height: det.detection.box.height / s,
      },
      score: det.detection.score,
      pts: det.landmarks.positions.map((p) => ({ x: back(p.x, ox), y: back(p.y, oy) })),
    }
  },
  async detect(url, inputSize) {
    const img = new Image()
    img.src = url
    await img.decode()
    const det = await faceapi
      .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize }))
      .withFaceLandmarks()
    if (!det) return { ok: false }
    const pts = det.landmarks.positions.map((p) => ({ x: p.x, y: p.y }))
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    return {
      ok: true,
      nat: { w: img.naturalWidth, h: img.naturalHeight },
      // Box 的 x/y/width/height 是原型上的 getter，展开运算符会丢掉，必须逐个取
      box: {
        x: det.detection.box.x,
        y: det.detection.box.y,
        width: det.detection.box.width,
        height: det.detection.box.height,
      },
      score: det.detection.score,
      bbox: {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      },
      p36: pts[36],
      p45: pts[45],
      pts,
    }
  },
}
