/**
 * diag-responsive.mjs —— 多分辨率布局诊断：截整页图 + 报告溢出/裁剪/画布尺寸
 * 用法: node scripts/diag-responsive.mjs （需 dev server 在 5173）
 */

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=swiftshader'] })

const SIZES = [
  [1366, 768],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
]

for (const [w, h] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('就绪'), { timeout: 90000 })
  await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
  await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), { timeout: 90000 })
  await page.waitForTimeout(600)

  const m = await page.evaluate(() => {
    const r = (sel) => {
      const e = document.querySelector(sel)
      if (!e) return null
      const b = e.getBoundingClientRect()
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
    }
    const overflow = []
    document.querySelectorAll('.layout *').forEach((e) => {
      const b = e.getBoundingClientRect()
      if (b.right > window.innerWidth + 1 || b.left < -1) {
        overflow.push(`${e.className || e.tagName} right=${Math.round(b.right)}`)
      }
    })
    const clipped = []
    document.querySelectorAll('.col-left, .col-right').forEach((e) => {
      if (e.scrollHeight > e.clientHeight + 2) clipped.push(`${e.className}: 内容 ${e.scrollHeight} > 可视 ${e.clientHeight}`)
    })
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      docH: document.documentElement.scrollHeight,
      left: r('.col-left'),
      center: r('.col-center'),
      right: r('.col-right'),
      canvasBox: r('.canvas-duo .canvas-box'),
      img: r('.canvas-duo .canvas-wrap img'),
      toolbar: r('.col-center .toolbar'),
      overflow: overflow.slice(0, 6),
      clipped,
    }
  })
  console.log(`\n=== ${w}x${h} ===`)
  console.log(JSON.stringify(m, null, 1))
  await page.screenshot({ path: `_res-${w}x${h}.png` })
  await page.close()
}
await browser.close()
