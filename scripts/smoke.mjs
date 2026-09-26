/**
 * 浏览器冒烟测试（开发期工具，不参与构建）
 * 用系统 Chrome 打开应用，上传示例照片，校验检测链路与指标渲染。
 *
 * 运行：node scripts/smoke.mjs
 */
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SAMPLE = path.join(ROOT, 'public', 'sample-face.png')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL_APP = 'http://localhost:5173/'

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const log = (...a) => console.log(...a)

await page.goto(URL_APP, { waitUntil: 'domcontentloaded' })

// 1) 等待模型就绪
await page.waitForFunction(
  () => document.querySelector('.status')?.textContent?.includes('就绪'),
  { timeout: 60000 },
)
log('✓ 模型加载完成，状态：就绪')

// 2) 上传示例照片
await page.setInputFiles('.upload input[type=file]', SAMPLE)
await page.waitForFunction(
  () => document.querySelector('.status')?.textContent?.includes('分析完成'),
  { timeout: 60000 },
)
log('✓ 人脸检测完成')

// 3) 抓取指标面板
const metrics = await page.$$eval('.metrics tr', (rows) =>
  rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent.trim())),
)
log('✓ 几何指标：')
for (const [k, v, ideal] of metrics) log(`    ${k.padEnd(6)} ${String(v).padEnd(10)} (理想 ${ideal})`)

const score = await page.textContent('.score-num')
const grade = await page.textContent('.score-grade')
log(`✓ 综合评分：${score}（${grade}）`)

const adviceCount = await page.$$eval('.advice li', (l) => l.length)
log(`✓ 处方建议条数：${adviceCount}`)

const copy = await page.textContent('.copy')
log(`✓ 分析文案：${copy}`)

// 4) 校验 canvas 已被绘制（网格层非空）
const painted = await page.evaluate(() => {
  const c = document.querySelector('canvas.mesh')
  if (!c) return null
  const ctx = c.getContext('2d')
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let n = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
  return { w: c.width, h: c.height, nonTransparent: n }
})
log(`✓ 网格层绘制：${painted.w}x${painted.h}，非空像素 ${painted.nonTransparent}`)

// 5) 切换叠加层 + 拖动滑块
await page.click('.seg:nth-child(2) button:nth-child(3)') // 三庭
await page.waitForTimeout(300)
await page.screenshot({ path: path.join(ROOT, 'smoke-three.png') })

const slider = await page.$('.slider-row:nth-child(2) input[type=range]')
await slider.focus()
for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
await page.click('.seg:nth-child(1) button:nth-child(2)') // 调整视图
await page.waitForTimeout(300)
const sliderVal = await page.textContent('.slider-row:nth-child(2) .slider-value')
log(`✓ 下巴滑块值：${sliderVal}`)
await page.screenshot({ path: path.join(ROOT, 'smoke-adjust.png') })

// 6) 控制台错误检查
if (errors.length) {
  log('✗ 控制台错误：')
  errors.forEach((e) => log('    ' + e))
} else {
  log('✓ 控制台无报错')
}

await browser.close()
process.exit(errors.length ? 1 : 0)
