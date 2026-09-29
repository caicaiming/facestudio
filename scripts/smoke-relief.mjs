/**
 * 冒烟测试：凹凸（深度）光影层（Stage 31）
 *
 * 背景：此前工具只有 X / Y 两个自由度 —— 都是平面内的位移，回答「轮廓往哪挪」。
 * 医美沟通里还有「填起来一点」「吸掉一些」，说的是垂直于照片平面的深度。
 * 二维正面照测不出真实深度，但可以把它**画出来**：凸起迎光变亮、背光变暗。
 *
 * 断言：① 医美部位每行有「位移」「凹凸」两组档位
 *      ② 调凹凸 → 光影画布真的出现像素（且是明暗，不是纯色块）
 *      ③ 凹凸档位归零 → 光影画布清空
 *      ④ 凹凸会顺手撑一点轮廓（点位确实动了，但幅度小于同档位移）
 *      ⑤ 深度也换算成 mm，与位移的 mm 分别标注
 *      ⑥ 图层栈里多出「凹凸光影」层，可隐藏
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
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('就绪'), null, {
  timeout: 120000,
})
await page.setInputFiles('.upload input[type=file]', path.resolve('public/sample-face.png'))
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('分析完成'), null, {
  timeout: 120000,
})
await page.waitForTimeout(1000)

const FS = () => page.evaluate(() => window.__faceStudio)
/** 面板骨架复用，按标题区分 */
const blockOf = (title) => page.locator('.subunit-block').filter({ hasText: title }).first()
const ensureOpen = async (block) => {
  const cls = (await block.getAttribute('class')) || ''
  if (cls.includes('collapsed')) await block.locator('.subunit-toggle').click()
  await page.waitForTimeout(350)
}

/**
 * 光影画布的像素统计。
 * 只看「有没有画东西」是不够的 —— 纯色块也能通过，必须验证它既有亮又有暗，
 * 且亮暗都偏离中性灰 128（soft-light 下 128 才是「无变化」）。
 */
/**
 * 光影是贴在形变照上的，故量**预览区**那张（主图的形变层默认关闭，
 * 它的 relief 画布保持初始的 300×150，量它没有意义）。
 */
const reliefStats = () =>
  page.evaluate(() => {
    const wraps = document.querySelectorAll('.canvas-duo .canvas-wrap')
    const c = wraps[1]?.querySelector('canvas.relief')
    if (!c || !c.width) return null
    const ctx = c.getContext('2d')
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let painted = 0
    let bright = 0
    let dark = 0
    let maxDev = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue
      painted++
      const g = d[i]
      if (g > 128) bright++
      else if (g < 128) dark++
      const dev = Math.abs(g - 128)
      if (dev > maxDev) maxDev = dev
    }
    return { total: c.width * c.height, painted, bright, dark, maxDev }
  })

// ---------------------------------------------------------------- ① 两组档位

console.log('\n— ① 每行两组档位 —')
const zoneBlock = blockOf('医美部位')
await ensureOpen(zoneBlock)
// 取**已展开**分区的第一行（P0 默认展开，控制点离 68 点近，形变量级才明显）
const firstRow = zoneBlock.locator('.su-zone.open .su-row').first()
const tags = await firstRow.locator('.zone-col-tag').allInnerTexts()
check('①a 每行有「位移」档位', tags.includes('位移'), tags.join('/'))
check('①b 每行有「凹凸」档位', tags.includes('凹凸'), tags.join('/'))
check('①c 两组各有一个步进器', (await firstRow.locator('.stepper').count()) === 2)

// ---------------------------------------------------------------- ② 调凹凸出光影

console.log('\n— ② 调凹凸产生光影 —')
const before = await reliefStats()
check('②a 未调凹凸时光影层为空', !before || before.painted === 0, JSON.stringify(before))

// 第一个分区里第一个部位的「凹凸」列：第 2 个 stepper
const depthStepper = firstRow.locator('.zone-col').nth(1).locator('.stepper')
for (let i = 0; i < 6; i++) {
  await depthStepper.locator('button[aria-label="加一档"]').click()
  await page.waitForTimeout(120)
}
await page.waitForTimeout(700)

