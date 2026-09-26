/**
 * zones.test.mjs —— 医美部位层
 * 覆盖：部位表完整性、规范坐标跨脸一致性（旋转 / 缩放 / 平移不变）、
 *       部位点的解剖位置合理性、成对部位镜像、高斯衰减形变、空值短路。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generateLandmarks } from '../src/measure.js'
import { buildFrame, project } from '../src/frame.js'
import {
  SITES,
  SITE_ZONES,
  applySiteOffsets,
  emptySites,
  siteAnchors,
  siteOf,
  sitesOf,
  zoneContext,
} from '../src/zones.js'

const ideal = () => generateLandmarks(1)

/** 长脸：下半脸纵向拉长 1.2 倍（额头比例随之变化） */
const longFace = () => {
  const p = generateLandmarks(1)
  const pv = p[33].y
  for (const q of p) if (q.y > pv) q.y = pv + (q.y - pv) * 1.2
  return p
}

/** 对点集做相似变换：旋转 θ、缩放 s、平移 (tx,ty) */
const transform = (pts, { rot = 0, scale = 1, tx = 0, ty = 0 } = {}) => {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return pts.map((p) => ({
    x: scale * (p.x * c - p.y * s) + tx,
    y: scale * (p.x * s + p.y * c) + ty,
  }))
}

const mag = (v) => Math.hypot(v.x, v.y)

// ---------------------------------------------------------------- 1. 表完整性

test('T10a 分区表：8 个分区，key 唯一，lever 合法', () => {
  assert.equal(SITE_ZONES.length, 8)
  const keys = new Set(SITE_ZONES.map((z) => z.key))
  assert.equal(keys.size, 8)
  for (const z of SITE_ZONES) {
    assert.ok(['P0', 'P1', 'P2'].includes(z.lever), `非法 lever: ${z.lever}`)
    assert.ok(z.label && z.note, `${z.key} 缺 label/note`)
  }
  const p0 = SITE_ZONES.filter((z) => z.lever === 'P0').map((z) => z.key)
  assert.deepEqual(p0.sort(), ['cheek', 'chin', 'nose', 'periorbital'])
})

test('T10b 部位表：key 唯一、字段齐全、控制点定义互斥', () => {
  const keys = new Set()
  for (const s of SITES) {
    assert.ok(!keys.has(s.key), `重复 key: ${s.key}`)
    keys.add(s.key)
    assert.ok(s.label && s.zone, `${s.key} 缺 label/zone`)
    assert.ok(SITE_ZONES.some((z) => z.key === s.zone), `${s.key} 的 zone 不存在: ${s.zone}`)
    assert.ok(s.radius > 0 && s.scale > 0, `${s.key} radius/scale 必须为正`)
    assert.ok(['high', 'mid', 'low'].includes(s.risk), `${s.key} risk 非法: ${s.risk}`)
    assert.ok(s.projects.length > 0, `${s.key} 无适用项目`)

    // 控制点定义三选一：idx（中轴）/ idxPair（成对索引）/ at（规范坐标公式）
    const modes = [s.idx, s.idxPair, s.at].filter(Boolean).length
    assert.equal(modes, 1, `${s.key} 必须且只能有一种控制点定义`)

    if (s.idxPair) {
      assert.equal(s.idxPair.length, 2, `${s.key} idxPair 必须两个索引`)
      for (const i of s.idxPair) {
        assert.ok(Number.isInteger(i) && i >= 0 && i < 68, `${s.key} 索引越界: ${i}`)
      }
      assert.equal(s.pair, true, `${s.key} idxPair 必须声明 pair`)
    }
    if (s.idx) {
      for (const i of s.idx) {
        assert.ok(Number.isInteger(i) && i >= 0 && i < 68, `${s.key} 索引越界: ${i}`)
      }
    }
    if (s.at) assert.equal(typeof s.at, 'function', `${s.key} at 必须是函数`)
    // dir 必须是有限数且非零（规范坐标 {u, v}，不是 {x, y}）
    assert.ok(Number.isFinite(s.dir.u) && Number.isFinite(s.dir.v), `${s.key} dir 非法`)
    assert.ok(Math.hypot(s.dir.u, s.dir.v) > 0, `${s.key} dir 不能为零向量`)
  }
  // 覆盖医美高频部位：额头、太阳穴、苹果肌、泪沟、鼻基底、咬肌缺一不可
  for (const k of ['foreheadCenter', 'temple', 'malar', 'tearTrough', 'noseBase', 'masseter']) {
    assert.ok(siteOf(k), `缺少高频部位: ${k}`)
  }
})

