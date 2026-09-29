/**
 * 咨询师走查（不是冒烟测试，不断言通过/失败）
 *
 * 视角：一位医美咨询师，客户坐在对面。要回答的问题只有一个 ——
 * 「我能不能在 5 分钟内，用这套工具让客户看懂她的问题、信服我的方案？」
 *
 * 所以这里量的是三件事，不是功能是否报错：
 *   1. 操作成本 —— 达成一个意图要点几次、滚多远、等多久
 *   2. 可发现性 —— 不看源码能不能找到入口
 *   3. 说服力  —— 屏幕上的数字/话术能不能直接念给客户听
 *
 * 每一步都截图到 shots/，便于逐帧回看。
 */
import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const SHOTS = path.resolve('shots')
fs.mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, acceptDownloads: true })

const errors = []
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('[console] ' + m.text())
})

/** 记一步：耗时 + 截图 */
const t0 = Date.now()
let lastT = t0
const step = async (name, shot = true) => {
  const dt = Date.now() - lastT
  lastT = Date.now()
  console.log(`\n[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}  (上一步耗时 ${dt}ms)`)
  if (shot) await page.screenshot({ path: path.join(SHOTS, `${name.replace(/[^\w\u4e00-\u9fa5]+/g, '_')}.png`) })
}

// ══════════════════════════════════════════════ 第一幕：客户坐下，我得先出结果
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('就绪'), {
  timeout: 120000,
})
await step('01_初始界面')

// 咨询师第一眼：能不能知道第一步做什么
const firstLook = await page.evaluate(() => {
  const vis = (sel) => {
    const e = document.querySelector(sel)
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { text: e.textContent.trim().slice(0, 80), x: Math.round(r.x), y: Math.round(r.y) }
  }
  return {
    upload: vis('.upload'),
    status: vis('.status'),
    hints: [...document.querySelectorAll('.note, .hint, .empty')].slice(0, 3).map((e) => e.textContent.trim().slice(0, 60)),
  }
})
console.log('  上传入口：', JSON.stringify(firstLook.upload))
console.log('  状态提示：', firstLook.status?.text)
console.log('  空态提示：', firstLook.hints)

// ══════════════════════════════════════════════ 第二幕：传照片
const tUpload = Date.now()
await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), {
  timeout: 120000,
})
console.log(`\n  照片 → 出结果：${Date.now() - tUpload}ms`)
await page.waitForTimeout(1200)
await step('02_分析完成')

// ══════════════════════════════════════════════ 第三幕：我看到了什么（能不能直接念给客户）
const report = await page.evaluate(() => {
  const rows = (sel) =>
    [...document.querySelectorAll(sel + ' tr')].map((tr) =>
      [...tr.children].map((td) => td.textContent.trim()).join(' | '),
    )
  return {
    score: document.querySelector('.score-num')?.textContent?.trim() ?? null,
    grade: document.querySelector('.score-grade')?.textContent?.trim() ?? null,
    scoreItems: [...document.querySelectorAll('.score-item')].map((e) =>
      e.textContent.trim().replace(/\s+/g, ' '),
    ),
    metrics: rows('.metrics').slice(0, 12),
    advice: [...document.querySelectorAll('.advice-item, .rx-item')].map((e) =>
      e.textContent.trim().replace(/\s+/g, ' ').slice(0, 110),
    ),
    copy: document.querySelector('.copy-text, .analysis-text')?.textContent?.trim()?.slice(0, 400) ?? null,
  }
})
console.log(`  综合评分：${report.score} 分 / 等级「${report.grade}」`)
console.log('  分项：', report.scoreItems.join('  '))
console.log('  几何指标：')
report.metrics.forEach((m) => console.log('    ·', m))
console.log('  处方建议：')
report.advice.forEach((m) => console.log('    ·', m))
console.log('  分析文案：\n    ', (report.copy ?? '（无）').replace(/\n/g, '\n    '))

// ══════════════════════════════════════════════ 第四幕：调方案（核心工作）
/** 找部位行，点位移列 + 号 N 次 */
const bump = async (label, times, col = 0) => {
  const row = page.locator('.zone-block .su-row', { hasText: label }).first()
  await row.scrollIntoViewIfNeeded()
  const btn = row.locator('.zone-col').nth(col).locator('.step-btn').last()
  for (let i = 0; i < times; i++) {
    await btn.click()
    await page.waitForTimeout(70)
  }
  return row
}

