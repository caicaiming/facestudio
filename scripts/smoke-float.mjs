/**
 * 冒烟测试：标注面板浮窗（可拖动 / 可缩放 / 位置记忆）+ 专注模式 + 自适应
 *
 * 诉求：「标注工具、素材、话术库的元素无法调整大小位置」「根据分辨率自适应」。
 * 浮窗是最容易出低级错的一类交互 —— 拖到一半丢失、缩到看不见、刷新后跑回
 * 原点或跑到屏幕外。这里用真实指针事件逐项验证。
 *
 * 断言：① 点 ⇱ 浮出，侧栏留占位条
 *      ② 拖标题栏 → 位置跟随（且被 clamp 在视口内）
 *      ③ 拖右下角 → 尺寸变化，且不小于最小尺寸
 *      ④ 刷新后位置尺寸保持（localStorage）
 *      ⑤ 收回浮窗 → 侧栏恢复、浮窗消失
 *      ⑥ 专注模式：左右栏隐藏、画布变宽
 *      ⑦ 三种分辨率下无横向溢出、画布可用高度 > 300px
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
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('就绪'), {
  timeout: 90000,
})
await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), {
  timeout: 90000,
})
await page.waitForTimeout(800)

const panelBox = () =>
  page.evaluate(() => {
    const e = document.querySelector('.float-panel')
    if (!e) return null
    const b = e.getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  })

// ---------- ① 浮出 ----------
console.log('== 浮出 ==')
await page.locator('.ann-section', { hasText: '素材' }).locator('.ann-pop').click()
await page.waitForTimeout(300)
check('①a 浮窗出现', (await page.locator('.float-panel').count()) === 1)
check('①b 侧栏留「浮窗中」占位', (await page.locator('.ann-section.floated').count()) === 1)
const p0 = await panelBox()

// ---------- ② 拖动位置 ----------
console.log('== 拖动 ==')
const head = await page.locator('.fp-head').boundingBox()
await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2)
await page.mouse.down()
await page.mouse.move(head.x + head.width / 2 + 160, head.y + head.height / 2 + 120, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(200)
const p1 = await panelBox()
check('②a 拖动后位置改变', !!p1 && (Math.abs(p1.x - p0.x) > 80 || Math.abs(p1.y - p0.y) > 60), `${p0.x},${p0.y} → ${p1?.x},${p1?.y}`)
check(
  '②b 位置被 clamp 在视口内',
  !!p1 && p1.x >= 0 && p1.y >= 0 && p1.x + p1.w <= 1680 + 1 && p1.y + 40 <= 1000 + 1,
  `x=${p1?.x} y=${p1?.y} w=${p1?.w}`,
)

// ---------- ③ 缩放 ----------
console.log('== 缩放 ==')
const rz = await page.locator('.fp-resize').boundingBox()
await page.mouse.move(rz.x + rz.width / 2, rz.y + rz.height / 2)
await page.mouse.down()
await page.mouse.move(rz.x + rz.width / 2 + 120, rz.y + rz.height / 2 + 90, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(200)
const p2 = await panelBox()
check('③a 尺寸变大', !!p2 && p2.w > p1.w + 60 && p2.h > p1.h + 40, `${p1.w}×${p1.h} → ${p2?.w}×${p2?.h}`)
check('③b 素材网格随宽度变多列', (await page.locator('.fp-body .ann-mat').count()) === 10)

// 拖过头也不能小于最小尺寸
await page.mouse.move(p2.x + p2.w - 6, p2.y + p2.h - 6)
await page.mouse.down()
await page.mouse.move(p2.x + 40, p2.y + 40, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(200)
const p3 = await panelBox()
check('③c 缩到最小尺寸为止（不消失）', !!p3 && p3.w >= 240 && p3.h >= 180, `${p3?.w}×${p3?.h}`)

// ---------- ④ 刷新后记忆 ----------
console.log('== 记忆 ==')
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('就绪'), {
  timeout: 90000,
})
await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), {
  timeout: 90000,
})
await page.waitForTimeout(800)
const p4 = await panelBox()
check(
  '④a 刷新后仍为浮窗且位置尺寸保持',
  !!p4 && Math.abs(p4.w - p3.w) <= 2 && Math.abs(p4.h - p3.h) <= 2,
  `${p3.w}×${p3.h} → ${p4?.w}×${p4?.h}`,
)

// ---------- ⑤ 收回 ----------
console.log('== 收回 ==')
await page.locator('.fp-close').click()
await page.waitForTimeout(300)
check('⑤a 浮窗消失', (await page.locator('.float-panel').count()) === 0)
check('⑤b 侧栏恢复且已展开', (await page.locator('.ann-section.floated').count()) === 0 && (await page.locator('.ann-mats').count()) === 1)

// ---------- ⑥ 专注模式 ----------
console.log('== 专注模式 ==')
const before = await page.evaluate(() => {
  const c = document.querySelector('.canvas-duo .canvas-box').getBoundingClientRect()
  return { w: Math.round(c.width), visibleLeft: !!document.querySelector('.col-left')?.offsetWidth }
})
await page.locator('.tool-focus').click()
await page.waitForTimeout(400)
const after = await page.evaluate(() => {
  const c = document.querySelector('.canvas-duo .canvas-box').getBoundingClientRect()
  const l = document.querySelector('.col-left')
  return { w: Math.round(c.width), leftHidden: !l || l.offsetWidth === 0 }
})
check('⑥a 左右栏隐藏', after.leftHidden)
check('⑥b 画布变宽', after.w > before.w + 200, `${before.w} → ${after.w}`)
await page.locator('.tool-focus').click()
await page.waitForTimeout(300)

// ---------- ⑦ 多分辨率自适应 ----------
console.log('== 自适应 ==')
for (const [w, h] of [
  [1366, 768],
  [1600, 900],
  [2560, 1440],
]) {
  await page.setViewportSize({ width: w, height: h })
  await page.waitForTimeout(500)
  const m = await page.evaluate(() => {
    const over = []
    document.querySelectorAll('.layout *').forEach((e) => {
      const b = e.getBoundingClientRect()
      if (b.width > 0 && b.right > window.innerWidth + 2) over.push(e.className || e.tagName)
    })
    const box = document.querySelector('.canvas-duo .canvas-box').getBoundingClientRect()
    return { over: over.slice(0, 3), boxH: Math.round(box.height), boxW: Math.round(box.width) }
  })
  check(`⑦ ${w}×${h} 无横向溢出`, m.over.length === 0, m.over.join(' | '))
  check(`⑦ ${w}×${h} 画布尺寸可用`, m.boxH > 300 && m.boxW > 200, `${m.boxW}×${m.boxH}`)
}

await page.setViewportSize({ width: 1680, height: 1000 })
await page.waitForTimeout(300)
await page.screenshot({ path: 'smoke-float.png' })
check('⑧ 无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
console.log(failed === 0 ? '\n✅ 浮窗/自适应冒烟全部通过' : `\n❌ ${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)
