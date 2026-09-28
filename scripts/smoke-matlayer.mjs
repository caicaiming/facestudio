/**
 * 冒烟测试：素材不再遮挡点位
 *
 * 背景：素材是整张贴在脸上的示意图（占短边 60%），原先和画线画在同一块
 * 画布上、盖在点位层之上，插进去之后 68 点位就被糊住了，既看不见也讲不清。
 * 这里验证素材被单独放到点位【下面】一层，而箭头文字仍在点位【上面】，
 * 并可单独调淡。
 *
 * 断言：① DOM 层序：annot-mats → overlay/mesh → annot
 *      ② 素材画在 mat 画布上（有像素），画线画布上不含素材
 *      ③ 插入素材后，点位画布（.layer.mesh）在鼻尖处仍有标记像素（未被覆盖）
 *         ⚠️ 采样对象必须是 mesh：默认 overlay='mesh'，68 点标记画在 mesh 上，
 *         overlay 画布此时是空的 —— 这里踩过一次，量错画布会得到假阴性。
 *      ④ 拖动画线仍在点位之上（箭头层有像素）
 *      ⑤ 选中素材后不透明度滑块可调；新插素材默认 62% 不糊点位
 *      ⑥ 标注模式下点位照样可拖（让路规则：橡皮/手柄 > 点位 > 标注工具）
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

const layers = () => page.evaluate(() => window.__faceStudio.ann.layers)

/** 某个画布在自然坐标 p 周围 r 像素内是否有不透明像素（素材是线稿，单点常落空） */
const hasPixelNear = (sel, p, r = 60) =>
  page.evaluate(
    ([sel, p, r]) => {
      const cv = document.querySelector(`.canvas-duo .canvas-wrap ${sel}`)
      if (!cv || !cv.width) return false
      const k = cv.width / p.natW
      const x0 = Math.max(0, Math.round((p.x - r) * k))
      const y0 = Math.max(0, Math.round((p.y - r) * k))
      const w = Math.min(cv.width - x0, Math.round(r * 2 * k))
      const h = Math.min(cv.height - y0, Math.round(r * 2 * k))
      if (w <= 0 || h <= 0) return false
      const d = cv.getContext('2d').getImageData(x0, y0, w, h).data
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true
      return false
    },
    [sel, p, r],
  )

/** 某个画布在自然坐标 p 处是否有不透明像素 */
const hasPixel = (sel, p) =>
  page.evaluate(
    ([sel, p]) => {
      const cv = document.querySelector(`.canvas-duo .canvas-wrap ${sel}`)
      if (!cv || !cv.width) return false
      const sx = Math.round((p.x / p.natW) * cv.width)
      const sy = Math.round((p.y / p.natH) * cv.height)
      if (sx < 0 || sy < 0 || sx >= cv.width || sy >= cv.height) return false
      const d = cv.getContext('2d').getImageData(sx, sy, 1, 1).data
      return d[3] > 8
    },
    [sel, p],
  )

/** 画布非空像素占比（%） */
const coverage = (sel) =>
  page.evaluate((sel) => {
    const cv = document.querySelector(`.canvas-duo .canvas-wrap ${sel}`)
    if (!cv || !cv.width) return 0
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
    return (n / (d.length / 4)) * 100
  }, sel)

const G = await page.evaluate(() => {
  const img = document.querySelector('.canvas-duo .canvas-wrap img')
  return { w: img.naturalWidth, h: img.naturalHeight }
})

// ---------- ① 层序 ----------
console.log('== 素材层位置 ==')
await page.locator('.seg button', { hasText: '标注' }).click()
await page.waitForTimeout(200)
await page.locator('.ann-section .ann-fold', { hasText: '素材' }).click()
await page.waitForTimeout(250)

const order = await page.evaluate(() => {
  const zoom = document.querySelector('.canvas-duo .canvas-wrap .canvas-zoom')
  return [...zoom.children].map((el) => el.className || el.tagName.toLowerCase())
})
const iMat = order.findIndex((c) => c.includes('annot-mats'))
const iOverlay = order.findIndex((c) => c.includes('overlay'))
const iMesh = order.findIndex((c) => c.includes('mesh'))
const iAnn = order.findIndex((c) => c.includes('annot') && !c.includes('annot-mats'))
check(
  '①a 素材层在点位层之下',
  iMat >= 0 && iMat < iOverlay && iMat < iMesh,
  `mats@${iMat} < overlay@${iOverlay}/mesh@${iMesh}`,
)
check('①b 画线层仍在点位之上', iAnn > iOverlay && iAnn > iMesh, `annot@${iAnn}`)

// ---------- ② 素材入栈且画在 mat 画布 ----------
const nose = await page.evaluate(() => {
  const p = window.__faceStudio.displayPoints[33]
  const img = document.querySelector('.canvas-duo .canvas-wrap img')
  return { x: p.x, y: p.y, natW: img.naturalWidth, natH: img.naturalHeight }
})
const markerBefore = await hasPixel('.layer.mesh', nose)

