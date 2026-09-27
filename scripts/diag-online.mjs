// 线上排障：抓取所有失败请求 + 状态文案时间线 + 完整 console 错误
import { chromium } from 'playwright-core'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.env.VERIFY_BASE || 'https://caicaiming.github.io/facestudio/'

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })

const failed = []
const errors = []
const t0 = Date.now()
const at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5) + 's'
page.on('pageerror', (e) => console.log(at(), '[pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log(at(), '[console]', m.text())
})
page.on('response', (r) => {
  const u = r.url()
  if (r.status() >= 400) {
    failed.push(`${r.status()} ${u}`)
    console.log(at(), '[HTTP]', r.status(), u)
  } else if (u.includes('/models/')) {
    console.log(at(), '[model]', r.status(), u.split('/').pop())
  }
})

console.log('打开', BASE)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })

for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(3000)
  const s = ((await page.textContent('.status').catch(() => '')) || '').trim()
  console.log(at(), 'status:', s)
  if (s.includes('就绪') || s.includes('失败') || s.includes('错误')) break
}

await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(3000)
  const s = ((await page.textContent('.status').catch(() => '')) || '').trim()
  console.log(at(), 'after-upload:', s)
  if (s.includes('分析完成') || s.includes('未检测') || s.includes('失败')) break
}

await page.screenshot({ path: '_diag-online.png' })
console.log('失败请求合计：', failed.length)
await browser.close()
