/**
 * relief.test.mjs —— 凹凸（深度）光影层
 * 覆盖：高度场的高斯形状与叠加、平坦面零变化（最关键的归一化）、
 *       凸起/凹陷的光影符号、光源方向、边界与空档位、网格分辨率无关性。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  GRID_STEP,
  LIGHT_DEFAULT,
  LIGHT_RIG,
  blurField,
  heightField,
  heightPeak,
  reliefOf,
  shadeField,
} from '../src/relief.js'

/**
 * 造一个单点部位。注意 `radius` 与 zones.js 一致，是**面宽的比例**而非像素：
 * 0.2 × 面宽 200 = 40px。
 */
const anchorAt = (cx, cy, radius = 0.2, scale = 0.2) => ({
  site: { key: 't', scale, radius, label: '测试部位' },
  pts: [{ x: cx, y: cy }],
  dirs: [{ x: 0, y: -1 }],
})

const OPTS = { w: 400, h: 400, W: 200, k: 1 }

// ---------------------------------------------------------------- 1. 高度场

test('T20a 无档位返回 null，缺参数返回 null', () => {
  assert.equal(heightField([anchorAt(200, 200, 0.20)], {}, OPTS), null)
  assert.equal(heightField([anchorAt(200, 200, 0.20)], { t: 0 }, OPTS), null)
  assert.equal(heightField([], { t: 5 }, OPTS), null)
  assert.equal(heightField([anchorAt(200, 200, 0.20)], { t: 5 }, { w: 0, h: 0, W: 0 }), null)
})

test('T20b 高度场：中心最高，向外高斯衰减', () => {
  const f = heightField([anchorAt(200, 200, 0.20)], { t: 10 }, OPTS)
  assert.ok(f, '应有高度场')
  const gx = Math.round(200 / GRID_STEP)
  const gy = Math.round(200 / GRID_STEP)
  const at = (x, y) => f.data[Math.round(y / GRID_STEP) * f.gw + Math.round(x / GRID_STEP)]
  const peak = at(200, 200)
  assert.ok(peak > 0, `峰值应 > 0，实际 ${peak}`)
  // exp(−3·(d/r)²)：d=r 时约 0.05，d=2r 时约 6e−6
  assert.ok(Math.abs(at(240, 200) / peak - 0.05) < 0.02, `r 处约 5%：${at(240, 200) / peak}`)
  assert.ok(at(300, 200) / peak < 0.01, '2r 之外应基本归零')

  // 峰值量级：档位 10 × scale 0.2 × 面宽 200 = 4px
  // 取 2% 容差：网格采样点未必正落在中心（200/6 不整除，差 2px 时高斯约 0.9925）
  const want = (10 / 100) * 0.2 * 200
  assert.ok(Math.abs(peak - want) / want < 0.02, `峰值 ${peak} 应约 ${want}`)
  assert.ok(gx >= 0 && gy >= 0)
})

test('T20c 档位取负 → 凹陷（高度为负）', () => {
  const f = heightField([anchorAt(200, 200, 0.20)], { t: -10 }, OPTS)
  const p = heightPeak(f)
  assert.ok(p.down < 0 && p.up === 0, `应为纯凹陷：up=${p.up} down=${p.down}`)
})

test('T20d 多部位叠加：两峰之间高度相加，各自峰值不受影响', () => {
  const f = heightField([anchorAt(120, 200, 0.20), anchorAt(280, 200, 0.20)], { t: 10, u: 10 }, OPTS)
  // 两个锚点 site.key 相同会互相覆盖，这里用不同 key
  const a1 = { site: { key: 't', scale: 0.2, radius: 0.2 }, pts: [{ x: 120, y: 200 }] }
  const a2 = { site: { key: 'u', scale: 0.2, radius: 0.2 }, pts: [{ x: 280, y: 200 }] }
  const g = heightField([a1, a2], { t: 10, u: 10 }, { w: 400, h: 400, W: 200 })
  const at = (f, x, y) => f.data[Math.round(y / GRID_STEP) * f.gw + Math.round(x / GRID_STEP)]
  assert.ok(at(g, 120, 200) > 0 && at(g, 280, 200) > 0, '两峰都应存在')
  // 中点处两个高斯各衰减 exp(−3·(80/40)²)=6e−6，几乎为 0
  assert.ok(Math.abs(at(g, 200, 200)) < 1e-3, `中点应接近 0：${at(g, 200, 200)}`)
})

