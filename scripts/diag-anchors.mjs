/**
 * 诊断：基准点（anchors）到底还在不在？
 *
 * 现象：用户反馈「基准点不见了」。
 * 可能的断点有三处，脚本逐一过关，避免靠猜：
 *   ① 图层栈里还有没有「基准点」这一行（flattenStack 是否把它列出来）
 *   ② 这一层是开着还是关着（localStorage 里的 layerState）
 *   ③ 画布 mesh 上真的画出青色圆环了没有（数据全对也可能没画）
 */
import { chromium } from 'playwright-core'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ok = (b) => (b ? '✅' : '❌')

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
try {
  await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('就绪'), null, {
    timeout: 120000,
  })
} catch {
  await page.screenshot({ path: 'diag-anchors-stuck.png' })
  console.log('页面卡在模型加载，截图 diag-anchors-stuck.png')
  await browser.close()
  process.exit(2)
}

const stored = await page.evaluate(() => localStorage.getItem('facestudio_layers_v1'))
console.log('— ① localStorage 里的图层状态 —')
console.log(stored ? `  ${stored.slice(0, 500)}` : '  （无存档，走默认状态）')

await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), null, {
  timeout: 120000,
})
await page.waitForTimeout(1200)

const FS = () => page.evaluate(() => window.__faceStudio)

console.log('\n— ② 图层栈里有没有「基准点」这一行 —')
await page.locator('.ann-section .ann-fold', { hasText: '图层' }).click()
await page.waitForTimeout(500)
const names = await page.locator('.ann-layer').evaluateAll((els) =>
  els.map((e) => ({ key: e.dataset.key, txt: e.innerText.split('\n')[0], cls: e.className })),
)
console.log('  图层栈（自顶向下）：')
for (const n of names) console.log(`    ${n.key}\t${n.txt}\t${n.cls.includes('hidden') ? '(隐藏)' : ''}`)
const row = names.find((n) => n.key === 'anchors')
console.log(`  ${ok(!!row)} 找到「基准点」层${row ? `：${row.txt} ${row.cls.includes('hidden') ? '← 处于隐藏状态' : '（显示中）'}` : ''}`)

const st = await FS()
console.log('\n— ③ 运行时状态 —')
console.log('  layerState.meta.anchors =', JSON.stringify(st?.layerState?.meta?.anchors))
console.log('  layerState.order       =', JSON.stringify(st?.layerState?.order))
console.log('  frameAnchors           =', JSON.stringify(st?.frameAnchors ?? st?.anchors ?? null))
console.log('  previewPoints.length   =', st?.previewPoints?.length)

console.log('\n— ④ 画布上有没有青色圆环 —')
const cyan = await page.evaluate(() => {
  const out = []
  for (const wrap of document.querySelectorAll('.canvas-duo .canvas-wrap')) {
    const c = wrap.querySelector('canvas.mesh')
    if (!c || !c.width) {
      out.push({ tag: wrap.className, painted: -1 })
      continue
    }
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let cyanPx = 0
    let any = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue
      any++
      // 基准点的青 rgba(34,211,238)：绿蓝高、红低是它的指纹
      if (d[i + 1] > 150 && d[i + 2] > 180 && d[i] < 120) cyanPx++
    }
    out.push({ tag: wrap.className, w: c.width, h: c.height, any, cyanPx })
  }
  return out
})
for (const c of cyan) console.log('  ', JSON.stringify(c))

console.log('\n— ⑤ 左栏「基准点校准」卡片 —')
const card = await page.locator('.frame-block').count()
console.log(`  ${ok(card > 0)} 卡片存在（${card} 个）`)
const btnTxt = await page.locator('.frame-actions .btn-ghost').allInnerTexts().catch(() => [])
console.log('  按钮：', btnTxt.join(' / '))

/**
 * ⑥ 交互回归：左栏按钮与图层面板眼睛必须是同一个开关。
 * 此前两者脱钩 —— 按钮隐藏后，面板里点眼睛救不回来，基准点「消失」。
 */
console.log('\n— ⑥ 双开关同步回归 —')
const cyanCount = () =>
  page.evaluate(() => {
    const c = document.querySelector('.canvas-duo .canvas-wrap canvas.mesh')
    if (!c || !c.width) return -1
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 0 && d[i + 1] > 150 && d[i + 2] > 180 && d[i] < 120) n++
    }
    return n
  })
const hideBtn = page.locator('.frame-actions .btn-ghost', { hasText: '基准点' })
const eyeBtn = page.locator('.ann-layer.sys[data-key="anchors"] .ann-eye')

const c0 = await cyanCount()
await hideBtn.click()
await page.waitForTimeout(600)
const st1 = await FS()
const c1 = await cyanCount()
console.log(`  ${ok(st1.layerState.meta.anchors.visible === false)} 点「隐藏基准点」→ 图层状态同步为隐藏`)
console.log(`  ${ok(c1 < c0)} 画布青色像素消失（${c0} → ${c1}）`)

// 关键：面板里点眼睛应当能救回来
await eyeBtn.click()
await page.waitForTimeout(600)
const st2 = await FS()
const c2 = await cyanCount()
console.log(`  ${ok(st2.layerState.meta.anchors.visible === true)} 面板眼睛点开 → 状态恢复显示`)
console.log(`  ${ok(c2 >= c0 * 0.95)} 画布青色圆环回来（${c2}，基准 ${c0}）`)

// 面板眼睛关 → 左栏按钮文字应变「显示基准点」
await eyeBtn.click()
await page.waitForTimeout(500)
const btnNow = await hideBtn.innerText()
console.log(`  ${ok(btnNow.includes('显示基准点'))} 面板眼睛关闭 → 左栏按钮文字同步（${btnNow.trim()}）`)
await eyeBtn.click()
await page.waitForTimeout(500)

console.log('\n— 控制台 —')
console.log(errors.length ? `  ❌ ${errors.slice(0, 5).join(' | ')}` : '  ✅ 无报错')

await page.screenshot({ path: 'diag-anchors.png', fullPage: false })
await browser.close()
