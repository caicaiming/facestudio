import { chromium } from 'playwright-core'
import path from 'node:path'
const browser = await chromium.launch({
  executablePath: 'C://Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('就绪'), null, { timeout: 120000 })
await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), null, { timeout: 120000 })
await page.waitForTimeout(1000)

const diffStats = () => page.evaluate(() => {
  const cs = [...document.querySelectorAll('canvas.layer.diff')]
  return cs.map((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let painted = 0, maxA = 0, sumA = 0
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 0) { painted++; sumA += d[i]; if (d[i] > maxA) maxA = d[i] }
    }
    return { w: c.width, h: c.height, displayed: getComputedStyle(c).display, painted, maxA, avgA: painted ? +(sumA / painted).toFixed(1) : 0 }
  })
})
console.log('① 未调档（应完全透明）:', JSON.stringify(await diffStats()))

const row = page.locator('.zone-block .su-row', { hasText: '苹果肌' }).first()
await row.scrollIntoViewIfNeeded()
const plus = row.locator('.zone-col').nth(0).locator('.step-btn').last()
for (let i = 0; i < 12; i++) { await plus.click(); await page.waitForTimeout(70) }
await page.waitForTimeout(900)
console.log('② 苹果肌 12 档:', JSON.stringify(await diffStats()))
await page.screenshot({ path: 'verify-diff.png' })

// 关掉 diff 层，确认能关
const eye = page.locator('.layer-row', { hasText: '差异热区' }).first().locator('button').first()
if (await eye.count()) { await eye.click(); await page.waitForTimeout(700)
  console.log('③ 关闭图层后:', JSON.stringify(await diffStats())) }
console.log('控制台错误:', errs.length ? errs.slice(0, 3) : '无')
await browser.close()