test('T20e k（图像→画布缩放）等比缩放高度与半径', () => {
  const a = { site: { key: 't', scale: 0.2, radius: 0.2 }, pts: [{ x: 200, y: 200 }] }
  const f1 = heightField([a], { t: 10 }, { w: 400, h: 400, W: 200, k: 1 })
  // 同一张脸（W 不变）渲染到 2 倍大的画布上：k 翻倍 → 深度像素值翻倍
  const f2 = heightField([a], { t: 10 }, { w: 800, h: 800, W: 200, k: 2 })
  // 画布翻倍、k 翻倍 → 峰值也翻倍（同一张脸放大一倍，深度自然也放大一倍）
  // 容差 5%：网格采样点未必正落在峰顶，两次的偏差不同（实测 2.02）
  const ratio = heightPeak(f2).up / heightPeak(f1).up
  assert.ok(Math.abs(ratio - 2) < 0.05, `峰值比 ${ratio.toFixed(3)} 应约 2`)
  // 网格数是 ceil(w/step)+1，画布翻倍则格子数翻倍（+1 的取整误差容忍 1 个）
  assert.ok(Math.abs(f2.gw - 2 * f1.gw) <= 1, `gw: ${f1.gw} → ${f2.gw}`)
})

// ---------------------------------------------------------------- 2. 光影

test('T20f 平坦面 = 零变化（归一化是否成立，本层最要紧的一条）', () => {
  const f = { gw: 8, gh: 8, step: GRID_STEP, data: new Float32Array(64), w: 48, h: 48 }
  const s = shadeField(f)
  for (let i = 0; i < s.gw * s.gh; i++) {
    assert.equal(s.data[i * 4 + 3], 0, '平坦面必须完全透明 —— 否则整张脸会被平白压暗')
  }
})

test('T20g 凸起：迎光面提亮（>128），背光面压暗（<128）', () => {
  // 光从左上射来：凸包的左上侧是迎光面，右下侧是背光面
  const f = heightField([anchorAt(200, 200, 0.30)], { t: 15 }, OPTS)
  const s = shadeField(f)
  const at = (x, y) => {
    const i = Math.round(y / GRID_STEP) * s.gw + Math.round(x / GRID_STEP)
    return { g: s.data[i * 4], a: s.data[i * 4 + 3] }
  }
  const upLeft = at(200 - 30, 200 - 30)
  const downRight = at(200 + 30, 200 + 30)
  assert.ok(upLeft.a > 0 && downRight.a > 0, '两侧都应有光影')
  assert.ok(upLeft.g > 128, `左上应提亮，实际 ${upLeft.g}`)
  assert.ok(downRight.g < 128, `右下应压暗，实际 ${downRight.g}`)
})

test('T20h 凹陷与凸起的光影完全相反', () => {
  const bump = shadeField(heightField([anchorAt(200, 200, 0.30)], { t: 15 }, OPTS))
  const dent = shadeField(heightField([anchorAt(200, 200, 0.30)], { t: -15 }, OPTS))
  const at = (s, x, y) => s.data[(Math.round(y / GRID_STEP) * s.gw + Math.round(x / GRID_STEP)) * 4]
  const b = at(bump, 170, 170)
  const d = at(dent, 170, 170)
  // 同一位置：凸起提亮则凹陷压暗，且偏离 128 的方向相反
  assert.ok((b - 128) * (d - 128) < 0, `符号应相反：${b} vs ${d}`)
  assert.ok(Math.abs(b - 128) > 5, '偏离应足够可见')
})

test('T20i 换光源方向，高光跟着换边', () => {
  const f = heightField([anchorAt(200, 200, 0.30)], { t: 15 }, OPTS)
  const at = (s, x, y) => s.data[(Math.round(y / GRID_STEP) * s.gw + Math.round(x / GRID_STEP)) * 4]
  const left = shadeField(f, { light: LIGHT_DEFAULT })
  const right = shadeField(f, { light: { x: 0.42, y: 0.52, z: 0.74 } })
  assert.ok(at(left, 170, 170) > 128, '光在左上时左上提亮')
  assert.ok(at(right, 170, 170) < 128, '光换到右下后同一处应转为压暗')
})

