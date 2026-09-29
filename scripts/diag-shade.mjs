/**
 * 诊断：真实照片下光影层的灰度分布，定位「最大偏离 128」（打满纯白/纯黑）
 * 到底来自哪一项。一次性脚本。
 */
import { chromium } from 'playwright-core'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('就绪'), null, {
  timeout: 120000,
})
await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), null, {
  timeout: 120000,
})

const info = await page.evaluate(() => {
  const s = window.__faceStudio
  const im = document.querySelector('.canvas-duo .canvas-wrap img')
  const c = document.querySelectorAll('.canvas-duo .canvas-wrap')[1]?.querySelector('canvas.relief')
  return {
    natW: im?.naturalWidth,
    natH: im?.naturalHeight,
    reliefW: c?.width,
    reliefH: c?.height,
    faceW: s?.faceWidthPx ?? null,
  }
})
console.log('图片', info.natW, '×', info.natH, ' relief 画布', info.reliefW, '×', info.reliefH, ' 面宽', info.faceW?.toFixed?.(1))

/** 调某部位的凹凸到指定档位 */
const setDepth = async (label, times) => {
  const row = page.locator('.zone-block .su-row', { hasText: label }).first()
  await row.scrollIntoViewIfNeeded()
  const col = row.locator('.zone-col').nth(1)
  const plus = col.locator('.step-btn').last()
  for (let i = 0; i < times; i++) {
    await plus.click()
    await page.waitForTimeout(90)
  }
}

const hist = () =>
  page.evaluate(() => {
    const c = document.querySelectorAll('.canvas-duo .canvas-wrap')[1]?.querySelector('canvas.relief')
    if (!c || !c.width) return null
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let painted = 0
    let sum = 0
    let mx = 0
    let sat = 0
    let nearSat = 0
    const buckets = { '0-32': 0, '32-96': 0, '96-128': 0, '128-160': 0, '160-224': 0, '224-255': 0 }
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue
      painted++
      const g = d[i]
      const dev = Math.abs(g - 128)
      sum += dev
      if (dev > mx) mx = dev
      if (g <= 2 || g >= 253) sat++
      if (g <= 12 || g >= 243) nearSat++
      if (g < 32) buckets['0-32']++
      else if (g < 96) buckets['32-96']++
      else if (g < 128) buckets['96-128']++
      else if (g < 160) buckets['128-160']++
      else if (g < 224) buckets['160-224']++
      else buckets['224-255']++
    }
    return { painted, avg: painted ? sum / painted : 0, maxDev: mx, sat, nearSat, buckets }
  })

for (const n of [6, 15, 30]) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('就绪'), null, {
    timeout: 120000,
  })
  await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
  await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), null, {
    timeout: 120000,
  })
  await setDepth('泪沟', n)
  const h = await hist()
  console.log(`\n泪沟凹凸 ${n} 档：`)
  console.log(`  着色 ${h.painted}  平均偏离 ${h.avg.toFixed(2)}  最大偏离 ${h.maxDev}`)
  console.log(`  饱和 ${h.sat}（${((h.sat / h.painted) * 100).toFixed(3)}%）  接近饱和 ${h.nearSat}`)
  console.log(`  直方图 ${JSON.stringify(h.buckets)}`)
  if (n === 15) {
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'diag-shade.png', clip: { x: 500, y: 100, width: 400, height: 500 } })
    console.log('  已截图 diag-shade.png（预览区右侧 = 调整后）')
  }
}

console.log('\n控制台错误：', errors.length ? errors.slice(0, 3) : '无')
await browser.close()
