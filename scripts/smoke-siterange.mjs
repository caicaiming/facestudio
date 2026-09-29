/**
 * 冒烟测试：医美部位档位范围放宽到 ±30（Stage 32）
 *
 * 背景：用户反馈「医美的数值太小了，只有 ±15」。底层 scale 是按满档 ±100
 * 标定的，UI 卡在 ±15 只是早期保守取值，可以放心放宽 —— 但放宽后必须确认
 * 三件事：档位真能调上去、毫米换算跟着线性走、大档位不会把脸画崩。
 *
 * 断言：① 档位能一直加到 +30（且到顶后按钮禁用，不会越界）
 *      ② 30 档的毫米 ≈ 15 档的两倍（mm 换算没被旧的 ±15 截断）
 *      ③ 提示文案跟着范围走（−30 … ＋30）
 *      ④ 形变随档位线性放大，且不产生 NaN
 *      ⑤ 凹凸满档光影不过饱和（30 档比 15 档强，但不能糊成黑白块）
 *      ⑥ 归零回到 0
 *      ⑦ 控制台无报错
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
try {
  await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('就绪'), null, {
    timeout: 120000,
  })
} catch {
  await page.screenshot({ path: 'smoke-siterange-stuck.png' })
  console.log('页面卡在模型加载，截图 smoke-siterange-stuck.png')
  await browser.close()
  process.exit(2)
}
await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), null, {
  timeout: 120000,
})
await page.waitForTimeout(1000)

const FS = () => page.evaluate(() => window.__faceStudio)
const blockOf = (title) => page.locator('.subunit-block').filter({ hasText: title }).first()
const ensureOpen = async (block) => {
  const cls = (await block.getAttribute('class')) || ''
  if (cls.includes('collapsed')) await block.locator('.subunit-toggle').click()
  await page.waitForTimeout(350)
}

const zoneBlock = blockOf('医美部位')
await ensureOpen(zoneBlock)
const row = zoneBlock.locator('.su-zone.open .su-row').first()
const moveCol = row.locator('.zone-col').nth(0)
const depthCol = row.locator('.zone-col').nth(1)
const plus = moveCol.locator('button[aria-label="加一档"]')
const valText = async () => (await moveCol.locator('.step-val').innerText()).trim()
const mmText = async () => (await row.locator('.zone-mm').first().innerText()).trim()
/** 当前预览点位（68 点）快照 */
const previewPts = () =>
  page.evaluate(() => {
    const p = window.__faceStudio?.previewPoints
    return p ? p.slice(0, 68).map((q) => ({ x: q.x, y: q.y })) : null
  })
const num = (s) => {
  const m = /(-?\d+(\.\d+)?)/.exec(s)
  return m ? Number(m[1]) : NaN
}

// ---------------------------------------------------------------- ① 档位上限

console.log('\n— ① 档位能加到 +30 —')
for (let i = 0; i < 15; i++) {
  await plus.click()
  await page.waitForTimeout(45)
}
await page.waitForTimeout(500)
const v15 = await valText()
const mm15 = num(await mmText())
check('①a 15 档可达（旧上限）', v15 === '+15', `档位 ${v15} · ${mm15}mm`)
const snap15 = await previewPts()

for (let i = 0; i < 15; i++) {
  await plus.click()
  await page.waitForTimeout(45)
}
await page.waitForTimeout(600)
const v30 = await valText()
const mm30 = num(await mmText())
check('①b 30 档可达（新上限）', v30 === '+30', `档位 ${v30} · ${mm30}mm`)
check(
  '①c 到顶后加一档按钮禁用（不会越界）',
  await plus.isDisabled(),
  `disabled=${await plus.isDisabled()}`,
)
await plus.click({ force: true }).catch(() => {})
await page.waitForTimeout(300)
check('①d 越过上限后档位不变', (await valText()) === '+30', await valText())

const st = await FS()
check(
  '①e 档位写进状态',
  !!st.siteValues && Object.values(st.siteValues).some((v) => v === 30),
  JSON.stringify(Object.entries(st.siteValues || {}).filter(([, v]) => v)),
)

// ---------------------------------------------------------------- ② mm 线性

