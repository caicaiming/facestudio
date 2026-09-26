/**
 * 冒烟测试：医美部位与方案
 * 断言：① 医美部位面板渲染，P0 分区默认展开
 *      ② 调整部位后方案卡片生成对应条目（部位 / 项目 / 幅度 mm / 剂量）
 *      ③ 高风险部位标出高风险
 *      ④ 主图绘制医美部位作用点
 *      ⑤ 瞳距标定切换后毫米值随之变化
 *      ⑥ 方案文本含免责声明，可导出
 *      ⑦ 预览区照片随部位调整产生形变
 */
import { chromium } from 'playwright-core'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({
  viewport: { width: 1680, height: 1000 },
  acceptDownloads: true,
})
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

// ---------- ① 面板渲染 ----------
const panelExists = await page.locator('.zone-block').count()
const openZones = await page.evaluate(() =>
  [...document.querySelectorAll('.zone-block .su-zone.open .su-zone-name')].map((e) => e.textContent),
)
console.log('医美部位面板：', panelExists > 0 ? '已渲染' : '缺失')
console.log('默认展开分区：', openZones.join(' / '))

// ---------- ② 调整部位 ----------
/** 确保分区处于展开状态（P0 默认已展开，重复点击会把它收起） */
const ensureOpen = async (label) => {
  const zone = page.locator('.zone-block .su-zone', { hasText: label }).first()
  const isOpen = await zone.evaluate((e) => e.classList.contains('open'))
  if (!isOpen) await zone.locator('.su-zone-head').click()
  await page.waitForTimeout(250)
}

/** 按部位名找到所在行并点 ＋ N 次 */
const bumpSite = async (label, times) => {
  const row = page.locator('.zone-block .su-row', { hasText: label }).first()
  await row.scrollIntoViewIfNeeded()
  for (let i = 0; i < times; i++) {
    await row.locator('.step-btn').last().click()
    await page.waitForTimeout(120)
  }
  return row
}

await ensureOpen('颏部')
await bumpSite('颏尖', 6)

// 太阳穴属高风险部位（颞浅动脉区）
await ensureOpen('颞部')
await bumpSite('太阳穴', 4)

await page.waitForTimeout(800)

const planItems = await page.evaluate(() =>
  [...document.querySelectorAll('.plan-item')].map((li) => ({
    name: li.querySelector('.plan-name')?.textContent?.trim(),
    risk: li.querySelector('.plan-risk')?.textContent?.trim(),
    mm: li.querySelector('.plan-mm')?.textContent?.trim(),
    proj: li.querySelector('.plan-proj')?.textContent?.trim(),
    meta: li.querySelector('.plan-meta')?.textContent?.trim(),
  })),
)
console.log('\n方案条目：')
for (const it of planItems) {
  console.log(`  ${it.name}｜${it.risk}｜${it.mm}｜${it.proj}｜${it.meta}`)
}

// ---------- ③ 高风险标记 ----------
const highFlag = await page.locator('.zone-risk-flag').textContent().catch(() => null)
const highItem = await page.locator('.plan-item.risk-high').count()
console.log('\n高风险徽标：', highFlag?.trim() || '（无）', '｜高风险条目数：', highItem)

// ---------- ④ 主图部位标记（蓝色 #2563eb 像素）----------
const markerPixels = await page.evaluate(() => {
  const cvs = [...document.querySelectorAll('canvas')]
  let best = 0
  for (const c of cvs) {
    if (!c.width || !c.height) continue
    const ctx = c.getContext('2d')
    let d
    try {
      d = ctx.getImageData(0, 0, c.width, c.height).data
    } catch {
      continue
    }
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      // 蓝色标记 rgba(37,99,235)：蓝通道显著高于红通道
      if (d[i + 3] > 120 && d[i + 2] > 180 && d[i + 2] - d[i] > 90) n++
    }
    best = Math.max(best, n)
  }
  return best
})
console.log('主图部位标记像素数：', markerPixels)

// ---------- ⑤ 瞳距标定切换 ----------
const mmBefore = await page.locator('.plan-item .plan-mm').first().textContent()
await page.locator('.plan-scale .seg button', { hasText: '女' }).click()
await page.waitForTimeout(600)
const mmFemale = await page.locator('.plan-item .plan-mm').first().textContent()
await page.locator('.plan-scale .seg button', { hasText: '男' }).click()
await page.waitForTimeout(600)
const mmMale = await page.locator('.plan-item .plan-mm').first().textContent()
console.log('\n毫米标定：默认', mmBefore?.trim(), '→ 女', mmFemale?.trim(), '→ 男', mmMale?.trim())
console.log('女性瞳距更小故 mm 更大：', parseFloat(mmFemale) > parseFloat(mmMale))

// 自定义瞳距
await page.fill('.plan-scale .score-input', '70')
await page.waitForTimeout(600)
const mmCustom = await page.locator('.plan-item .plan-mm').first().textContent()
console.log('自定义瞳距 70mm →', mmCustom?.trim())

// ---------- ⑥ 免责声明与导出 ----------
const disclaimer = await page.locator('.plan-disclaimer').last().textContent()
console.log('\n免责声明长度：', disclaimer?.trim().length, '字符')
console.log('含「不构成医疗诊断」：', disclaimer?.includes('不构成医疗诊断'))
console.log('含「瞳距估算」：', disclaimer?.includes('瞳距估算'))

console.log('导出按钮数量：', await page.locator('.plan-actions button').count())

// ---------- ⑦ 预览区形变 ----------
const warpChanged = await page.evaluate(() => {
  const wraps = document.querySelectorAll('.canvas-duo .canvas-wrap')
  return wraps.length >= 2 && !!wraps[1]?.querySelector('canvas.warp')
})
console.log('预览区 warp 画布：', warpChanged)

// ---------- ⑧ 导出对比图 ----------
const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
await page.locator('.plan-actions .btn-accent').click()
const download = await dl
console.log('\n导出对比图：', download ? `已触发（${download.suggestedFilename()}）` : '未触发')
if (download) {
  const p = await download.path()
  const size = p ? (await import('node:fs')).statSync(p).size : 0
  console.log('  文件大小：', size, '字节', size > 10000 ? '(合理)' : '(异常)')
}
console.log('导出后无报错：', errors.length === 0)

// ---------- 归零 ----------
await page.locator('.zone-block .subunit-head .btn-mini', { hasText: '归零' }).click()
await page.waitForTimeout(500)
const afterReset = await page.locator('.plan-item').count()
console.log('\n归零后方案条目数：', afterReset)

await page.locator('.plan-card').screenshot({ path: '_medical-plan.png' })
await page.locator('.zone-block').screenshot({ path: '_medical-zones.png' })

console.log('\n页面错误：', errors.length ? errors : '无')
await browser.close()
