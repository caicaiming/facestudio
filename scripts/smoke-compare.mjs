/**
 * 冒烟测试：调整对比 + 调整记录
 * 重点验证「调整后指标」是基于形变后点位重新测量的，而非沿用原始值
 */
import { chromium } from 'playwright-core'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text())
})

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('就绪'), {
  timeout: 90000,
})
await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), {
  timeout: 90000,
})
console.log('✓ 检测完成')

/** 读取对比表：{ 指标: {原始, 调整后, Δ} } */
const readCompare = () =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('.metrics.compare tbody tr')]
    const out = {}
    for (const tr of rows) {
      const td = tr.querySelectorAll('td')
      if (td.length < 4) continue
      out[td[0].textContent.trim()] = {
        base: td[1].textContent.trim(),
        now: td[2].textContent.trim(),
        delta: td[3].textContent.trim(),
      }
    }
    return out
  })

// 切到调整视图（未做任何修改）→ Δ 应全为 0
await page.getByRole('button', { name: '调整' }).click()
await page.waitForTimeout(500)
const zero = await readCompare()
console.log('未调整时对比表：', JSON.stringify(zero['综合评分']), JSON.stringify(zero['上庭']))
const allFlat = Object.values(zero).every((v) => v.delta === '—')
console.log(allFlat ? '✓ 未调整时所有 Δ 为 —（无虚假变化）' : '✗ 未调整时就出现 Δ')

// 拖「下巴 +15」+「下颌线 -15」
const setSlider = (label, value) =>
  page.evaluate(
    ({ label, value }) => {
      const row = [...document.querySelectorAll('.slider-row')].find((r) =>
        r.querySelector('.slider-label')?.textContent?.includes(label),
      )
      if (!row) return false
      const input = row.querySelector('input[type=range]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    { label, value },
  )

await setSlider('下巴', 15)
await page.waitForTimeout(300)
await setSlider('下颌线', -15)
await page.waitForTimeout(700)

const after = await readCompare()
console.log('')
console.log('调整后对比表：')
for (const [k, v] of Object.entries(after)) {
  console.log(`  ${k.padEnd(6, '　')} ${v.base.padStart(8)} → ${v.now.padStart(8)}  Δ ${v.delta}`)
}

const changed = Object.entries(after).filter(([, v]) => v.delta !== '—')
console.log('')
console.log(changed.length > 0 ? `✓ ${changed.length} 项指标发生变化（确认是重新测量）` : '✗ 指标无任何变化')

// ---- 调整记录 ----
await page.getByRole('button', { name: '记录当前状态' }).click()
await page.waitForTimeout(400)
let hist = await page.$$eval('.history li', (ls) =>
  ls.map((l) => ({
    head: l.querySelector('.hist-head')?.textContent?.trim(),
    sum: l.querySelector('.hist-sum')?.textContent?.trim(),
  })),
)
console.log('')
console.log(`✓ 记录 1 条：`, JSON.stringify(hist[0]))

// 改参数后再记一条
await setSlider('下巴', 0)
await page.waitForTimeout(300)
await setSlider('颧骨', 12)
await page.waitForTimeout(600)
await page.getByRole('button', { name: '记录当前状态' }).click()
await page.waitForTimeout(400)
hist = await page.$$eval('.history li', (ls) =>
  ls.map((l) => l.querySelector('.hist-head')?.textContent?.trim()),
)
console.log(`✓ 共 ${hist.length} 条记录：`, JSON.stringify(hist))

// 恢复第 1 条（最早的记录，列表最后一项）
const beforeRestore = await readCompare()
await page.evaluate(() => {
  const items = [...document.querySelectorAll('.history li')]
  const last = items[items.length - 1]
  ;[...last.querySelectorAll('.hist-actions button')].find((b) => b.textContent.includes('恢复'))?.click()
})
await page.waitForTimeout(700)
const afterRestore = await readCompare()
console.log('')
console.log('恢复前 上庭 Δ：', beforeRestore['上庭']?.delta, ' 恢复后 上庭 Δ：', afterRestore['上庭']?.delta)
console.log('恢复前 评分 Δ：', beforeRestore['综合评分']?.delta, ' 恢复后 评分 Δ：', afterRestore['综合评分']?.delta)

// 删除一条
await page.evaluate(() => {
  const first = document.querySelector('.history li')
  ;[...first.querySelectorAll('.hist-actions button')].find((b) => b.textContent.includes('删除'))?.click()
})
await page.waitForTimeout(400)
const remain = await page.$$eval('.history li', (ls) => ls.length)
console.log('✓ 删除后剩余记录：', remain)

await page.screenshot({ path: 'compare.png' })
await browser.close()
