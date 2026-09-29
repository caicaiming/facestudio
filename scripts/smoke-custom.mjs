/**
 * 冒烟测试：① 参数数值输入框  ② 自定义控制点（加点 / 拖动 / 精确位移 / 删除）
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
await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), {
  timeout: 90000,
})
console.log('✓ 检测完成')

/**
 * 形变图与原图的像素差异。
 *
 * ⚠️ 必须取【预览区】那块 warp 画布（.canvas-duo 里第二个 canvas-wrap）：
 * 主图的 warp 层只在「形变预览」图层打开时才绘制，平时是 300×150 的空白
 * 画布，拿它跟原图比永远是 ~98% 差异 —— 之前踩过一次，量错画布得到假阴性。
 */
const diffFromOriginal = () =>
  page.evaluate(() => {
    const boxes = document.querySelectorAll('.canvas-duo .canvas-wrap')
    const wc = boxes[1]?.querySelector('canvas.warp')
    const img = boxes[0]?.querySelector('img')
    if (!wc || !img || !wc.width) return null
    const c = document.createElement('canvas')
    c.width = wc.width
    c.height = wc.height
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, wc.width, wc.height)
    const a = ctx.getImageData(0, 0, wc.width, wc.height).data
    const b = wc
      .getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, wc.width, wc.height).data
    let sum = 0
    let changed = 0
    const n = a.length / 4
    for (let i = 0; i < a.length; i += 4) {
      const d =
        Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      sum += d / 3
      if (d / 3 > 8) changed++
    }
    return { meanDiff: +(sum / n).toFixed(3), changedPct: +((changed / n) * 100).toFixed(2) }
  })

// ============================================================ 1. 数值输入框
const trisBefore = await page.evaluate(() => window.__faceStudio.triangles.length)

// 找到「下巴」这一行，在数值框里键入 -7 并回车
const typed = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.slider-row')].find((r) =>
    r.querySelector('.slider-label')?.textContent?.includes('下巴'),
  )
  if (!row) return 'NO_ROW'
  const num = row.querySelector('input[type=number]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(num, '-7')
  num.dispatchEvent(new Event('input', { bubbles: true }))
  num.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  return 'ok'
})
await page.waitForTimeout(500)
const chinValue = await page.evaluate(() => window.__faceStudio.params.chin)
const numDisplay = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.slider-row')].find((r) =>
    r.querySelector('.slider-label')?.textContent?.includes('下巴'),
  )
  return row.querySelector('input[type=number]').value
})
console.log(`✓ 数值输入：键入 -7 → params.chin = ${chinValue}，输入框显示 "${numDisplay}"（${typed}）`)

// 超范围输入应被钳制
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.slider-row')].find((r) =>
    r.querySelector('.slider-label')?.textContent?.includes('下巴'),
  )
  const num = row.querySelector('input[type=number]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(num, '999')
  num.dispatchEvent(new Event('input', { bubbles: true }))
  num.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
})
await page.waitForTimeout(400)
const clamped = await page.evaluate(() => window.__faceStudio.params.chin)
console.log(`✓ 超范围钳制：键入 999 → ${clamped}`)

// 非法输入应回滚
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.slider-row')].find((r) =>
    r.querySelector('.slider-label')?.textContent?.includes('下巴'),
  )
  const num = row.querySelector('input[type=number]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(num, 'abc')
  num.dispatchEvent(new Event('input', { bubbles: true }))
  num.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
})
await page.waitForTimeout(400)
const afterBad = await page.evaluate(() => window.__faceStudio.params.chin)
console.log(`✓ 非法输入回滚：键入 abc → ${afterBad}`)

// 归零，回到干净状态
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.slider-row')].find((r) =>
    r.querySelector('.slider-label')?.textContent?.includes('下巴'),
  )
  const num = row.querySelector('input[type=number]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(num, '0')
  num.dispatchEvent(new Event('input', { bubbles: true }))
  num.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
})
await page.waitForTimeout(400)

// ============================================================ 2. 自定义加点
await page.click('.custom-bar button >> nth=0')
await page.waitForTimeout(200)
const addModeOn = await page.evaluate(
  () => !!document.querySelector('.canvas-wrap.add-mode'),
)
console.log('✓ 进入加点模式：', addModeOn)

/** 在自然坐标 (x, y) 处点击画布 */
const clickAtNatural = async (nx, ny) => {
  const p = await page.evaluate(
    ({ nx, ny }) => {
      const wrap = document.querySelector('.canvas-wrap')
      const img = wrap.querySelector('img')
      const r = wrap.getBoundingClientRect()
      return {
        x: r.x + (nx / img.naturalWidth) * r.width,
        y: r.y + (ny / img.naturalHeight) * r.height,
      }
    },
    { nx, ny },
  )
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(400)
}

