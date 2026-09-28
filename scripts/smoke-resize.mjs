/**
 * 冒烟测试：标注元素的缩放 / 旋转（选中即出控制点）
 *
 * 背景：此前只有素材能用键盘 [ ] 缩放，画出来的箭头 / 框 / 文字一旦落笔就
 * 「大小定死」，讲方案时想把箭头拉长一点只能删了重画。这里在真实浏览器里
 * 验证：拖角手柄改大小、拖旋转手柄转向、按钮与快捷键三条路径都生效，
 * 且等比缩放不会把素材拉变形、撤销能回到原尺寸。
 *
 * 断言：① 拖 se 手柄放大箭头：长度变长、起点（对侧锚点）不动
 *      ② 撤销回到原长度
 *      ③ 素材拖角等比缩放：w/h 比例不变
 *      ④ 拖旋转手柄：rot 改变（Shift 吸附 15°）
 *      ⑤ 快捷键 ] / . 对文字同样有效（字号变大 / 文字转向）
 *      ⑥ 图层面板的 ＋ / ↻ 按钮生效
 *      ⑦ 橡皮工具下手柄不拦截：点在手柄上照样删掉该层
 */
import { chromium } from 'playwright-core'
import path from 'node:path'

import { layerBox, boxToNatural } from '../src/annotations.js'

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
await page.waitForTimeout(1000)

const geom = () =>
  page.evaluate(() => {
    const img = document.querySelector('.canvas-duo .canvas-wrap img')
    return { w: img.naturalWidth, h: img.naturalHeight, disp: img.getBoundingClientRect().width }
  })

/** 自然坐标 → 屏幕坐标 */
const toScreen = (nat) =>
  page.evaluate((p) => {
    const img = document.querySelector('.canvas-duo .canvas-wrap img')
    const r = img.getBoundingClientRect()
    return {
      x: r.left + (p.x / img.naturalWidth) * r.width,
      y: r.top + (p.y / img.naturalHeight) * r.height,
    }
  }, nat)

const layers = () => page.evaluate(() => window.__faceStudio.ann.layers)
const selId = () => page.evaluate(() => window.__faceStudio.ann.sel)
const selLayer = async () => {
  const L = await layers()
  const id = await selId()
  return L.find((x) => x.id === id) || null
}

async function dragNat(from, to, steps = 12, mods = []) {
  const a = await toScreen(from)
  const b = await toScreen(to)
  for (const m of mods) await page.keyboard.down(m)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (let n = 1; n <= steps; n++) {
    await page.mouse.move(a.x + ((b.x - a.x) * n) / steps, a.y + ((b.y - a.y) * n) / steps)
  }
  await page.mouse.up()
  for (const m of mods) await page.keyboard.up(m)
  await page.waitForTimeout(180)
}

/** 手柄的自然坐标（旋转手柄的抬升按当前缩放折算：26 屏幕像素） */
async function handleNat(id) {
  const it = await selLayer()
  const G = await geom()
  const box = layerBox(it)
  const lift = 26 * (G.w / G.disp)
  if (id === 'rot') return boxToNatural(box, 0, -box.h / 2 - lift)
  const D = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1], e: [1, 0] }[id]
  return boxToNatural(box, (D[0] * box.w) / 2, (D[1] * box.h) / 2)
}

const G = await geom()

// ---------- ① 箭头：拖 se 手柄放大 ----------
console.log('== 箭头缩放 ==')
await page.locator('.seg button', { hasText: '标注' }).click()
await page.waitForTimeout(200)
await page.locator('.ann-tool', { hasText: '箭头' }).click()
await page.waitForTimeout(150)

const a1 = { x: G.w * 0.32, y: G.h * 0.6 }
const b1 = { x: G.w * 0.46, y: G.h * 0.5 }
await dragNat(a1, b1, 10)
let L = await layers()
check('①a 箭头入栈并选中', L.length === 1 && L[0].kind === 'arrow' && (await selId()) === L[0].id)

const len0 = Math.hypot(L[0].x2 - L[0].x1, L[0].y2 - L[0].y1)
const x1_0 = L[0].x1
const se = await handleNat('se')
await dragNat(se, { x: se.x + G.w * 0.08, y: se.y + G.h * 0.06 })
L = await layers()
const len1 = Math.hypot(L[0].x2 - L[0].x1, L[0].y2 - L[0].y1)
check('①b 拖角手柄后变长', len1 > len0 * 1.15, `${len0.toFixed(0)} → ${len1.toFixed(0)}px`)
check(
  '①c 对侧锚点不动（左上角固定）',
  Math.abs(L[0].x1 - x1_0) < G.w * 0.02,
  `x1 ${x1_0.toFixed(0)} → ${L[0].x1.toFixed(0)}`,
)
check('①d 线宽同步放大', L[0].width > 10, `${L[0].width?.toFixed(1)}px`)

