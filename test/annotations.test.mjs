/**
 * annotations.test.mjs —— 标注图层模型单测（T16 组）
 *
 * 覆盖：45° 吸附、画笔增量、命中测试（各类型）、平移、笔画有效性、
 * 素材本地坐标命中、默认样式。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ANN_TOOLS,
  ANN_COLORS,
  defaultAnnStyle,
  beginStroke,
  updateStroke,
  makeText,
  makeMaterial,
  snapPoint45,
  segDist,
  layerBounds,
  hitLayer,
  hitLayers,
  translateLayer,
  strokeLength,
  layerName,
  MAT_INIT_RATIO,
  layerBox,
  handlePoints,
  hitHandle,
  scaleLayer,
  rotateLayer,
  drawGizmo,
} from '../src/annotations.js'

const S = () => defaultAnnStyle()

test('T16a 工具与色板清单完整', () => {
  assert.equal(ANN_TOOLS.length, 8)
  assert.deepEqual(
    ANN_TOOLS.map((t) => t.key),
    ['pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'era', 'move'],
  )
  assert.equal(ANN_COLORS.length, 8)
  assert.equal(MAT_INIT_RATIO, 0.6)
})

test('T16b 45° 吸附到 8 方向', () => {
  const a = { x: 0, y: 0 }
  // 10,0 → 0°
  assert.deepEqual(snapPoint45(a, { x: 10, y: 0 }), { x: 10, y: 0 })
  // 10,9 → 45°
  const q = snapPoint45(a, { x: 10, y: 9 })
  assert.ok(Math.abs(q.x - q.y) < 1e-9, `应在 45° 线上: ${JSON.stringify(q)}`)
  // 半径保持
  assert.ok(Math.abs(Math.hypot(q.x, q.y) - Math.hypot(10, 9)) < 1e-9)
  // 1,10 → 90°
  const q2 = snapPoint45(a, { x: 1, y: 10 })
  assert.ok(Math.abs(q2.x) < 1e-9 && q2.y > 9)
})

test('T16c 直线吸附由 style.shape 开关', () => {
  const s1 = S()
  s1.shape = true
  const l1 = beginStroke('line', { x: 0, y: 0 }, { x: 10, y: 9 }, s1)
  assert.ok(Math.abs(l1.x2 - l1.y2) < 1e-9, '开启吸附时终点应在 45° 线')
  const l2 = beginStroke('line', { x: 0, y: 0 }, { x: 10, y: 9 }, S())
  assert.equal(l2.x2, 10)
  assert.equal(l2.y2, 9)
})

test('T16d 画笔亚像素抖动被吞', () => {
  const p = beginStroke('pen', { x: 100, y: 100 }, { x: 100.3, y: 100.2 }, S())
  assert.equal(p.pts.length, 2)
  updateStroke(p, { x: 100.5, y: 100.4 }, false)
  assert.equal(p.pts.length, 2, '0.5px 移动不应加点')
  updateStroke(p, { x: 105, y: 102 }, false)
  assert.equal(p.pts.length, 3)
})

test('T16e 各类型命中测试', () => {
  const line = beginStroke('line', { x: 0, y: 0 }, { x: 100, y: 0 }, S())
  assert.ok(hitLayer({ x: 50, y: 0 }, line, 5))
  assert.ok(hitLayer({ x: 50, y: 8 }, line, 5), '线宽 10/2 + tol 5 应命中')
  assert.ok(!hitLayer({ x: 50, y: 30 }, line, 5))

  const rect = beginStroke('rect', { x: 0, y: 0 }, { x: 100, y: 60 }, S())
  assert.ok(!hitLayer({ x: 50, y: 30 }, rect, 5), '空心矩形中心不命中')
  assert.ok(hitLayer({ x: 50, y: 2 }, rect, 5), '边缘应命中')
  rect.fill = true
  assert.ok(hitLayer({ x: 50, y: 30 }, rect, 5), '填充后中心命中')

  const txt = makeText(100, 100, '鼻头圆钝', S())
  assert.ok(hitLayer({ x: 110, y: 92 }, txt, 5))
  assert.ok(!hitLayer({ x: 300, y: 300 }, txt, 5))

  const mat = makeMaterial('u', '鼻部结构', 200, 200, 100, 80)
  assert.ok(hitLayer({ x: 200, y: 200 }, mat, 2))
  assert.ok(!hitLayer({ x: 300, y: 300 }, mat, 2))
  mat.rot = 90
  assert.ok(hitLayer({ x: 200, y: 250 }, mat, 2), '旋转 90° 后长边转向 y')
  assert.ok(!hitLayer({ x: 250, y: 200 }, mat, 2), '短边方向超出不应命中')
})

test('T16f hitLayers 自顶向下', () => {
  const a = beginStroke('line', { x: 0, y: 0 }, { x: 100, y: 0 }, S())
  const b = beginStroke('line', { x: 0, y: 1 }, { x: 100, y: 1 }, S())
  assert.equal(hitLayers({ x: 50, y: 0 }, [a, b], 5), 1, '后加入的在上层')
  b.visible = false
  assert.equal(hitLayers({ x: 50, y: 0 }, [a, b], 5), 0, '隐藏层不参与命中')
  assert.equal(hitLayers({ x: 500, y: 500 }, [a, b], 5), -1)
})

test('T16g 平移保持几何关系', () => {
  const pen = beginStroke('pen', { x: 10, y: 10 }, { x: 20, y: 20 }, S())
  updateStroke(pen, { x: 30, y: 10 }, false)
  const t = translateLayer(pen, 5, -3)
  assert.deepEqual(t.pts[0], { x: 15, y: 7 })
  assert.equal(t.pts.length, 3)
  const line = translateLayer(beginStroke('line', { x: 0, y: 0 }, { x: 9, y: 9 }, S()), 1, 1)
  assert.equal(line.x1, 1)
  assert.equal(line.y2, 10)
  const txt = translateLayer(makeText(5, 5, 'x', S()), 2, 2)
  assert.equal(txt.x, 7)
})

test('T16h 笔画有效性判定', () => {
  const s = beginStroke('pen', { x: 10, y: 10 }, { x: 10.5, y: 10.2 }, S())
  assert.ok(strokeLength(s) < 3, '误触不应成层')
  updateStroke(s, { x: 40, y: 12 }, false)
  assert.ok(strokeLength(s) > 3)
  const l = beginStroke('line', { x: 0, y: 0 }, { x: 100, y: 0 }, S())
  assert.equal(strokeLength(l), 100)
})

test('T16i 包围盒与显示名', () => {
  const pen = beginStroke('pen', { x: 10, y: 10 }, { x: 20, y: 20 }, S())
  const b = layerBounds(pen)
  assert.ok(b.x <= 10 && b.w >= 10)
  assert.equal(layerBounds(null), null)
  const txt = makeText(0, 100, '测试', S())
  const tb = layerBounds(txt)
  assert.ok(tb.w > 0 && tb.h > 0)
  assert.ok(layerName(txt).includes('测试'))
  const mat = makeMaterial('u', '骨相高点标注', 0, 0, 100, 50)
  assert.equal(layerName(mat), '骨相高点标注')
  assert.equal(layerName(beginStroke('arrow', { x: 0, y: 0 }, { x: 5, y: 5 }, S())), '箭头')
})

test('T16j 样式默认值与融合工具出厂一致', () => {
  const s = defaultAnnStyle()
  assert.equal(s.color, '#e02020')
  assert.equal(s.width, 10)
  assert.equal(s.alpha, 100)
  assert.equal(s.arrowH, 24)
  assert.equal(s.font, 48)
  assert.equal(s.outline, true)
  assert.equal(s.dash, false)
})

// ---------------------------------------------------------------- T16k–n 变换

test('T16k layerBox：各类别都给出中心与本地尺寸，素材带旋转', () => {
  const line = beginStroke('line', { x: 0, y: 0 }, { x: 100, y: 40 }, S())
  const b = layerBox(line)
  assert.equal(b.cx, 50)
  assert.equal(b.cy, 20)
  assert.ok(b.w > 100 && b.h > 40) // 含线宽余量

  const mat = makeMaterial('u', 'm', 200, 300, 120, 60)
  assert.deepEqual(
    [layerBox(mat).cx, layerBox(mat).cy, layerBox(mat).w, layerBox(mat).h],
    [200, 300, 120, 60],
  )
  const rot = { ...mat, rot: 90 }
  assert.equal(layerBox(rot).rot, 90) // 旋转存在框上，手柄才会跟着斜

  const txt = makeText(10, 100, '泪沟', S())
  const tb = layerBox(txt)
  assert.ok(tb.w > 0 && tb.h > 0 && tb.rot === 0)
  assert.equal(layerBox(null), null)
})

test('T16l 手柄：8 缩放 + 1 旋转，角点落在框上，隐藏层不出手柄', () => {
  const rect = beginStroke('rect', { x: 0, y: 0 }, { x: 100, y: 50 }, { ...S(), width: 0 })
  const pts = handlePoints(rect, 20)
  assert.equal(pts.length, 9)
  const at = (id) => pts.find((p) => p.id === id)
  assert.deepEqual([at('nw').x, at('nw').y], [0, 0])
  assert.deepEqual([at('se').x, at('se').y], [100, 50])
  assert.equal(at('n').x, 50) // 边中点在轴中点
  assert.ok(at('rot').y < 0) // 旋转点抬到框外
  assert.equal(hitHandle({ x: -500, y: -500 }, rect, 9), null)
  assert.equal(hitHandle({ x: 100, y: 50 }, { ...rect, visible: false }, 9), null)
  assert.equal(hitHandle({ x: 100, y: 50 }, rect, 9), 'se')
  assert.equal(hitHandle({ x: 50, y: -20 }, rect, 9), 'rot')
})

test('T16m scaleLayer：绕对侧锚点缩放，尺寸字段同步', () => {
  // 箭头放大 2 倍：端点离锚点翻倍，线宽与箭翼也跟着涨
  const a = beginStroke('arrow', { x: 0, y: 0 }, { x: 100, y: 0 }, S())
  const big = scaleLayer(a, 2, 2, { x: 0, y: 0 }, 0)
  assert.deepEqual([big.x1, big.x2], [0, 200])
  assert.equal(big.width, a.width * 2)
  assert.equal(big.arrowH, a.arrowH * 2)

  // 缩小时锚点（左上角）不动
  const small = scaleLayer(a, 0.5, 0.5, { x: 0, y: 0 }, 0)
  assert.equal(small.x1, 0)
  assert.equal(small.x2, 50)

  // 文字：位置绕锚点变，字号按几何平均
  const t = makeText(100, 100, '鼻', S())
  const ts = scaleLayer(t, 2, 2, { x: 100, y: 100 }, 0)
  assert.equal(ts.font, t.font * 2)
  assert.equal(ts.x, 100)

  // 素材：w/h 分别缩放，中心按锚点平移
  const m = makeMaterial('u', 'm', 100, 100, 50, 50)
  const ms = scaleLayer(m, 2, 1, { x: 0, y: 0 }, 0)
  assert.equal(ms.w, 100)
  assert.equal(ms.h, 50)
  assert.equal(ms.x, 200)

  // 极小不塌：下限 8px
  const tiny = scaleLayer(m, 0.001, 0.001, { x: 0, y: 0 }, 0)
  assert.ok(tiny.w >= 8 && tiny.h >= 8)

  // 画笔：每个点都参与
  const pen = beginStroke('pen', { x: 0, y: 0 }, { x: 10, y: 10 }, S())
  updateStroke(pen, { x: 20, y: 20 })
  const ps = scaleLayer(pen, 2, 2, { x: 0, y: 0 }, 0)
  assert.deepEqual(
    ps.pts.map((p) => [p.x, p.y]),
    [
      [0, 0],
      [20, 20],
      [40, 40],
    ],
  )
})

test('T16n rotateLayer：素材/框存 rot，线段烤进坐标', () => {
  const m = makeMaterial('u', 'm', 0, 0, 100, 50)
  assert.equal(rotateLayer(m, 90).rot, 90)
  assert.equal(rotateLayer({ ...m, rot: 350 }, 20).rot, 10) // 绕回一圈
  const r = beginStroke('rect', { x: 0, y: 0 }, { x: 100, y: 50 }, { ...S(), width: 0 })
  assert.equal(rotateLayer(r, 30).rot, 30)

  // 线段绕中点转 90°：(0,0)-(100,0) → (50,-50)-(50,50)
  const l = beginStroke('line', { x: 0, y: 0 }, { x: 100, y: 0 }, { ...S(), width: 0 })
  const lr = rotateLayer(l, 90)
  assert.ok(Math.abs(lr.x1 - 50) < 1e-6 && Math.abs(lr.y1 + 50) < 1e-6)
  assert.ok(Math.abs(lr.x2 - 50) < 1e-6 && Math.abs(lr.y2 - 50) < 1e-6)
  assert.equal(lr.rot, undefined) // 线段不需要 rot 字段

  // 旋转后可命中：100×50 的框转 90° 后变成 50×100，
  // 命中测试必须把点反旋回本地系，否则「看得见的框点不中」
  const rr = rotateLayer(beginStroke('rect', { x: -50, y: -25 }, { x: 50, y: 25 }, { ...S(), width: 2 }), 90)
  assert.ok(hitLayer({ x: 25, y: 0 }, rr, 2)) // 转后右边框
  assert.ok(hitLayer({ x: 0, y: 50 }, rr, 2)) // 转后下边框
  assert.ok(!hitLayer({ x: 0, y: 0 }, rr, 2)) // 空心：正中不命中
  assert.ok(!hitLayer({ x: 40, y: 0 }, rr, 2)) // 转到窄边外了
})

test('T16o drawGizmo 不抛错，且空/零尺寸图元直接跳过', () => {
  const calls = []
  const ctx = new Proxy(
    {},
    {
      get: (_, k) => {
        if (k === 'canvas') return { width: 100, height: 100 }
        return (...args) => calls.push([k, ...args])
      },
      set: () => true,
    },
  )
  const rect = beginStroke('rect', { x: 0, y: 0 }, { x: 100, y: 50 }, S())
  drawGizmo(ctx, rect, 5, 26)
  assert.ok(calls.length > 0)
  assert.equal(drawGizmo(ctx, null, 5, 26), undefined)
  const empty = beginStroke('line', { x: 10, y: 10 }, { x: 10, y: 10 }, { ...S(), width: 0 })
  assert.equal(drawGizmo(ctx, empty, 5, 26), undefined)
})
