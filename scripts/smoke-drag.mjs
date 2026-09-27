/**
 * 冒烟测试：拖动阻尼（灵敏度）
 *
 * 背景：用户反馈「拖点没有阻力，很容易拖大拖小」。修复引入 src/drag.js 的
 * 增益模型 + 工具条档位 + Shift/Alt 临时档 + 滑块相对拖动。这里在真实浏览器
 * 里量化验证这些手感参数，防止以后有人改 dt/换算系数时悄悄把阻尼改回 1:1。
 *
 * 断言：① 默认档（½）只施加约一半位移
 *      ② Shift → ¼，Alt → 1×（都与档位无关）
 *      ③ 工具条切档生效并被 localStorage 记住
 *      ④ 拖动读数浮层给出累计位移
 *      ⑤ 单次事件的位移存在上限，猛甩不会拉飞
 *      ⑥ 滑块改为相对拖动，拖同样距离不再直接冲到量程端点
 *      ⑦ 滑块按住 Shift 精调
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

// 「逐点微调」的按钮只在选中某个关键点后才渲染，先选位点 33（鼻尖）：
// 点位居中、周围无遮挡，拖动测试最稳。之后每次拖点也会自动保持在选中态。
await page.selectOption('select[aria-label="选择点位"]', '33')
await page.waitForTimeout(300)

/** 点位索引 → 屏幕坐标（按 img 的 rect 换算，与 FaceCanvas.toNatural 同源） */
const screenOfPoint = (i) =>
  page.evaluate((idx) => {
    const wrap = document.querySelector('.canvas-wrap')
    const img = wrap.querySelector('img')
    const r = img.getBoundingClientRect()
    const p = window.__faceStudio.displayPoints[idx]
    return {
      x: r.left + (p.x / img.naturalWidth) * r.width,
      y: r.top + (p.y / img.naturalHeight) * r.height,
      dispW: r.width,
      natW: img.naturalWidth,
      natH: img.naturalHeight,
    }
  }, i)

/** 读某一点累计的手动位移（原图像素） */
const offsetOf = (i) =>
  page.evaluate((idx) => {
    const o = window.__faceStudio.pointOffsets[idx] || { dx: 0, dy: 0 }
    return { dx: o.dx, dy: o.dy }
  }, i)

/** 点位归零，保证每次实验起点一致。
 *  用「重置该点」而非「点位全部归零」：后者在尚未调整过时被禁用。 */
const resetPoints = async () => {
  const btn = page.locator('.point-actions button', { hasText: '重置该点' })
  if (await btn.count()) await btn.click()
  await page.waitForTimeout(200)
}

/**
 * 从某点开始水平拖动 N 个屏幕像素（分多帧走完，避免触发单次位移上限）。
 * @param {object} mods { shift?:boolean, alt?:boolean }
 */
async function dragFrom(i, screenPx, mods = {}) {
  await resetPoints()
  const s = await screenOfPoint(i)
  const k = s.natW / s.dispW // 屏幕 px → 原图 px 的换算系数
  const steps = 8
  await page.mouse.move(s.x, s.y)
  if (mods.shift) await page.keyboard.down('Shift')
  if (mods.alt) await page.keyboard.down('Alt')
  await page.mouse.down()
  for (let n = 1; n <= steps; n++) {
    await page.mouse.move(s.x + (screenPx * n) / steps, s.y)
  }
  if (mods.shot) {
    // 取证：工具条档位 + 跟随光标的位移读数，都只在拖动过程中可见
    await page.screenshot({ path: 'smoke-drag.png' })
  }
  const o = await offsetOf(i)
  const readout = await page.locator('.drag-readout').count()
  const readoutText = readout ? await page.locator('.drag-readout').innerText() : ''
  await page.mouse.up()
  if (mods.shift) await page.keyboard.up('Shift')
  if (mods.alt) await page.keyboard.up('Alt')
  await page.waitForTimeout(150)
  return { k, dx: o.dx, expectedRaw: screenPx * k, readoutText }
}

// ---------- ①② 各档位的实际增益 ----------
console.log('== 拖动增益 ==')
const base = await dragFrom(33, 60, { shot: true })
const baseGain = base.dx / base.expectedRaw
console.log(`  默认档：屏幕 60px → 原图 ${base.dx.toFixed(1)}px（未阻尼应为 ${base.expectedRaw.toFixed(1)}）`)
check('① 默认档 ½：实际增益约 0.5', Math.abs(baseGain - 0.5) < 0.06, `实测 ${baseGain.toFixed(3)}`)

const fine = await dragFrom(33, 60, { shift: true })
const fineGain = fine.dx / fine.expectedRaw
check('② Shift → ¼', Math.abs(fineGain - 0.25) < 0.05, `实测 ${fineGain.toFixed(3)}`)

const alt = await dragFrom(33, 60, { alt: true })
const altGain = alt.dx / alt.expectedRaw
check('③ Alt → 跟手 1×', Math.abs(altGain - 1) < 0.08, `实测 ${altGain.toFixed(3)}`)

// ---------- ④ 工具条切档 ----------
console.log('== 工具条档位 ==')
await page.locator('.canvas-wrap').first().hover()
await page.locator('.ct-gain .ct-btn', { hasText: '¼' }).first().click()
await page.waitForTimeout(150)
const pickFine = await dragFrom(33, 60)
const pickGain = pickFine.dx / pickFine.expectedRaw
check('④ 档位切到 ¼ 生效', Math.abs(pickGain - 0.25) < 0.05, `实测 ${pickGain.toFixed(3)}`)

