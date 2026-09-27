/**
 * 冒烟测试：整图缩放 / 平移 / 放大镜
 *
 * 断言：① 两块画布都渲染了工具条
 *      ② 工具条 ＋/−/复位 与滚轮都能改缩放，图片显示宽度随之变化
 *      ③ 放大后拖空白处可平移画面
 *      ④ **放大后拖点位的位移量按缩放比正确衰减**（换算基准用 img rect 而非容器）
 *      ⑤ 放大镜开启后跟随鼠标显示，窗口内有实际图像内容
 *      ⑥ 倍率切换会改变放大内容
 *      ⑦ 放大镜开启时点位仍可正常拖动
 */
import { chromium } from 'playwright-core'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

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
await page.waitForTimeout(1200)

const main = page.locator('.canvas-wrap').first()
const ok = (b) => (b ? '✅' : '❌')

// ---------- ① 工具条 ----------
const toolbarCount = await page.locator('.canvas-tools').count()
console.log('工具条数量（主图 + 预览区）：', toolbarCount, ok(toolbarCount === 2))

// ---------- ② 缩放 ----------
/** 读取主图缩放百分比与图片显示宽度 */
const readZoom = () =>
  page.evaluate(() => {
    const pct = document.querySelector('.canvas-tools .ct-pct')?.textContent?.trim()
    const img = document.querySelector('.canvas-wrap img')
    return { pct, dispW: Math.round(img.getBoundingClientRect().width) }
  })

const z0 = await readZoom()
await main.locator('.ct-btn', { hasText: '＋' }).click()
await page.waitForTimeout(350)
const z1 = await readZoom()
console.log(`缩放 ＋：${z0.pct} → ${z1.pct}，显示宽度 ${z0.dispW} → ${z1.dispW}`, ok(z1.pct === '150%'))
console.log(
  '  显示宽度按比例增长：',
  ok(Math.abs(z1.dispW / z0.dispW - 1.5) < 0.03),
)

await main.locator('.ct-btn.ct-pct').click()
await page.waitForTimeout(350)
const z2 = await readZoom()
console.log(`复位：${z1.pct} → ${z2.pct}`, ok(z2.pct === '100%' && Math.abs(z2.dispW - z0.dispW) <= 1))

// 滚轮：向上滚放大
const box = await main.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.wheel(0, -200)
await page.waitForTimeout(350)
const z3 = await readZoom()
console.log(`滚轮放大：${z2.pct} → ${z3.pct}`, ok(z3.pct === '150%'))

// ---------- ③ 平移 ----------
const readPan = () =>
  page.evaluate(() => {
    const t = document.querySelector('.canvas-wrap .canvas-zoom').style.transform
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(t)
    return m ? { x: +m[1], y: +m[2] } : null
  })
const p0 = await readPan()
// 在空白处按下并拖动（取左上角安全区，避开人脸与点位）
await page.mouse.move(box.x + 40, box.y + box.height - 40)
await page.mouse.down()
await page.mouse.move(box.x + 140, box.y + box.height - 40, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(250)
const p1 = await readPan()
console.log(
  `平移：(${p0.x.toFixed(0)}, ${p0.y.toFixed(0)}) → (${p1.x.toFixed(0)}, ${p1.y.toFixed(0)})`,
  ok(Math.abs(p1.x - p0.x - 100) < 6),
)

// ---------- ④ 放大后拖点位的位移衰减（核心回归） ----------
/** 点位索引 → 屏幕坐标（按当前显示比例实时换算） */
const ptScreen = (idx) =>
  page.evaluate((i) => {
    const p = window.__faceStudio.displayPoints[i]
    const img = document.querySelector('.canvas-wrap img')
    const r = img.getBoundingClientRect()
    const w = img.naturalWidth
    const h = img.naturalHeight
    return { x: r.left + (p.x / w) * r.width, y: r.top + (p.y / h) * r.height }
  }, idx)

const readOffset = (idx) =>
  page.evaluate((i) => ({ ...(window.__faceStudio.pointOffsets[i] || { dx: 0, dy: 0 }) }), idx)

const wrapBox = () =>
  page.evaluate(() => {
    const r = document.querySelector('.canvas-wrap').getBoundingClientRect()
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }
  })

/**
 * 确保点位在可视区内。
 * 放大后画面四周会被裁掉（下巴尖这类靠边的点会落到容器外，鼠标根本够不着），
 * 这正是「放大 → 平移 → 再拖点」的真实操作路径，顺带把它纳入验证。
 */
const ensureVisible = async (idx) => {
  for (let n = 0; n < 3; n++) {
    const s = await ptScreen(idx)
    const w = await wrapBox()
    if (s.x > w.l + 20 && s.x < w.r - 20 && s.y > w.t + 20 && s.y < w.b - 20) return true
    // 拖空白处把点位拉向画面中心
    await page.mouse.move(w.l + 25, w.b - 25)
    await page.mouse.down()
    await page.mouse.move(
      w.l + 25 + ((w.l + w.r) / 2 - s.x) * 0.8,
      w.b - 25 + ((w.t + w.b) / 2 - s.y) * 0.8,
      { steps: 8 },
    )
    await page.mouse.up()
    await page.waitForTimeout(220)
  }
  const s = await ptScreen(idx)
  const w = await wrapBox()
  return s.x > w.l + 20 && s.x < w.r - 20 && s.y > w.t + 20 && s.y < w.b - 20
}

