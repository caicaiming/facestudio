// Pages 部署验证：用真实浏览器在「模拟 Pages 子路径」下走完
// 「加载模型 → 上传照片 → 检测出分 → 点位绘制」全链路。
//
// 前置：
//   1. npm run build
//   2. node scripts/static-server.mjs <dist所在父目录> 8082
//      （例如 dist 复制到 /tmp/pages-sim/facestudio/，则传 /tmp/pages-sim）
//      —— 不要用 python -m http.server：Windows 下它把 .js 发成
//      text/plain，浏览器按规范拒绝执行模块脚本，会出现假失败。
//   3. node scripts/verify-pages.mjs
//
// 注意：window.__faceStudio 仅 DEV 暴露，本脚本全部用 DOM / 画布像素判断。
// tfjs 的 wasm 探测性请求 404 属已知行为（失败即降级 CPU），已排除。
import { chromium } from 'playwright-core'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:8082/facestudio/'

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })

const errors = []
const failed = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('[console] ' + m.text())
})
// 任何 404 都要抓出来 —— 子路径部署的经典故障就是资源路径错
page.on('response', (r) => {
  if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`)
})

console.log('打开 ' + BASE)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })

// 1. 模型是否加载成功（这一步依赖 ./models 的正确解析）
let status = ''
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000)
  status = (await page.textContent('.status').catch(() => '')) || ''
  if (status.includes('就绪') || status.includes('失败') || status.includes('错误')) break
}
console.log('模型加载状态：', status.trim() || '(未取到)')

// 2. 上传样张跑一次分析
await page.setInputFiles(
  '.upload input[type=file]',
  path.resolve('public/sample-face.png'),
)
let analyzed = ''
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(2000)
  analyzed = (await page.textContent('.status').catch(() => '')) || ''
  if (analyzed.includes('分析完成') || analyzed.includes('未检测') || analyzed.includes('失败')) break
}
console.log('分析结果：', analyzed.trim() || '(未取到)')

// 3. 叠加层是否真的画出了点位标记
//    注意：window.__faceStudio 只在 DEV 下暴露（生产构建剔除），
//    所以生产产物只能靠 DOM + 画布像素来判断。
const info = await page.evaluate(() => {
  const cs = Array.from(document.querySelectorAll('canvas'))
  const overlay = cs.find((c) => (c.className || '').includes('overlay'))
  let painted = 0
  if (overlay && overlay.width) {
    const d = overlay.getContext('2d').getImageData(0, 0, overlay.width, overlay.height).data
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted++
  }
  const text = document.body.innerText || ''
  const m = text.match(/(\d+(?:\.\d+)?)\s*分/)
  return {
    canvasCount: cs.length,
    overlaySize: overlay ? `${overlay.width}x${overlay.height}` : null,
    paintedPx: painted,
    score: m ? m[1] : null,
  }
})
console.log('canvas 层数：', info.canvasCount, '| 叠加层：', info.overlaySize ?? '—')
console.log('叠加层已绘制像素：', info.paintedPx, info.paintedPx > 1000 ? '✅（点位已画出）' : '❌（疑似空白）')
console.log('页面评分：', info.score ?? '（未在文本中匹配到）')

// wasm 探测性 404 属于 tfjs 已知行为，失败即降级 CPU，不计为失败
const realFailed = failed.filter((f) => !f.includes('tfjs-backend-wasm'))
console.log('4xx/5xx 请求（已排除 tfjs wasm 探测）：', realFailed.length ? realFailed.join('\n  ') : '无 ✅')
console.log('页面错误：', errors.length ? errors.slice(0, 3).join(' | ') : '无 ✅')

const pass =
  status.includes('就绪') &&
  analyzed.includes('分析完成') &&
  info.paintedPx > 1000 &&
  realFailed.length === 0
console.log(pass ? '\n✅ 子路径部署全链路通过' : '\n❌ 存在失败项')

await page.screenshot({ path: '_pages-verify.png' })
await browser.close()
