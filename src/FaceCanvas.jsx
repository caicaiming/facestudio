/**
 * FaceCanvas.jsx —— 分层绘制
 * 68 点索引规范见《开发文档》第 4 章；锚点说明见 anchors.js。
 *
 * 图层分工（自下而上）：
 *   img      原图（浏览器原生渲染）
 *   warp     形变结果（adjustment 视图接管显示，其余视图隐藏）
 *   overlay  三庭分界线、中轴线、对称偏差连线
 *   mesh     三角网格、关键点
 *
 * 调整视图下 warp 层覆盖 img：照片本身跟随滑块形变，而非只有网格线在动。
 *
 * 点集布局（索引顺序固定）：
 *   0–67   68 个关键点
 *   68–75  8 个外围锚点（anchors.js）
 *   76+    用户自定义控制点（customCount 个）
 *
 * 同一组件承担两种角色（由 showWarp / overlay 决定）：
 *   - 主图：showWarp=false，始终显示原图，叠加层按 overlay 绘制
 *   - 预览：showWarp=true，显示形变后的照片，overlay='none' 时不画任何线条
 */

import { useEffect, useRef, useState } from 'react'
import { TRIANGLES } from './triangles.js'
import { RIGHT_HALF, LEFT_HALF, fitLine, mirrorPoint } from './measure.js'
import { createWarper } from './warp.js'
import { ANCHOR_BASE, ANCHOR_COUNT } from './anchors.js'

/** warp 画布长边上限默认值：超大图（手机直出 4000px+）按此降采样，保证拖动实时性 */
const MAX_EDGE = 1600

/** 空态默认文案 */
const EMPTY = {
  title: '上传一张正面人脸照开始分析',
  hint: '建议使用光线均匀、无遮挡的正面照',
}

/**
 * 点位标记的目标【屏幕尺寸】（CSS 像素）。
 *
 * ⚠️ 画布按图片自然像素开尺寸，而图片在页面上被缩小显示（如 1024px 的原图
 * 只显示 372px）。若标记半径直接取自然像素值，屏幕上会缩小到 1–2px，几乎
 * 无法瞄准。因此标记尺寸全部按 MARKER_PX（CSS 像素）定义，绘制时乘以换算
 * 系数 k（1 CSS px 对应的画布像素数），保证任何显示缩放下观感与手感恒定。
 */
const MARKER_PX = {
  meshDot: 2.8, // 网格模式下的小圆点
  point: 5.2, // 点位模式下的关键点
  custom: 7, // 自定义控制点菱形
  select: 9.5, // 选中点高亮环
  hover: 7.5, // 悬停点提示环
  faint: 2.4, // 三庭/对称模式下的淡底圆点（保证任何叠加模式下都有可抓目标）
  hit: 13, // 命中半径（抓取范围）
  font: 11.5, // 点号字号
}

/** 自定义点起始索引 */
export const CUSTOM_BASE = ANCHOR_BASE + ANCHOR_COUNT // 76

const computeScale = (w, h, maxEdge = MAX_EDGE) => Math.min(1, maxEdge / Math.max(w, h))

// ---------------------------------------------------------------- 绘制原语

function drawMesh(ctx, pts, lw, tris, k) {
  ctx.lineWidth = lw * 0.7
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.45)'
  ctx.beginPath()
  for (let t = 0; t < tris.length; t++) {
    const [a, b, c] = tris[t]
    const pa = pts[a]
    const pb = pts[b]
    const pc = pts[c]
    if (!pa || !pb || !pc) continue
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.lineTo(pc.x, pc.y)
    ctx.closePath()
  }
  ctx.stroke()

  // 只画 68 个真实关键点，锚点是辅助点不参与展示
  const r = Math.max(lw * 1.8, MARKER_PX.meshDot * k)
  ctx.fillStyle = 'rgba(191, 219, 254, 0.95)'
  ctx.beginPath()
  for (let i = 0; i < 68 && i < pts.length; i++) {
    ctx.moveTo(pts[i].x + r, pts[i].y)
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2)
  }
  ctx.fill()
}

/**
 * 关键点：实心圆 + 深色描边 + 白色高光环。
 * 三层结构是为了在额头（亮）、头发（暗）、背景（灰）上都保持可辨识轮廓。
 */
function drawPoints(ctx, pts, lw, k) {
  const r = Math.max(lw * 2.6, MARKER_PX.point * k)
  const ring = Math.max(1, 1.4 * k)

  // 外圈：深色底衬，保证浅色区域也能看清
  ctx.lineWidth = ring * 2
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)'
  ctx.fillStyle = 'rgba(59, 130, 246, 0.95)'
  ctx.beginPath()
  for (let i = 0; i < 68 && i < pts.length; i++) {
    ctx.moveTo(pts[i].x + r, pts[i].y)
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2)
  }
  ctx.stroke()
  ctx.fill()

  // 内圈：白色细环，提升锐度
  ctx.lineWidth = ring
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.stroke()

  const fs = Math.max(10, Math.round(MARKER_PX.font * k))
  ctx.font = `${fs}px system-ui, sans-serif`
  ctx.lineWidth = ring * 2.2
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)'
  ctx.fillStyle = 'rgba(240, 247, 255, 0.98)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  for (let i = 0; i < 68 && i < pts.length; i++) {
    const y = pts[i].y - r - ring * 2.5
    ctx.strokeText(String(i), pts[i].x, y)
    ctx.fillText(String(i), pts[i].x, y)
  }
}

/**
 * 医美部位作用点。
 *
 * 与亚单位高亮的区别：亚单位高亮的是 68 点里的真实关键点，而医美部位
 * （额头 / 太阳穴 / 苹果肌 / 泪沟…）在 68 点里【不存在】，是规范坐标系外推
 * 出来的虚拟控制点。必须单独画出来，否则使用者看不到调整作用在哪。
 *
 * 语义：on = 该部位当前有档位（实心大点）；active = 鼠标悬停（外圈 + 标签）。
 */
