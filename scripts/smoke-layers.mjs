/**
 * 冒烟测试：统一图层栈（Stage 29）
 *
 * 背景：之前只有手画的箭头 / 文字 / 素材算「图层」，而照片、网格、点位、
 * 三庭五眼、医美部位、基准点这些叠加内容全靠散落的开关控制 —— 不能单独
 * 调浓淡、不能锁、不能排序。现在它们全部进入同一张图层栈。
 *
 * 断言：① 面板列出全部 10 个系统层（画布上每张叠加内容都是图层）
 *      ② 底图照片是图层：可隐藏（img 退出绘制）、可调淡（opacity）
 *      ③ 预设按钮写的是图层状态：点「点位」→ points 开、mesh 关
 *      ④ 标记层可单独隐藏，且不透明度 / 标记大小写进 layerState
 *      ⑤ 锁定：锁住「68 点位」后拖点位纹丝不动，解锁后恢复可拖
 *      ⑥ 标记层可在 band 内排序；系统层不给删除按钮
 *      ⑦ 画出来的标注进入同一张列表，且排在最上层
 *      ⑧ 恢复默认：一键回到出厂图层设置
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

// 图层面板默认是折叠的（annFold.layers = true），先展开
await page.locator('.ann-section .ann-fold', { hasText: '图层' }).click()
await page.waitForTimeout(300)

const LS = () => page.evaluate(() => window.__faceStudio.layerState)
const rowOf = (key) => page.locator(`.ann-layer.sys[data-key="${key}"]`)
/** 叠加预设那一组 seg（页面上还有视图组、拖动增益组，必须限定范围） */
const overlaySeg = () =>
  page.locator('.seg').filter({ has: page.locator('button', { hasText: '网格' }) })
const offsetDelta = async (i, px) => {
  const a = await offsetOf(i)
  await dragPoint(i, px)
  return (await offsetOf(i)) - a
}

/** 点位索引 → 屏幕坐标（按 img 的 rect 换算，与 FaceCanvas.toNatural 同源） */
const screenOfPoint = (i) =>
  page.evaluate((idx) => {
    const wrap = document.querySelector('.canvas-duo .canvas-wrap')
    const img = wrap.querySelector('img')
    const r = img.getBoundingClientRect()
    const p = window.__faceStudio.displayPoints[idx]
    return {
      x: r.left + (p.x / img.naturalWidth) * r.width,
      y: r.top + (p.y / img.naturalHeight) * r.height,
    }
  }, i)

const offsetOf = (i) =>
  page.evaluate((idx) => {
    const o = window.__faceStudio.pointOffsets[idx] || { dx: 0, dy: 0 }
    return Math.hypot(o.dx, o.dy)
  }, i)

async function dragPoint(i, screenPx) {
  const s = await screenOfPoint(i)
  await page.mouse.move(s.x, s.y)
  await page.mouse.down()
  for (let n = 1; n <= 8; n++) await page.mouse.move(s.x + (screenPx * n) / 8, s.y)
  const moved = await offsetOf(i)
  await page.mouse.up()
  await page.waitForTimeout(150)
  return moved
}

// ---------- ① 每张叠加内容都是图层 ----------
console.log('== 统一图层栈 ==')
const sysRows = await page.locator('.ann-layer.sys').count()
const sysKeys = await page.evaluate(() =>
  [...document.querySelectorAll('.ann-layer.sys')].map((el) => el.dataset.key),
)
check('① 面板列出 10 个系统层', sysRows === 10, `${sysRows} 行：${sysKeys.join(',')}`)
check(
  '①b 关键叠加内容都在（照片/网格/点位/三庭/对称/部位/自定义/基准点）',
  ['photo', 'warp', 'mesh', 'points', 'three', 'symmetry', 'sites', 'custom', 'anchors'].every((k) =>
    sysKeys.includes(k),
  ),
)

// ---------- ② 底图照片也是一个图层 ----------
console.log('\n== 底图照片层 ==')
const imgStyle = () =>
  page.evaluate(() => {
    const img = document.querySelector('.canvas-duo .canvas-wrap img')
    return { vis: getComputedStyle(img).visibility, op: getComputedStyle(img).opacity }
  })
const before = await imgStyle()
await rowOf('photo').locator('.ann-eye').click()
await page.waitForTimeout(250)
const hidden = await imgStyle()
check('②a 照片层可隐藏', before.vis === 'visible' && hidden.vis === 'hidden', `${before.vis} → ${hidden.vis}`)
await rowOf('photo').locator('.ann-eye').click()
await page.waitForTimeout(250)
check('②b 再点一次恢复显示', (await imgStyle()).vis === 'visible')

// 选中照片层 → 快捷条里调不透明度
await rowOf('photo').click()
await page.waitForTimeout(200)
await page.locator('.ann-sel-alpha input[type=range]').fill('50')
await page.waitForTimeout(250)
const faded = await imgStyle()
check('②c 照片层可调淡（50%）', Math.abs(Number(faded.op) - 0.5) < 0.02, `opacity=${faded.op}`)
await page.locator('.ann-sel-alpha input[type=range]').fill('100')
await page.waitForTimeout(200)

// ---------- ③ 预设按钮写的是图层状态 ----------
console.log('\n== 叠加预设 ==')
await page.locator('.seg button', { hasText: '点位' }).click()
await page.waitForTimeout(250)
let st = await LS()
check(
  '③a 点「点位」→ points 开、mesh 关',
  st.meta.points.visible === true && st.meta.mesh.visible === false,
)
const activeLabel = await overlaySeg().locator('button.active').allInnerTexts()
check('③b 预设按钮高亮跟随图层状态', activeLabel.join('/') === '点位', activeLabel.join('/'))
await overlaySeg().locator('button', { hasText: '网格' }).click()
await page.waitForTimeout(250)
st = await LS()
check('③c 切回「网格」→ mesh 开、points 关', st.meta.mesh.visible && !st.meta.points.visible)

