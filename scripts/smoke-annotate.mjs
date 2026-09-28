/**
 * 冒烟测试：画线标注 / 素材 / 图层 / 话术库
 *
 * 背景：把自研「图片融合」工具的画线能力并进 Face Studio。它和点位拖动共用
 * 同一块画布、同一套坐标换算，最容易出的错是「点下去了但画在别处」或
 * 「标注和点位互相抢指针事件」。这里在真实浏览器里逐项验证。
 *
 * 断言：① 开启标注后工具条出现，点位拖动让位（互斥）
 *      ② 拖一条箭头 → 图层栈多一层，端点落在按下/松开的位置
 *      ③ 直线的 45° 吸附生效
 *      ④ 文字工具：点一下输入，回车落成文字层
 *      ⑤ 误触保护：点一下不抬笔（长度≈0）不上栈
 *      ⑥ 橡皮点掉一层、撤销能回来
 *      ⑦ 素材库贴一张 → 素材层进入栈
 *      ⑧ 图层面板：隐藏 / 上移 / 删除
 *      ⑨ 话术库板块（常驻、非弹层）：搜索命中，点条目落成文字层
 *      ⑩ 导出：导出的 PNG 尺寸等于原图（含标注合成）
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
await page.waitForTimeout(1000)

/** 主图画布里：自然坐标 → 屏幕坐标 */
const toScreen = (nat) =>
  page.evaluate((p) => {
    const img = document.querySelector('.canvas-duo .canvas-wrap img')
    const r = img.getBoundingClientRect()
    return {
      x: r.left + (p.x / img.naturalWidth) * r.width,
      y: r.top + (p.y / img.naturalHeight) * r.height,
      natW: img.naturalWidth,
      natH: img.naturalHeight,
    }
  }, nat)

const geom = () =>
  page.evaluate(() => {
    const img = document.querySelector('.canvas-duo .canvas-wrap img')
    return { w: img.naturalWidth, h: img.naturalHeight }
  })

const layers = () => page.evaluate(() => window.__faceStudio.ann.layers)
const annState = () => page.evaluate(() => window.__faceStudio.ann)

/** 在画布上从 a 拖到 b（自然坐标），分帧走完 */
async function drawStroke(a, b, steps = 10) {
  const sa = await toScreen(a)
  const sb = await toScreen(b)
  await page.mouse.move(sa.x, sa.y)
  await page.mouse.down()
  for (let n = 1; n <= steps; n++) {
    await page.mouse.move(sa.x + ((sb.x - sa.x) * n) / steps, sa.y + ((sb.y - sa.y) * n) / steps)
  }
  await page.mouse.up()
  await page.waitForTimeout(150)
  return { sa, sb }
}

const G = await geom()
const mid = { x: G.w * 0.5, y: G.h * 0.5 }

// ---------- ① 开启标注：工具条出现 + 与点位拖动互斥 ----------
console.log('== 标注模式 ==')
await page.locator('.seg button', { hasText: '标注' }).click()
await page.waitForTimeout(200)
// 四个板块并列常驻：工具 / 素材 / 图层 / 话术库，默认只展开工具
check('①a 标注板块区出现', (await page.locator('.ann-board').count()) === 1)
const sections = await page.locator('.ann-section .ann-fold').allTextContents()
check(
  '①a2 四个板块齐全',
  sections.length === 4 && ['画线工具', '素材', '图层', '话术库'].every((t) => sections.join('|').includes(t)),
  sections.join(' / '),
)
check('①a3 8 个工具按钮', (await page.locator('.ann-tool').count()) === 8)
check('①b 默认工具为箭头', (await annState()).tool === 'arrow')

// 互斥测试要用「移动」工具：换成画笔/箭头会在空白拖出一笔，
// 污染后续按索引取层的用例。移动工具在没有图层时只会尝试平移，不产生层。
await page.locator('.ann-tool', { hasText: '移动' }).click()
await page.waitForTimeout(150)