function drawSiteMarkers(ctx, markers, lw, k) {
  if (!markers || markers.length === 0) return
  const rOn = Math.max(lw * 3.4, MARKER_PX.point * k * 1.5)
  const rOff = Math.max(lw * 2.2, MARKER_PX.point * k * 0.9)

  for (const m of markers) {
    for (const p of m.pts) {
      const r = m.on ? rOn : rOff
      if (m.on) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(37, 99, 235, 0.85)'
        ctx.fill()
        ctx.lineWidth = Math.max(1, 1.4 * k)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(37, 99, 235, 0.28)'
        ctx.fill()
      }
      if (m.active) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, r * 2.1, 0, Math.PI * 2)
        ctx.lineWidth = Math.max(1, 1.8 * k)
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.95)'
        ctx.stroke()
      }
    }
    if (m.active && m.pts.length) {
      const p = m.pts[0]
      const fs = Math.max(11, lw * 7)
      ctx.font = `${fs}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.lineWidth = Math.max(2, fs / 4)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
      ctx.fillStyle = '#1d4ed8'
      const y = p.y - (m.on ? rOn : rOff) * 2.2
      ctx.strokeText(m.label, p.x, y)
      ctx.fillText(m.label, p.x, y)
    }
  }
}

/**
 * 亚单位高亮：给指定点位画琥珀色光环 + 连线，指示该亚单位覆盖了哪些关键点。
 * 只在悬停亚单位行时出现，不参与命中判定。
 */
function drawHighlight(ctx, pts, indices, lw, k) {
  if (!indices || indices.length === 0) return
  const r = Math.max(lw * 4.2, MARKER_PX.point * k * 2.1)
  const ring = Math.max(1, 1.8 * k)

  // 连线：把核心点串成轮廓，读起来比孤立圆环更像「一个亚单位」
  if (indices.length > 1) {
    ctx.beginPath()
    ctx.moveTo(pts[indices[0]].x, pts[indices[0]].y)
    for (let i = 1; i < indices.length; i++) {
      ctx.lineTo(pts[indices[i]].x, pts[indices[i]].y)
    }
    ctx.lineWidth = Math.max(1, 1.6 * k)
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)'
    ctx.stroke()
  }

  ctx.lineWidth = ring * 2.4
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.7)'
  ctx.fillStyle = 'rgba(251, 191, 36, 0.95)'
  ctx.beginPath()
  for (const i of indices) {
    if (i < 0 || i >= pts.length) continue
    ctx.moveTo(pts[i].x + r, pts[i].y)
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2)
  }
  ctx.stroke()
  ctx.fill()
}

/**
 * 基准点（两眼质心）：青色圆环 + 十字 + 连线 + 原点。
 * 这两个点定义了整张脸的坐标系 —— 原点在两眼中点、单位是眼间距，
 * 换任何一张脸定义都完全相同，所以画出来让用户看得见、抓得住。
 */
function drawFrameAnchors(ctx, anchors, lw, k, activeKey) {
  if (!anchors || !anchors.L || !anchors.R) return
  const r = Math.max(lw * 3, MARKER_PX.select * k)

  ctx.save()
  // 基准轴（两眼连线）：坐标系的 X 轴
  ctx.setLineDash([lw * 5, lw * 4])
  ctx.lineWidth = lw * 1.5
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.8)'
  ctx.beginPath()
  ctx.moveTo(anchors.L.x, anchors.L.y)
  ctx.lineTo(anchors.R.x, anchors.R.y)
  ctx.stroke()
  ctx.setLineDash([])

  // 原点：两眼中点
  const O = { x: (anchors.L.x + anchors.R.x) / 2, y: (anchors.L.y + anchors.R.y) / 2 }
  const cross = r * 0.55
  ctx.lineWidth = lw * 1.6
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.95)'
  ctx.beginPath()
  ctx.moveTo(O.x - cross, O.y)
  ctx.lineTo(O.x + cross, O.y)
  ctx.moveTo(O.x, O.y - cross)
  ctx.lineTo(O.x, O.y + cross)
  ctx.stroke()

  const font = Math.max(9, Math.round(MARKER_PX.font * k * 0.95))
  ctx.font = `700 ${font}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const key of ['L', 'R']) {
    const a = anchors[key]
    const on = activeKey === key
    ctx.lineWidth = lw * 2
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)'
    ctx.fillStyle = on ? 'rgba(34, 211, 238, 0.95)' : 'rgba(34, 211, 238, 0.4)'
    ctx.beginPath()
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    ctx.lineWidth = lw * 2.6
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.fillStyle = '#e2f9ff'
    ctx.font = `700 ${font}px system-ui, sans-serif`
    // 标注按「画面上的左右」，用户看到哪边就是哪边，不引入解剖学左右
    const label = key === 'L' ? '左' : '右'
    ctx.fillText(label, a.x, a.y + 0.5)
    ctx.strokeText(label, a.x, a.y + 0.5)
  }
  ctx.restore()
}

/** 淡底圆点：三庭 / 对称模式下没有点位图层，仍给出可抓目标 */
function drawFaintPoints(ctx, pts, k, count = 68) {
  const r = Math.max(1.2, MARKER_PX.faint * k)
  ctx.fillStyle = 'rgba(191, 219, 254, 0.55)'
  ctx.beginPath()
  for (let i = 0; i < count && i < pts.length; i++) {
    ctx.moveTo(pts[i].x + r, pts[i].y)
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2)
  }
  ctx.fill()
}

