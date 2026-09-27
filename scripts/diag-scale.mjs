// 诊断：图片尺寸放大后，点位/叠加层是否仍然对齐。
//
// 做法：同一张样张按 S 倍放大（像素内容完全相同，只是尺寸变大），
// 分别上传原图与放大图，比较：
//   1) 检测到的点位是否随尺寸线性放大（应 ≈ S × 原点位）
//   2) overlay/mesh 画布像素尺寸是否等于图片自然尺寸
//   3) 画面上「点位中心」与「按 S 倍推算的期望位置」的偏差
//
// 用法：node scripts/diag-scale.mjs [倍数...]
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const APP = process.env.APP_URL || 'http://localhost:5173/'
const SRC = path.resolve('public/sample-face.png')
const FACTORS = (process.argv[2] ? process.argv.slice(2) : ['1', '2', '3', '4']).map(Number)

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})

// ---------- 1. 生成放大图 ----------
const maker = await browser.newPage()
await maker.goto('about:blank')
const variants = {}
for (const S of FACTORS) {
  if (S === 1) {
    variants[1] = SRC
    continue
  }
  const dataUrl = await maker.evaluate(
    async ({ S, src }) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = Math.round(img.naturalWidth * S)
      cv.height = Math.round(img.naturalHeight * S)
      const ctx = cv.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(img, 0, 0, cv.width, cv.height)
      return cv.toDataURL('image/png')
    },
    { S, src: 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64') },
  )
  const out = path.resolve(`_scale-${S}x.png`)
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
  variants[S] = out
}
console.log('已生成测试图：', Object.values(variants).map((p) => path.basename(p)).join(', '))

// ---------- 2. 逐张上传、取点位 ----------
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
await page.goto(APP, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => (document.querySelector('.status')?.textContent || '').includes('就绪'),
  null,
  { timeout: 180000 },
)

const results = {}
for (const S of FACTORS) {
  await page.setInputFiles('.upload input[type=file]', variants[S])
  await page.waitForFunction(
    () => {
      const t = document.querySelector('.status')?.textContent || ''
      return t.includes('分析完成') || t.includes('未检测') || t.includes('失败')
    },
    null,
    { timeout: 120000 },
  )
  await page.waitForTimeout(1500)
  const info = await page.evaluate(() => {
    const st = window.__faceStudio || {}
    const cs = Array.from(document.querySelectorAll('canvas'))
    const pick = (cls) => cs.find((c) => (c.className || '').includes(cls))
    const stat = (c) => {
      if (!c) return null
      let painted = -1
      try {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
        painted = 0
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted++
      } catch {}
      return { attr: `${c.width}x${c.height}`, painted }
    }
    const img = document.querySelector('.canvas-duo .canvas-wrap img')
    return {
      pts: (st.points || []).slice(0, 68),
      nat: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
      css: img ? (() => { const r = img.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) } })() : null,
      overlay: stat(pick('overlay')),
      mesh: stat(pick('mesh')),
      warp: stat(pick('warp')),
    }
  })
  results[S] = info
  console.log(
    `S=${S}x 自然=${info.nat?.w}x${info.nat?.h} 显示=${info.css?.w}x${info.css?.h} ` +
      `overlay=${info.overlay?.attr} 已绘=${info.overlay?.painted} ` +
      `mesh已绘=${info.mesh?.painted} warp=${info.warp?.attr}`,
  )
}

// ---------- 3. 比对：点位是否随尺寸线性放大 ----------
const base = results[1]?.pts
if (base?.length === 68) {
  console.log('\n相对原图的点位偏差（单位：原图像素；>1.0 视为错位）：')
  for (const S of FACTORS) {
    const r = results[S]
    if (!r?.pts?.length) {
      console.log(`S=${S}x 未取到点位`)
      continue
    }
    let max = 0
    let sum = 0
    for (let i = 0; i < 68; i++) {
      const dx = r.pts[i].x / S - base[i].x
      const dy = r.pts[i].y / S - base[i].y
      const d = Math.hypot(dx, dy)
      sum += d
      if (d > max) max = d
    }
    console.log(`  S=${S}x  平均 ${(sum / 68).toFixed(2)}  最大 ${max.toFixed(2)}`)
  }
}

await browser.close()
