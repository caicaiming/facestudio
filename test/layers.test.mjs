/**
 * layers.test.mjs —— 统一图层栈单测（T18 组）
 *
 * 覆盖三件事：
 *   1. 默认值与坏数据兜底（localStorage 里躺着旧版本数据是常态）
 *   2. 四种基本操作（显隐 / 锁 / 不透明度 / 排序）的边界
 *   3. 摊平后的层序必须满足物理约束：素材在点位下、画线在点位上
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  SYS_LAYERS,
  SYS_KEYS,
  MARKER_KEYS,
  defaultLayerState,
  sanitizeLayerState,
  layerMeta,
  isLayerOn,
  layerAlpha,
  layerLock,
  layerMarkerScale,
  patchLayer,
  toggleLayer,
  moveMarker,
  moveContent,
  bandOfItem,
  overlayPreset,
  overlayOf,
  flattenStack,
  canMove,
} from '../src/layers.js'

const mat = (id) => ({ id, kind: 'material', visible: true, alpha: 0.62 })
const arrow = (id) => ({ id, kind: 'arrow', visible: true, alpha: 1 })

test('T18a 默认状态：照片/网格/部位/自定义点/基准点可见，形变预览与参考线隐藏', () => {
  const st = defaultLayerState()
  for (const k of ['photo', 'mesh', 'sites', 'custom', 'anchors']) {
    assert.equal(isLayerOn(st, k), true, `${k} 应默认可见`)
  }
  for (const k of ['warp', 'points', 'three', 'symmetry']) {
    assert.equal(isLayerOn(st, k), false, `${k} 应默认隐藏`)
  }
  assert.equal(layerAlpha(st, 'photo'), 1)
  assert.equal(layerLock(st, 'mesh'), false)
  assert.equal(layerMarkerScale(st, 'mesh'), 1)
})

test('T18b 系统层定义自洽：11 层，层名唯一，band 只有 0/1/3', () => {
  assert.equal(SYS_LAYERS.length, 11)
  assert.equal(new Set(SYS_KEYS).size, 11)
  for (const l of SYS_LAYERS) {
    assert.ok(l.name && l.icon && l.hint, `${l.key} 缺展示信息`)
    assert.ok([0, 1, 3].includes(l.band), `${l.key} band 非法`)
  }
  // 标记层键必须与定义一一对应，否则 order 会漏层
  for (const k of MARKER_KEYS) assert.ok(SYS_KEYS.includes(k), `${k} 未定义`)
})

test('T18c 坏数据兜底：null / 垃圾 meta / 缺 order 键都能回到可用状态', () => {
  assert.deepEqual(sanitizeLayerState(null), defaultLayerState())
  assert.deepEqual(sanitizeLayerState('不是对象'), defaultLayerState())

  const st = sanitizeLayerState({ meta: { photo: null, mesh: { alpha: 'x' } }, order: ['mesh', 'zzz'] })
  assert.equal(isLayerOn(st, 'photo'), true) // meta 是 null → 用默认
  assert.equal(layerAlpha(st, 'mesh'), 1) // 非数字 → 回退 1
  // 缺的标记键补在末尾，顺序里不认识的键丢掉
  assert.deepEqual(st.order.slice(0, 2), ['mesh', 'points'])
  assert.equal(new Set(st.order).size, MARKER_KEYS.length)
  for (const k of MARKER_KEYS) assert.ok(st.order.includes(k), `${k} 丢失`)
})

test('T18d 不透明度与标记缩放夹紧在合法区间', () => {
  let st = patchLayer(defaultLayerState(), 'photo', { alpha: 5 })
  assert.equal(layerAlpha(st, 'photo'), 1)
  st = patchLayer(st, 'photo', { alpha: -1 })
  assert.equal(layerAlpha(st, 'photo'), 0.05)
  st = patchLayer(st, 'mesh', { marker: 99 })
  assert.equal(layerMarkerScale(st, 'mesh'), 2.5)
  st = patchLayer(st, 'mesh', { marker: 0 })
  assert.equal(layerMarkerScale(st, 'mesh'), 0.5)
})

test('T18e patch / toggle 不改原对象（React 要靠引用变化触发重渲染）', () => {
  const st = defaultLayerState()
  const st2 = toggleLayer(st, 'mesh')
  assert.notEqual(st, st2)
  assert.equal(isLayerOn(st, 'mesh'), true, '原状态不应被改')
  assert.equal(isLayerOn(st2, 'mesh'), false)
  assert.equal(toggleLayer(st2, 'mesh').meta.mesh.visible, true)
  // 不认识的键：原样返回，不制造脏数据
  assert.equal(patchLayer(st, 'nope', { visible: false }), st)
})

test('T18f 标记层排序：相邻交换，到头不动', () => {
  const st = defaultLayerState()
  // 数组靠后 = 画得晚 = 视觉上更靠上
  assert.deepEqual(st.order.slice(0, 3), ['mesh', 'points', 'three'])
  const up = moveMarker(st, 'points', 1) // points 上移 → 越过 three
  assert.deepEqual(up.order.slice(0, 3), ['mesh', 'three', 'points'])
  const down = moveMarker(st, 'points', -1) // points 下移 → 越过 mesh
  assert.deepEqual(down.order.slice(0, 3), ['points', 'mesh', 'three'])
  // 一来一回回到原处
  assert.deepEqual(moveMarker(down, 'points', 1).order, st.order)
  // 首尾越界：原样返回同一个引用
  assert.equal(moveMarker(st, 'mesh', -1), st)
  assert.equal(moveMarker(st, 'anchors', 1), st)
})

test('T18g 内容层只在同 band 内排序：素材不会翻到点位的上面', () => {
  const items = [mat('m1'), arrow('a1'), mat('m2'), arrow('a2')]
  assert.equal(bandOfItem(items[0]), 2)
  assert.equal(bandOfItem(items[1]), 4)

  // m1 上移一层 → 排到 m2 之后（仍在素材 band 内）
  const up = moveContent(items, 0, 1)
  assert.deepEqual(up.map((x) => x.id), ['a1', 'm2', 'm1', 'a2'])
  // m2 下移一层 → 排到 m1 之前
  const down = moveContent(items, 2, -1)
  assert.deepEqual(down.map((x) => x.id), ['m2', 'm1', 'a1', 'a2'])
  // 到头不动
  assert.equal(moveContent(items, 0, -1), items)
  assert.equal(moveContent(items, 2, 1), items)
  // 画线层同样只在自己 band 内动
  const annUp = moveContent(items, 1, 1)
  assert.deepEqual(annUp.map((x) => x.id), ['m1', 'm2', 'a2', 'a1'])
})

test('T18h 叠加预设：一次只开一组，可反推出高亮按钮', () => {
  const st = defaultLayerState()
  assert.equal(overlayOf(st), 'mesh')
  assert.equal(overlayOf(overlayPreset(st, 'three')), 'three')
  assert.equal(overlayOf(overlayPreset(st, 'none')), 'none')
  // 面板里单独又开了点位 → 与任何预设都不符，不高亮
  const mixed = patchLayer(overlayPreset(st, 'three'), 'points', { visible: true })
  assert.equal(overlayOf(mixed), 'multi')
  // 预设是互斥的：切到 symmetry 后 three 必须关掉
  assert.equal(isLayerOn(overlayPreset(mixed, 'symmetry'), 'three'), false)
})

test('T18i 摊平后的栈：系统底图 → 形变 → 素材 → 标记 → 画线', () => {
  const st = defaultLayerState()
  const stack = flattenStack(st, [mat('m1'), arrow('a1')])
  const bands = stack.map((r) => r.band)
  const kinds = stack.map((r) => r.id)
  // 光影紧跟形变照；差异热区再压在光影之上（它是要被看见的标记，不能被 soft-light 吃掉）
  assert.deepEqual(kinds.slice(0, 4), ['sys:photo', 'sys:warp', 'sys:relief', 'sys:diff'])
  assert.equal(kinds[4], 'm1', '素材必须在标记层之前（点位之下）')
  assert.equal(kinds[kinds.length - 1], 'a1', '画线必须在最上（点位之上）')
  // band 单调不减：不允许出现「画线在素材下面」这类穿越
  for (let i = 1; i < bands.length; i++) assert.ok(bands[i] >= bands[i - 1], `第 ${i} 项 band 回退`)
  // 标记层内部顺序跟随 state.order
  const markerIds = stack.filter((r) => r.band === 3).map((r) => r.key)
  assert.deepEqual(markerIds, st.order)
})

test('T18j 跨 band 与固定层的移动按钮被禁用', () => {
  const st = defaultLayerState()
  const stack = flattenStack(st, [mat('m1'), arrow('a1')])
  assert.equal(canMove(stack, 'sys:photo', 1), false, '照片固定在最底')
  assert.equal(canMove(stack, 'sys:warp', 1), false, '形变预览固定在照片之上')
  assert.equal(canMove(stack, 'm1', 1), false, '素材不能翻到点位上面')
  assert.equal(canMove(stack, 'a1', -1), false, '画线不能沉到点位下面')
  assert.equal(canMove(stack, 'a1', 1), false, '最顶层没有更上一层')
  // 标记层内部可自由上下
  assert.equal(canMove(stack, 'sys:sites', 1), true)
  assert.equal(canMove(stack, 'sys:sites', -1), true)
  // 多个素材时同 band 内可动
  const stack2 = flattenStack(st, [mat('m1'), mat('m2')])
  assert.equal(canMove(stack2, 'm1', 1), true)
  assert.equal(canMove(stack2, 'm1', -1), false, '已在素材层最底')
})

test('T18k 锁定与重命名：锁只影响拾取，不影响可见性', () => {
  const st = patchLayer(defaultLayerState(), 'mesh', { lock: true })
  assert.equal(layerLock(st, 'mesh'), true)
  assert.equal(isLayerOn(st, 'mesh'), true, '锁住 ≠ 隐藏')
  // 系统层 meta 缺字段时读出来仍是完整对象
  const broken = { v: 1, order: [], meta: {} }
  assert.equal(isLayerOn(broken, 'photo'), true)
  assert.equal(layerAlpha(broken, 'photo'), 1)
  assert.equal(layerLock(broken, 'photo'), false)
  assert.deepEqual(Object.keys(layerMeta(broken, 'photo')).sort(), ['alpha', 'lock', 'marker', 'visible'])
})
