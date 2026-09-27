// 验证：大图先降采样到 maxEdge 再检测，点位换算回原图坐标后是否稳定。
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const SRC = path.resolve('public/sample-face.png')

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto('http://localhost:5173/diag-detect.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__diag, null, { timeout: 60000 })
console.log('init:', await page.evaluate(() => window.__diag.init()))

const b64 = fs.readFileSync(SRC).toString('base64')
const variants = {}
for (const S of [1, 2, 3, 4, 6]) {
  variants[S] = await page.evaluate(
    async ({ S, b64 }) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = Math.round(img.naturalWidth * S)
      cv.height = Math.round(img.naturalHeight * S)
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
      return cv.toDataURL('image/png')
    },
    { S, b64 },
  )
}

const REFERENCE = await page.evaluate(
  ({ url }) => window.__diag.detect(url, 416),
  { url: variants[1] },
)
console.log('基准（1024 原图）点位取到：', REFERENCE.ok, REFERENCE.ok ? REFERENCE.pts.length : '')

for (const maxEdge of [2048, 1600, 1280, 1024]) {
  console.log(`\n=== maxEdge=${maxEdge}（检测前降采样上限）===`)
  for (const S of [2, 3, 4, 6]) {
    const r = await page.evaluate(
      ({ url, maxEdge }) => window.__diag.detectScaled(url, 416, maxEdge),
      { url: variants[S], maxEdge },
    )
    if (!r.ok) {
      console.log(`  S=${S}x 未检出人脸`)
      continue
    }
    let sum = 0
    let max = 0
    for (let i = 0; i < 68; i++) {
      const d = Math.hypot(r.pts[i].x / S - REFERENCE.pts[i].x, r.pts[i].y / S - REFERENCE.pts[i].y)
      sum += d
      if (d > max) max = d
    }
    console.log(
      `  S=${S}x 原图=${r.nat.w} 实际检测=${r.used.w} 框=${r.box.width.toFixed(0)}x${r.box.height.toFixed(0)} ` +
        `score=${r.score.toFixed(2)} 偏差(均/最大)=${(sum / 68).toFixed(2)} / ${max.toFixed(2)}`,
    )
  }
}

await browser.close()
