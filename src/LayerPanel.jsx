/**
 * LayerPanel.jsx —— 标注图层栈
 *
 * 数组序即 z 序：列表【倒序】展示（末尾 = 画布最上层 = 列表第一行），
 * 这样「上下移层」的方向与视觉一致，也和 Photoshop 的图层面板习惯相同。
 *
 * 每层三件事：显示 / 隐藏（眼）、选中（点击行）、上移下移与删除。
 * 选中态是给「移动」工具用的 —— 选中后可以用方向键微调位置。
 */

import { layerName } from './annotations.js'

export default function LayerPanel({ layers, sel, onSelect, onToggleVisible, onRemove, onReorder, onClear }) {
  if (!layers.length) {
    return (
      <div className="ann-panel">
        <div className="ann-panel-head">
          <strong>图层</strong>
        </div>
        <p className="note">还没有标注。选一个工具在照片上画，或从「素材」里贴一张示意图。</p>
      </div>
    )
  }

  // 倒序：栈顶（最上层）排最前
  const order = layers.map((_, i) => i).reverse()

  return (
    <div className="ann-panel">
      <div className="ann-panel-head">
        <strong>图层</strong>
        <span className="ann-count">{layers.length}</span>
        <button type="button" className="btn-mini" onClick={onClear}>
          清空
        </button>
      </div>
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
      <p className="note">点行选中（可用「移动」工具拖动，或方向键微调）；点眼睛临时隐藏。</p>
    </div>
  )
}