// 咨询师典型方案：苹果肌填充 + 泪沟 + 下巴
await bump('苹果肌', 8)
await step('03_苹果肌填充8档')
await bump('泪沟', 6)
await step('04_泪沟填充6档')
await bump('颏尖', 5)
await step('05_下巴前翘5档')

const planAfter = await page.evaluate(() => ({
  items: [...document.querySelectorAll('.plan-item, .plan-card')].map((e) =>
    e.textContent.trim().replace(/\s+/g, ' ').slice(0, 120),
  ),
  mm: [...document.querySelectorAll('.plan-mm, .zone-mm')].map((e) => e.textContent.trim()).slice(0, 10),
}))
console.log('  方案条目：')
planAfter.items.forEach((m) => console.log('    ·', m))
console.log('  mm 标注：', planAfter.mm.join(' | '))

// ══════════════════════════════════════════════ 第五幕：找各个入口（可发现性）
const discover = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('.group-head, .card-title')].map((e) => ({
    t: e.textContent.trim(),
    y: Math.round(e.getBoundingClientRect().top + window.scrollY),
  }))
  const segs = [...document.querySelectorAll('.seg')].map((e) =>
    [...e.querySelectorAll('button')].map((b) => b.textContent.trim()),
  )
  return { heads, segs, docH: document.documentElement.scrollHeight, winH: window.innerHeight }
})
console.log('\n  左栏板块（按文档位置）：')
discover.heads.forEach((h) => console.log(`    y=${String(h.y).padStart(5)}  ${h.t}`))
console.log('  顶部按钮组：', JSON.stringify(discover.segs))
console.log(`  页面总高 ${discover.docH}px / 视口 ${discover.winH}px → 左栏需滚动 ${(discover.docH / discover.winH).toFixed(1)} 屏`)

// ══════════════════════════════════════════════ 第六幕：对照视图（说服客户的关键一步）
const viewBtns = await page.locator('.toolbar .seg button').allInnerTexts()
console.log('\n  视图按钮：', viewBtns.join(' / '))
for (const v of ['对照', '检测', '调整']) {
  const b = page.locator('.toolbar .seg button', { hasText: v }).first()
  if (await b.count()) {
    await b.click()
    await page.waitForTimeout(700)
    await step(`06_视图_${v}`)
  }
}

// ══════════════════════════════════════════════ 第七幕：标注（当面画给客户看）
const annBtn = page.locator('.toolbar button', { hasText: '标注' }).first()
if (await annBtn.count()) {
  await annBtn.click()
  await page.waitForTimeout(400)
  await step('07_标注模式开启')
  const annUI = await page.evaluate(() => ({
    sections: [...document.querySelectorAll('.ann-board .ann-head, .ann-title')].map((e) => e.textContent.trim()),
    open: [...document.querySelectorAll('.ann-board .ann-body')].filter((e) => e.offsetHeight > 0).length,
  }))
  console.log('  标注面板：', JSON.stringify(annUI))
}

// ══════════════════════════════════════════════ 第八幕：话术库 / 素材 / 图层
const rightPanel = await page.evaluate(() => {
  const secs = [...document.querySelectorAll('.ann-board > *')].map((e) => ({
    cls: e.className,
    head: e.querySelector('.ann-head, .ann-title, h3')?.textContent?.trim() ?? '',
    h: e.offsetHeight,
  }))
  return secs
})
console.log('\n  右栏区块：', JSON.stringify(rightPanel))

// ══════════════════════════════════════════════ 第九幕：导出（给客户带走）
const exportBtns = await page.evaluate(() =>
  [...document.querySelectorAll('button')]
    .map((b) => b.textContent.trim())
    .filter((t) => /导出|保存|下载|复制|截图|打印/.test(t)),
)
console.log('\n  导出类按钮：', exportBtns.join(' / '))

// ══════════════════════════════════════════════ 收尾
console.log('\n═══ 控制台错误 ═══')
console.log(errors.length ? errors.slice(0, 10).join('\n') : '  无')
console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
await browser.close()
