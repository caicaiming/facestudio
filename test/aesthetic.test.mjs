/**
 * aesthetic.test.mjs —— 医美方案层
 * 覆盖：毫米标定（跨分辨率一致 / 性别）、档位↔毫米互逆、自动建议的触发与抑制、
 *       方案组装排序、文本导出的数值一致性与免责声明。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generateLandmarks, measureFace } from '../src/measure.js'
import { analyzeFace } from '../src/analyze.js'
import { frameFaceWidth, frameOf } from '../src/frame.js'
import { emptySites, siteOf } from '../src/zones.js'
import {
  IPD_MM,
  buildPlan,
  isInjectable,
  levelForMm,
  mmScale,
  renderPlanText,
  siteAmplitude,
  suggestFromMetrics,
} from '../src/aesthetic.js'

const ideal = () => generateLandmarks(1)
const scaled = (k) => generateLandmarks(k)

const M = (pts) => measureFace(pts, 600, 800, null, 1, null)
const A = (m) => analyzeFace(m)

// ---------------------------------------------------------------- 1. 毫米标定

test('T11a 毫米标定：瞳距像素 → mmPerPixel，面宽换算合理', () => {
  const pts = ideal()
  const s = mmScale(pts)
  assert.ok(s.ok)
  assert.ok(Math.abs(s.mmPerPixel - s.ipdMm / s.ipdPx) < 1e-12)
  // 成年人面宽约 130–150mm，模板脸按标准比例应在该量级
  assert.ok(s.faceWidthMm > 100 && s.faceWidthMm < 180, `面宽量级异常: ${s.faceWidthMm}`)
  assert.equal(s.ipdMm, IPD_MM.default)
})

test('T11b 毫米标定：性别与自定义瞳距生效', () => {
  const pts = ideal()
  assert.equal(mmScale(pts, { gender: 'female' }).ipdMm, 62)
  assert.equal(mmScale(pts, { gender: 'male' }).ipdMm, 64)
  assert.equal(mmScale(pts, { ipdMm: 70 }).ipdMm, 70)
  // 自定义瞳距优先于性别
  assert.equal(mmScale(pts, { gender: 'male', ipdMm: 58 }).ipdMm, 58)
})

test('T11c 毫米标定：照片放大后 mmPerPixel 变小，但面宽 mm 不变', () => {
  const a = mmScale(scaled(1))
  const b = mmScale(scaled(4))
  assert.ok(b.mmPerPixel < a.mmPerPixel, '放大后每像素代表的毫米应更小')
  assert.ok(Math.abs(a.faceWidthMm - b.faceWidthMm) < 1e-9, '同一张脸的面宽 mm 应一致')
})

test('T11d 毫米标定：瞳距不可用时不抛异常且 ok=false', () => {
  const s = mmScale([])
  assert.equal(s.ok, false)
  assert.equal(s.mmPerPixel, 0)
  assert.ok(s.note.length > 0)
})

// ---------------------------------------------------------------- 2. 档位 ↔ 毫米

test('T11e 档位 → 毫米：幅度与档位成正比，正负对称', () => {
  const pts = ideal()
  const s = mmScale(pts)
  const a = siteAmplitude(pts, 'chin', 10, s)
  const b = siteAmplitude(pts, 'chin', 5, s)
  const neg = siteAmplitude(pts, 'chin', -10, s)
  assert.ok(a.ok && a.mm > 0)
  assert.ok(Math.abs(a.mm - 2 * b.mm) < 1e-9, '幅度应与档位成正比')
  assert.ok(Math.abs(a.mm + neg.mm) < 1e-9, '正负档位应对称')
})

test('T11f 档位 ↔ 毫米互逆（round-trip）', () => {
  const pts = ideal()
  const s = mmScale(pts)
  // 取 1.5mm：所有测试部位都在 ±15 档位范围内，不触发钳制（钳制另见 T11h）
  for (const key of ['chin', 'malar', 'temple', 'noseDorsum', 'masseter']) {
    const target = 1.5
    const level = levelForMm(pts, key, target, s)
    assert.ok(Math.abs(level) < 15, `${key} 档位应未触发钳制: ${level}`)
    const back = siteAmplitude(pts, key, level, s)
    assert.ok(Math.abs(back.mm - target) < 1e-9, `${key} round-trip 失败: ${back.mm} ≠ ${target}`)
  }
})

test('T11g 档位 → 毫米：档位为 0 或尺度不可用时返回 ok=false', () => {
  const pts = ideal()
  const s = mmScale(pts)
  assert.equal(siteAmplitude(pts, 'chin', 0, s).ok, false)
  assert.equal(siteAmplitude(pts, 'chin', 10, mmScale([])).ok, false)
  assert.equal(siteAmplitude(pts, '不存在的部位', 10, s).ok, false)
})

test('T11h 档位钳制：levelForMm 结果不超过 ±15', () => {
  const pts = ideal()
  const s = mmScale(pts)
  assert.equal(levelForMm(pts, 'chin', 999, s), 15)
  assert.equal(levelForMm(pts, 'chin', -999, s), -15)
})

// ---------------------------------------------------------------- 3. 自动建议

test('T11i 自动建议：下庭偏短 → 建议颏部填充，带依据数值', () => {
  const pts = ideal()
  const m = M(pts)
  const s = mmScale(pts, { faceHeightPx: m.faceHeight })
  // 人为压短下庭
  const short = { ...m, three: { ...m.three, lower: 0.26 } }
  const out = suggestFromMetrics(pts, short, s, {})
  const chin = out.find((o) => o.key === 'chin')
  assert.ok(chin, '下庭偏短应给出颏部建议')
  assert.ok(chin.mm > 0 && chin.mm <= 6, `建议幅度异常: ${chin.mm}`)
  assert.ok(chin.evidence.includes('26.0%'), `依据应包含实测数值: ${chin.evidence}`)
  assert.ok(chin.evidence.includes('下庭占比'))
})

test('T11j 自动建议：已手动设定的部位不再重复建议', () => {
  const pts = ideal()
  const m = M(pts)
  const s = mmScale(pts, { faceHeightPx: m.faceHeight })
  const short = { ...m, three: { ...m.three, lower: 0.26 } }
  const out = suggestFromMetrics(pts, short, s, { chin: 8 })
  assert.ok(!out.some((o) => o.key === 'chin'), '已设定的颏部不应再建议')
})

test('T11k 自动建议：对称偏差过大 → 给排查提示而非项目建议', () => {
  const pts = ideal()
  const m = M(pts)
  const s = mmScale(pts, { faceHeightPx: m.faceHeight })
  const asym = { ...m, symmetry: 28 }
  const out = suggestFromMetrics(pts, asym, s, {})
  const sym = out.find((o) => o.key === '__symmetry__')
  assert.ok(sym, '应给出对称排查提示')
  assert.equal(sym.confidence, 'high')
  assert.ok(sym.reason.includes('拍摄'), '应提示排查拍摄条件')
  assert.ok(sym.evidence.includes('28.0'), '应带实测数值')
})

test('T11l 自动建议：上庭偏长 → 明确归为非注射项目', () => {
  const pts = ideal()
  const m = M(pts)
  const s = mmScale(pts, { faceHeightPx: m.faceHeight })
  const tall = { ...m, three: { ...m.three, upper: 0.42 } }
  const out = suggestFromMetrics(pts, tall, s, {})
  const h = out.find((o) => o.key === '__hairline__')
  assert.ok(h, '应给出发际线提示')
  assert.ok(h.reason.includes('注射'), '应说明注射类项目无法改善')
  assert.equal(h.mm, 0, '不应给出注射幅度')
})

test('T11m 自动建议：指标无效或尺度不可用时返回空', () => {
  const pts = ideal()
  assert.deepEqual(suggestFromMetrics(pts, null, mmScale(pts), {}), [])
  assert.deepEqual(suggestFromMetrics(pts, { valid: false }, mmScale(pts), {}), [])
  assert.deepEqual(suggestFromMetrics(pts, M(pts), mmScale([]), {}), [])
})

// ---------------------------------------------------------------- 4. 方案组装

test('T11n 方案组装：已设定部位进入 items，含项目 / 剂量 / 风险', () => {
  const pts = ideal()
  const m = M(pts)
  const plan = buildPlan(pts, {
    metrics: m,
    score: A(m).score,
    siteValues: { ...emptySites(), temple: 8, chin: 6 },
  })
  assert.equal(plan.items.length, 2)
  const temple = plan.items.find((i) => i.key === 'temple')
  assert.ok(temple.mm > 0)
  assert.ok(temple.projects.length > 0)
  assert.ok(temple.doseRef.length > 0)
  assert.equal(temple.risk, 'high')
  assert.ok(temple.riskText.includes('高风险'))
})

test('T11o 方案组装：高风险部位排在前面', () => {
  const pts = ideal()
  const plan = buildPlan(pts, {
    metrics: M(pts),
    siteValues: { ...emptySites(), chin: 10, temple: 5, upperLip: 8 },
  })
  const risks = plan.items.map((i) => i.risk)
  const order = { high: 0, mid: 1, low: 2 }
  for (let i = 1; i < risks.length; i++) {
    assert.ok(order[risks[i - 1]] <= order[risks[i]], '风险等级应非递减')
  }
})

test('T11p 方案组装：高风险部位触发警告，对称偏差触发警告', () => {
  const pts = ideal()
  const m = M(pts)
  const p1 = buildPlan(pts, { metrics: m, siteValues: { ...emptySites(), temple: 6 } })
  assert.ok(p1.warnings.some((w) => w.includes('高风险部位')))

  const p2 = buildPlan(pts, { metrics: { ...m, symmetry: 25 }, siteValues: {} })
  assert.ok(p2.warnings.some((w) => w.includes('对称')))
})

test('T11q 方案组装：空档位时 items 为空且不抛异常', () => {
  const pts = ideal()
  const plan = buildPlan(pts, { metrics: M(pts), siteValues: emptySites() })
  assert.equal(plan.items.length, 0)
  assert.ok(plan.text.includes('未设定任何部位调整'))
})

// ---------------------------------------------------------------- 5. 文本导出

test('T11r 文本导出：含免责声明、尺度说明、项目与测量数据', () => {
  const pts = ideal()
  const m = M(pts)
  const sc = A(m).score
  const plan = buildPlan(pts, {
    metrics: m,
    score: sc,
    adjustedMetrics: m,
    adjustedScore: sc,
    siteValues: { ...emptySites(), chin: 7 },
  })
  const t = plan.text
  assert.ok(t.includes('非医疗建议'), '应含非医疗建议声明')
  assert.ok(t.includes('不构成医疗诊断'), '应含免责声明全文')
  assert.ok(t.includes('瞳距'), '应含尺度标定说明')
  assert.ok(t.includes('颏尖'), '应含项目名')
  assert.ok(t.includes('玻尿酸隆颏'), '应含具体项目')
  assert.ok(t.includes('三庭'), '应含测量数据')
  assert.ok(t.includes(sc.grade), '应含评级')
})

test('T11s 文本导出：数值与测量值一致（红线约束）', () => {
  const pts = ideal()
  const m = M(pts)
  const plan = buildPlan(pts, { metrics: m, score: A(m).score, siteValues: {} })
  const lower = (m.three.lower * 100).toFixed(1)
  assert.ok(plan.text.includes(`${lower}%`), `文本应含实测下庭占比 ${lower}%`)
  const sym = m.symmetry.toFixed(1)
  assert.ok(plan.text.includes(`${sym}%`), `文本应含实测对称偏差 ${sym}%`)
})

test('T11t 文本导出：纯函数，同一输入两次渲染一致', () => {
  const pts = ideal()
  const m = M(pts)
  const p = {
    scale: mmScale(pts),
    items: [],
    suggestions: [],
    warnings: ['测试警告'],
    disclaimer: 'D',
    metrics: m,
  }
  assert.equal(renderPlanText(p), renderPlanText(p))
})

test('T11u 注射类判定：填充 / 隆鼻 / 肉毒为注射类，纯收紧类不是', () => {
  assert.equal(isInjectable(siteOf('chin')), true) // 玻尿酸隆颏
  assert.equal(isInjectable(siteOf('temple')), true) // 玻尿酸填充
  assert.equal(isInjectable(siteOf('masseter')), true) // 肉毒
  assert.equal(isInjectable(siteOf('jawline')), true) // 含肉毒素（颈阔肌）
  assert.equal(isInjectable(siteOf('jowl')), false) // 仅收紧 / 溶脂，无注射项目
  assert.equal(isInjectable(null), false)
})

test('T11v 面宽毫米与规范面宽一致（跨分辨率）', () => {
  const a = mmScale(scaled(1))
  const b = mmScale(scaled(3))
  const wa = frameFaceWidth(scaled(1), frameOf(scaled(1)))
  const wb = frameFaceWidth(scaled(3), frameOf(scaled(3)))
  assert.ok(Math.abs(wa * a.mmPerPixel - wb * b.mmPerPixel) < 1e-9)
})