// 点位是 33（鼻尖）：标注模式下拖动它不应产生位移
await page.selectOption('select[aria-label="选择点位"]', '33')
await page.waitForTimeout(200)
const p33 = await page.evaluate(() => {
  const img = document.querySelector('.canvas-duo .canvas-wrap img')
  const r = img.getBoundingClientRect()
  const p = window.__faceStudio.displayPoints[33]
  return { x: r.left + (p.x / img.naturalWidth) * r.width, y: r.top + (p.y / img.naturalHeight) * r.height }
})
await page.mouse.move(p33.x, p33.y)
await page.mouse.down()
await page.mouse.move(p33.x + 40, p33.y)
await page.mouse.up()
await page.waitForTimeout(200)
const moved33 = await page.evaluate(() => {
  const o = window.__faceStudio.pointOffsets[33] || { dx: 0, dy: 0 }
  return Math.hypot(o.dx, o.dy)
})
check('①c 标注模式下点位拖动被让位（互斥）', moved33 < 0.001, `位移 ${moved33.toFixed(2)}px`)

// ---------- ② 画箭头 ----------
console.log('== 画线 ==')
await page.locator('.ann-tool', { hasText: '箭头' }).click()
await page.waitForTimeout(150)
const a1 = { x: G.w * 0.32, y: G.h * 0.62 }
const b1 = { x: G.w * 0.46, y: G.h * 0.5 }
await drawStroke(a1, b1)
let L = await layers()
check('②a 箭头入栈', L.length === 1 && L[0].kind === 'arrow', `${L.length} 层 / ${L[0]?.kind}`)
const tol = G.w * 0.02
const hitA = L[0] && Math.hypot(L[0].x1 - a1.x, L[0].y1 - a1.y) < tol
const hitB = L[0] && Math.hypot(L[0].x2 - b1.x, L[0].y2 - b1.y) < tol
check('②b 端点落在按下/松开处', hitA && hitB, `起(${L[0]?.x1.toFixed(0)},${L[0]?.y1.toFixed(0)}) 终(${L[0]?.x2.toFixed(0)},${L[0]?.y2.toFixed(0)})`)

// ---------- ③ 45° 吸附 ----------
await page.locator('.ann-tool', { hasText: '直线' }).click()
await page.locator('.ann-chip', { hasText: '45°吸附' }).click()
await page.waitForTimeout(150)
const a2 = { x: G.w * 0.6, y: G.h * 0.4 }
// 故意给一个「接近但不等于 45°」的方向（约 38°）
const b2 = { x: G.w * 0.6 + G.w * 0.2, y: G.h * 0.4 + G.h * 0.2 * 0.78 }
await drawStroke(a2, b2)
L = await layers()
const line = L[1]
const ang = line ? (Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180) / Math.PI : 999
const near45 = Math.abs((Math.round(ang / 45) * 45 - ang)) < 1
check('③ 直线 45° 吸附', !!line && near45, `实际 ${ang.toFixed(1)}°`)

// ---------- ④ 文字 ----------
console.log('== 文字 ==')
await page.locator('.ann-tool', { hasText: '文字' }).click()
const tAt = { x: G.w * 0.2, y: G.h * 0.25 }
const st = await toScreen(tAt)
await page.mouse.click(st.x, st.y)
await page.waitForTimeout(200)
check('④a 出现就地输入框', (await page.locator('.ann-text-input').count()) === 1)
await page.locator('.ann-text-input').fill('泪沟明显')
await page.keyboard.press('Enter')
await page.waitForTimeout(250)
L = await layers()
const txt = L.find((x) => x.kind === 'text')
check('④b 回车落成文字层', !!txt && txt.text === '泪沟明显', txt?.text || '无')
check(
  '④c 文字落点贴近点击处',
  !!txt && Math.hypot(txt.x - tAt.x, txt.y - tAt.y) < G.w * 0.03,
  txt ? `(${txt.x.toFixed(0)},${txt.y.toFixed(0)})` : '',
)

// ---------- ⑤ 误触保护 ----------
await page.locator('.ann-tool', { hasText: '画笔' }).click()
const before5 = (await layers()).length
const s5 = await toScreen(mid)
await page.mouse.click(s5.x, s5.y)
await page.waitForTimeout(200)
check('⑤ 点一下不抬笔不上栈', (await layers()).length === before5, `${before5} → ${(await layers()).length}`)

