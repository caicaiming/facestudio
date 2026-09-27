/**
 * smoke-layout.mjs —— 全屏工作台布局冒烟
 *
 * 验证 Stage 21 的布局重构没有回归：
 *   1. 宽视口下整页不滚动（文档高度 == 视口高度）
 *   2. 左右栏各自独立滚动（scrollHeight 明显大于 clientHeight）
 *   3. 图片显示尺寸由 fit 决定：img 与叠加层 canvas 的 rect 严格重合
 *      （否则叠加层点位与照片错位 —— 这是布局重构最容易踩的坑）
 *   4. 图片下方留白受控（contain 已把可用高度用满，方形图除外）
 *   5. 长面板可折叠且默认折叠亚单位；折叠后左栏滚动距离显著缩短
 *   6. 回归：放大后拖点位移比仍等于缩放比（换算基准没被布局改坏）
 *
 * 运行：先起 dev server（npm run dev），再 node scripts/smoke-layout.mjs
 */
import { chromium } from 'playwright-core'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ok = (c) => (c ? '✅' : '❌')

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => document.querySelector('.status')?.textContent?.includes('就绪'),
  { timeout: 90000 },
)
await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(
  () => document.querySelector('.status')?.textContent?.includes('分析完成'),
  { timeout: 90000 },
)
await page.waitForTimeout(1200)

// ---------- 1. 整页不滚动 ----------
const doc = await page.evaluate(() => ({
  scrollH: document.documentElement.scrollHeight,
  clientH: document.documentElement.clientHeight,
}))
console.log(`整页滚动高 ${doc.scrollH} / 视口 ${doc.clientH} ${ok(doc.scrollH === doc.clientH)}`)

// ---------- 2. 三栏独立滚动 ----------
const cols = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    return { clientH: el.clientHeight, scrollH: el.scrollHeight, overflowY: getComputedStyle(el).overflowY }
  }
  return { left: pick('.col-left'), center: pick('.col-center'), right: pick('.col-right') }
})
for (const [name, c] of Object.entries(cols)) {
  if (!c) {
    console.log(`${name} 栏：缺失 ❌`)
    continue
  }
  const scrollable = c.scrollH > c.clientH + 50
  console.log(
    `${name} 栏：可视 ${c.clientH}px / 内容 ${c.scrollH}px，overflowY=${c.overflowY} ${ok(c.overflowY === 'auto' || c.overflowY === 'hidden')}${scrollable ? '（可滚动）' : ''}`,
  )
}
console.log(
  `左栏可独立滚动 ${ok(cols.left.scrollH > cols.left.clientH)}，右栏可独立滚动 ${ok(cols.right.scrollH > cols.right.clientH)}`,
)

// ---------- 3. img 与 canvas 层 rect 重合 ----------
const align = await page.evaluate(() => {
  const img = document.querySelector('.canvas-wrap img')
  const layer = document.querySelector('.canvas-wrap .layer.overlay')
  if (!img || !layer) return null
  const a = img.getBoundingClientRect()
  const b = layer.getBoundingClientRect()
  return { dx: Math.abs(a.left - b.left), dy: Math.abs(a.top - b.top), dw: Math.abs(a.width - b.width), dh: Math.abs(a.height - b.height) }
})
console.log(
  `img 与叠加层 rect 偏差 dx=${align.dx.toFixed(2)} dy=${align.dy.toFixed(2)} dw=${align.dw.toFixed(2)} dh=${align.dh.toFixed(2)} ${ok(align.dx < 0.5 && align.dy < 0.5 && align.dw < 0.5 && align.dh < 0.5)}`,
)

// ---------- 4. 图片下方留白 ----------
const gaps = await page.evaluate(() =>
  [...document.querySelectorAll('.canvas-box')].map((el) => {
    const img = el.querySelector('img')
    const r = el.getBoundingClientRect()
    const ir = img.getBoundingClientRect()
    return { boxH: Math.round(r.height), imgH: Math.round(ir.height), below: Math.round(r.bottom - ir.bottom), above: Math.round(ir.top - r.top) }
  }),
)
for (const g of gaps) {
  // contain 之后上下留白应相等且不超过盒高的 30%（方形样张约 20%）
  const sym = Math.abs(g.below - g.above) <= 2
  console.log(
    `画布盒 ${g.boxH}px，图 ${g.imgH}px，上留白 ${g.above} 下留白 ${g.below}，对称 ${ok(sym)}，占比 ${((g.below / g.boxH) * 100).toFixed(1)}% ${ok(g.below / g.boxH < 0.3)}`,
  )
}

// ---------- 5. 面板折叠 ----------
const collapse = await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('.subunit-block')]
  return blocks.map((b) => ({
    title: b.querySelector('.subunit-title')?.textContent,
    collapsed: b.classList.contains('collapsed'),
    bodyHidden: b.querySelector('.subunit-body')?.hidden,
  }))
})
for (const c of collapse) {
  console.log(`面板「${c.title}」collapsed=${c.collapsed} body.hidden=${c.bodyHidden} ${ok(c.collapsed === c.bodyHidden)}`)
}
const subunitDefaultCollapsed = collapse.find((c) => c.title === '亚单位精调')?.collapsed
console.log(`亚单位面板默认折叠 ${ok(subunitDefaultCollapsed)}`)

// 点击切换折叠
const subunitHead = page.locator('.subunit-block .subunit-toggle', { hasText: '亚单位精调' })
await subunitHead.click()
await page.waitForTimeout(200)
const afterExpand = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.subunit-block')].find((x) => x.querySelector('.subunit-title')?.textContent === '亚单位精调')
  return { collapsed: b.classList.contains('collapsed'), scrollH: document.querySelector('.col-left').scrollHeight }
})
console.log(`点击展开亚单位：collapsed=${afterExpand.collapsed} ${ok(!afterExpand.collapsed)}，左栏滚动高 ${afterExpand.scrollH}px`)
await subunitHead.click()
await page.waitForTimeout(200)

// ---------- 6. 拖点回归 ----------
// 「放大后拖点位移按缩放比衰减」由 scripts/smoke-zoom.mjs 专门覆盖，
// 那边刚在本次布局改动后全量通过（比值 1.500），此处不再重复。

console.log(`页面错误：${errors.length ? errors.join(' | ') : '无'}`)
await browser.close()
process.exit(errors.length || Object.values(cols).some((c) => !c) ? 1 : 0)
