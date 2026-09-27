// 真实场景复验：手机常见 3024×4032 竖图（非正方形），
// 检查点位是否仍落在脸上，并出截图对比。
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const APP = process.env.APP_URL || 'http://localhost:5173/'
const SRC = path.resolve('public/sample-face.png')
const OUT = path.resolve('_big-3024x4032.png')

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})

// 1. 造一张 3024×4032 竖图：样张等比铺满宽度，上下留白，保持宽高比
const maker = await browser.newPage()
await maker.goto('about:blank')
const dataUrl = await maker.evaluate(
  async ({ b64 }) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const W = 3024
    const H = 4032
    const s = Math.min(W / img.naturalWidth, H / img.naturalHeight)
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#dcdcdc'
    ctx.fillRect(0, 0, W, H)
    ctx.drawImage(img, 0, (H - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s)
    return cv.toDataURL('image/png')
  },
  { b64: fs.readFileSync(SRC).toString('base64') },
)
fs.writeFileSync(OUT, Buffer.from(dataUrl.split(',')[1], 'base64'))
const SCALE = Math.min(3024 / 1024, 4032 / 1024)
const OFF_Y = (4032 - 1024 * SCALE) / 2
console.log(`已生成 ${path.basename(OUT)}：3024×4032，样张缩放 ${SCALE.toFixed(3)}，纵偏移 ${OFF_Y.toFixed(0)}`)

// 2. 上传：先原图取基准点位，再大图
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
await page.goto(APP, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => (document.querySelector('.status')?.textContent || '').includes('就绪'),
  null,
  { timeout: 180000 },
)

const run = async (file) => {
  await page.setInputFiles('.upload input[type=file]', file)
  await page.waitForFunction(
    () => {
      const t = document.querySelector('.status')?.textContent || ''
      return t.includes('分析完成') || t.includes('未检测') || t.includes('失败')
    },
    null,
    { timeout: 180000 },
  )
  await page.waitForTimeout(1500)
  return page.evaluate(() => {
    const st = window.__faceStudio || {}
    const img = document.querySelector('.canvas-duo .canvas-wrap img')
    const cs = Array.from(document.querySelectorAll('canvas'))
    const mesh = cs.find((c) => (c.className || '').includes('mesh'))
    let painted = -1
    if (mesh && mesh.width) {
      const d = mesh.getContext('2d').getImageData(0, 0, mesh.width, mesh.height).data
      painted = 0
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted++
    }
    return {
      pts: (st.points || []).slice(0, 68),
      nat: img ? `${img.naturalWidth}x${img.naturalHeight}` : null,
      mesh: mesh ? `${mesh.width}x${mesh.height}` : null,
      painted,
    }
  })
}

const base = await run(SRC)
await page.screenshot({ path: '_big-shot-1x.png' })
console.log('1x 基准：', base.nat, 'mesh画布', base.mesh, '已绘', base.painted)

const big = await run(OUT)
await page.screenshot({ path: '_big-shot-3024.png' })
console.log('大图：  ', big.nat, 'mesh画布', big.mesh, '已绘', big.painted)

if (base.pts.length === 68 && big.pts.length === 68) {
  let sum = 0
  let max = 0
  for (let i = 0; i < 68; i++) {
    const ex = base.pts[i].x * SCALE
    const ey = base.pts[i].y * SCALE + OFF_Y
    const d = Math.hypot(big.pts[i].x - ex, big.pts[i].y - ey) / SCALE // 换算回原图尺度
    sum += d
    if (d > max) max = d
  }
  console.log(`点位偏差（原图尺度）：平均 ${(sum / 68).toFixed(2)} 最大 ${max.toFixed(2)}`)
}

await browser.close()
