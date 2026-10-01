/**
 * ux-pixdiff.mjs —— 量化「调了 30 档，预览图到底变了多少」
 *
 * 流程：上传样例脸 → 苹果肌位移推满 +30 → 前后抓预览画布像素对比。
 * 产出：变化像素占比 / 最大差值 / 平均差值 + 截图。
 * 用途：交互审核证据 —— 部位实际形变量级与 mm 标注是否脱节。
 */
import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => document.querySelector('.status')?.textContent?.includes('就绪'),
  { timeout: 120000 },
)

const sample = path.resolve('public/sample-face.png')
await page.setInputFiles('.upload input[type=file]', sample)
await page.waitForFunction(
  () => document.querySelector('.status')?.textContent?.includes('分析完成'),
  { timeout: 120000 },
)
await page.waitForTimeout(1200)

/** 抓「调整后预览」画布的像素（缩到 1/2 以稳住比较粒度） */
const grab = () =>
  page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.canvas-duo .canvas-box')]
    const box = boxes[1]
    const cv = box?.querySelector('canvas')
    if (!cv) return null
    const off = document.createElement('canvas')
    const s = 0.5
    off.width = Math.max(1, Math.round(cv.width * s))
    off.height = Math.max(1, Math.round(cv.height * s))
    const ctx = off.getContext('2d')
    ctx.drawImage(cv, 0, 0, off.width, off.height)
    return { w: off.width, h: off.height, data: ctx.getImageData(0, 0, off.width, off.height).data }
  })

const before = await grab()

// 展开医美部位面板（默认折叠）
const zoneToggle = page.locator('.zone-block .subunit-toggle')
if (await zoneToggle.count()) {
  const collapsed = await page.evaluate(() => !!document.querySelector('.zone-block.collapsed'))
  if (collapsed) {
    await zoneToggle.click()
    await page.waitForTimeout(300)
  }
}
// 展开颧颊分区（P0 默认已展开，双保险）
const cheekHead = page.locator('.su-zone-head', { hasText: '颧颊' })
if (await cheekHead.count()) {
  const open = await page.evaluate(() => {
    const z = [...document.querySelectorAll('.su-zone')].find((el) =>
      el.textContent.includes('颧颊'),
    )
    return z ? z.classList.contains('open') : false
  })
  if (!open) {
    await cheekHead.click()
    await page.waitForTimeout(300)
  }
}

// 苹果肌位移 +30（点击 ＋ 按钮 30 次）
const malarRow = page.locator('.su-row.zone-row', { hasText: '苹果肌' }).first()
const plus = malarRow.locator('.step-btn').nth(1)
for (let i = 0; i < 30; i++) await plus.click({ force: true })
await page.waitForTimeout(2000)

const val = await page.evaluate(() => window.__faceStudio?.siteValues?.malar ?? null)
const after = await grab()
await page.screenshot({ path: 'ux-pixdiff-after.png' })

if (!before || !after || before.data.length !== after.data.length) {
  console.log(JSON.stringify({ ok: false, reason: 'grab failed', malar: val }))
} else {
  let changed = 0
  let maxd = 0
  let sum = 0
  const px = before.data.length / 4
  for (let i = 0; i < before.data.length; i += 4) {
    const d =
      Math.abs(before.data[i] - after.data[i]) +
      Math.abs(before.data[i + 1] - after.data[i + 1]) +
      Math.abs(before.data[i + 2] - after.data[i + 2])
    if (d > 24) changed++
    if (d > maxd) maxd = d
    sum += d
  }
  const out = {
    ok: true,
    malarValue: val,
    canvas: `${before.w}x${before.h}`,
    pxTotal: px,
    changedPx: changed,
    changedPct: +((changed / px) * 100).toFixed(3),
    maxDelta: maxd,
    avgDelta: +(sum / px).toFixed(3),
  }
  console.log(JSON.stringify(out))
  fs.writeFileSync('ux-pixdiff.json', JSON.stringify(out, null, 2))
}
await browser.close()
