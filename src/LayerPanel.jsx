/**
 * LayerPanel.jsx —— 标注图层栈
 *
 * 数组序即 z 序：列表【倒序】展示（末尾 = 画布最上层 = 列表第一行），
 * 这样「上下移层」的方向与视觉一致，也和 Photoshop 的图层面板习惯相同。
 *
 * 每层三件事：显示 / 隐藏（眼）、选中（点击行）、上移下移与删除。
 * 选中态是给「移动」工具用的 —— 选中后可以用方向键微调位置。
 *
 * 本组件只出内容，外壳（卡片标题 / 折叠）由 AnnSection 统一提供。
 */

import { layerName } from './annotations.js'

export default function LayerPanel({
  layers,
  sel,
  onSelect,
  onToggleVisible,
  onRemove,
  onReorder,
  onScale,
  onRotate,
  onAlpha,
}) {
  if (!layers.length) {
    return (
      <div className="ann-body">
        <p className="note">还没有标注。选一个工具在照片上画，或从「素材」里贴一张示意图。</p>
      </div>
    )
  }

  // 倒序：栈顶（最上层）排最前
  const order = layers.map((_, i) => i).reverse()
  const selIdx = layers.findIndex((it) => it.id === sel)

  return (
    <div className="ann-body">
      <ul className="ann-layers">
        {order.map((i) => {
          const it = layers[i]
          return (
            <li
              key={it.id}
              className={`ann-layer${it.id === sel ? ' active' : ''}${it.visible === false ? ' hidden' : ''}`}
              onClick={() => onSelect(it.id === sel ? null : it.id)}
            >
              <button
                type="button"
                className="ann-eye"
                title={it.visible === false ? '显示' : '隐藏'}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleVisible(i)
                }}
              >
                {it.visible === false ? '◌' : '◉'}
              </button>
              <span className="ann-layer-name">{layerName(it)}</span>
              <span className="ann-layer-ops">
                <button
                  type="button"
                  title="上移一层"
                  disabled={i === layers.length - 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onReorder(i, 1)
                  }}
                >
                  ▲
                </button>
                <button
                  type="button"
                  title="下移一层"
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onReorder(i, -1)
                  }}
                >
                  ▼
                </button>
                <button
                  type="button"
                  title="删除该层"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(i)
                  }}
                >
                  ×
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      {selIdx >= 0 && (
        <div className="ann-sel-bar">
          <span className="ann-sel-name" title={layerName(layers[selIdx])}>
            {layerName(layers[selIdx])}
          </span>
          {/* 素材这类整张贴纸，压脸时调淡比挪开更省事 */}
          <label className="ann-sel-alpha" title="该层不透明度">
            <input
              type="range"
              min={15}
              max={100}
              step={5}
              value={Math.round((layers[selIdx].alpha ?? 1) * 100)}
              onChange={(e) => onAlpha?.(Number(e.target.value) / 100)}
            />
            <b>{Math.round((layers[selIdx].alpha ?? 1) * 100)}%</b>
          </label>
          <span className="ann-layer-ops">
            <button type="button" title="缩小（[）" onClick={() => onScale?.(0.9)}>
              －
            </button>
            <button type="button" title="放大（]）" onClick={() => onScale?.(1 / 0.9)}>
              ＋
            </button>
            <button type="button" title="逆时针 15°（,）" onClick={() => onRotate?.(-15)}>
              ↺
            </button>
            <button type="button" title="顺时针 15°（.）" onClick={() => onRotate?.(15)}>
              ↻
            </button>
            <button type="button" title="删除（Delete）" onClick={() => onRemove(selIdx)}>
              🗑
            </button>
          </span>
        </div>
      )}

      <p className="note">
        点行选中：拖四角方块改大小、拖顶部圆点旋转；也可 [ ] 缩放、, . 旋转、方向键微调、Delete 删除。
      </p>
    </div>
  )
}