// ---------------------------------------------------------------- 2. 跨脸一致性

test('T10c 锚量上下文：旋转 / 缩放 / 平移后规范坐标不变', () => {
  const base = zoneContext(ideal())
  const moved = zoneContext(transform(ideal(), { rot: 0.35, scale: 2.7, tx: 180, ty: -95 }))

  for (const k of Object.keys(base)) {
    if (k === 'frame') continue
    assert.ok(
      Math.abs(base[k] - moved[k]) < 1e-9,
      `锚量 ${k} 随姿态变化: ${base[k]} → ${moved[k]}`,
    )
  }
})

test('T10d 部位控制点：相似变换后规范坐标不变（跨脸一致的必要条件）', () => {
  const pts = ideal()
  const moved = transform(pts, { rot: -0.28, scale: 1.9, tx: 240, ty: 60 })

  const a = siteAnchors(pts, zoneContext(pts))
  const b = siteAnchors(moved, zoneContext(moved))
  assert.equal(a.length, b.length)

  for (let i = 0; i < a.length; i++) {
    const fa = buildFrame(pts)
    const fb = buildFrame(moved)
    for (let k = 0; k < a[i].pts.length; k++) {
      const ca = project(a[i].pts[k], fa)
      const cb = project(b[i].pts[k], fb)
      assert.ok(Math.abs(ca.u - cb.u) < 1e-8, `${a[i].site.key} u 漂移: ${ca.u} → ${cb.u}`)
      assert.ok(Math.abs(ca.v - cb.v) < 1e-8, `${a[i].site.key} v 漂移: ${ca.v} → ${cb.v}`)
    }
  }
})

test('T10e 部位点落在正确的解剖位置（长脸 vs 标准脸各自自适应）', () => {
  for (const pts of [ideal(), longFace()]) {
    const ctx = zoneContext(pts)
    const anchors = siteAnchors(pts, ctx)
    const get = (key) => anchors.find((a) => a.site.key === key)
    const V = (key) => {
      const a = get(key)
      return project(a.pts[0], ctx.frame).v
    }
    const U = (key, k = 0) => {
      const a = get(key)
      return project(a.pts[k], ctx.frame).u
    }

    // 额部中央必须在眉线之上、发际线之下
    const vFore = V('foreheadCenter')
    assert.ok(vFore < ctx.vBrowTop, `额部中央应在眉线之上: ${vFore} vs ${ctx.vBrowTop}`)
    assert.ok(vFore > ctx.vHairline, `额部中央应在发际线之下: ${vFore} vs ${ctx.vHairline}`)

    // 太阳穴：横向超出面半宽、纵向在眉线与眼裂之间
    assert.ok(Math.abs(U('temple', 1)) > ctx.uHalf * 0.95, '太阳穴应在面宽外侧')
    const vTemple = project(get('temple').pts[1], ctx.frame).v
    assert.ok(vTemple > ctx.vBrowTop && vTemple < ctx.vEyeBottom, '太阳穴纵向应在眉线与眼裂之间')

    // 苹果肌：眼下、鼻底之上，且在中轴与面宽之间
    const vMalar = project(get('malar').pts[1], ctx.frame).v
    assert.ok(vMalar > ctx.vEyeBottom, '苹果肌应在眼裂之下')
    assert.ok(vMalar < ctx.vSubnasal, '苹果肌应在鼻底之上')
    assert.ok(Math.abs(U('malar', 1)) < ctx.uHalf, '苹果肌应在面宽之内')

    // 泪沟：眼下、比苹果肌更靠内
    assert.ok(Math.abs(U('tearTrough', 1)) < Math.abs(U('malar', 1)), '泪沟应比苹果肌更靠内')

    // 鼻基底：鼻底高度、鼻翼宽度附近
    const vBase = project(get('noseBase').pts[1], ctx.frame).v
    assert.ok(Math.abs(vBase - ctx.vSubnasal) < 1e-9, '鼻基底应在鼻底高度')

    // 咬肌：下颌角高度附近、面宽外侧
    const vMass = project(get('masseter').pts[1], ctx.frame).v
    assert.ok(vMass > ctx.vSubnasal, '咬肌应在鼻底之下')
    assert.ok(vMass < ctx.vChin, '咬肌应在下巴之上')
  }
})