// ---------- ② 撤销回原尺寸 ----------
console.log('== 撤销 ==')
await page.keyboard.press('Control+z')
await page.waitForTimeout(250)
L = await layers()
const lenU = L.length ? Math.hypot(L[0].x2 - L[0].x1, L[0].y2 - L[0].y1) : -1
check('② 撤销回到原长度', Math.abs(lenU - len0) < 1, `${lenU.toFixed(0)} vs ${len0.toFixed(0)}`)

// ---------- ③ 素材：等比缩放不变形 ----------
console.log('== 素材缩放 ==')
await page.locator('.ann-section .ann-fold', { hasText: '素材' }).click()
await page.waitForTimeout(250)
await page.locator('.ann-mat').first().click()
await page.waitForTimeout(500)
L = await layers()
const mat = L[L.length - 1]
check('③a 素材入栈', mat?.kind === 'material', `${mat?.name}`)
const r0 = mat.w / mat.h
const mse = await handleNat('se')
await dragNat(mse, { x: mse.x + G.w * 0.06, y: mse.y + G.h * 0.06 })
let mat2 = await selLayer()
const r1 = mat2.w / mat2.h
check('③b 角手柄等比缩放', mat2.w > mat.w * 1.1 && Math.abs(r1 - r0) < 0.02, `${mat.w}→${mat2.w.toFixed(0)}，比例 ${r0.toFixed(3)}→${r1.toFixed(3)}`)

// ---------- ④ 旋转手柄 ----------
console.log('== 旋转 ==')
const rp = await handleNat('rot')
const box = layerBox(mat2)
const rad = Math.max(box.w, box.h) * 0.6
await dragNat(rp, { x: box.cx + rad, y: box.cy + rad }, 12, ['Shift'])
const mat3 = await selLayer()
check('④ 拖旋转手柄（Shift 吸附 15°）', mat3.rot % 15 === 0 && mat3.rot !== mat2.rot, `rot=${mat3.rot}°`)

// ---------- ⑤ 快捷键对文字同样有效 ----------
console.log('== 文字缩放 / 旋转 ==')
await page.locator('.ann-tool', { hasText: '文字' }).click()
const tAt = { x: G.w * 0.18, y: G.h * 0.22 }
const st = await toScreen(tAt)
await page.mouse.click(st.x, st.y)
await page.waitForTimeout(200)
await page.locator('.ann-text-input').fill('鼻基底凹陷')
await page.keyboard.press('Enter')
await page.waitForTimeout(250)
await page.locator('.ann-tool', { hasText: '移动' }).click() // 移动工具：按空白处不会新起笔画
await page.waitForTimeout(150)
let txt = await selLayer()
check('⑤a 文字入栈并选中', txt?.kind === 'text', `${txt?.text}`)
const f0 = txt.font
await page.keyboard.press(']')
await page.waitForTimeout(200)
txt = await selLayer()
check('⑤b ] 放大字号', txt.font > f0 * 1.05, `${f0} → ${txt.font.toFixed(0)}`)
await page.keyboard.press('.')
await page.waitForTimeout(200)
txt = await selLayer()
check('⑤c . 旋转文字', (txt.rot || 0) === 15, `rot=${txt.rot}`)

// ---------- ⑥ 图层面板按钮 ----------
console.log('== 图层面板按钮 ==')
await page.locator('.ann-section .ann-fold', { hasText: '图层' }).click()
await page.waitForTimeout(250)
const f1 = (await selLayer()).font
await page.locator('.ann-sel-bar button[title^="放大"]').click()
await page.waitForTimeout(200)
const f2 = (await selLayer()).font
check('⑥a ＋ 按钮放大', f2 > f1 * 1.05, `${f1.toFixed(0)} → ${f2.toFixed(0)}`)
await page.locator('.ann-sel-bar button[title^="顺时针"]').click()
await page.waitForTimeout(200)
check('⑥b ↻ 按钮旋转', (await selLayer()).rot === 30, `rot=${(await selLayer()).rot}`)

// ---------- ⑦ 橡皮下手柄不拦截 ----------
console.log('== 橡皮 ==')
await page.locator('.ann-tool', { hasText: '橡皮' }).click()
await page.waitForTimeout(150)
const before = (await layers()).length
const eh = await handleNat('se')
const es = await toScreen(eh)
await page.mouse.click(es.x, es.y)
await page.waitForTimeout(250)
check('⑦ 橡皮工具下手柄不拦截（点在手柄上照删）', (await layers()).length === before - 1, `${before} → ${(await layers()).length}`)

// ---------- ⑧ 无报错 ----------
check('⑧ 无控制台报错', errors.length === 0, errors.slice(0, 2).join(' | '))

await page.screenshot({ path: 'smoke-resize.png' })
await browser.close()
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)
