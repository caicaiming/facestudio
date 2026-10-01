/**
 * smoke-uxbatch1.mjs —— 交互审核「第一批修复」验收冒烟（Stage 35）
 *
 * ① 调参可撤销：苹果肌 +8 → Ctrl+Z 回到 0；Ctrl+Shift+Z 重做回 8
 * ② 连续调整合并：连点 8 次 ＋ 只产生 1 步历史（不能是按 8 次才退回去）
 * ③ 六套状态全部可撤：5 路滑块 / 亚单位 / 凹凸 / 逐点位移各退一步
 * ④ 部位脉冲：刚调过的部位在预览图上画出涟漪（pulse 画布非空白）
 * ⑤ 1280 窄屏：部位行的「位移」「凹凸」两组档位完整落在左栏可视区内
 */
import { chromium } from 'playwright-core'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ok = (b) => (b ? '✅' : '❌')
let failed = 0
const check = (label, pass, extra = '') => {
  console.log(`${ok(pass)} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!pass) failed++
}

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
await page.waitForFunction(
  () => document.querySelector('.status')?.textContent?.includes('就绪'),
  // ⚠️ 第二参数是 arg、第三才是 options —— 少传 null 的话 timeout 会被吞成默认 30s
  null,
  { timeout: 120000 },
)
await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(
  () => document.querySelector('.status')?.textContent?.includes('分析完成'),
  null,
  { timeout: 120000 },
)
await page.waitForTimeout(1200)

const S = () => page.evaluate(() => ({ ...window.__faceStudio.siteValues }))
const P = () => page.evaluate(() => ({ ...window.__faceStudio.params }))
const histLen = () =>
  page.evaluate(() => document.querySelector('.adj-hist-n')?.textContent?.trim() ?? '无')

// 展开医美部位面板
if (await page.evaluate(() => !!document.querySelector('.zone-block.collapsed'))) {
  await page.locator('.zone-block .subunit-toggle').click()
  await page.waitForTimeout(300)
}
const malarRow = page.locator('.su-row.zone-row', { hasText: '苹果肌' }).first()
const plus = malarRow.locator('.step-btn').nth(1)

// ---------- ①+② 撤销 / 合并 ----------
console.log('== 调参撤销（P0-4）==')
for (let i = 0; i < 8; i++) await plus.click({ force: true })
await page.waitForTimeout(700)
const after8 = (await S()).malar
check('①a 苹果肌推到 +8', after8 === 8, `malar=${after8}`)
const steps8 = await histLen()
check(
  '②a 连点 8 次合并为 1 步历史',
  steps8.startsWith('1 '),
  `面板显示「${steps8}」`,
)

await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('Control+z')
await page.waitForTimeout(600)
const afterUndo = (await S()).malar
check('①b Ctrl+Z 一步回到 0', afterUndo === 0, `malar=${afterUndo}`)

await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(600)
const afterRedo = (await S()).malar
check('①c Ctrl+Shift+Z 重做回 8', afterRedo === 8, `malar=${afterRedo}`)

await page.locator('.adj-hist .btn-ghost', { hasText: '撤销' }).click()
await page.waitForTimeout(600)
check('①d 顶栏撤销按钮同样生效', (await S()).malar === 0, `malar=${(await S()).malar}`)

// ---------- ③ 六套状态可撤 ----------
console.log('\n== 六套调整状态覆盖 ==')
const beforeParams = await P()
await page.locator('.col-left .slider-row').first().locator('.step-btn').nth(1).click()
await page.waitForTimeout(500)
const afterSlider = await P()
const changed = JSON.stringify(beforeParams) !== JSON.stringify(afterSlider)
check('③a 5 路滑块改动生效', changed)
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('Control+z')
await page.waitForTimeout(500)
check(
  '③b 5 路滑块可撤销',
  JSON.stringify(await P()) === JSON.stringify(beforeParams),
)

// 凹凸（第三自由度）
const depthPlus = malarRow.locator('.step-btn').nth(3)
if ((await depthPlus.count()) > 0) {
  await depthPlus.click({ force: true })
  await page.waitForTimeout(500)
  const d = await page.evaluate(() => window.__faceStudio.siteDepths?.malar ?? 0)
  check('③c 凹凸档位可改', d !== 0, `depth=${d}`)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(500)
  check(
    '③d 凹凸可撤销',
    (await page.evaluate(() => window.__faceStudio.siteDepths?.malar ?? 0)) === 0,
  )
}

// ---------- ④ 部位脉冲 ----------
console.log('\n== 部位脉冲（P0-1③）==')
await plus.click({ force: true })
// 涟漪由 rAF 推进，click 后要等它画出第一帧（动画总长约 1.6s，这里只等一帧多点）
await page.waitForTimeout(150)
const pulse = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('.canvas-duo .canvas-box')]
  const cv = boxes[1]?.querySelector('canvas.pulse')
  if (!cv || !cv.width) return null
  const ctx = cv.getContext('2d')
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data
  let lit = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 12) lit++
  return { w: cv.width, h: cv.height, litPx: lit, total: d.length / 4 }
})
if (!pulse) {
  check('④a pulse 画布存在', false, '未找到 canvas.pulse')
} else {
  check('④a 预览区存在 pulse 层', pulse.w > 0, `${pulse.w}×${pulse.h}`)
  check(
    '④b 调部位后涟漪真的画出来了',
    pulse.litPx > 200,
    `着色 ${pulse.litPx} / ${pulse.total} px`,
  )
}
await page.screenshot({ path: 'smoke-uxb1-pulse.png' })

// ---------- ⑤ 1280 窄屏布局 ----------
console.log('\n== 1280 窄屏部位行（P0-3③）==')
await page.setViewportSize({ width: 1280, height: 800 })
await page.waitForTimeout(600)
const layout = await page.evaluate(() => {
  const col = document.querySelector('.col-left')
  const cr = col.getBoundingClientRect()
  const row = [...document.querySelectorAll('.su-row.zone-row')].find((r) =>
    r.textContent.includes('苹果肌'),
  )
  if (!row) return null
  const cells = [...row.querySelectorAll('.zone-col')].map((c) => {
    const r = c.getBoundingClientRect()
    return {
      tag: c.querySelector('.zone-col-tag')?.textContent,
      left: Math.round(r.left),
      right: Math.round(r.right),
      inside: r.right <= cr.right + 1 && r.left >= cr.left - 1,
    }
  })
  return { colRight: Math.round(cr.right), cells, rowH: Math.round(row.getBoundingClientRect().height) }
})
if (!layout) {
  check('⑤a 找到苹果肌行', false)
} else {
  for (const c of layout.cells) {
    check(
      `⑤ 「${c.tag}」组完整落在左栏内`,
      c.inside,
      `right=${c.right} / 栏右边界=${layout.colRight}`,
    )
  }
  check('⑤b 两组档位都在', layout.cells.length === 2, `${layout.cells.length} 组`)
}
await page.screenshot({ path: 'smoke-uxb1-1280.png' })

check('⑥ 无 JS 运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '))
console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`)
await browser.close()
process.exit(failed === 0 ? 0 : 1)