test('T20j gain 与 strength：gain 放大对比，strength 只改 alpha', () => {
  const f = heightField([anchorAt(200, 200, 0.30)], { t: 15 }, OPTS)
  const at = (s, x, y) => s.data[(Math.round(y / GRID_STEP) * s.gw + Math.round(x / GRID_STEP)) * 4]
  const s1 = shadeField(f, { gain: 2 })
  const s2 = shadeField(f, { gain: 6 })
  assert.ok(Math.abs(at(s2, 170, 170) - 128) > Math.abs(at(s1, 170, 170) - 128), 'gain 越大越明显')
  const s3 = shadeField(f, { gain: 2, strength: 0.4 })
  const i = Math.round(170 / GRID_STEP) * s3.gw + Math.round(170 / GRID_STEP)
  assert.equal(s3.data[i * 4 + 3], Math.round(255 * 0.4))
  assert.equal(s3.data[i * 4], s1.data[i * 4], 'strength 只改 alpha，不改灰度')
})

test('T20k 网格疏密不改变观感（step 6 与 step 12 的峰值位置一致）', () => {
  const a = [anchorAt(200, 200, 0.30)]
  const f1 = heightField(a, { t: 15 }, { ...OPTS, step: 6 })
  const f2 = heightField(a, { t: 15 }, { ...OPTS, step: 12 })
  assert.ok(Math.abs(heightPeak(f1).up - heightPeak(f2).up) / heightPeak(f1).up < 0.02)
  assert.equal(f1.gw > f2.gw, true)
})

test('T20l reliefOf：一步到位，无档位返回 null', () => {
  assert.equal(reliefOf([anchorAt(200, 200, 0.30)], {}, OPTS), null)
  const r = reliefOf([anchorAt(200, 200, 0.30)], { t: 12 }, OPTS)
  assert.ok(r && r.data.length === r.gw * r.gh * 4)
  assert.equal(reliefOf([], { t: 12 }, OPTS), null)
})

/**
 * 取某点灰度。alpha 为 0 表示「无光影」，此时灰度未写入（读出来是 0），
 * 按语义应视作 128（中性）—— 直接读会得到「死黑」的错误结论。
 */
const grayAt = (s, x, y) => {
  const i = (Math.round(y / GRID_STEP) * s.gw + Math.round(x / GRID_STEP)) * 4
  return s.data[i + 3] === 0 ? 128 : s.data[i]
}

const BUMP = (lv) => heightField([anchorAt(200, 200, 0.3)], { t: lv }, OPTS)
// 采样偏移取 0.7r：再往外高斯已衰减到噪声量级，读不出信号
const OFF = Math.round(0.3 * 200 * 0.7)

test('T20n 镜面高光：只提亮迎光面，背光面一格不动', () => {
  const f = BUMP(20)
  const noSpec = shadeField(f, { ...OPTS, specular: 0, ao: 0 })
  const withSpec = shadeField(f, { ...OPTS, ao: 0 })
  const upNo = grayAt(noSpec, 200 - OFF, 200 - OFF)
  const upYes = grayAt(withSpec, 200 - OFF, 200 - OFF)
  const dnNo = grayAt(noSpec, 200 + OFF, 200 + OFF)
  const dnYes = grayAt(withSpec, 200 + OFF, 200 + OFF)
  assert.ok(upYes > upNo, `迎光应更亮：${upNo} → ${upYes}`)
  assert.equal(dnYes, dnNo, `背光应完全不动：${dnNo} → ${dnYes}`)
})

test('T20o 环境光遮蔽：只压凹陷，凸起一格不动', () => {
  // 少了「自身低于基准面」这道门，凸起周围会被压出一圈不自然的暗环
  const up = BUMP(20)
  const dn = BUMP(-20)
  assert.equal(
    grayAt(shadeField(up, OPTS), 200, 200),
    grayAt(shadeField(up, { ...OPTS, ao: 0 }), 200, 200),
    '凸起中心不应被遮蔽',
  )
  const dNo = grayAt(shadeField(dn, { ...OPTS, ao: 0 }), 200, 200)
  const dYes = grayAt(shadeField(dn, OPTS), 200, 200)
  assert.ok(dYes < dNo - 10, `凹陷中心应明显更暗：${dNo} → ${dYes}`)
})