function drawThree(ctx, pts, metrics, lw) {
  const xs = pts[0].x
  const xe = pts[16].x
  const lines = [
    { y: metrics && Number.isFinite(metrics.faceTop) ? metrics.faceTop : null, label: '发际线(估算)', color: '#f59e0b' },
    { y: pts[27].y, label: '眉心', color: '#f87171' },
    { y: pts[33].y, label: '鼻底', color: '#f87171' },
    { y: pts[8].y, label: '下巴尖', color: '#94a3b8' },
  ]

  ctx.save()
  ctx.setLineDash([lw * 6, lw * 4])
  ctx.lineWidth = lw
  ctx.font = `${Math.max(10, Math.round(lw * 11))}px system-ui, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  const ratios = metrics
    ? [metrics.three.upper, metrics.three.middle, metrics.three.lower]
    : [null, null, null]

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]
    if (L.y == null) continue
    ctx.strokeStyle = L.color
    ctx.beginPath()
    ctx.moveTo(xs, L.y)
    ctx.lineTo(xe, L.y)
    ctx.stroke()
    ctx.fillStyle = L.color
    ctx.fillText(L.label, xe + lw * 4, L.y)
    if (i < 3 && ratios[i] != null && Number.isFinite(ratios[i])) {
      ctx.fillText(`${(ratios[i] * 100).toFixed(1)}%`, xs + lw * 4, (L.y + lines[i + 1].y) / 2)
    }
  }
  ctx.restore()
}

/**
 * 自定义控制点：任何叠加模式下都绘制。
 * 用户自己加的点是其调整资产，切到「三庭」「对称」等视图时也必须可见可点。
 */
function drawCustomPoints(ctx, pts, count, selected, lw, k) {
  if (!count) return
  const r = Math.max(lw * 2.8, MARKER_PX.custom * k)
  const ring = Math.max(1, 1.4 * k)
  ctx.font = `600 ${Math.max(10, Math.round(MARKER_PX.font * k))}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'

  for (let n = 0; n < count; n++) {
    const i = CUSTOM_BASE + n
    const p = pts[i]
    if (!p) continue

    ctx.beginPath()
    ctx.moveTo(p.x, p.y - r)
    ctx.lineTo(p.x + r, p.y)
    ctx.lineTo(p.x, p.y + r)
    ctx.lineTo(p.x - r, p.y)
    ctx.closePath()
    ctx.fillStyle = 'rgba(244, 114, 182, 0.95)'
    ctx.fill()
    ctx.lineWidth = ring * 1.6
    ctx.strokeStyle = i === selected ? '#facc15' : 'rgba(15, 23, 42, 0.85)'
    ctx.stroke()

    const y = p.y - r - ring * 2.5
    ctx.lineWidth = ring * 2.2
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)'
    ctx.strokeText(`C${n + 1}`, p.x, y)
    ctx.fillStyle = '#fce7f3'
    ctx.fillText(`C${n + 1}`, p.x, y)
  }
}

/**
 * 悬停提示：白色虚线环 + 点号。让用户按下前就能确认「抓的是哪个点」，
 * 避免密集区域（如唇周 48–67）误选。
 */
