// 非正方形大图（手机竖拍）的三种送检方式对比：
//   原生尺寸 / 降采样 / 降采样+补方
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const SRC = path.resolve('public/sample-face.png')
const BIG = path.resolve('_big-3024x4032.png')

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto('http://localhost:5173/diag-detect.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__diag, null, { timeout: 60000 })
console.log('init:', await page.evaluate(() => window.__diag.init()))

// 期望值：样张等比铺满 3024 宽、上下居中留白
const SCALE = Math.min(3024 / 1024, 4032 / 1024)
const OFF_Y = (4032 - 1024 * SCALE) / 2
const ref = await page.evaluate(
  ({ url }) => window.__diag.detect(url, 416),
  { url: 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64') },
)
const expected = ref.pts.map((p) => ({ x: p.x * SCALE, y: p.y * SCALE + OFF_Y }))
const bigUrl = 'data:image/png;base64,' + fs.readFileSync(BIG).toString('base64')

const report = (tag, r) => {
  if (!r.ok) return console.log(`${tag} 未检出`)
  let sum = 0
  let max = 0
  for (let i = 0; i < 68; i++) {
    const d = Math.hypot(r.pts[i].x - expected[i].x, r.pts[i].y - expected[i].y) / SCALE
    sum += d
    if (d > max) max = d
  }
  const ar = r.box.width / r.box.height
  console.log(
    `${tag} 框=${r.box.width.toFixed(0)}x${r.box.height.toFixed(0)} 宽高比=${ar.toFixed(2)} ` +
      `score=${r.score.toFixed(2)} 偏差(均/最大, 原图尺度)=${(sum / 68).toFixed(2)} / ${max.toFixed(2)}`,
  )
}

report('原生 3024x4032    ', await page.evaluate(({ url }) => window.__diag.detect(url, 416), { url: bigUrl }))
for (const me of [1600, 1280, 1024]) {
  report(
    `降采样 ${me}         `,
    await page.evaluate(({ url, me }) => window.__diag.detectScaled(url, 416, me), { url: bigUrl, me }),
  )
  report(
    `降采样 ${me} + 补方  `,
    await page.evaluate(({ url, me }) => window.__diag.detectPadded(url, 416, me), { url: bigUrl, me }),
  )
}

await browser.close()
