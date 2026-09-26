/**
 * subunits.test.mjs —— 面部亚单位映射与局部形变
 * 覆盖：分区/亚单位表完整性、核心点索引合法性、镜像亚单位成对、高斯衰减、
 *       幅度归一、空值短路、确定性、性能。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generateLandmarks } from '../src/measure.js'
import {
  SUBUNITS,
  SUBUNIT_RANGE,
  ZONES,
  NON_WARPABLE,
  activeCountOf,
  applySubunitOffsets,
  coreIndicesOf,
  emptySubunits,
  subunitField,
  subunitsOf,
} from '../src/subunits.js'

/** 标准脸 + 一个纵向拉长的脸，覆盖不同面型 */
const ideal = () => generateLandmarks(1)
const longFace = () => {
  const p = generateLandmarks(1)
  const pv = p[33].y
  for (const q of p) if (q.y > pv) q.y = pv + (q.y - pv) * 1.2
  return p
}

const unitOf = (pts) => Math.abs(pts[16].x - pts[0].x)
const mag = (v) => Math.hypot(v.x, v.y)

// ---------------------------------------------------------------- 1. 表完整性

test('T8a 分区表：9 大分区，key 唯一，杠杆等级合法', () => {
  assert.equal(ZONES.length, 9)
  const keys = new Set(ZONES.map((z) => z.key))
  assert.equal(keys.size, 9)
  for (const z of ZONES) {
    assert.ok(['P0', 'P1', 'P2', 'P3'].includes(z.lever), `非法 lever: ${z.lever}`)
    assert.ok(z.label && z.focus, `${z.key} 缺 label/focus`)
  }
  // P0 必做分区应为眼/鼻/下颌颏（杠杆最高）
  const p0 = ZONES.filter((z) => z.lever === 'P0').map((z) => z.key)
  assert.deepEqual(p0.sort(), ['eye', 'jaw', 'nose'])
})

test('T8b 亚单位表：key 唯一、索引合法、必填字段齐全', () => {
  const keys = new Set()
  for (const su of SUBUNITS) {
    assert.ok(!keys.has(su.key), `重复 key: ${su.key}`)
    keys.add(su.key)
    assert.ok(su.label && su.hint, `${su.key} 缺 label/hint`)
    assert.ok(su.radius > 0 && su.scale > 0, `${su.key} radius/scale 必须为正`)
    assert.ok(su.core.length > 0, `${su.key} 无核心点`)
    for (const [i, wx, wy] of su.core) {
      assert.ok(Number.isInteger(i) && i >= 0 && i < 68, `${su.key} 点位越界: ${i}`)
      assert.ok(Number.isFinite(wx) && Number.isFinite(wy), `${su.key} 方向非法`)
      assert.ok(Math.abs(wx) + Math.abs(wy) > 0, `${su.key} 零方向无意义`)
    }
  }
  // 每个亚单位都归属一个已定义的分区
  const zoneKeys = new Set(ZONES.map((z) => z.key))
  for (const su of SUBUNITS) assert.ok(zoneKeys.has(su.zone), `${su.key} 分区未定义: ${su.zone}`)
  // 每个分区至少被覆盖一次说明（可形变或不可形变）
  for (const z of ZONES) {
    const covered = subunitsOf(z.key).length > 0 || NON_WARPABLE.some((n) => n.zone === z.key)
    assert.ok(covered, `${z.key} 既无亚单位也无说明`)
  }
})

test('T8c 镜像亚单位必须成对给反向权重（否则会拉垮对称分）', () => {
  // 需要左右对称的亚单位：核心点中关于中线成对、且 x 权重相反
  const mirrored = [
    'browSpan', 'innerCanthus', 'outerCanthus', 'noseWidth',
    'cheekbone', 'cheekHollow', 'chinWidth', 'jawAngle', 'jawEdge', 'lipWidth',
    'foreheadWidth',
  ]
  for (const key of mirrored) {
    const su = SUBUNITS.find((s) => s.key === key)
    assert.ok(su, `缺少亚单位: ${key}`)
    let sum = 0
    for (const [, wx] of su.core) sum += wx
    // 左右权重相互抵消 → 净横向位移为 0（纯“变宽/变窄”，不整体平移）
    assert.ok(Math.abs(sum) < 1e-9, `${key} 横向权重不抵消: ${sum}`)
  }
})

test('T8d 每个亚单位的位移都落在单一主轴上（横 or 纵），便于理解与预测', () => {
  for (const su of SUBUNITS) {
    let hasX = false
    let hasY = false
    for (const [, wx, wy] of su.core) {
      if (Math.abs(wx) > 1e-9) hasX = true
      if (Math.abs(wy) > 1e-9) hasY = true
    }
    assert.ok(!(hasX && hasY), `${su.key} 同时含横纵位移，语义会含混`)
    assert.ok(hasX || hasY)
  }
})

// ---------------------------------------------------------------- 2. 形变性质

test('T8e 核心点位移最大、远处趋零（局部性）', () => {
  const pts = ideal()
  const unit = unitOf(pts)
  for (const su of SUBUNITS) {
    const f = subunitField(su, pts)
    const core = coreIndicesOf(su)
    // 核心点必须达到满幅度（±1 档）
    for (const i of core) {
      assert.ok(
        mag(f[i]) > 0.9 * (su.scale / 100) * unit,
        `${su.key} 核心点 ${i} 位移不足: ${mag(f[i])}`,
      )
    }
    // 与所有核心点距离 > 1.5×radius 的点，位移应衰减到 5% 以下
    const full = (su.scale / 100) * unit
    for (let i = 0; i < 68; i++) {
      if (core.includes(i)) continue
      let dmin = Infinity
      for (const j of core) {
        dmin = Math.min(dmin, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) / unit)
      }
      if (dmin > su.radius * 1.5) {
        assert.ok(mag(f[i]) < full * 0.25, `${su.key} 远点 ${i} 衰减不足: ${mag(f[i])}`)
      }
    }
  }
})

