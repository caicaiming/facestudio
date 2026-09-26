/**
 * 冒烟测试：逐点调节（下拉选点 + X/Y 滑块 + 画布直接拖拽）
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

// ---- 1. 分组下拉是否载入 68 个点 ----
const groupInfo = await page.evaluate(() => {
  const sels = document.querySelectorAll('.point-picker select')
  return { count: sels.length, options: sels[1]?.options.length }
})
console.log(`✓ 逐点面板存在：${groupInfo.count} 个下拉，「全部」分组共 ${groupInfo.options} 项（68 点 + 1 占位）`)

// ---- 2. 选点 + 拖 X/Y 滑块，检查照片像素变化 ----
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

const setRange = (labelText, value) =>
  page.evaluate(
    ({ labelText, value }) => {
      const row = [...document.querySelectorAll('.slider-row')].find((r) =>
        r.querySelector('.slider-label')?.textContent?.includes(labelText),
      )
      if (!row) return false
      const input = row.querySelector('input[type=range]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    { labelText, value },
  )

// 选中 8 号点（下巴尖）
await page.selectOption('.point-picker select >> nth=1', '8')
await page.waitForTimeout(300)
const selected = await page.textContent('.point-current')
console.log('✓ 选中点位：', selected?.trim())

await setRange('垂直位移', 30)
await page.waitForTimeout(600)
const afterY = await diffFromOriginal()
console.log('  8号点垂直 +30px →', JSON.stringify(afterY))

const offsetText = await page.textContent('.point-actions + .note, .note:has(strong)').catch(() => '')
console.log('  状态提示：', offsetText?.trim())

// ---- 3. 画布直接拖拽点位 ----
await setRange('垂直位移', 0)
await page.waitForTimeout(400)

// 取 30 号点（鼻尖）在页面上的位置，模拟按下并拖动
const dragResult = await page.evaluate(() => {
  const wrap = document.querySelector('.canvas-wrap')
  const img = wrap.querySelector('img')
  const r = wrap.getBoundingClientRect()
  const s = window.__faceStudio
  return { ok: !!s, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, nw: img.naturalWidth, nh: img.naturalHeight }
})
console.log('✓ 画布尺寸换算可用', JSON.stringify(dragResult.rect), `自然尺寸 ${dragResult.nw}x${dragResult.nh}`)

// 用真实鼠标事件拖拽：从鼻尖位置向下拖 60px
const before = await diffFromOriginal()
const pt = await page.evaluate(() => {
  const wrap = document.querySelector('.canvas-wrap')
  const r = wrap.getBoundingClientRect()
  const img = wrap.querySelector('img')
  const p = window.__faceStudio.points[30]
  return { x: r.x + (p.x / img.naturalWidth) * r.width, y: r.y + (p.y / img.naturalHeight) * r.height }
})
await page.mouse.move(pt.x, pt.y)
await page.mouse.down()
await page.mouse.move(pt.x, pt.y + 60, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(600)

const afterDrag = await diffFromOriginal()
const selAfterDrag = await page.textContent('.point-current').catch(() => null)
console.log('  拖拽鼻尖 60px →', JSON.stringify(afterDrag))
console.log('  拖拽后选中点位：', selAfterDrag?.trim())

// ---- 4. 重置 ----
await page.click('.point-actions button >> nth=0')
await page.waitForTimeout(400)
const afterReset = await diffFromOriginal()
console.log('  重置该点 →', JSON.stringify(afterReset))

await page.screenshot({ path: 'pointedit.png' })

console.log('')
console.log(afterY && afterY.changedPct > 1 ? '✓ 点位滑块使照片实际改变' : '✗ 点位滑块无效')
console.log(afterDrag && afterDrag.changedPct > 1 ? '✓ 画布拖拽使照片实际改变' : '✗ 画布拖拽无效')
console.log(
  afterReset && afterReset.changedPct < (afterDrag?.changedPct ?? 99) ? '✓ 重置该点生效' : '✗ 重置无效',
)

await browser.close()
