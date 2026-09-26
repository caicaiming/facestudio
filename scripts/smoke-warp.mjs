/**
 * 冒烟测试：验证「照片本身」跟随滑块形变（不只是网格线动）
 * 运行前需先启动 dev server（npm run dev）
 */
import { chromium } from 'playwright-core'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text())
})

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('就绪'), {
  timeout: 90000,
})
console.log('✓ 模型就绪')

await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), {
  timeout: 90000,
})
console.log('✓ 检测完成')

// ---- 切到「调整」视图 ----
await page.getByRole('button', { name: '调整' }).click()
await page.waitForTimeout(600)

/** 比较 warp 画布与原图的平均像素差异（0–255） */
const diffFromOriginal = () =>
  page.evaluate(() => {
    const wc = document.querySelector('canvas.warp')
    const img = document.querySelector('.canvas-wrap img')
    if (!wc || !img) return null
    const c = document.createElement('canvas')
    c.width = wc.width
    c.height = wc.height
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, wc.width, wc.height)
    const a = ctx.getImageData(0, 0, wc.width, wc.height).data
    const b = wc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, wc.width, wc.height).data
    let sum = 0
    let changed = 0
    const n = a.length / 4
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      sum += d / 3
      if (d / 3 > 8) changed++
    }
    return { meanDiff: +(sum / n).toFixed(3), changedPct: +((changed / n) * 100).toFixed(2) }
  })

const idle = await diffFromOriginal()
console.log('参数全零时与原图差异：', JSON.stringify(idle))

// ---- 拖动「下巴」滑块到 +15 ----
const setSlider = (label, value) =>
  page.evaluate(
    ({ label, value }) => {
      const row = [...document.querySelectorAll('.slider-row')].find((r) =>
        r.querySelector('.slider-label')?.textContent?.includes(label),
      )
      if (!row) return false
      const input = row.querySelector('input[type=range]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    { label, value },
  )

const t0 = Date.now()
await setSlider('下巴', 15)
await page.waitForTimeout(500)
const chin = await diffFromOriginal()
console.log(`下巴 +15 后差异：`, JSON.stringify(chin), `（耗时 ${Date.now() - t0}ms）`)

await setSlider('下颌线', -15)
await page.waitForTimeout(500)
const jaw = await diffFromOriginal()
console.log('再叠加下颌线 -15：', JSON.stringify(jaw))

// ---- 拖动实时性：连续 12 档，测每帧渲染耗时 ----
const frameCost = await page.evaluate(async () => {
  const row = [...document.querySelectorAll('.slider-row')].find((r) =>
    r.querySelector('.slider-label')?.textContent?.includes('颧骨'),
  )
  const input = row.querySelector('input[type=range]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const times = []
  for (let v = -15; v <= 15; v += 3) {
    const t = performance.now()
    setter.call(input, String(v))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    times.push(+(performance.now() - t).toFixed(1))
  }
  return times
})
console.log('连续拖动每档渲染耗时(ms)：', frameCost.join(', '))

// ---- 截图 ----
await page.screenshot({ path: 'warp-adjust.png' })
await page.getByRole('button', { name: '对照' }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: 'warp-reference.png' })

// ---- 断言 ----
const ok1 = idle && idle.meanDiff < 1.5
const ok2 = chin && chin.meanDiff > 1 && chin.changedPct > 3
console.log('')
console.log(ok1 ? '✓ 全零参数下形变层与原图一致（无误形变）' : '✗ 全零参数下仍有差异')
console.log(ok2 ? '✓ 拖滑块后照片像素实际改变' : '✗ 拖滑块后照片未改变')

await browser.close()