function drawHover(ctx, pts, index, lw, k) {
  const p = pts[index]
  if (!p) return
  const r = Math.max(lw * 4, MARKER_PX.hover * k)
  ctx.save()
  ctx.setLineDash([Math.max(1.5, 2.5 * k), Math.max(1.5, 2 * k)])
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.lineWidth = Math.max(1, 1.6 * k)
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  const fs = Math.max(10, Math.round(MARKER_PX.font * k))
  ctx.font = `600 ${fs}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  const y = p.y - r - Math.max(2, 3 * k)
  ctx.lineWidth = fs * 0.28
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.95)'
  ctx.strokeText(String(index < CUSTOM_BASE ? index : `C${index - CUSTOM_BASE + 1}`), p.x, y)
  ctx.fillStyle = '#fde68a'
  ctx.fillText(String(index < CUSTOM_BASE ? index : `C${index - CUSTOM_BASE + 1}`), p.x, y)
}

/** 选中点位高亮：亮环 + 十字，画在最上层保证任何叠加模式下都可见 */
function drawSelection(ctx, pts, index, lw, k) {
  const p = pts[index]
  if (!p) return
  const r = Math.max(lw * 5, MARKER_PX.select * k)
  const lwv = Math.max(lw * 1.6, 2 * k)
  ctx.strokeStyle = '#facc15'
  ctx.lineWidth = lwv

  // 深色底衬让黄环在浅色皮肤上同样醒目
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)'
  ctx.lineWidth = lwv * 2
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.moveTo(p.x - r * 1.6, p.y)
  ctx.lineTo(p.x + r * 1.6, p.y)
  ctx.moveTo(p.x, p.y - r * 1.6)
  ctx.lineTo(p.x, p.y + r * 1.6)
  ctx.stroke()
  ctx.restore()

  ctx.strokeStyle = '#facc15'
  ctx.lineWidth = lwv
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(p.x - r * 1.6, p.y)
  ctx.lineTo(p.x + r * 1.6, p.y)
  ctx.moveTo(p.x, p.y - r * 1.6)
  ctx.lineTo(p.x, p.y + r * 1.6)
  ctx.stroke()
}

// ---------------------------------------------------------------- 放大镜

/** 放大镜窗口直径（CSS 像素） */
const LENS_PX = 208

/** 整图缩放档位（缩放平移模式） */
const ZOOM_STEPS = [1, 1.5, 2, 3, 4]

/** 放大镜倍率档位 */
const LOUPE_STEPS = [2, 3, 4, 6]

/**
 * 把源矩形 blit 到放大镜，源矩形越界时按同一比例裁剪目标矩形。
 *
 * ⚠️ 不能直接把越界的源矩形交给 drawImage：浏览器会「裁剪源并按比例裁剪
 * 目标」，结果是内容被挤向一角而不是居中 —— 放大镜下中心就不再是鼠标所指
 * 的那个点。这里手动裁剪，越界区域留作中性底色，中心始终对准指针。
 */
function blitClipped(ctx, src, srcW, srcH, sx, sy, side, r) {
  const x0 = Math.max(0, sx)
  const y0 = Math.max(0, sy)
  const x1 = Math.min(srcW, sx + side)
  const y1 = Math.min(srcH, sy + side)
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return
  ctx.drawImage(
    src,
    x0,
    y0,
    x1 - x0,
    y1 - y0,
    (x0 - sx) * r,
    (y0 - sy) * r,
    (x1 - x0) * r,
    (y1 - y0) * r,
  )
}

/**
 * 绘制放大镜内容。
 *
 * 两层做法，第二层是关键：
 *   1. 底图 —— drawImage 按像素放大，看得清皮肤与边缘细节；
 *   2. 点位标记 —— **不跟着放大**，而是把 k 与 lw 同时除以倍率 Z 后交给
 *      同一套绘制原语重绘。
 *
 * 推导：放大镜的变换比 r = dpr·Z/k，标记自然半径 = MARKER_PX·(k/Z)，
 * 落到屏幕 = MARKER_PX·(k/Z)·r/dpr = MARKER_PX，与未放大时完全一致。
 * 道理也直观 —— 放大镜下要看清的是「标记中心压在哪个解剖位置」，
 * 标记本身若跟着放大 Z 倍只会变成糊住目标的大圆点。
 */
function drawLens(ctx, o) {
  const {
    Wl,
    img,
    warp,
    rw,
    sx,
    sy,
    side,
    r,
    z,
    points,
    drawOverlay,
    overlay,
    metrics,
    lw,
    k,
    triangles,
    customCount,
    selectedPoint,
    highlight,
    siteMarkers,
    frameAnchors,
    showAnchors,
    activeAnchor,
  } = o

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, Wl, Wl)

  ctx.save()
  ctx.beginPath()
  ctx.arc(Wl / 2, Wl / 2, Wl / 2, 0, Math.PI * 2)
  ctx.clip()
  // 图外区域用中性底：明确表示「照片到这里就结束了」，而不是拉伸边缘像素
  ctx.fillStyle = '#0b0b10'
  ctx.fillRect(0, 0, Wl, Wl)

  if (warp) {
    blitClipped(ctx, warp, warp.width, warp.height, sx * rw, sy * rw, side * rw, r)
  } else if (img) {
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    blitClipped(ctx, img, w, h, sx, sy, side, r)
  }

  if (drawOverlay && points) {
    // 自然坐标 → 放大镜像素：lens = (nat − s) · r
    ctx.setTransform(r, 0, 0, r, -sx * r, -sy * r)
    const lwL = lw / z
    const kL = k / z

    if (overlay === 'mesh') drawMesh(ctx, points, lwL, triangles, kL)
    else if (overlay === 'points') drawPoints(ctx, points, lwL, kL)
    else if (overlay === 'three') {
      drawThree(ctx, points, metrics, lwL)
      drawFaintPoints(ctx, points, kL)
    } else if (overlay === 'symmetry') {
      drawSymmetry(ctx, points, lwL)
      drawFaintPoints(ctx, points, kL)
    }
    drawCustomPoints(ctx, points, customCount, selectedPoint, lwL, kL)
    drawSiteMarkers(ctx, siteMarkers, lwL, kL)
    drawHighlight(ctx, points, highlight, lwL, kL)
    if (showAnchors && frameAnchors) drawFrameAnchors(ctx, frameAnchors, lwL, kL, activeAnchor)
    if (selectedPoint != null) drawSelection(ctx, points, selectedPoint, lwL, kL)
  }

  // 准星：画在窗口正中心（identity 变换），指示当前指针所指的那一个点
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const c = Wl / 2
  const g = Math.max(5, Wl * 0.05)
  const arm = Math.max(1.5, Wl * 0.011)
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)'
  ctx.lineWidth = arm
  ctx.beginPath()
  ctx.moveTo(c - g, c)
  ctx.lineTo(c - arm * 1.8, c)
  ctx.moveTo(c + arm * 1.8, c)
  ctx.lineTo(c + g, c)
  ctx.moveTo(c, c - g)
  ctx.lineTo(c, c - arm * 1.8)
  ctx.moveTo(c, c + arm * 1.8)
  ctx.lineTo(c, c + g)
  ctx.stroke()
  ctx.restore()
}

function drawSymmetry(ctx, pts, lw) {
  const axis = fitLine([pts[8], pts[27], pts[30]])

  const span = Math.abs(pts[8].y - pts[27].y) * 2.5
  ctx.strokeStyle = '#22d3ee'
  ctx.lineWidth = lw * 1.2
  ctx.beginPath()
  ctx.moveTo(axis.cx - axis.dx * span, axis.cy - axis.dy * span)
  ctx.lineTo(axis.cx + axis.dx * span, axis.cy + axis.dy * span)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)'
  ctx.lineWidth = lw * 0.8
  ctx.beginPath()
  for (let i = 0; i < RIGHT_HALF.length; i++) {
    const m = mirrorPoint(pts[RIGHT_HALF[i]], axis)
    const t = pts[LEFT_HALF[i]]
    ctx.moveTo(m.x, m.y)
    ctx.lineTo(t.x, t.y)
  }
  ctx.stroke()

  ctx.fillStyle = 'rgba(34, 211, 238, 0.9)'
  ctx.beginPath()
  for (let i = 0; i < RIGHT_HALF.length; i++) {
    const m = mirrorPoint(pts[RIGHT_HALF[i]], axis)
    ctx.moveTo(m.x + lw * 1.6, m.y)
    ctx.arc(m.x, m.y, lw * 1.6, 0, Math.PI * 2)
  }
  ctx.fill()
}

// ---------------------------------------------------------------- 组件

export default function FaceCanvas({
  imageSrc,
  points,
  srcPoints,
  overlay,
  view,
  metrics,
  selectedPoint = null,
  interactive = false,
  onPointSelect,
  onPointDrag,
  triangles = TRIANGLES,
  customCount = 0,
  addMode = false,
  onAddPoint,
  showWarp,
  /** 需要高亮显示的点位索引（悬停亚单位行时给出），null 表示无 */
  highlight = null,
  /** 医美部位作用点（虚拟控制点，不在 68 点内）：[{key,label,pts,active,on}] */
  siteMarkers = null,
  /** 基准点 {L, R}：整张脸的坐标原点与尺度基准，可拖动校准 */
  frameAnchors = null,
  /** 是否绘制并可抓取基准点 */
  showAnchors = false,
  onAnchorDrag,
  onAnchorSelect,
  /** 当前选中的基准点 'L' | 'R' | null */
  activeAnchor = null,
  maxEdge = MAX_EDGE,
  emptyTitle = EMPTY.title,
  emptyHint = EMPTY.hint,
  className = '',
  /** 是否显示缩放 / 放大镜工具条（预览区同样需要放大看形变细节） */
  tools = true,
}) {
  // 未显式指定时沿用旧行为：仅「调整」视图显示形变照
  const warpOn = showWarp ?? view === 'adjustment'
  // 'none' 表示纯净照片（预览区），不绘制任何叠加层
  const drawOverlay = overlay !== 'none' && view !== 'reference'
  const wrapRef = useRef(null)
  const imgRef = useRef(null)
  const warpRef = useRef(null)
  const overlayRef = useRef(null)
  const meshRef = useRef(null)
  const warperRef = useRef(null)
  const rafRef = useRef(0)
  const dragRef = useRef(null)
  const hoverRef = useRef(-1)
  /** 供指针事件触发重绘（hover 高亮不进 React state，避免每次移动都重渲染） */
  const scheduleRef = useRef(() => {})
  const [imgReady, setImgReady] = useState(false)

  // ---- 缩放 / 放大镜 ----
  // zoom 同时存 ref 与 state：ref 供 wheel / 拖拽等原生回调读取最新值，
  // state 只为触发一次重渲染（k 随显示宽度变化，叠加层必须按新尺度重绘）。
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const [loupeOn, setLoupeOn] = useState(false)
  const loupeOnRef = useRef(false)
  const [loupeZ, setLoupeZ] = useState(3)
  const loupeZRef = useRef(3)
  const [hovering, setHovering] = useState(false)
  /** 平移偏移（CSS px）。拖动时直接改 DOM style，不进 React state */
  const panRef = useRef({ x: 0, y: 0 })
  const zoomLayerRef = useRef(null)
  const lensRef = useRef(null)
  const panDragRef = useRef(null)
  /** 指针当前位置的自然像素坐标，放大镜每次重绘都以此为中心 */
  const pointerNatRef = useRef(null)
  const lensRafRef = useRef(0)

  // 换图：清空加载态与纹理缓存
  useEffect(() => {
    setImgReady(false)
    if (warperRef.current) {
      warperRef.current.dispose()
      warperRef.current = null
    }
  }, [imageSrc])

  // 源点集（或图片）变化 → 重建纹理块缓存
  useEffect(() => {
    const img = imgRef.current
    if (!img || !imgReady || !srcPoints) return
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) return
    warperRef.current = createWarper(img, srcPoints, computeScale(w, h, maxEdge), triangles)
    return () => {
      if (warperRef.current) {
        warperRef.current.dispose()
        warperRef.current = null
      }
    }
  }, [srcPoints, imgReady, triangles])

  useEffect(() => {
    const img = imgRef.current
    if (!img || !imageSrc) return

    const render = () => {
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      if (!w || !h) return

      const oc = overlayRef.current
      const mc = meshRef.current
      const wc = warpRef.current
      if (!oc || !mc || !wc) return

      if (oc.width !== w || oc.height !== h) {
        oc.width = w
        oc.height = h
        mc.width = w
        mc.height = h
      }

      // ---- warp 层：形变后的照片（draw 内部已绘制底图，网格外保持原样）----
      const wctx = wc.getContext('2d')
      if (warpOn && points && warperRef.current) {
        if (wc.width !== warperRef.current.cw || wc.height !== warperRef.current.ch) {
          wc.width = warperRef.current.cw
          wc.height = warperRef.current.ch
        }
        const tw = performance.now()
        warperRef.current.draw(wctx, points)
        if (import.meta.env.DEV) window.__warpMs = +(performance.now() - tw).toFixed(1)
      } else {
        wctx.setTransform(1, 0, 0, 1, 0, 0)
        wctx.clearRect(0, 0, wc.width, wc.height)
      }

      // ---- overlay / mesh 层 ----
      const octx = oc.getContext('2d')
      const mctx = mc.getContext('2d')
      octx.clearRect(0, 0, w, h)
      mctx.clearRect(0, 0, w, h)

      if (!drawOverlay || !points) return

      const lw = Math.max(1, w / 500)
      // 显示缩放换算：1 CSS 像素对应的画布像素数。标记按屏幕尺寸绘制的关键。
      // 取图片自身的显示宽度（而非容器），整图缩放后标记才不会被一起放大。
      const dispW = img.getBoundingClientRect().width || 0
      const k = dispW > 0 ? w / dispW : 1

      const tm = performance.now()
      if (overlay === 'mesh') drawMesh(mctx, points, lw, triangles, k)
      else if (overlay === 'points') drawPoints(mctx, points, lw, k)
      else if (overlay === 'three') {
        drawThree(octx, points, metrics, lw)
        drawFaintPoints(mctx, points, k)
      } else if (overlay === 'symmetry') {
        drawSymmetry(octx, points, lw)
        drawFaintPoints(mctx, points, k)
      }
      drawCustomPoints(mctx, points, customCount, selectedPoint, lw, k)
      drawSiteMarkers(mctx, siteMarkers, lw, k)
      drawHighlight(mctx, points, highlight, lw, k)
      if (showAnchors && frameAnchors) drawFrameAnchors(mctx, frameAnchors, lw, k, activeAnchor)
      const hov = hoverRef.current
      if (hov >= 0 && hov !== selectedPoint && hov < points.length) {
        drawHover(mctx, points, hov, lw, k)
      }
      if (selectedPoint != null) drawSelection(mctx, points, selectedPoint, lw, k)
      if (import.meta.env.DEV) window.__meshMs = +(performance.now() - tm).toFixed(1)
    }

    const schedule = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        render()
      })
    }
    scheduleRef.current = schedule

    const onLoad = () => {
      setImgReady(true)
      schedule()
    }

    if (img.complete && (img.naturalWidth || img.width)) {
      if (!imgReady) setImgReady(true)
      schedule()
    }
    img.addEventListener('load', onLoad)
    // 显示宽度变化会改变 CSS px → 画布 px 的换算系数，需按新尺度重绘标记
    window.addEventListener('resize', schedule)
    return () => {
      img.removeEventListener('load', onLoad)
      window.removeEventListener('resize', schedule)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [
    imageSrc,
    points,
    srcPoints,
    overlay,
    view,
    metrics,
    imgReady,
    selectedPoint,
    triangles,
    customCount,
    highlight,
    siteMarkers,
    frameAnchors,
    showAnchors,
    activeAnchor,
    // 缩放改变显示宽度 → k 变 → 标记必须按新尺度重绘
    zoom,
  ])

  // ---------------------------------------------------------------- 缩放 / 放大镜

  /** 把平移量约束在合法区间：放大时可自由平移，缩小时强制居中 */
  const clampPan = () => {
    const wrap = wrapRef.current
    if (!wrap) return
    const cw = wrap.clientWidth
    const ch = wrap.clientHeight
    const z = zoomRef.current
    const fit = (c, s) => (s >= c ? [c - s, 0] : [(c - s) / 2, (c - s) / 2])
    const [loX, hiX] = fit(cw, cw * z)
    const [loY, hiY] = fit(ch, ch * z)
    panRef.current.x = Math.min(hiX, Math.max(loX, panRef.current.x))
    panRef.current.y = Math.min(hiY, Math.max(loY, panRef.current.y))
  }

  /** 把 zoom / pan 写进变换层。平移不进 React state，避免拖动时整棵树重渲染 */
  const applyTransform = () => {
    const el = zoomLayerRef.current
    if (!el) return
    const { x, y } = panRef.current
    el.style.transform = `translate(${x}px, ${y}px) scale(${zoomRef.current})`
  }

  useEffect(() => {
    clampPan()
    applyTransform()
  }, [zoom, imageSrc, imgReady])

  /** 放大镜定位：跟随指针，靠边翻转到另一侧，且始终不越出画布边界 */
  const placeLens = (clientX, clientY) => {
    const wrap = wrapRef.current
    const lens = lensRef.current
    if (!wrap || !lens) return
    const r = wrap.getBoundingClientRect()
    const off = 26
    let x = clientX - r.left + off
    let y = clientY - r.top + off
    if (x + LENS_PX > r.width) x = clientX - r.left - LENS_PX - off
    if (y + LENS_PX > r.height) y = clientY - r.top - LENS_PX - off
    lens.style.left = `${Math.max(0, Math.min(x, r.width - LENS_PX))}px`
    lens.style.top = `${Math.max(0, Math.min(y, r.height - LENS_PX))}px`
  }

  const paintLens = () => {
    const lens = lensRef.current
    const img = imgRef.current
    if (!lens || !img) return
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) return
    const p = pointerNatRef.current
    if (!p) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const Wl = Math.round(LENS_PX * dpr)
    if (lens.width !== Wl) {
      lens.width = Wl
      lens.height = Wl
    }
    const rect = img.getBoundingClientRect()
    const k = rect.width > 0 ? w / rect.width : 1
    const z = loupeZRef.current
    // 源区域边长：窗口在屏幕上占 LENS_PX，放大 z 倍 → 源只取 LENS_PX/z
    const side = (LENS_PX / z) * k
    if (!(side > 0)) return

    const wc = warpRef.current
    const useWarp = warpOn && !!wc && wc.width > 0 && !!warperRef.current
    drawLens(lens.getContext('2d'), {
      Wl,
      img,
      warp: useWarp ? wc : null,
      rw: useWarp ? wc.width / w : 1,
      sx: p.x - side / 2,
      sy: p.y - side / 2,
      side,
      r: Wl / side,
      z,
      points,
      drawOverlay,
      overlay,
      metrics,
      lw: Math.max(1, w / 500),
      k,
      triangles,
      customCount,
      selectedPoint,
      highlight,
      siteMarkers,
      frameAnchors,
      showAnchors,
      activeAnchor,
    })
  }

  const scheduleLens = () => {
    if (lensRafRef.current) return
    lensRafRef.current = requestAnimationFrame(() => {
      lensRafRef.current = 0
      paintLens()
    })
  }

  useEffect(
    () => () => {
      if (lensRafRef.current) cancelAnimationFrame(lensRafRef.current)
    },
    [],
  )

  // 滚轮：放大镜开启时调倍率，否则调整图缩放。
  // React 的 onWheel 走 passive 事件委托，preventDefault 无效，只能手动绑定
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !imageSrc) return
    const onWheel = (e) => {
      e.preventDefault()
      const dir = e.deltaY > 0 ? -1 : 1
      if (loupeOnRef.current) {
        const i = LOUPE_STEPS.indexOf(loupeZRef.current)
        const ni = Math.min(LOUPE_STEPS.length - 1, Math.max(0, (i < 0 ? 1 : i) + dir))
        const nz = LOUPE_STEPS[ni]
        if (nz === loupeZRef.current) return
        loupeZRef.current = nz
        setLoupeZ(nz)
        return
      }
      const i = ZOOM_STEPS.indexOf(zoomRef.current)
      const ni = Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))
      const nz = ZOOM_STEPS[ni]
      if (nz === zoomRef.current) return
      // 以指针为锚点：让指针下的那个图像点在缩放前后停在同一屏幕位置
      const r = wrap.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      const ratio = nz / zoomRef.current
      panRef.current.x = mx - (mx - panRef.current.x) * ratio
      panRef.current.y = my - (my - panRef.current.y) * ratio
      zoomRef.current = nz
      setZoom(nz)
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [imageSrc])

  /** 切换整图缩放档位（工具条按钮用，以画布中心为锚点） */
  const stepZoom = (dir) => {
    const i = ZOOM_STEPS.indexOf(zoomRef.current)
    const ni = Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))
    const nz = ZOOM_STEPS[ni]
    if (nz === zoomRef.current) return
    const wrap = wrapRef.current
    if (wrap) {
      const ratio = nz / zoomRef.current
      const cx = wrap.clientWidth / 2
      const cy = wrap.clientHeight / 2
      panRef.current.x = cx - (cx - panRef.current.x) * ratio
      panRef.current.y = cy - (cy - panRef.current.y) * ratio
    }
    zoomRef.current = nz
    setZoom(nz)
  }

  const toggleLoupe = () => {
    const next = !loupeOnRef.current
    loupeOnRef.current = next
    setLoupeOn(next)
  }

  const pickLoupeZ = (z) => {
    loupeZRef.current = z
    setLoupeZ(z)
  }

  // ---------------------------------------------------------------- 点位拖拽

  /** 鼠标坐标 → 图片自然像素坐标 */
  const toNatural = (e) => {
    const img = imgRef.current
    const wrap = wrapRef.current
    if (!img || !wrap) return null
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) return null
    // ⚠️ 必须用【图片】的 rect 而不是容器的：整图缩放后容器尺寸不变，
    // 用容器做分母会把坐标算回未缩放的位置，拖点立刻错位。
    const r = img.getBoundingClientRect()
    if (!r.width || !r.height) return null
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h }
  }

  /** 可交互点位：68 关键点 + 自定义点（锚点是辅助点，不参与交互） */
  const isDraggable = (i) => i < 68 || (i >= CUSTOM_BASE && i < CUSTOM_BASE + customCount)

  /**
   * 命中测试：返回最近可交互点位索引，超出半径返回 -1。
   * 半径按【屏幕像素】折算（MARKER_PX.hit），图片被缩小显示时抓取范围不会
   * 跟着缩小；同时对超小图保留 2% 图宽的相对下限，避免整图只有一个命中区。
   */
  const hitTest = (p) => {
    if (!p || !points) return null
    const img = imgRef.current
    const w = img?.naturalWidth || img?.width || 1
    // 同 toNatural：按图片实际显示宽度换算，缩放后命中半径才跟得上屏幕像素
    const dispW = img?.getBoundingClientRect().width || 0
    const k = dispW > 0 ? w / dispW : 1
    const hitR = Math.max(w * 0.02, MARKER_PX.hit * k)

    // 基准点优先：它是整张脸的坐标原点，比单个关键点更该被抓到
    if (showAnchors && frameAnchors) {
      let bestA = null
      let bestAD = Infinity
      for (const key of ['L', 'R']) {
        const a = frameAnchors[key]
        if (!a) continue
        const d = Math.hypot(a.x - p.x, a.y - p.y)
        if (d < bestAD) {
          bestAD = d
          bestA = key
        }
      }
      if (bestA && bestAD <= hitR * 1.15) return { kind: 'anchor', id: bestA }
    }

    let best = -1
    let bestD = Infinity
    for (let i = 0; i < points.length; i++) {
      if (!isDraggable(i)) continue
      const d = Math.hypot(points[i].x - p.x, points[i].y - p.y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return bestD > hitR ? null : { kind: 'point', id: best }
  }

  /** 记录指针位置并安排放大镜重绘（rAF 节流） */
  const trackPointer = (e) => {
    if (!loupeOnRef.current) return
    const p = toNatural(e)
    if (!p) return
    pointerNatRef.current = p
    placeLens(e.clientX, e.clientY)
    scheduleLens()
  }

  const startPan = (e) => {
    e.preventDefault()
    panDragRef.current = { x: e.clientX, y: e.clientY, px: panRef.current.x, py: panRef.current.y }
    e.currentTarget.style.cursor = 'grabbing'
  }

  const onPointerDown = (e) => {
    trackPointer(e)
    const p = toNatural(e)

    // 非交互画布（预览区）也要能拖动平移 —— 放大看形变细节同样需要
    if (!interactive) {
      if (p && zoomRef.current > 1) startPan(e)
      return
    }
    if (!p) return

    // preventDefault 会阻止焦点转移，导致左栏数值框收不到 blur、键入值滞留。
    // 这里先主动提交它，保证「改完数字立刻去拖点」时数字一定已生效。
    const active = document.activeElement
    if (active && active !== document.body && typeof active.blur === 'function') active.blur()

    const hit = hitTest(p)

    // 加点模式：点在空白处则新建控制点；命中已有点则照常拖动
    if (addMode && !hit) {
      e.preventDefault()
      onAddPoint?.(p.x, p.y)
      return
    }
    if (!hit) {
      // 放大状态下拖空白处 = 平移画面（未放大时无意义，保持原样）
      if (zoomRef.current > 1) startPan(e)
      return
    }
    e.preventDefault()
    dragRef.current = { kind: hit.kind, id: hit.id, lastX: p.x, lastY: p.y }
    e.currentTarget.style.cursor = 'grabbing'
    if (hit.kind === 'anchor') onAnchorSelect?.(hit.id)
    else onPointSelect?.(hit.id)
  }

  const onPointerMove = (e) => {
    trackPointer(e)

    const pd = panDragRef.current
    if (pd) {
      panRef.current.x = pd.px + (e.clientX - pd.x)
      panRef.current.y = pd.py + (e.clientY - pd.y)
      clampPan()
      applyTransform()
      return
    }

    if (!interactive) return
    const p = toNatural(e)
    if (!p) return
    const d = dragRef.current
    if (d) {
      // 上报相对上一次移动的增量，由上层累加到该点既有位移上
      const dx = p.x - d.lastX
      const dy = p.y - d.lastY
      d.lastX = p.x
      d.lastY = p.y
      if (dx || dy) {
        if (d.kind === 'anchor') onAnchorDrag?.(d.id, dx, dy)
        else onPointDrag?.(d.id, dx, dy)
      }
      return
    }
    const hit = hitTest(p)
    const has = !!hit
    e.currentTarget.style.cursor = addMode ? (has ? 'grab' : 'crosshair') : has ? 'grab' : 'default'

    // hover 变化才重绘：仅更新 ref + 走 rAF，不触发 React 渲染
    // 基准点 hover 用负码记录（-2 = L，-3 = R），与点位索引互不冲突
    const hovCode = !hit ? -1 : hit.kind === 'anchor' ? (hit.id === 'L' ? -2 : -3) : hit.id
    if (hovCode !== hoverRef.current) {
      hoverRef.current = hovCode
      scheduleRef.current()
    }
  }

  const endDrag = () => {
    if (panDragRef.current) {
      panDragRef.current = null
      if (wrapRef.current) wrapRef.current.style.cursor = 'default'
    }
    if (dragRef.current) {
      dragRef.current = null
      if (wrapRef.current) wrapRef.current.style.cursor = 'default'
    }
    if (hoverRef.current !== -1) {
      hoverRef.current = -1
      scheduleRef.current()
    }
  }

  return (
    <div
      className={`canvas-wrap${addMode ? ' add-mode' : ''}${className ? ` ${className}` : ''}`}
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerEnter={(e) => {
        setHovering(true)
        trackPointer(e)
      }}
      onPointerLeave={() => {
        setHovering(false)
        endDrag()
      }}
    >
      {/* 变换层：整图缩放与平移都施加在这一层，img 与三个 canvas 一起变换。
          transform 不影响布局，故容器高度恒定；溢出部分由容器 overflow 裁掉。 */}
      <div className="canvas-zoom" ref={zoomLayerRef}>
        {imageSrc ? (
          <>
            {/* visibility 而非 opacity：隐藏时不参与绘制，但仍占位保持布局 */}
            <img
              ref={imgRef}
              src={imageSrc}
              alt="待分析的人脸照片"
              draggable={false}
              style={{ visibility: warpOn ? 'hidden' : 'visible' }}
            />
            {/* display:none 而非 opacity:0：非调整视图让整层退出合成，减少每帧开销 */}
            <canvas
              ref={warpRef}
              className="layer warp"
              style={{ display: warpOn ? 'block' : 'none' }}
            />
            <canvas ref={overlayRef} className="layer overlay" />
            <canvas ref={meshRef} className="layer mesh" />
          </>
        ) : (
          <div className="canvas-empty">
            <div className="canvas-empty-icon">＋</div>
            <p>{emptyTitle}</p>
            <p className="dim">{emptyHint}</p>
          </div>
        )}
      </div>

      {tools && imageSrc && (
        <div className="canvas-tools">
          <button
            type="button"
            className={`ct-btn${loupeOn ? ' active' : ''}`}
            onClick={toggleLoupe}
            title="放大镜：窗口跟随鼠标局部放大，滚轮切换倍率"
          >
            放大镜
          </button>
          <div className="ct-group">
            <button
              type="button"
              className="ct-btn"
              onClick={() => stepZoom(-1)}
              disabled={zoom <= ZOOM_STEPS[0]}
              title="缩小"
            >
              −
            </button>
            <button
              type="button"
              className="ct-btn ct-pct"
              onClick={() => stepZoom(-ZOOM_STEPS.length)}
              title="复位到 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="ct-btn"
              onClick={() => stepZoom(1)}
              disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
              title="放大"
            >
              ＋
            </button>
          </div>
          {loupeOn && (
            <div className="ct-group">
              {LOUPE_STEPS.map((z) => (
                <button
                  key={z}
                  type="button"
                  className={`ct-btn${loupeZ === z ? ' active' : ''}`}
                  onClick={() => pickLoupeZ(z)}
                  title={`${z} 倍放大`}
                >
                  {z}×
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 放大镜窗口：不在变换层内，始终按屏幕坐标定位 */}
      <canvas
        ref={lensRef}
        className="canvas-loupe"
        style={{
          display: loupeOn && hovering ? 'block' : 'none',
          width: LENS_PX,
          height: LENS_PX,
        }}
      />
    </div>
  )
}
