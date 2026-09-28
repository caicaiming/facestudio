// 外部工具深度截图：上传照片后依次截 素材库/话术库/画线/AI分析/图层
import { chromium } from 'playwright-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = 'C:\\Users\\95575\\WorkBuddy\\面部看脸\\_ref'
const SAMPLE = 'C:\\Users\\95575\\WorkBuddy\\面部看脸\\face-studio\\public\\sample-face.png'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
await page.goto('http://49.51.250.197:8088/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(1500)

// 上传顾客照片
const fi = await page.$('#custFile')
await fi.setInputFiles(SAMPLE)
await sleep(2500)
await page.screenshot({ path: `${OUT}\\shot-ref-photo.png` })
console.log('photo ok')

// 素材库弹层
await page.click('#libBtn').catch(() => {})
await sleep(1200)
await page.screenshot({ path: `${OUT}\\shot-ref-lib.png` })
console.log('lib ok')
await page.click('#libClose').catch(() => {})

// 话术库
await page.click('#phBtn').catch(() => {})
await sleep(900)
await page.screenshot({ path: `${OUT}\\shot-ref-phrases.png` })
console.log('phrases ok')
await page.click('#phCancel').catch(() => {})
await sleep(400)

// AI 分析
await page.click('#aiBtn').catch(() => {})
await sleep(15000)
await page.screenshot({ path: `${OUT}\\shot-ref-ai.png` })
console.log('ai ok')

// 画线工具（手绘）
await page.click('#drawBtn').catch(() => {})
await sleep(500)
await page.click('#mHand').catch(() => {})
await sleep(1000)
await page.screenshot({ path: `${OUT}\\shot-ref-draw.png` })
console.log('draw ok')

// 图层 tab
await page.click('#penCancel').catch(() => {})
await page.click('button[data-m="layer"]').catch(() => {})
await sleep(500)
await page.screenshot({ path: `${OUT}\\shot-ref-layers.png` })
console.log('layers ok')

// 调整 tab
await page.click('button[data-m="adj"]').catch(() => {})
await sleep(500)
await page.screenshot({ path: `${OUT}\\shot-ref-adj.png` })
console.log('adj ok')

await browser.close()
console.log('done')