const after = await reliefStats()
check('②b 调凹凸后光影层出现像素', after && after.painted > 0, JSON.stringify(after))
check(
  '②c 既有提亮也有压暗（是真光影，不是色块）',
  after && after.bright > 0 && after.dark > 0,
  `亮 ${after?.bright} / 暗 ${after?.dark}`,
)
check('②d 明暗幅度足够可见', after && after.maxDev > 15, `最大偏离 ${after?.maxDev}`)

const st = await FS()
const depths = Object.entries(st.siteDepths || {}).filter(([, v]) => v)
check('②e 凹凸档位写进状态', depths.length > 0, JSON.stringify(depths))

// ---------------------------------------------------------------- ③ 归零

console.log('\n— ③ 归零后光影消失 —')
for (let i = 0; i < 6; i++) {
  await depthStepper.locator('button[aria-label="减一档"]').click()
  await page.waitForTimeout(120)
}
await page.waitForTimeout(700)
const cleared = await reliefStats()
check('③ 归零后光影层清空', !cleared || cleared.painted === 0, JSON.stringify(cleared))

// ---------------------------------------------------------------- ④ 轮廓也跟着动

console.log('\n— ④ 凹凸顺手撑一点轮廓 —')
const pts = () =>
  page.evaluate(() => {
    const p = window.__faceStudio.previewPoints
    return p ? p.slice(0, 68).map((q) => ({ x: q.x, y: q.y })) : null
  })
const moveDelta = (a, b) => {
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.hypot(b[i].x - a[i].x, b[i].y - a[i].y))
  return m
}
const bump = async (col, label, n) => {
  for (let i = 0; i < n; i++) {
    await firstRow.locator('.zone-col').nth(col).locator(`button[aria-label="${label}"]`).click()
    await page.waitForTimeout(90)
  }
  await page.waitForTimeout(700)
}

const ptsBefore = await pts()
// 同一部位、同一档数，位移组与凹凸组各来 10 档 —— 比的是两者的比值
await bump(0, '加一档', 10)
const dMove = moveDelta(ptsBefore, await pts())
await bump(0, '减一档', 10)
await bump(1, '加一档', 10)
const dDepth = moveDelta(ptsBefore, await pts())
const ratio = dMove > 0 ? dDepth / dMove : 0
check('④a 凹凸确实推动轮廓', dDepth > 0, `位移 ${dDepth.toFixed(3)}px`)
check(
  '④b 幅度约为同档位移的 1/4（DEPTH_TO_CONTOUR = 0.25）',
  ratio > 0.15 && ratio < 0.4,
  `比值 ${ratio.toFixed(3)}（凹凸 ${dDepth.toFixed(3)}px / 位移 ${dMove.toFixed(3)}px）`,
)

// ---------------------------------------------------------------- ⑤ 深度的 mm

console.log('\n— ⑤ 深度换算毫米 —')
const depthMm = await firstRow.locator('.zone-mm.depth').first().innerText().catch(() => '')
check('⑤ 凹凸档位给出深度 mm', /\d+(\.\d+)?mm/.test(depthMm), depthMm)

// ---------------------------------------------------------------- ⑥ 图层

console.log('\n— ⑥ 凹凸光影是一层 —')
await page.locator('.ann-section .ann-fold', { hasText: '图层' }).click()
await page.waitForTimeout(400)
const reliefRow = page.locator('.ann-layer.sys[data-key="relief"]')
check('⑥a 图层栈里有「凹凸光影」层', (await reliefRow.count()) === 1)
check(
  '⑥b 该层名为凹凸光影',
  (await reliefRow.innerText().catch(() => '')).includes('凹凸光影'),
  (await reliefRow.innerText().catch(() => '')).split('\n')[0],
)
if (await reliefRow.count()) {
  await reliefRow.locator('.ann-eye').click()
  await page.waitForTimeout(500)
  const ls = await FS()
  check('⑥c 眼睛按钮可隐藏该层', ls.layerState.meta.relief.visible === false)
  await reliefRow.locator('.ann-eye').click()
  await page.waitForTimeout(400)
}

// ---------------------------------------------------------------- 收尾

console.log('\n— 控制台 —')
check('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '))

await page.screenshot({ path: 'smoke-relief.png' })
await browser.close()
console.log(failed === 0 ? '\n✅ 全部通过' : `\n❌ ${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)