test('T20p 凹陷档位越深越暗，不反弹（回归）', () => {
  // 曾踩过：极深凹陷的坑底四周一样深，sink 反趋近 0，
  // 导致档位 −20 最暗、−25 反而变亮 —— 用户调深却变亮，完全反直觉。
  const levels = [-10, -15, -20, -25, -30]
  const gs = levels.map((lv) => grayAt(shadeField(BUMP(lv), OPTS), 200, 200))
  for (let i = 1; i < gs.length; i++) {
    assert.ok(gs[i] <= gs[i - 1] + 1, `${levels[i - 1]}→${levels[i]} 不该变亮：${gs[i - 1]} → ${gs[i]}`)
  }
  assert.ok(gs[gs.length - 1] < gs[0] - 20, `整体应明显变暗：${gs[0]} → ${gs[gs.length - 1]}`)
})

test('T20q 凸起档位越深越亮，不早饱和', () => {
  const levels = [5, 10, 15, 20, 25, 30]
  const gs = levels.map((lv) => grayAt(shadeField(BUMP(lv), OPTS), 200 - OFF, 200 - OFF))
  for (let i = 1; i < gs.length; i++) {
    assert.ok(gs[i] > gs[i - 1], `${levels[i - 1]}→${levels[i]} 应继续变亮：${gs[i - 1]} → ${gs[i]}`)
  }
  assert.ok(gs[gs.length - 1] < 250, `满档不该打到纯白：${gs[gs.length - 1]}`)
})

test('T20r blurField：常数场与线性场都保持不变（滑动窗口正确性）', () => {
  const gw = 16
  const gh = 16
  const c = new Float32Array(gw * gh).fill(7.5)
  const bc = blurField(c, gw, gh, 3)
  for (let i = 0; i < c.length; i++) {
    assert.ok(Math.abs(bc[i] - 7.5) < 1e-6, `常数场应保持 7.5，实际 ${bc[i]}`)
  }
  // 线性场在对称窗口下均值 = 中心值；边界是 clamp-to-edge，会偏，故只查内部
  const lin = new Float32Array(gw * gh)
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) lin[y * gw + x] = x * 2 + y * 0.5
  const bl = blurField(lin, gw, gh, 3)
  for (let y = 3; y < gh - 3; y++) {
    for (let x = 3; x < gw - 3; x++) {
      assert.ok(
        Math.abs(bl[y * gw + x] - lin[y * gw + x]) < 1e-5,
        `线性场内部应保持 ${lin[y * gw + x]}，实际 ${bl[y * gw + x]}`,
      )
    }
  }
})

test('T20s 补光会削弱明暗对比 —— 这是默认只用主光的原因', () => {
  const f = BUMP(20)
  const solo = shadeField(f, { ...OPTS, rig: [{ ...LIGHT_DEFAULT, w: 1 }] })
  const filled = shadeField(f, {
    ...OPTS,
    rig: [{ ...LIGHT_DEFAULT, w: 1 }, { x: 0.62, y: -0.22, z: 0.75, w: 0.38 }],
  })
  const sContrast = grayAt(solo, 200 - OFF, 200 - OFF) - grayAt(solo, 200 + OFF, 200 + OFF)
  const fContrast = grayAt(filled, 200 - OFF, 200 - OFF) - grayAt(filled, 200 + OFF, 200 + OFF)
  assert.ok(fContrast < sContrast, `补光应削弱对比：${sContrast} → ${fContrast}`)
  assert.equal(LIGHT_RIG.length, 1, '默认光源组应只有主光')
})

test('T20m 输出不越界：灰度 0–255，alpha 0–255', () => {
  const r = reliefOf([anchorAt(200, 200, 0.15)], { t: 15 }, OPTS)
  for (let i = 0; i < r.gw * r.gh; i++) {
    const g = r.data[i * 4]
    const a = r.data[i * 4 + 3]
    assert.ok(g >= 0 && g <= 255, `灰度越界 ${g}`)
    assert.ok(a >= 0 && a <= 255, `alpha 越界 ${a}`)
    assert.equal(r.data[i * 4], r.data[i * 4 + 1])
    assert.equal(r.data[i * 4 + 1], r.data[i * 4 + 2])
  }
})