const stored = await page.evaluate(() => localStorage.getItem('face-studio:drag-gain'))
check('⑤ 档位写入 localStorage', stored === 'fine', `stored=${stored}`)

// 还原到默认档，后续用例才有稳定前提
await page.locator('.canvas-wrap').first().hover()
await page.locator('.ct-gain .ct-btn', { hasText: '½' }).first().click()
await page.waitForTimeout(150)

// ---------- ⑥ 读数浮层 ----------
check(
  '⑥ 拖动时给出累计位移读数',
  /px/.test(base.readoutText) && /总位移/.test(base.readoutText),
  base.readoutText.replace(/\n/g, ' '),
)

// ---------- ⑦ 单次位移上限 ----------
// ⚠️ 瞬移距离必须留在图片显示范围内：拖出 canvas-wrap 会触发 pointerleave，
// 拖动随即结束，那样量到的是「没拖」而不是「被限住」。
await resetPoints()
const s7 = await screenOfPoint(33)
await page.mouse.move(s7.x, s7.y)
await page.mouse.down()
await page.mouse.move(s7.x + 150, s7.y)
const jump = await offsetOf(33)
await page.mouse.up()
const limit = Math.min(s7.natW, s7.natH) * 0.06
const rawJump = 150 * (s7.natW / s7.dispW) * 0.5
console.log(
  `  瞬移 150 屏幕px：位移 ${Math.abs(jump.dx).toFixed(1)} 原图px` +
    `（未限速应为 ${rawJump.toFixed(1)}，单次上限 ${limit.toFixed(1)}）`,
)
check(
  '⑦ 单次事件位移被上限截住（且确实动了）',
  Math.abs(jump.dx) > 1 && Math.abs(jump.dx) <= limit + 1,
)

// ---------- ⑧⑨ 滑块相对拖动 ----------
console.log('== 滑块阻尼 ==')

const mouthRow = page.locator('.slider-row', {
  has: page.locator('.slider-label', { hasText: '嘴巴' }),
})
const mouthRange = mouthRow.locator("input[type='range']")
// 左栏是可滚动容器：滑块可能落在可视区之外（诊断时曾被 footer 挡住），
// 先滚进来，否则鼠标事件打不到 range 上。
await mouthRange.scrollIntoViewIfNeeded()
await page.waitForTimeout(200)

/** 记录当前值 + 几何信息。
 *  ⚠️ 起点必须按【thumb 的当前位置】算，而不是轨道中心：值 ≠ 0 时 thumb
 *  并不在中间，此时点中心等于点在空轨道上，会退化成原生跳转行为。 */
const readSlider = () =>
  mouthRange.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const THUMB = 12
    const min = Number(el.min)
    const max = Number(el.max)
    const frac = (Number(el.value) - min) / (max - min)
    const thumbX = r.left + THUMB / 2 + frac * (r.width - THUMB)
    const cy = r.top + r.height / 2
    return {
      value: Number(el.value),
      width: r.width,
      cx: thumbX,
      cy,
      hitUs: document.elementFromPoint(thumbX, cy) === el,
    }
  })

/**
 * 在滑块上向右拖 dxPx 像素，返回「值的改变量」。
 * 直接 API 写 value 会被 React 的 value tracker 认为没变而丢弃，因此一律
 * 从当前值出发做相对比较。
 */
async function dragSlider(dxPx, mods = {}) {
  const st = await readSlider()
  await page.mouse.move(st.cx, st.cy)
  if (mods.shift) await page.keyboard.down('Shift')
  await page.mouse.down()
  const steps = 8
  for (let n = 1; n <= steps; n++) await page.mouse.move(st.cx + (dxPx * n) / steps, st.cy)
  await page.mouse.up()
  if (mods.shift) await page.keyboard.up('Shift')
  await page.waitForTimeout(200)
  const after = await readSlider()
  return { delta: after.value - st.value, from: st.value, to: after.value, width: st.width, hitUs: st.hitUs }
}

const probe = await readSlider()
console.log(`  轨道宽 ${probe.width.toFixed(0)}px，起始值 ${probe.value}`)
check('⑧a 鼠标能落到滑块上', probe.hitUs === true)

const halfTrack = Math.round(probe.width / 2)
const normal = await dragSlider(halfTrack)
console.log(`  拖半个轨道（${halfTrack}px）：嘴巴 ${normal.from} → ${normal.to}`)
check(
  '⑧b 滑块不再一拖到底（原生 range 会直接到 +15）',
  normal.delta > 0 && normal.delta < 10,
  `Δ=${normal.delta}`,
)

const sFine = await dragSlider(halfTrack, { shift: true })
console.log(`  按住 Shift 拖同样距离：嘴巴 ${sFine.from} → ${sFine.to}`)
check(
  '⑨ 滑块 Shift 精调更钝',
  sFine.delta >= 0 && sFine.delta < normal.delta,
  `Shift Δ=${sFine.delta} vs 默认 Δ=${normal.delta}`,
)

check('⑩ 无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
console.log(failed === 0 ? '\n✅ 拖动阻尼冒烟全部通过' : `\n❌ ${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)