// ---------- ④ 标记层的可见性 / 不透明度 / 标记大小 ----------
console.log('\n== 标记层操作 ==')
await rowOf('points').locator('.ann-eye').click()
await page.waitForTimeout(250)
st = await LS()
check('④a 单独打开「68 点位」层', st.meta.points.visible === true)
check(
  '④b 与预设不再一致时不强行高亮（网格+点位同时开）',
  (await overlaySeg().locator('button.active').count()) === 0,
)

await rowOf('mesh').click()
await page.waitForTimeout(200)
const markerBefore = (await LS()).meta.mesh.marker
await page.locator('.ann-sel-bar button[title="标记放大"]').click()
await page.waitForTimeout(200)
const markerAfter = (await LS()).meta.mesh.marker
check('④c 标记大小可调', markerAfter > markerBefore, `${markerBefore} → ${markerAfter}`)
await page.locator('.ann-sel-alpha input[type=range]').fill('60')
await page.waitForTimeout(200)
check('④d 标记层不透明度可调（60%）', Math.abs((await LS()).meta.mesh.alpha - 0.6) < 0.02)

// ---------- ⑤ 锁定：锁住的层拖不动 ----------
console.log('\n== 图层锁定 ==')
await rowOf('points').locator('.ann-eye').click() // 关掉大点位，避免拖动时抓到编号点
await page.waitForTimeout(200)
await page.selectOption('select[aria-label="选择点位"]', '33')
await page.waitForTimeout(300)

// 点位位移是累计值，必须比【增量】：锁住前先拖一次建立基线
const movable = await offsetDelta(33, 60)
check('⑤a 未锁时可拖', movable > 5, `位移 ${movable.toFixed(2)}px`)
await rowOf('points').locator('.ann-lock').click()
await page.waitForTimeout(250)
check('⑤b 锁定写入 layerState', (await LS()).meta.points.lock === true)
const locked = await offsetDelta(33, 60)
check('⑤c 锁住后拖点位纹丝不动', locked < 0.001, `增量 ${locked.toFixed(3)}px`)
await rowOf('points').locator('.ann-lock').click()
await page.waitForTimeout(250)
const unlocked = await offsetDelta(33, 60)
check('⑤d 解锁后恢复可拖', unlocked > 5, `增量 ${unlocked.toFixed(2)}px`)

// ---------- ⑥ 排序与删除权限 ----------
console.log('\n== 层序与删除 ==')
const orderBefore = (await LS()).order.join(',')
await rowOf('sites').click()
await page.waitForTimeout(200)
await page.locator('.ann-layer.sys[data-key="sites"] button[title="上移一层"]').click()
await page.waitForTimeout(250)
const orderAfter = (await LS()).order.join(',')
check('⑥a 标记层可上移', orderAfter !== orderBefore, `${orderBefore} → ${orderAfter}`)
check('⑥b 系统层不给删除按钮', (await rowOf('sites').locator('button[title="删除该层"]').count()) === 0)
// 固定层的按钮 title 会写明原因（不是「上移一层」），据此断言它被禁用
check(
  '⑥c 底图照片固定在最底（上移按钮禁用）',
  await rowOf('photo').locator('button[title="该层固定在最底，不能上移"]').isDisabled(),
)

// ---------- ⑦ 画出来的标注进入同一张列表 ----------
console.log('\n== 内容层与系统层同列 ==')
await page.locator('.seg button', { hasText: '标注' }).click()
await page.waitForTimeout(300)
const box = await page.evaluate(() => {
  const img = document.querySelector('.canvas-duo .canvas-wrap img')
  const r = img.getBoundingClientRect()
  return { left: r.left, top: r.top, w: r.width, h: r.height }
})
// 起笔落在画面左下角：远离 68 点，避免被让路规则判成拖点位
await page.mouse.move(box.left + box.w * 0.14, box.top + box.h * 0.82)
await page.mouse.down()
for (let n = 1; n <= 6; n++) {
  await page.mouse.move(box.left + box.w * 0.14 + (110 * n) / 6, box.top + box.h * 0.82 - (40 * n) / 6)
}
await page.mouse.up()
await page.waitForTimeout(300)

const firstKey = await page.evaluate(() => document.querySelector('.ann-layer')?.dataset.key)
const freeRows = await page.locator('.ann-layer.free').count()
check('⑦a 画出的标注进栈', freeRows === 1, `${freeRows} 个内容层`)
check('⑦b 内容层排在最上层（列表第一行）', firstKey === 'arrow', `第一行 data-key=${firstKey}`)
check('⑦c 内容层有删除按钮', (await page.locator('.ann-layer.free button[title="删除该层"]').count()) === 1)

// ---------- ⑧ 恢复默认 ----------
console.log('\n== 恢复默认 ==')
await page.locator('.ann-layers-reset').click()
await page.waitForTimeout(300)
st = await LS()
check(
  '⑧a 一键恢复：网格可见、点位与形变预览隐藏、无锁',
  st.meta.mesh.visible && !st.meta.points.visible && !st.meta.warp.visible && !st.meta.mesh.lock,
)
check('⑧b 恢复默认不动内容层（画的线还在）', (await page.locator('.ann-layer.free').count()) === 1)

await page.screenshot({ path: 'smoke-layers.png' })

check('⑨ 无 JS 运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '))

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`)
await browser.close()
process.exit(failed === 0 ? 0 : 1)