console.log('\n— ② 毫米换算跟着范围走 —')
const ratio = mm15 > 0 ? mm30 / mm15 : 0
check(
  '② 30 档毫米 ≈ 15 档的两倍（未被旧的 ±15 截断）',
  ratio > 1.9 && ratio < 2.1,
  `${mm15}mm → ${mm30}mm（比值 ${ratio.toFixed(2)}）`,
)

const tip = await moveCol.locator('.step-val').getAttribute('title')
check('③ 提示文案跟着范围走', /30/.test(tip || ''), tip || '(无 title)')

// ---------------------------------------------------------------- ④ 形变线性

console.log('\n— ④ 形变随档位放大且不出 NaN —')
const d30 = await previewPts()
check(
  '④a 30 档无 NaN / Infinity 点位',
  d30 && d30.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  `${d30?.filter((p) => !Number.isFinite(p.x)).length ?? '?'} 个非法点位`,
)
// 第一行是泪沟这类「68 点附近没有点」的部位，绝对位移本就很小 ——
// 有意义的是【同一部位 30 档 vs 15 档】的差值，而不是绝对位移
const diff = (() => {
  if (!snap15 || !d30) return 0
  let m = 0
  for (let i = 0; i < 68; i++) m = Math.max(m, Math.hypot(d30[i].x - snap15[i].x, d30[i].y - snap15[i].y))
  return m
})()
check('④b 30 档比 15 档推得更远（同部位对比）', diff > 0.01, `增量 ${diff.toFixed(3)}px`)

// ---------------------------------------------------------------- ⑤ 凹凸满档光影

console.log('\n— ⑤ 凹凸满档光影不过饱和 —')
const reliefStats = () =>
  page.evaluate(() => {
    const wraps = document.querySelectorAll('.canvas-duo .canvas-wrap')
    const c = wraps[1]?.querySelector('canvas.relief')
    if (!c || !c.width) return null
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let painted = 0
    let sat = 0
    let maxDev = 0
    let sum = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue
      painted++
      const g = d[i]
      if (g <= 2 || g >= 253) sat++
      const dev = Math.abs(g - 128)
      if (dev > maxDev) maxDev = dev
      sum += dev
    }
    // avg = 平均明暗强度。最大偏离在 15 档就已打满（少数像素到极值），
    // 真正反映「档位更高 = 光影更重」的是平均值。
    return { painted, sat, maxDev, avg: painted ? sum / painted : 0 }
  })

const dplus = depthCol.locator('button[aria-label="加一档"]')
for (let i = 0; i < 15; i++) {
  await dplus.click()
  await page.waitForTimeout(45)
}
await page.waitForTimeout(700)
const r15 = await reliefStats()
for (let i = 0; i < 15; i++) {
  await dplus.click()
  await page.waitForTimeout(45)
}
await page.waitForTimeout(800)
const r30 = await reliefStats()
check('⑤a 凹凸也能到 30 档', (await depthCol.locator('.step-val').innerText()).trim() === '+30')
check('⑤b 满档光影有像素', r30 && r30.painted > 0, JSON.stringify(r30))
const satRatio = r30 && r30.painted ? r30.sat / r30.painted : 1
check(
  '⑤c 满档饱和像素占比 < 15%（不糊成黑白块）',
  satRatio < 0.15,
  `饱和 ${(satRatio * 100).toFixed(2)}%（${r30?.sat}/${r30?.painted}）`,
)
check(
  '⑤d 30 档光影比 15 档更重（平均明暗强度上升）',
  r15 && r30 && r30.avg > r15.avg * 1.05,
  `平均偏离 ${r15?.avg.toFixed(1)} → ${r30?.avg.toFixed(1)}`,
)

// ---------------------------------------------------------------- ⑥ 归零

console.log('\n— ⑥ 归零 —')
await zoneBlock.locator('.zone-reset').first().click()
await page.waitForTimeout(600)
check('⑥a 位移档位归零', (await valText()) === '0', await valText())
check('⑥b 凹凸档位归零', (await depthCol.locator('.step-val').innerText()).trim() === '0')
const cleared = await reliefStats()
check('⑥c 归零后光影层清空', !cleared || cleared.painted === 0, JSON.stringify(cleared))

console.log('\n— 控制台 —')
check('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '))

await page.screenshot({ path: 'smoke-siterange.png' })
await browser.close()
console.log(failed === 0 ? '\n✅ 全部通过' : `\n❌ ${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)