/** 拖动某点位固定屏幕距离，返回自然坐标位移量 */
const dragPointBy = async (idx, screenDx) => {
  await ensureVisible(idx)
  const before = await readOffset(idx)
  const s = await ptScreen(idx)
  await page.mouse.move(s.x, s.y)
  await page.mouse.down()
  await page.mouse.move(s.x + screenDx, s.y, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const after = await readOffset(idx)
  return Math.abs((after.dx ?? 0) - (before.dx ?? 0))
}

// 先复位到 100% 再测。
// ⚠️ 每次测完必须在【同一缩放档位】下反向拖回等量屏幕距离，点位才会回到原位；
// 否则放大后可视区变小，点位会被裁到容器外，下一次就抓不中了。
await main.locator('.ct-btn.ct-pct').click()
await page.waitForTimeout(350)
const d100 = await dragPointBy(8, 80)
await dragPointBy(8, -80)

await main.locator('.ct-btn', { hasText: '＋' }).click()
await page.waitForTimeout(350)
const d150 = await dragPointBy(8, 80)
await dragPointBy(8, -80)
const ratio = d100 / d150
console.log(
  `拖点位移衰减：100% 时 ${d100.toFixed(2)}px，150% 时 ${d150.toFixed(2)}px，比值 ${ratio.toFixed(3)}`,
  ok(Math.abs(ratio - 1.5) < 0.12),
)
console.log('  （若换算基准用容器 rect，两次位移会相同、比值≈1）')

await main.locator('.ct-btn.ct-pct').click()
await page.waitForTimeout(350)

// ---------- ⑤ 放大镜 ----------
const readLensDisplay = () =>
  page.evaluate(() => getComputedStyle(document.querySelector('.canvas-loupe')).display)

await main.locator('.ct-btn', { hasText: '放大镜' }).click()
await page.waitForTimeout(250)
// 移出画布：放大镜应隐藏
await page.mouse.move(box.x - 60, box.y - 30)
await page.waitForTimeout(300)
const lensVisibleBefore = await readLensDisplay()
// 移回画布：应重新出现并绘制内容
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(450)

const lens = await page.evaluate(() => {
  const c = document.querySelector('.canvas-loupe')
  const st = getComputedStyle(c)
  const ctx = c.getContext('2d')
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  // 统计非背景像素占比（背景是纯 #0b0b10）
  let lit = 0
  const total = c.width * c.height
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 30 || d[i + 1] > 30 || d[i + 2] > 30) lit++
  }
  // 中心 8×8 区域的平均亮度，用于比对倍率切换前后内容是否变化
  let sum = 0
  const hs = Math.floor(c.height / 2)
  const ws = Math.floor(c.width / 2)
  for (let y = hs - 4; y < hs + 4; y++) {
    for (let x = ws - 4; x < ws + 4; x++) {
      const i = (y * c.width + x) * 4
      sum += (d[i] + d[i + 1] + d[i + 2]) / 3
    }
  }
  return {
    display: st.display,
    w: c.width,
    h: c.height,
    litRatio: lit / total,
    center: +(sum / 64).toFixed(2),
  }
})
console.log(
  `放大镜：移出画布 display=${lensVisibleBefore}，移入后 display=${lens.display}`,
  ok(lens.display === 'block' && lensVisibleBefore === 'none'),
)
console.log(
  `  窗口尺寸 ${lens.w}×${lens.h}，图像覆盖率 ${(lens.litRatio * 100).toFixed(1)}%`,
  ok(lens.litRatio > 0.5),
)

// ---------- ⑥ 倍率切换 ----------
await page.locator('.canvas-tools').first().locator('.ct-btn', { hasText: '6×' }).click()
await page.mouse.move(box.x + box.width / 2 + 4, box.y + box.height / 2 + 4)
await page.waitForTimeout(450)
const lens6 = await page.evaluate(() => {
  const c = document.querySelector('.canvas-loupe')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let sum = 0
  const hs = Math.floor(c.height / 2)
  const ws = Math.floor(c.width / 2)
  for (let y = hs - 4; y < hs + 4; y++) {
    for (let x = ws - 4; x < ws + 4; x++) {
      const i = (y * c.width + x) * 4
      sum += (d[i] + d[i + 1] + d[i + 2]) / 3
    }
  }
  return +(sum / 64).toFixed(2)
})
console.log(`倍率切换 3× → 6×：中心亮度 ${lens.center} → ${lens6}`, ok(lens6 !== lens.center))

// ---------- ⑦ 放大镜开启时仍可拖点位 ----------
const dLens = await dragPointBy(8, 60)
console.log(`放大镜开启时拖点位位移：${dLens.toFixed(2)}px`, ok(dLens > 1))

// ---------- ⑧ 关闭 ----------
await main.locator('.ct-btn', { hasText: '放大镜' }).click()
await page.waitForTimeout(250)
const closed = await page.evaluate(() => getComputedStyle(document.querySelector('.canvas-loupe')).display)
console.log('关闭放大镜：', closed, ok(closed === 'none'))

await page.screenshot({ path: '_zoom-final.png' })
console.log('\n页面错误：', errors.length ? errors.join(' | ') : '无')
await browser.close()