// 在右脸颊空白处加一个点（取 3 号点与 30 号点之间的区域）
const cheek = await page.evaluate(() => {
  const p = window.__faceStudio.points
  return { x: Math.round((p[2].x + p[30].x) / 2), y: Math.round((p[2].y + p[30].y) / 2) }
})
await clickAtNatural(cheek.x, cheek.y)

const st1 = await page.evaluate(() => ({
  count: window.__faceStudio.customPoints.length,
  tris: window.__faceStudio.triangles.length,
  selected: document.querySelector('.point-current')?.textContent?.trim(),
  listItems: document.querySelectorAll('.custom-list li').length,
}))
console.log(
  `✓ 加点成功：${st1.count} 个自定义点，三角剖分 ${trisBefore} → ${st1.tris}，列表 ${st1.listItems} 项`,
)
console.log('  面板显示：', st1.selected)

// ============================================================ 3. 自定义点精确位移
const beforeMove = await diffFromOriginal()
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.slider-row')]
  // 自定义点面板的两个位移滑块位于末尾
  const row = rows.findLast((r) => r.querySelector('.slider-label')?.textContent === '水平位移')
  const num = row.querySelector('input[type=number]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(num, '25')
  num.dispatchEvent(new Event('input', { bubbles: true }))
  num.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
})
await page.waitForTimeout(600)
const afterMove = await diffFromOriginal()
const cp0 = await page.evaluate(() => window.__faceStudio.customPoints[0])
console.log(
  `✓ 自定义点水平 +25px：dx = ${cp0.dx}，像素改变 ${afterMove?.changedPct}%（调整前 ${beforeMove?.changedPct}%）`,
)

// ============================================================ 4. 画布拖动自定义点
const cpPos = await page.evaluate(() => {
  const wrap = document.querySelector('.canvas-wrap')
  const r = wrap.getBoundingClientRect()
  const img = wrap.querySelector('img')
  const c = window.__faceStudio.customPoints[0]
  return {
    x: r.x + (c.x / img.naturalWidth) * r.width,
    y: r.y + (c.y / img.naturalHeight) * r.height,
  }
})
await page.mouse.move(cpPos.x, cpPos.y)
await page.mouse.down()
await page.mouse.move(cpPos.x + 40, cpPos.y - 30, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(600)
const cp1 = await page.evaluate(() => window.__faceStudio.customPoints[0])
const afterDrag = await diffFromOriginal()
console.log(
  `✓ 拖动自定义点 → dx=${cp1.dx.toFixed(1)} dy=${cp1.dy.toFixed(1)}，像素改变 ${afterDrag?.changedPct}%`,
)

// ============================================================ 5. 删除
await page.click('.custom-list li >> nth=0 >> .custom-del')
await page.waitForTimeout(500)
const st2 = await page.evaluate(() => ({
  count: window.__faceStudio.customPoints.length,
  tris: window.__faceStudio.triangles.length,
}))
const afterDel = await diffFromOriginal()
console.log(`✓ 删除自定义点：剩余 ${st2.count} 个，三角剖分回到 ${st2.tris}`)
console.log('  删除后像素改变：', afterDel?.changedPct, '%（预设参数已归零，应接近 0）')

await page.screenshot({ path: 'custom.png' })

console.log('')
console.log(chinValue === -7 ? '✓ 数值输入写入精确值' : '✗ 数值输入未生效')
console.log(clamped === 15 ? '✓ 超范围钳制到 max' : '✗ 钳制失效')
console.log(afterBad === 15 ? '✓ 非法输入回滚' : '✗ 回滚失效')
console.log(st1.count === 1 && st1.tris > trisBefore ? '✓ 加点触发三角剖分重算' : '✗ 加点/重算失败')
console.log(cp0.dx === 25 ? '✓ 自定义点精确位移生效' : '✗ 自定义点位移失败')
console.log(
  afterMove && afterMove.changedPct > beforeMove.changedPct + 0.5
    ? '✓ 自定义点使照片实际改变'
    : '✗ 自定义点未影响照片',
)
console.log(cp1.dy < 0 ? '✓ 画布拖动自定义点生效' : '✗ 拖动无效')
console.log(st2.count === 0 && st2.tris === trisBefore ? '✓ 删除后恢复原拓扑' : '✗ 删除未复位')

await browser.close()
