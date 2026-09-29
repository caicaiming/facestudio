/**
 * 冒烟测试：数值单位（Stage 30）
 *
 * 背景：咨询师面对的滑块全是 −15…＋15 的裸数字，没有单位 —— 不知道
 * 「下巴 +8」到底是推了 2mm 还是 20mm；点位位移写的是 px，同一数值在
 * 手机直出照和截图上完全不是一个量级。现在全部补上物理单位。
 *
 * 断言：① 5 路形变滑块标注「档」，并在 hint 里给出换算后的毫米
 *      ② 档位翻倍、毫米随之翻倍；归零后毫米标注消失
 *      ③ 亚单位行出现毫米徽标，且跟着档位变化
 *      ④ 点位位移标注 px，并同时给出毫米（px 随分辨率变，mm 不变）
 *      ⑤ 医美部位面板已有 mm（回归，确认没被改坏）
 *      ⑥ 方案面板给出 ml 参考剂量
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

/** 按 label 取到那一行滑块（label 在 .slider-label 里） */
const sliderRow = (label) =>
  page.locator('.slider-row').filter({ has: page.locator('.slider-label', { hasText: label }) })
const hintOf = async (label) => (await sliderRow(label).locator('.slider-hint').innerText()).trim()
const unitOf = async (label) => (await sliderRow(label).locator('.num-unit').innerText()).trim()
const numOf = async (label) => Number(await sliderRow(label).locator('.num-input').inputValue())
/** 从 hint 文本里抠出毫米数字 */
const mmIn = (t) => {
  const m = t.match(/([\d.]+)\s*mm/)
  return m ? Number(m[1]) : null
}

// ---------------------------------------------------------------- ① 5 路滑块

console.log('\n— ① 5 路形变滑块 —')
for (const label of ['嘴巴', '下巴', '下颌线', '额头', '颧骨']) {
  const u = await unitOf(label)
  check(`① 「${label}」数值框标注单位`, u === '档', u)
}

// ---------------------------------------------------------------- ② 档位 → mm

console.log('\n— ② 档位换算成毫米 —')
await sliderRow('下巴').locator('.num-input').fill('5')
await sliderRow('下巴').locator('.num-input').press('Enter')
await page.waitForTimeout(400)
const mm5 = mmIn(await hintOf('下巴'))
check('②a 档位 5 时给出毫米值', mm5 != null && mm5 > 0, await hintOf('下巴'))

await sliderRow('下巴').locator('.num-input').fill('10')
await sliderRow('下巴').locator('.num-input').press('Enter')
await page.waitForTimeout(400)
const mm10 = mmIn(await hintOf('下巴'))
check(
  '②b 档位翻倍，毫米随之翻倍',
  mm5 != null && mm10 != null && Math.abs(mm10 - 2 * mm5) < 0.15,
  `${mm5}mm → ${mm10}mm`,
)
check(
  '②c 毫米值在合理量级（1 档 ≈ 0.3–1.5mm）',
  mm10 != null && mm10 / 10 > 0.3 && mm10 / 10 < 1.5,
  `每档 ${mm10 != null ? (mm10 / 10).toFixed(2) : '?'}mm`,
)

await sliderRow('下巴').locator('.num-input').fill('0')
await sliderRow('下巴').locator('.num-input').press('Enter')
await page.waitForTimeout(400)
check('②d 归零后不再显示毫米', mmIn(await hintOf('下巴')) == null, await hintOf('下巴'))

// ---------------------------------------------------------------- ③ 亚单位

console.log('\n— ③ 亚单位毫米徽标 —')
/** 两个面板共用 .subunit-block 骨架，按标题区分 */
const blockOf = (title) =>
  page.locator('.subunit-block').filter({ hasText: title }).first()
/** 面板可能是展开的，盲目点 toggle 会适得其反 —— 先看 class 再决定 */
const ensureOpen = async (block) => {
  const cls = (await block.getAttribute('class')) || ''
  if (cls.includes('collapsed')) await block.locator('.subunit-toggle').click()
  await page.waitForTimeout(350)
}

const subBlock = blockOf('亚单位精调')
await ensureOpen(subBlock)

const firstRow = subBlock.locator('.su-row').first()
const plusBtn = firstRow.locator('button[aria-label="加一档"]')
await plusBtn.click()
await page.waitForTimeout(250)
await plusBtn.click()
await page.waitForTimeout(400)
const suMm = await firstRow.locator('.su-mm').innerText()
check('③a 亚单位行出现毫米徽标', /\d+(\.\d+)?mm/.test(suMm), suMm)
const suVal = (await firstRow.locator('.step-val').innerText()).trim()
check('③b 徽标与档位同源', suVal === '+2', `档位 ${suVal} · ${suMm}`)

// 归零后徽标消失
const minusBtn = firstRow.locator('button[aria-label="减一档"]')
await minusBtn.click()
await page.waitForTimeout(200)
await minusBtn.click()
await page.waitForTimeout(400)
check('③c 归零后毫米徽标消失', (await subBlock.locator('.su-row .su-mm').count()) === 0)

// ---------------------------------------------------------------- ④ 点位位移

console.log('\n— ④ 点位位移的 px 与 mm —')
// 用点位下拉选中 8 号（下巴尖），比在画布上盲点可靠
await page.selectOption('.point-picker select >> nth=1', '8')
await page.waitForTimeout(400)

const dxRow = page
  .locator('.slider-row')
  .filter({ has: page.locator('.slider-label', { hasText: '水平位移' }) })
  .first()
const u = (await dxRow.locator('.num-unit').innerText().catch(() => '')).trim()
check('④a 点位位移标注 px', u === 'px', u)
await dxRow.locator('.num-input').fill('20')
await dxRow.locator('.num-input').press('Enter')
await page.waitForTimeout(400)
const t4 = (await dxRow.locator('.slider-hint').innerText()).trim()
check('④b px 之外同时给出毫米', mmIn(t4) != null, t4)

// ---------------------------------------------------------------- ⑤⑥ 医美部位与方案

console.log('\n— ⑤ 部位 mm 与方案 ml —')
const zoneBlock = blockOf('医美部位')
await ensureOpen(zoneBlock)
// 展开第一个分区，给第一个部位加档
const zoneHead = zoneBlock.locator('.su-zone-head').first()
if ((await zoneHead.getAttribute('aria-expanded')) === 'false') await zoneHead.click()
await page.waitForTimeout(350)
// 每行有【位移 / 凹凸】两组步进器，按钮名一样 —— 必须指定第 0 列（位移），
// 否则定位器会撞上两个同名按钮（Stage 31 加凹凸列后这里挂过一次）
const zoneRow = zoneBlock.locator('.su-row').first()
await zoneRow.locator('.zone-col').first().locator('button[aria-label="加一档"]').click()
await page.waitForTimeout(500)
const zoneMm = await zoneBlock.locator('.zone-mm').first().innerText().catch(() => '')
check('⑤ 医美部位给出毫米幅度', /\d+(\.\d+)?mm/.test(zoneMm), zoneMm)

const bodyText = await page.locator('body').innerText()
check('⑥ 方案给出 ml 参考剂量', /\d+(\.\d+)?\s*ml/.test(bodyText), (bodyText.match(/[\d.]+\s*ml/g) || [])[0] || '未找到')

// ---------------------------------------------------------------- 收尾

console.log('\n— 控制台 —')
check('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '))

await page.screenshot({ path: 'smoke-units.png' })
await browser.close()
console.log(failed === 0 ? '\n✅ 全部通过' : `\n❌ ${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)