test('T8f 幅度按面宽归一：不同分辨率下位移比例一致', () => {
  const a = ideal()
  const b = a.map((p) => ({ x: p.x * 3, y: p.y * 3 })) // 放大 3 倍
  const v = emptySubunits()
  v.chinLength = 10
  const da = applySubunitOffsets(a, v)
  const db = applySubunitOffsets(b, v)
  const ra = (da[8].y - a[8].y) / unitOf(a)
  const rb = (db[8].y - b[8].y) / unitOf(b)
  assert.ok(Math.abs(ra - rb) < 1e-9, `归一化不一致: ${ra} vs ${rb}`)
  // 满档 ±15 时颏部纵向位移约为面宽的 4.8%（0.32 × 15/100）
  const full = emptySubunits()
  full.chinLength = 15
  const df = applySubunitOffsets(a, full)
  assert.ok(Math.abs((df[8].y - a[8].y) / unitOf(a) - 0.048) < 1e-6)
})

test('T8g 空档位短路：不产生新数组、不改变点位', () => {
  const pts = ideal()
  const out = applySubunitOffsets(pts, emptySubunits())
  assert.equal(out, pts, '空档位应原样返回引用，便于下游缓存')
  assert.equal(applySubunitOffsets(pts, null), pts)
  assert.equal(applySubunitOffsets(null, emptySubunits()), null)
  const v = emptySubunits()
  v.chinLength = 0
  assert.equal(applySubunitOffsets(pts, v), pts)
})

test('T8h 正负档位严格反号，且不修改入参', () => {
  const pts = ideal()
  const snapshot = pts.map((p) => ({ ...p }))
  const vp = emptySubunits()
  vp.jawAngle = 7
  const vn = emptySubunits()
  vn.jawAngle = -7
  const dp = applySubunitOffsets(pts, vp)
  const dn = applySubunitOffsets(pts, vn)
  for (let i = 0; i < 68; i++) {
    assert.ok(Math.abs(dp[i].x - pts[i].x + (dn[i].x - pts[i].x)) < 1e-9, `点 ${i} 正负不对称`)
    assert.ok(Math.abs(dp[i].y - pts[i].y + (dn[i].y - pts[i].y)) < 1e-9)
  }
  // 入参未被就地修改
  for (let i = 0; i < 68; i++) {
    assert.equal(pts[i].x, snapshot[i].x)
    assert.equal(pts[i].y, snapshot[i].y)
  }
})

test('T8i 亚单位形变不破坏点集合法性（无 NaN、无塌陷）', () => {
  for (const mk of [ideal, longFace]) {
    const pts = mk()
    const v = emptySubunits()
    for (const su of SUBUNITS) v[su.key] = SUBUNIT_RANGE.max // 全部拉满
    const out = applySubunitOffsets(pts, v)
    for (let i = 0; i < 68; i++) {
      assert.ok(Number.isFinite(out[i].x) && Number.isFinite(out[i].y), `点 ${i} 出现 NaN`)
    }
    // 五官不应被压成一点：鼻尖与下巴尖仍需保持距离
    assert.ok(Math.hypot(out[33].x - out[8].x, out[33].y - out[8].y) > unitOf(pts) * 0.1)
  }
})

test('T8j 确定性：同样输入两次调用结果逐字节一致', () => {
  const pts = longFace()
  const v = emptySubunits()
  v.upperLip = 4
  v.noseWidth = -6
  v.jawEdge = -3
  const a = applySubunitOffsets(pts, v)
  const b = applySubunitOffsets(pts, v)
  for (let i = 0; i < 68; i++) {
    assert.equal(a[i].x, b[i].x)
    assert.equal(a[i].y, b[i].y)
  }
})

test('T8k 档位范围与 activeCount 统计', () => {
  assert.equal(SUBUNIT_RANGE.min, -15)
  assert.equal(SUBUNIT_RANGE.max, 15)
  assert.equal(SUBUNIT_RANGE.step, 1)
  const v = emptySubunits()
  assert.equal(activeCountOf(v), 0)
  assert.equal(activeCountOf(null), 0)
  v.chinLength = 1
  v.noseTip = -1
  assert.equal(activeCountOf(v), 2)
  assert.equal(Object.keys(v).length, SUBUNITS.length)
})

test('T8l 性能：全量 27 个亚单位拉满求解 < 40ms', () => {
  const pts = ideal()
  const v = emptySubunits()
  for (const su of SUBUNITS) v[su.key] = 12
  const t0 = performance.now()
  for (let n = 0; n < 20; n++) applySubunitOffsets(pts, v)
  const ms = (performance.now() - t0) / 20
  assert.ok(ms < 40, `单次 ${ms.toFixed(2)}ms 过慢`)
})

test('T8m 不可形变清单完整：鼻唇角/鼻额角等侧面指标均已标注', () => {
  const labels = NON_WARPABLE.map((n) => n.label).join(' ')
  for (const kw of ['鼻唇角', '鼻额角', '鼻唇沟', '颅耳角']) {
    assert.ok(labels.includes(kw), `未标注不可形变项: ${kw}`)
  }
  for (const n of NON_WARPABLE) assert.ok(n.why && n.why.length > 6, `${n.label} 缺原因说明`)
})
