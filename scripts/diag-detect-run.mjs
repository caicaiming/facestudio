// 用 diag-detect 探针直接跑 face-api：不同输入尺寸 / 不同 inputSize 下，
// 看检测框与关键点是否稳定。
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const SRC = path.resolve('public/sample-face.png')
const FACES = ['/models']

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto('http://localhost:5173/diag-detect.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__diag, null, { timeout: 30000 })
console.log('init:', await page.evaluate(() => window.__diag.init()))

// 生成各尺寸 dataURL
const variants = {}
for (const S of [1, 2, 3, 4]) {
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
    { S, b64: fs.readFileSync(SRC).toString('base64') },
  )
}

for (const inputSize of [416, 608, 832, 1024]) {
  console.log(`\n=== inputSize=${inputSize} ===`)
  const ref = {}
  for (const S of [1, 2, 3, 4]) {
    const r = await page.evaluate(
      ({ url, inputSize }) => window.__diag.detect(url, inputSize),
      { url: variants[S], inputSize },
    )
    if (!r.ok) {
      console.log(`  S=${S}x 未检出人脸`)
      continue
    }
    if (S === 1) ref.pts = r.pts
    let err = null
    if (ref.pts) {
      let max = 0
      let sum = 0
      for (let i = 0; i < 68; i++) {
        const d = Math.hypot(r.pts[i].x / S - ref.pts[i].x, r.pts[i].y / S - ref.pts[i].y)
        sum += d
        if (d > max) max = d
      }
      err = `${(sum / 68).toFixed(2)} / ${max.toFixed(2)}`
    }
    console.log(
      `  S=${S}x 图=${r.nat.w} 框x=${r.box.x.toFixed(0)} y=${r.box.y.toFixed(0)} ` +
        `w=${r.box.width.toFixed(0)} h=${r.box.height.toFixed(0)} score=${r.score.toFixed(2)} ` +
        `点框w=${r.bbox.w.toFixed(0)} 偏差(均/最大)=${err}`,
    )
  }
}

await browser.close()
