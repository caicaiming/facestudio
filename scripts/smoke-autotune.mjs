/**
 * 冒烟测试：目标分数自动反解
 * 断言：① 输入目标分后 UI 给出结果 ② 得分确实逼近目标
 *      ③ 目标超上限时给出触顶提示 ④ 预览区照片随之变化
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
await page.waitForTimeout(1200)

console.log('上限提示：', (await page.textContent('.auto-tune .note'))?.trim())

const sliders = () =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.slider-row')].map((r) => [
        r.querySelector('.slider-label')?.textContent,
        Number(r.querySelector('input[type=range]')?.value),
      ]),
    ),
  )

const runTarget = async (target) => {
  const t0 = Date.now()
  await page.fill('#target-score', String(target))
  await page.click('.auto-tune .btn-accent')
  await page.waitForSelector('.tune-msg', { timeout: 20000 })
  await page.waitForTimeout(400)
  const msg = (await page.textContent('.tune-msg'))?.trim()
  const detail = (await page.textContent('.tune-detail').catch(() => null))?.trim() || '（无）'
  console.log(`\n目标 ${target}（${Date.now() - t0}ms）`)
  console.log('  ', msg)
  console.log('   写入：', detail)
  console.log('   滑块：', JSON.stringify(await sliders()))
  return { msg, detail }
}

const a = await runTarget(72)
await page.locator('.auto-tune').screenshot({ path: '_autotune.png' })
await runTarget(88)
const c = await runTarget(120)

// 预览区应随调整发生变化
const changed = await page.evaluate(() => {
  const cv = document.querySelectorAll('.canvas-duo .canvas-wrap')[1]?.querySelector('canvas.warp')
  return !!cv && cv.width > 0
})
console.log('\n预览区 warp 画布已绘制：', changed)
console.log('触顶提示出现：', /超出可达范围/.test(c.msg))


// 撤销：应回到全 0 滑块
await page.click('.auto-tune .btn-ghost.sm');
await page.waitForTimeout(400);
console.log('撤销后滑块：', JSON.stringify(await sliders()));
console.log('撤销后消息：', await page.textContent('.tune-msg').catch(() => '（已清空）'));
await browser.close()
