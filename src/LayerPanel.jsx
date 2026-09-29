/**
 * LayerPanel.jsx —— 统一图层栈
 *
 * 与旧版最大的不同：这里不再只列「手动画的标注」，而是把画布上所有叠加内容
 * 都当成图层列出来 —— 底图照片、形变预览、三角网格、68 点位、三庭五眼、
 * 对称线、医美部位、自定义点位、基准点，加上素材与画线文字。
 * 只要是图层，就能：显示/隐藏、锁定、调不透明度、调层序。
 *
 * 列表【倒序】展示（末尾 = 画布最上层 = 列表第一行），与 Photoshop 的图层
 * 面板习惯一致，也让「上移 / 下移」的方向和视觉对得上。
 *
 * 排序跨不过 band（素材必在点位下、画线必在点位上），到边界的按钮直接禁用 ——
 * 与其让用户点了没反应，不如一开始就不给点。
 *
 * 本组件只出内容，外壳（卡片标题 / 折叠 / 浮窗）由 AnnSection 统一提供。
 */

import { useState } from 'react'
import { layerName } from './annotations.js'
import { canMove, MARKER_SCALE_MAX, MARKER_SCALE_MIN } from './layers.js'

export default function LayerPanel({
  stack,
  sel,
  onSelect,
  onToggleVisible,
  onToggleLock,
  onMove,
  onRemove,
  onRename,
  onAlpha,
  onMarker,
  onScale,
  onRotate,
  onReset,
}) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')

  // 倒序：栈顶（最上层）排最前
  const rows = stack.slice().reverse()
  const cur = stack.find((r) => r.id === sel) || null

  const nameOf = (r) => (r.sys ? r.name : layerName(r.item))
  const commitName = (r) => {
    const v = draft.trim()
    if (v) onRename?.(r, v)
    setEditing(null)
  }

  return (
    <div className="ann-body">
      <ul className="ann-layers">
        {rows.map((r) => {
          const off = r.visible === false
          return (
            <li
              key={r.id}
              className={[
                'ann-layer',
                r.id === sel ? 'active' : '',
                off ? 'hidden' : '',
                r.sys ? 'sys' : 'free',
                r.lock ? 'locked' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-key={r.sys ? r.key : r.item.kind}
              data-band={r.band}
              title={r.sys ? r.hint : undefined}
              onClick={() => onSelect(r.id === sel ? null : r.id)}
            >
              <button
                type="button"
                className="ann-eye"
                title={off ? '显示该层' : '隐藏该层'}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleVisible(r)
                }}
              >
                {off ? '◌' : '◉'}
              </button>
              <button
                type="button"
                className="ann-lock"
                title={r.lock ? '解锁（恢复在画布上选中/拖动）' : '锁定（画布上不可选中、不可拖动）'}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleLock(r)
                }}
              >
                {r.lock ? '🔒' : '🔓'}
              </button>

              {editing === r.id ? (
                <input
                  className="ann-layer-rename"
                  value={draft}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitName(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitName(r)
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <span
                  className="ann-layer-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setEditing(r.id)
                    setDraft(nameOf(r))
                  }}
                >
                  <i className="ann-layer-icon">{r.icon}</i>
                  {nameOf(r)}
                </span>
              )}

              <span className="ann-layer-ops">
                <button
                  type="button"
                  title={r.fixed ? '该层固定在最底，不能上移' : '上移一层'}
                  disabled={!canMove(stack, r.id, 1)}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMove(r, 1)
                  }}
                >
                  ▲
                </button>
                <button
                  type="button"
                  title={r.fixed ? '该层固定在最底，不能下移' : '下移一层'}
                  disabled={!canMove(stack, r.id, -1)}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMove(r, -1)
                  }}
                >
                  ▼
                </button>
                {!r.sys && (
                  <button
                    type="button"
                    title="删除该层"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove(r)
                    }}
                  >
                    ×
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      {cur && (
        <div className="ann-sel-bar">
          <span className="ann-sel-name" title={nameOf(cur)}>
            {nameOf(cur)}
          </span>
          {/* 素材这类整张贴纸，压脸时调淡比挪开更省事；点位层同理 */}
          <label className="ann-sel-alpha" title="该层不透明度">
            <input
              type="range"
              min={15}
              max={100}
              step={5}
              value={Math.round((cur.alpha ?? 1) * 100)}
              onChange={(e) => onAlpha?.(cur, Number(e.target.value) / 100)}
            />
            <b>{Math.round((cur.alpha ?? 1) * 100)}%</b>
          </label>

          <span className="ann-layer-ops">
            {cur.sys && cur.band === 3 ? (
              <>
                <button
                  type="button"
                  title="标记缩小"
                  disabled={(cur.marker ?? 1) <= MARKER_SCALE_MIN + 1e-6}
                  onClick={() => onMarker?.(cur, -1)}
                >
                  －
                </button>
                <button
                  type="button"
                  title="标记放大"
                  disabled={(cur.marker ?? 1) >= MARKER_SCALE_MAX - 1e-6}
                  onClick={() => onMarker?.(cur, 1)}
                >
                  ＋
                </button>
              </>
            ) : (
              !cur.sys && (
                <>
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
                </>
              )
            )}
            {!cur.sys && (
              <button type="button" title="删除（Delete）" onClick={() => onRemove(cur)}>
                🗑
              </button>
            )}
          </span>
        </div>
      )}

      <p className="note">
        每一行都是一个图层：点眼睛显隐、点锁防误拖、双击改名、▲▼ 调层序。
        选中的是标记层时 －＋ 调标记大小；是画线/素材时 －＋ 缩放、↺↻ 旋转、[ ] , . 快捷键通用。
      </p>
      <button type="button" className="ann-layers-reset" onClick={() => onReset?.()}>
        恢复默认图层设置
      </button>
    </div>
  )
}