test('T10f 长脸与标准脸：额部点相对位置自适应（不写死绝对坐标）', () => {
  const a = zoneContext(ideal())
  const b = zoneContext(longFace())
  // 长脸的下庭更长，发际线到下巴的纵向跨度更大
  assert.ok(b.vChin - b.vHairline > a.vChin - a.vHairline, '长脸纵向跨度应更大')

  const fa = siteAnchors(ideal(), a)
  const fb = siteAnchors(longFace(), b)
  const vA = project(fa.find((x) => x.site.key === 'foreheadCenter').pts[0], a.frame).v
  const vB = project(fb.find((x) => x.site.key === 'foreheadCenter').pts[0], b.frame).v
  // 额部中央始终取「眉到发际线的中点」，故在两种脸型上的相对位置一致
  const rA = (a.vBrowTop - vA) / (a.vBrowTop - a.vHairline)
  const rB = (b.vBrowTop - vB) / (b.vBrowTop - b.vHairline)
  assert.ok(Math.abs(rA - rB) < 1e-9, `额部点相对位置应恒定: ${rA} vs ${rB}`)
  assert.ok(Math.abs(rA - 0.5) < 1e-9, '额部中央应为眉到发际线的中点')
})

// ---------------------------------------------------------------- 3. 成对部位

test('T10g 成对部位：控制点左右镜像、方向左右对称', () => {
  const pts = ideal()
  const ctx = zoneContext(pts)
  const anchors = siteAnchors(pts, ctx)

  let pairCount = 0
  for (const { site, pts: cp, dirs } of anchors) {
    if (!site.pair) {
      assert.equal(cp.length, 1, `${site.key} 非成对部位应只有一个控制点`)
      continue
    }
    pairCount++
    assert.equal(cp.length, 2, `${site.key} 成对部位应有两个控制点`)
    const lu = project(cp[0], ctx.frame).u
    const ru = project(cp[1], ctx.frame).u
    assert.ok(lu < 0 && ru > 0, `${site.key} 左右控制点应在中轴两侧: ${lu} / ${ru}`)
    // 模板脸左右对称，故 |u| 应相等
    assert.ok(Math.abs(lu + ru) < 1e-9, `${site.key} 左右不对称: ${lu} / ${ru}`)
    // 方向：纵向分量一致，横向分量相反
    assert.ok(Math.abs(dirs[0].y - dirs[1].y) < 1e-9, `${site.key} 方向纵向分量应一致`)
  }
  assert.ok(pairCount >= 10, `成对部位数量不足: ${pairCount}`)
})

test('T10h 成对部位形变：左右位移镜像，中轴点不横向移动', () => {
  const pts = ideal()
  const values = emptySites()
  values.malar = 12 // 苹果肌填充
  const out = applySiteOffsets(pts, values)

  const mid = [8, 27, 30, 33, 51, 62, 66]
  for (const i of mid) {
    assert.ok(Math.abs(out[i].x - pts[i].x) < 1e-6, `中轴点 ${i} 不应横向移动`)
  }
  // 位移量非零
  const moved = out.some((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y) > 1e-6)
  assert.ok(moved, '苹果肌档位应产生位移')
})

// ---------------------------------------------------------------- 4. 形变行为

test('T10i 高斯衰减：控制点处位移最大，远处衰减', () => {
  const pts = ideal()
  const values = emptySites()
  values.chin = 10
  const out = applySiteOffsets(pts, values)

  // 颏尖（8）位移应显著大于下颌角附近（0/16）
  const d8 = Math.hypot(out[8].x - pts[8].x, out[8].y - pts[8].y)
  const d0 = Math.hypot(out[0].x - pts[0].x, out[0].y - pts[0].y)
  const d16 = Math.hypot(out[16].x - pts[16].x, out[16].y - pts[16].y)
  assert.ok(d8 > d0 * 2, `颏尖位移应远大于下颌角: ${d8} vs ${d0}`)
  assert.ok(d8 > d16 * 2, `颏尖位移应远大于下颌角: ${d8} vs ${d16}`)
  // 眉眼区域几乎不受影响
  const dEye = Math.hypot(out[36].x - pts[36].x, out[36].y - pts[36].y)
  assert.ok(dEye < d8 * 0.02, `眼区不应被颏部形变带动: ${dEye} vs ${d8}`)
})

