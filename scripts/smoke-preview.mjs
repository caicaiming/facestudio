/**
 * 冒烟测试：主图 + 调整后预览区并排
 * 断言：① 主图始终显示原图（任何视图下都不形变）② 预览区随点位调整实时变化
 *      ③ 预览区无叠加层 ④ 调整对比数据不依赖视图切换
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
await page.waitForTimeout(800)
console.log('✓ 检测完成')

// ---- 1. 双栏结构 ----
const panes = await page.evaluate(() =>
  [...document.querySelectorAll('.canvas-duo .canvas-box')].map((b) => ({
    tag: b.querySelector('.pane-tag')?.textContent,
    hasImg: !!b.querySelector('.canvas-wrap img'),
  })),
)
console.log('✓ 面板：', JSON.stringify(panes))

/** 预览区（第 2 栏）形变图与原图的像素差异 */
const previewDiff = () =>
  page.evaluate(() => {
    const box = document.querySelectorAll('.canvas-duo .canvas-box')[1]
    const wc = box.querySelector('canvas.warp')
    const img = box.querySelector('.canvas-wrap img')
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

/** 主图显示状态：img 是否可见、warp 层是否被隐藏 */
const mainState = () =>
  page.evaluate(() => {
    const box = document.querySelectorAll('.canvas-duo .canvas-box')[0]
    const img = box.querySelector('.canvas-wrap img')
    const wc = box.querySelector('canvas.warp')
    return {
      imgVisible: getComputedStyle(img).visibility === 'visible',
      warpDisplay: getComputedStyle(wc).display,
    }
  })

// ---- 2. 主图在任何视图下都应是原图 ----
const s0 = await mainState()
console.log('✓ 未调整时主图：', JSON.stringify(s0))

const setNum = (labelText, value, paneIndex = 0) =>
  page.evaluate(
    ({ labelText, value }) => {
      const rows = [...document.querySelectorAll('.slider-row')]
      const row = rows.find((r) => r.querySelector('.slider-label')?.textContent === labelText)
      if (!row) return false
      const num = row.querySelector('input[type=number]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(num, String(value))
      num.dispatchEvent(new Event('input', { bubbles: true }))
      num.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return true
    },
    { labelText, value },
  )

// 选 8 号点（下巴尖），垂直 +30
await page.selectOption('.point-picker select >> nth=1', '8')
await page.waitForTimeout(300)
const before = await previewDiff()
await setNum('垂直位移', 30)
await page.waitForTimeout(700)
const after = await previewDiff()
console.log(`✓ 点位调整前预览差异 ${JSON.stringify(before)} → 调整后 ${JSON.stringify(after)}`)

// 切到「调整」视图，主图仍应是原图
await page.getByRole('button', { name: '调整' }).click()
await page.waitForTimeout(500)
const sAdj = await mainState()
const afterSwitch = await previewDiff()
console.log('✓ 切到「调整」视图后主图：', JSON.stringify(sAdj))
console.log('  预览区差异仍保持：', JSON.stringify(afterSwitch))

// ---- 3. 预览区无叠加层 ----
const overlayPixels = await page.evaluate(() => {
  const box = document.querySelectorAll('.canvas-duo .canvas-box')[1]
  const mc = box.querySelector('canvas.mesh')
  const oc = box.querySelector('canvas.overlay')
  if (!mc || !oc) return null
  const count = (cv) => {
    const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  }
  return { mesh: count(mc), overlay: count(oc) }
})
const mainOverlay = await page.evaluate(() => {
  const box = document.querySelectorAll('.canvas-duo .canvas-box')[0]
  const mc = box.querySelector('canvas.mesh')
  const d = mc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, mc.width, mc.height).data
  let n = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
  return n
})
console.log(`✓ 预览区叠加层像素 ${JSON.stringify(overlayPixels)}（应为 0）；主图网格层像素 ${mainOverlay}（应 > 0）`)

// ---- 4. 调整对比在「检测」视图下也有数据 ----
await page.getByRole('button', { name: '检测' }).click()
await page.waitForTimeout(500)
const deltas = await page.evaluate(() =>
  [...document.querySelectorAll('table.compare tbody tr')].map((tr) => ({
    k: tr.children[0]?.textContent,
    d: tr.children[3]?.textContent,
  })),
)
console.log('✓ 「检测」视图下的调整对比：', JSON.stringify(deltas))

await page.screenshot({ path: 'preview.png' })

console.log('')
console.log(panes.length === 2 ? '✓ 双栏布局就位' : '✗ 双栏缺失')
console.log(
  s0.imgVisible && s0.warpDisplay === 'none' && sAdj.imgVisible && sAdj.warpDisplay === 'none'
    ? '✓ 主图任何视图下都显示原图'
    : '✗ 主图被形变',
)
console.log(
  after && after.changedPct > 1 && before && before.changedPct < 0.5
    ? '✓ 预览区随点位调整实时变化'
    : '✗ 预览区未跟随',
)
console.log(
  overlayPixels && overlayPixels.mesh === 0 && overlayPixels.overlay === 0
    ? '✓ 预览区为纯净照片'
    : '✗ 预览区出现叠加层',
)
console.log(
  deltas.some((x) => x.d && x.d !== '—') ? '✓ 对比数据不依赖视图切换' : '✗ 对比数据随视图丢失',
)

await browser.close()