await page.locator('.ann-mat').first().click()
await page.waitForTimeout(700)
let L = await layers()
const mat = L[L.length - 1]
check('②a 素材入栈', mat?.kind === 'material', mat?.name)
// 取消选中：手柄本来就画在画线层上，不取消会把「手柄像素」误判成素材像素
await page.locator('.ann-section .ann-fold', { hasText: '图层' }).click()
await page.waitForTimeout(300)
await page.locator('.ann-layer', { hasText: mat.name }).first().click()
await page.waitForTimeout(200)
const matCov = await coverage('.layer.annot-mats')
const annCovMat = await coverage('.layer.annot')
check('②b 素材画在素材层', matCov > 1, `覆盖率 ${matCov.toFixed(1)}%`)
check('②c 画线层不含素材', annCovMat < 0.05, `覆盖率 ${annCovMat.toFixed(3)}%`)

// ---------- ③ 点位没被盖住 ----------
const markerAfter = await hasPixel('.layer.mesh', nose)
check(
  '③a 鼻尖点位仍在点位层可见',
  markerAfter && markerBefore,
  `插入前 ${markerBefore} → 插入后 ${markerAfter}`,
)
// 素材盖住鼻尖区域 → 说明素材确实铺到了点位下方（同一区域有素材像素）
const matAtNose = await hasPixelNear('.layer.annot-mats', nose, 60)
check('③b 素材铺在点位同一区域（确实会挡，但被压在下层）', matAtNose, `鼻尖 ±60px 内有素材像素 ${matAtNose}`)

// ---------- ④ 画线仍在点位上方 ----------
await page.locator('.ann-tool', { hasText: '箭头' }).click()
await page.waitForTimeout(150)
const toScreen = (nat) =>
  page.evaluate((p) => {
    const img = document.querySelector('.canvas-duo .canvas-wrap img')
    const r = img.getBoundingClientRect()
    return { x: r.left + (p.x / img.naturalWidth) * r.width, y: r.top + (p.y / img.naturalHeight) * r.height }
  }, nat)
const a = await toScreen({ x: G.w * 0.3, y: G.h * 0.7 })
const b = await toScreen({ x: G.w * 0.45, y: G.h * 0.55 })
await page.mouse.move(a.x, a.y)
await page.mouse.down()
for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10)
await page.mouse.up()
await page.waitForTimeout(250)
const annCov2 = await coverage('.layer.annot')
check('④ 画线画在上层（不被点位压）', annCov2 > annCovMat + 0.05, `${annCovMat.toFixed(3)}% → ${annCov2.toFixed(3)}%`)

// ---------- ⑤ 素材不透明度可调 + 默认半透明 ----------
console.log('== 不透明度 ==')
await page.locator('.ann-layer', { hasText: mat.name }).first().click()
await page.waitForTimeout(200)
const matNow = (await layers()).find((x) => x.id === mat.id)
check("⑤a 新素材默认 62%（不糊点位）", Math.abs(matNow.alpha - 0.62) < 0.01, `alpha=${matNow.alpha}`)
const a0 = matNow.alpha
await page.locator('.ann-sel-alpha input[type=range]').fill('40')
await page.waitForTimeout(250)
const a1 = (await layers()).find((x) => x.id === mat.id)?.alpha
check('⑤b 不透明度滑块生效', Math.abs(a1 - 0.4) < 0.01, `${a0} → ${a1}`)

// ---------- ⑥ 标注模式下点位照样可拖 ----------
console.log('== 标注模式拖点位 ==')
// 当前是箭头工具 + 素材选中。直接从鼻尖点位下笔：应命中点位而不是画箭头
const screenOfPoint = (i) =>
  page.evaluate((idx) => {
    const img = document.querySelector('.canvas-duo .canvas-wrap img')
    const r = img.getBoundingClientRect()
    const p = window.__faceStudio.displayPoints[idx]
    return { x: r.left + (p.x / img.naturalWidth) * r.width, y: r.top + (p.y / img.naturalHeight) * r.height }
  }, i)
const offsetOf = (i) =>
  page.evaluate((idx) => window.__faceStudio.pointOffsets[idx] || { dx: 0, dy: 0 }, i)

const s33 = await screenOfPoint(33)
await page.mouse.move(s33.x, s33.y)
await page.mouse.down()
for (let i = 1; i <= 8; i++) await page.mouse.move(s33.x + i * 3, s33.y + i * 2)
await page.mouse.up()
await page.waitForTimeout(400)
const off = await offsetOf(33)
check('⑥a 标注开着也能拖点位（点位命中优先）', Math.abs(off.dx) > 5 && Math.abs(off.dy) > 3, `dx=${off.dx?.toFixed?.(2)} dy=${off.dy?.toFixed?.(2)}`)
// 起笔不在点位上时仍是画箭头：图层栈应出现新的 arrow
const beforeCount = (await layers()).length
const a2 = await toScreen({ x: G.w * 0.62, y: G.h * 0.3 })
const b2 = await toScreen({ x: G.w * 0.72, y: G.h * 0.36 })
await page.mouse.move(a2.x, a2.y)
await page.mouse.down()
for (let i = 1; i <= 8; i++) await page.mouse.move(a2.x + ((b2.x - a2.x) * i) / 8, a2.y + ((b2.y - a2.y) * i) / 8)
await page.mouse.up()
await page.waitForTimeout(300)
const L2 = await layers()
check('⑥b 空白处起笔仍是画箭头', L2.length === beforeCount + 1 && L2[L2.length - 1].kind === 'arrow', `层数 ${beforeCount} → ${L2.length}`)

check('⑦ 无控制台报错', errors.length === 0, errors.slice(0, 2).join(' | '))

await page.screenshot({ path: 'smoke-matlayer.png' })
await browser.close()
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)