test('T10j 档位方向：＋ 为填充外推，− 为收紧内收', () => {
  const pts = ideal()
  const pos = applySiteOffsets(pts, { ...emptySites(), chin: 10 })
  const neg = applySiteOffsets(pts, { ...emptySites(), chin: -10 })
  // 颏部 dir 为 (0, +1)：＋ 档位下巴变长（y 增大），− 档位变短
  assert.ok(pos[8].y > pts[8].y, '＋ 档位应加长下巴')
  assert.ok(neg[8].y < pts[8].y, '− 档位应缩短下巴')
  assert.ok(Math.abs(pos[8].y - pts[8].y - (pts[8].y - neg[8].y)) < 1e-6, '正负档位应对称')
})

test('T10k 幅度归一：缩放后位移按面宽同比放大', () => {
  const pts = ideal()
  const big = transform(pts, { scale: 3 })
  const values = { ...emptySites(), malar: 10 }
  const d1 = applySiteOffsets(pts, values)
  const d2 = applySiteOffsets(big, values)
  const r1 = Math.hypot(d1[8].x - pts[8].x, d1[8].y - pts[8].y) / Math.abs(pts[16].x - pts[0].x)
  const r2 = Math.hypot(d2[8].x - big[8].x, d2[8].y - big[8].y) / Math.abs(big[16].x - big[0].x)
  assert.ok(Math.abs(r1 - r2) < 1e-9, `位移应按面宽归一: ${r1} vs ${r2}`)
})

test('T10l 空值短路与不可变性', () => {
  const pts = ideal()
  const snapshot = pts.map((p) => ({ ...p }))

  assert.equal(applySiteOffsets(pts, null), pts, 'null 档位应原样返回')
  assert.equal(applySiteOffsets(pts, emptySites()), pts, '全零档位应原样返回')
  // 非法点集不抛异常
  assert.equal(applySiteOffsets([], { chin: 5 }).length, 0)

  applySiteOffsets(pts, { ...emptySites(), temple: 8, malar: -6 })
  for (let i = 0; i < 68; i++) {
    assert.equal(pts[i].x, snapshot[i].x, `入参被修改: ${i}.x`)
    assert.equal(pts[i].y, snapshot[i].y, `入参被修改: ${i}.y`)
  }
})

test('T10m 确定性：同一输入两次调用结果一致', () => {
  const pts = ideal()
  const values = { ...emptySites(), foreheadCenter: 9, temple: -7, noseBase: 6 }
  const a = applySiteOffsets(pts, values)
  const b = applySiteOffsets(pts, values)
  for (let i = 0; i < 68; i++) {
    assert.equal(a[i].x, b[i].x)
    assert.equal(a[i].y, b[i].y)
  }
})

test('T10n 分区查询与空档位表', () => {
  const e = emptySites()
  assert.equal(Object.keys(e).length, SITES.length)
  for (const k of Object.keys(e)) assert.equal(e[k], 0)

  const cheek = sitesOf('cheek')
  assert.ok(cheek.length >= 4, '颧颊分区应含 4 个以上部位')
  for (const s of cheek) assert.equal(s.zone, 'cheek')
  assert.equal(sitesOf('不存在的分区').length, 0)
})

test('T10o 发际线：实测优先，缺失或无效时回退几何估算', () => {
  const pts = ideal()
  const fallback = zoneContext(pts, {}) // 不给 hairlineY
  assert.ok(fallback.vHairline < fallback.vBrowTop, '兜底发际线应在眉线之上')
  assert.ok(Number.isFinite(fallback.vHairline))

  // 实测发际线更高（更靠上）时应被采用
  const high = zoneContext(pts, { hairlineY: pts[27].y - 100 })
  assert.ok(high.vHairline < fallback.vHairline, '更高的实测发际线应覆盖兜底值')

  // 实测值低于眉线（扫描失败）时判定无效，回退兜底
  const bad = zoneContext(pts, { hairlineY: pts[27].y + 20 })
  assert.equal(bad.vHairline, fallback.vHairline, '无效实测值应回退兜底')
})