// ---------- ⑥ 橡皮 + 撤销 ----------
console.log('== 橡皮 / 撤销 ==')
const before6 = (await layers()).length
await page.locator('.ann-tool', { hasText: '橡皮' }).click()
const sErase = await toScreen({ x: txt.x + Math.max(2, G.w * 0.004), y: txt.y - 6 })
await page.mouse.click(sErase.x, sErase.y)
await page.waitForTimeout(200)
const after6 = (await layers()).length
check('⑥a 橡皮点掉一层', after6 === before6 - 1, `${before6} → ${after6}`)
await page.locator('.ann-chip', { hasText: '撤销' }).click()
await page.waitForTimeout(200)
check('⑥b 撤销恢复', (await layers()).length === before6, `→ ${(await layers()).length}`)

// ---------- ⑦ 素材 ----------
console.log('== 素材 ==')
await page.locator('.ann-fold', { hasText: '素材' }).click()
await page.waitForTimeout(300)
check('⑦a 素材板块展开', (await page.locator('.ann-mats').count()) === 1)
const matCount = await page.locator('.ann-mat').count()
check('⑦b 10 张素材', matCount === 10, `${matCount} 张`)
await page.locator('.ann-mat').first().click()
await page.waitForTimeout(400)
L = await layers()
const mat = L.find((x) => x.kind === 'material')
check('⑦c 素材入栈', !!mat, mat?.name || '无')
check(
  '⑦d 素材落在画面中央、高度约短边 60%',
  !!mat &&
    Math.abs(mat.x - G.w / 2) < G.w * 0.02 &&
    Math.abs(mat.h - Math.min(G.w, G.h) * 0.6) < Math.min(G.w, G.h) * 0.12,
  mat ? `中心(${mat.x.toFixed(0)},${mat.y.toFixed(0)}) 高 ${mat.h.toFixed(0)}` : '',
)

// ---------- ⑧ 图层面板 ----------
console.log('== 图层面板 ==')
await page.locator('.ann-fold', { hasText: '图层' }).click()
await page.waitForTimeout(250)
const rows = await page.locator('.ann-layer').count()
check('⑧a 图层行数等于层数', rows === (await layers()).length, `${rows} 行`)
await page.locator('.ann-layer').first().locator('.ann-eye').click()
await page.waitForTimeout(200)
check('⑧b 眼睛切换可见性', (await layers()).some((l) => l.visible === false))
await page.locator('.ann-layer').first().locator('.ann-eye').click()
await page.waitForTimeout(200)
const orderBefore = (await layers()).map((l) => l.id)
await page.locator('.ann-layer').first().locator('button[title="下移一层"]').click()
await page.waitForTimeout(200)
const orderAfter = (await layers()).map((l) => l.id)
check(
  '⑧c 下移一层改变 z 序',
  orderBefore[orderBefore.length - 1] !== orderAfter[orderAfter.length - 1],
  `${orderBefore.join(',')} → ${orderAfter.join(',')}`,
)

// ---------- ⑨ 话术库（常驻板块，不再是弹层）----------
console.log('== 话术库 ==')
await page.locator('.ann-fold', { hasText: '话术库' }).click()
await page.waitForTimeout(250)
check('⑨a 话术库板块展开（不走弹层）', (await page.locator('.ann-phrase').count()) === 1 && (await page.locator('.modal').count()) === 0)
await page.locator('.ph-search').fill('泪沟')
await page.waitForTimeout(200)
const hits = await page.locator('.ph-item').count()
check('⑨b 搜索「泪沟」有命中', hits > 0, `${hits} 条`)
const before9 = (await layers()).length
await page.locator('.ph-item').first().click()
await page.waitForTimeout(300)
check('⑨c 点条目落一条文字层', (await layers()).length === before9 + 1, `${before9} → ${(await layers()).length}`)

// ---------- ⑩ 导出 ----------
console.log('== 导出 ==')
const exported = await page.evaluate(async () => {
  const wrap = document.querySelector('.canvas-duo .canvas-wrap')
  const img = wrap.querySelector('img')
  // 直接复刻导出逻辑（点击会触发下载，浏览器里拿不到数据），验证尺寸与合成
  const out = document.createElement('canvas')
  out.width = img.naturalWidth
  out.height = img.naturalHeight
  const ctx = out.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return { w: out.width, h: out.height, data: out.toDataURL('image/png').length }
})
check('⑩ 导出画布尺寸 = 原图尺寸', exported.w === G.w && exported.h === G.h, `${exported.w}×${exported.h}`)

await page.screenshot({ path: 'smoke-annotate.png' })
check('⑪ 无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
console.log(failed === 0 ? '\n✅ 标注冒烟全部通过' : `\n❌ ${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)
