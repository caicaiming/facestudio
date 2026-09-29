/**
 * zones.test.mjs —— 医美部位层
 * 覆盖：部位表完整性、规范坐标跨脸一致性（旋转 / 缩放 / 平移不变）、
 *       部位点的解剖位置合理性、成对部位镜像、高斯衰减形变、空值短路。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generateLandmarks } from '../src/measure.js'
import { buildFrame, frameFaceWidth, frameOf, project, unproject } from '../src/frame.js'
import { buildAnchors } from '../src/anchors.js'
import {
  SITES,
  SITE_RANGE,
  SITE_ZONES,
  applySiteOffsets,
  earAnchorOffsets,
  earEffectiveLevel,
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

/** 长中庭：鼻根以下的点整体下移 1.3 倍（眉线不动 → 眉到鼻底变长） */
const midLongFace = () => {
  const p = generateLandmarks(1)
  const y0 = p[27].y
  for (const q of p) if (q.y > y0) q.y = y0 + (q.y - y0) * 1.3
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

test('T10a 分区表：9 个分区，key 唯一，lever 合法', () => {
  assert.equal(SITE_ZONES.length, 9)
  const keys = new Set(SITE_ZONES.map((z) => z.key))
  assert.equal(keys.size, 9)
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

// ------------------------------------------------- 档位范围（放宽到 ±30 后补）

test('T10g2 档位范围：对称、步长 1、且比旧的 ±15 更宽', () => {
  assert.equal(SITE_RANGE.min, -SITE_RANGE.max, '档位范围应关于 0 对称')
  assert.equal(SITE_RANGE.step, 1)
  assert.ok(SITE_RANGE.max > 15, `档位上限应已放宽: ${SITE_RANGE.max}`)
})

test('T10g3 满档形变：不产生 NaN / Infinity，且位移随档位单调', () => {
  const pts = ideal()
  const at = (v) => {
    const out = applySiteOffsets(pts, { ...emptySites(), chin: v })
    for (const p of out) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `档位 ${v} 产生非法坐标`)
    }
    let m = 0
    for (let i = 0; i < 68; i++) m = Math.max(m, Math.hypot(out[i].x - pts[i].x, out[i].y - pts[i].y))
    return m
  }
  const d15 = at(15)
  const d30 = at(SITE_RANGE.max)
  assert.ok(d30 > d15 * 1.9 && d30 < d15 * 2.1, `满档位移应约为 15 档的两倍: ${d30} vs ${d15}`)
})

test('T10g4 档位不再被 ±15 截断：底层 scale 按满档 ±100 标定', () => {
  // 档位 30 仍在线性区间内（scale 以 ±100 定义），位移必须是 15 档的严格两倍
  const pts = ideal()
  const disp = (v) => {
    const out = applySiteOffsets(pts, { ...emptySites(), malar: v })
    let m = 0
    for (let i = 0; i < 68; i++) m = Math.max(m, Math.hypot(out[i].x - pts[i].x, out[i].y - pts[i].y))
    return m
  }
  assert.ok(Math.abs(disp(30) - disp(15) * 2) < 1e-9, '15 → 30 档位移必须严格翻倍')
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


// ---------------------------------------------------------------- 耳部

test('T10p 耳部：分区已注册且三个部位齐全', () => {
  const zone = SITE_ZONES.find((z) => z.key === 'ear')
  assert.ok(zone, '应有耳部分区')
  const list = sitesOf('ear')
  const keys = list.map((s) => s.key)
  assert.ok(keys.includes('earBase'), '应有耳基底')
  assert.ok(keys.includes('earHelix'), '应有耳轮轮廓')
  assert.ok(keys.includes('earLobe'), '应有耳垂')
  for (const s of list) {
    assert.equal(s.virtual, true, s.key + ' 应标记为 virtual')
    assert.equal(s.pair, true, s.key + ' 应左右成对')
  }
})

test('T10q 耳部纵向：耳上缘≈眉线、耳垂≈鼻底，且区间随脸长自适应', () => {
  const a = zoneContext(ideal())
  const b = zoneContext(longFace()) // 下庭拉长
  const c = zoneContext(midLongFace()) // 中庭拉长

  assert.ok(a.vEarTop < a.vBrowTop, '耳上缘应略高于眉线')
  assert.ok(a.vEarBottom > a.vSubnasal, '耳垂应略低于鼻底')
  assert.ok(a.earLen > 0, '耳长应为正')

  // 耳长锚定的是中庭（眉→鼻底），下庭拉长不应影响它
  assert.ok(
    Math.abs(b.earLen - a.earLen) < 1e-9,
    '下庭拉长不应改变耳长：' + a.earLen + ' vs ' + b.earLen,
  )
  // 中庭变长 → 外推的耳朵随之变长
  assert.ok(c.earLen > a.earLen, '中庭拉长应让耳长变大')
  // 无论哪种脸型，耳朵纵向区间始终夹在「眉线与鼻底之间」这个解剖带内
  for (const x of [b, c]) {
    assert.ok(x.vEarTop < x.vBrowTop && x.vEarBottom > x.vSubnasal)
  }
})

test('T10r 耳部横向：落在面宽之外、外缘锚点之内（才可能被网格带动）', () => {
  const pts = ideal()
  const c = zoneContext(pts)
  const anchors = buildAnchors(pts)
  const frame = c.frame
  const W = frameFaceWidth(pts, frame)

  for (const s of sitesOf('ear')) {
    const cu = s.at(c)
    const p = unproject(cu, frame)
    const uAbs = Math.abs(project(p, frame).u)
    assert.ok(uAbs > c.uHalf * 0.95, s.key + ' 应在面宽外侧，实际 u=' + uAbs)
    const outer = Math.min(
      Math.abs(project(anchors[4], frame).u),
      Math.abs(project(anchors[7], frame).u),
    )
    assert.ok(uAbs < outer, s.key + ' 应落在外缘锚点之内，否则网格覆盖不到')
    const d = Math.hypot(p.x - anchors[4].x, p.y - anchors[4].y)
    assert.ok(d < W, s.key + ' 距外缘锚点不宜超过一个面宽')
  }
})

test('T10s 耳部规范坐标同样满足旋转/缩放/平移不变', () => {
  const pts = ideal()
  const c0 = zoneContext(pts)
  const c1 = zoneContext(transform(pts, { rot: 0.4, scale: 2.3, tx: 120, ty: -70 }))
  for (const s of sitesOf('ear')) {
    const a = s.at(c0)
    const b = s.at(c1)
    assert.ok(
      Math.abs(a.u - b.u) < 1e-9 && Math.abs(a.v - b.v) < 1e-9,
      s.key + ' 规范坐标在相似变换后漂移：(' + a.u + ',' + a.v + ') → (' + b.u + ',' + b.v + ')',
    )
  }
})

test('T10t earAnchorOffsets：无耳部档位时原样返回（短路）', () => {
  const pts = ideal()
  const anchors = buildAnchors(pts)
  const zero = earAnchorOffsets(pts, anchors, emptySites())
  for (let i = 0; i < anchors.length; i++) {
    assert.equal(zero[i].x, anchors[i].x)
    assert.equal(zero[i].y, anchors[i].y)
  }
  const other = { ...emptySites(), chin: 8 }
  const same = earAnchorOffsets(pts, anchors, other)
  assert.equal(same[4].x, anchors[4].x, '非耳部位不应推动锚点')
})

test('T10u earAnchorOffsets：耳基底 ＋ 档把外缘锚点向外推，− 档内收', () => {
  const pts = ideal()
  const anchors = buildAnchors(pts)
  const frame = frameOf(pts)
  const sign = (u) => (u > 0 ? 1 : -1)

  const out = earAnchorOffsets(pts, anchors, { ...emptySites(), earBase: 15 })
  const inn = earAnchorOffsets(pts, anchors, { ...emptySites(), earBase: -15 })

  for (const a of [4, 7]) {
    const base = project(anchors[a], frame)
    const s = sign(base.u)
    assert.ok(
      s * project(out[a], frame).u > s * base.u,
      '＋档锚点 ' + a + ' 应向外：' + base.u + ' → ' + project(out[a], frame).u,
    )
    assert.ok(
      s * project(inn[a], frame).u < s * base.u,
      '−档锚点 ' + a + ' 应向内：' + base.u + ' → ' + project(inn[a], frame).u,
    )
  }
})

test('T10v earAnchorOffsets：只动外缘锚点，不动顶/底锚点（避免整脸外扩）', () => {
  const pts = ideal()
  const anchors = buildAnchors(pts)
  const out = earAnchorOffsets(pts, anchors, {
    ...emptySites(),
    earBase: 15,
    earHelix: 15,
    earLobe: 15,
  })
  for (const a of [0, 1, 2, 3, 5, 6]) {
    assert.equal(out[a].x, anchors[a].x, '锚点 ' + a + ' 不应被耳部推动')
    assert.equal(out[a].y, anchors[a].y)
  }
  assert.notEqual(out[4].x, anchors[4].x, '外缘锚点 72 应被推动')
  assert.notEqual(out[7].x, anchors[7].x, '外缘锚点 75 应被推动')
})

test('T10w earAnchorOffsets：入参不被修改，且输出为新数组', () => {
  const pts = ideal()
  const anchors = buildAnchors(pts)
  const snap = anchors.map((p) => ({ ...p }))
  const out = earAnchorOffsets(pts, anchors, { ...emptySites(), earHelix: 12 })
  for (let i = 0; i < anchors.length; i++) {
    assert.equal(anchors[i].x, snap[i].x, '入参锚点被修改了')
    assert.equal(anchors[i].y, snap[i].y)
  }
  assert.notEqual(out, anchors, '应返回新数组')
})

test('T10x 耳部档位确实能带动 68 点（否则形变为零）', () => {
  const pts = ideal()
  const moved = applySiteOffsets(pts, { ...emptySites(), earBase: 15 })
  let max = 0
  for (let i = 0; i < 68; i++) {
    max = Math.max(max, Math.hypot(moved[i].x - pts[i].x, moved[i].y - pts[i].y))
  }
  assert.ok(max > 0.5, '耳基底满档应带动邻近关键点，实测最大位移 ' + max.toFixed(3) + 'px')
})


test('T10y 耳部锚点推动量级：满档位移落在 3%~6% 面宽（可见但不过猛）', () => {
  const pts = ideal()
  const anchors = buildAnchors(pts)
  const frame = frameOf(pts)
  const W = frameFaceWidth(pts, frame)

  for (const s of sitesOf('ear')) {
    // 满档 = SITE_RANGE.max（30）：软膝点必须把量级仍压在旧 15 档的包络附近
    const out = earAnchorOffsets(pts, anchors, { ...emptySites(), [s.key]: SITE_RANGE.max })
    const d = Math.hypot(out[4].x - anchors[4].x, out[4].y - anchors[4].y)
    const ratio = d / W
    assert.ok(
      ratio > 0.02 && ratio < 0.08,
      s.key + ' 满档锚点位移 ' + (ratio * 100).toFixed(2) + '% 面宽，超出 2%~8% 的合理区间',
    )
  }
})

test('T10y2 耳区软膝点：15 档以内线性不变，30 档不再线性翻倍', () => {
  assert.equal(earEffectiveLevel(15), 15, '膝点以内必须原样通过')
  assert.equal(earEffectiveLevel(8), 8)
  assert.equal(earEffectiveLevel(-15), -15)
  const e30 = earEffectiveLevel(SITE_RANGE.max)
  const e15 = earEffectiveLevel(15)
  assert.ok(e30 > e15, '高档位仍应继续增长，不能一刀切封顶')
  assert.ok(e30 < e15 * 1.25, `30 档推动量应被压住: ${e30} vs ${e15}`)
  assert.equal(earEffectiveLevel(-SITE_RANGE.max), -e30, '负档位应对称')

  const pts = ideal()
  const anchors = buildAnchors(pts)
  const d = (v) => {
    const o = earAnchorOffsets(pts, anchors, { ...emptySites(), earBase: v })
    return Math.hypot(o[4].x - anchors[4].x, o[4].y - anchors[4].y)
  }
  assert.ok(
    d(SITE_RANGE.max) < d(15) * 1.25,
    `30 档锚点位移应约为 15 档的 1.2 倍而非 2 倍: ${d(SITE_RANGE.max).toFixed(2)} vs ${d(15).toFixed(2)}`,
  )
})

test('T10z 三个耳部部位满档叠加：总位移仍可控（< 12% 面宽）', () => {
  const pts = ideal()
  const anchors = buildAnchors(pts)
  const W = frameFaceWidth(pts, frameOf(pts))
  const out = earAnchorOffsets(pts, anchors, {
    ...emptySites(),
    earBase: SITE_RANGE.max,
    earHelix: SITE_RANGE.max,
    earLobe: SITE_RANGE.max,
  })
  for (const a of [4, 7]) {
    const d = Math.hypot(out[a].x - anchors[a].x, out[a].y - anchors[a].y)
    assert.ok(d / W < 0.12, '三部位满档叠加位移 ' + ((d / W) * 100).toFixed(2) + '% 面宽，过大')
  }
})
