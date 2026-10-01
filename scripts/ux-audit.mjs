/**
 * ux-audit.mjs —— 交互体验量化走查（不做功能断言，只测量「好不好用」）
 *
 * 产出：
 *   ① 左栏要滚几屏才够看（信息密度 / 埋深）
 *   ② 达成一个真实目标（把苹果肌推 +8 档）需要多少次点击、多少次滚动
 *   ③ 照片实际渲染尺寸（主角有没有被挤扁）
 *   ④ 调整 → 反馈的延迟（拖滑块到预览重绘的耗时）
 *   ⑤ 有没有全局撤销（调参错了能不能回退）
 *   ⑥ 三档视口下的布局体检
 *
 * 用法：dev server 起在 5173 后 node scripts/ux-audit.mjs
 */
import { chromium } from 'playwright-core'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const VIEWPORTS = [
  { w: 1920, h: 1080, name: '1920×1080' },
  { w: 1440, h: 900, name: '1440×900' },
  { w: 1280, h: 800, name: '1280×800' },
]

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})

const results = {}

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } })
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => document.querySelector('.status')?.textContent?.includes('就绪'),
    { timeout: 120000 },
  )
  await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
  await page.waitForFunction(
    () => document.querySelector('.status')?.textContent?.includes('分析完成'),
    { timeout: 120000 },
  )
  await page.waitForTimeout(1200)

  const r = { name: vp.name }

  // ---- ① 左栏高度 ----
  r.colLeft = await page.evaluate(() => {
    const el = document.querySelector('.col-left')
    return {
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      screens: +(el.scrollHeight / el.clientHeight).toFixed(2),
      width: Math.round(el.getBoundingClientRect().width),
    }
  })

  // ---- ② 各区块埋深（滚动到可见需要多少像素） ----
  r.blocks = await page.evaluate(() => {
    const col = document.querySelector('.col-left')
    const top = col.getBoundingClientRect().top
    const out = []
    const pick = [
      ['基准点校准', '.frame-block'],
      ['自定义控制点', '.custom-bar'],
      ['逐点微调', '.point-picker'],
      ['调整参数(自动调整)', '.auto-tune'],
      ['5 路滑块首行', '.col-left .slider-row'],
      ['医美部位', '.zone-block'],
      ['亚单位', '.subunit-block:not(.zone-block)'],
    ]
    for (const [label, sel] of pick) {
      const el = col.querySelector(sel)
      if (!el) {
        out.push({ label, offsetTop: null })
        continue
      }
      out.push({ label, offsetTop: Math.round(el.getBoundingClientRect().top - top) })
    }
    return out
  })

  // ---- ③ 画布里照片的实际尺寸 ----
  r.canvas = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.canvas-duo .canvas-box')]
    return boxes.map((b) => {
      const img = b.querySelector('img')
      const r = img ? img.getBoundingClientRect() : null
      return {
        tag: b.querySelector('.pane-tag')?.textContent?.trim(),
        boxW: Math.round(b.getBoundingClientRect().width),
        boxH: Math.round(b.getBoundingClientRect().height),
        imgW: r ? Math.round(r.width) : 0,
        imgH: r ? Math.round(r.height) : 0,
      }
    })
  })

  // ---- ④ 调一个滑块 → 预览重绘延迟 ----
  r.latency = await page.evaluate(async () => {
    const slider = document.querySelector('.col-left .slider-row input[type=range]')
    if (!slider) return null
    const t = []
    for (let n = 0; n < 5; n++) {
      const t0 = performance.now()
      const cur = Number(slider.value)
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(slider, String(cur + 1))
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
      t.push(performance.now() - t0)
    }
    return {
      ms: t.map((x) => Math.round(x)),
      max: Math.round(Math.max(...t)),
    }
  })

  // ---- ⑤ 全局撤销：调参后按 Ctrl+Z 有没有反应 ----
  r.undo = await page.evaluate(() => {
    const before = window.__faceStudio?.params
    return { hasParams: !!before, keys: before ? Object.keys(before) : [] }
  })
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(500)
  r.undo.afterCtrlZ = await page.evaluate(() => {
    const p = window.__faceStudio?.params
    return p ? { ...p } : null
  })

  // ---- ⑥ 达成目标「苹果肌 +8 档」的路径成本 ----
  const cost = { clicks: 0, scrolls: 0, notes: [] }
  // 医美部位面板默认折叠（defaultCollapsed）
  const zoneHead = page.locator('.zone-block .subunit-toggle')
  if ((await zoneHead.count()) > 0) {
    const collapsed = await page.evaluate(
      () => !!document.querySelector('.zone-block.collapsed'),
    )
    if (collapsed) {
      await zoneHead.click()
      cost.clicks++
      cost.notes.push('展开「医美部位」面板（默认折叠）')
      await page.waitForTimeout(200)
    }
  }
  // 颧颊分区默认展开（P0），找到苹果肌行
  const malarRow = page.locator('.su-row.zone-row', { hasText: '苹果肌' })
  const n = await malarRow.count()
  cost.notes.push(`苹果肌行：${n} 个匹配`)
  if (n > 0) {
    const visible = await malarRow.first().isVisible()
    if (!visible) {
      cost.scrolls++
      cost.notes.push('需要滚动左栏才能看到')
    }
    await malarRow.first().scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    // 点 8 次 ＋
    const plus = malarRow.first().locator('.step-btn').nth(1)
    for (let i = 0; i < 8; i++) {
      await plus.click({ force: true })
      cost.clicks++
    }
    await page.waitForTimeout(600)
    cost.result = await page.evaluate(() => {
      const s = window.__faceStudio?.siteValues || {}
      return { malar: s.malar, all: Object.values(s).filter(Boolean).length }
    })
  }
  r.pathCost = cost

  // ---- ⑦ 视口内同时可见的区块数 ----
  r.visibleBlocks = await page.evaluate(() => {
    const col = document.querySelector('.col-left')
    const cr = col.getBoundingClientRect()
    const heads = [...col.querySelectorAll('.card-title, .group-head, .subunit-title')]
    return heads.filter((h) => {
      const r = h.getBoundingClientRect()
      return r.top >= cr.top - 2 && r.bottom <= cr.bottom + 2
    }).length
  })

  await page.screenshot({ path: `ux-audit-${vp.w}.png`, fullPage: false })
  results[vp.name] = r
  await page.close()
}

console.log(JSON.stringify(results, null, 2))
await browser.close()
