/**
 * FloatPanel.jsx —— 可拖动、可缩放的浮窗容器
 *
 * 侧栏宽度是固定的（右栏 260–320px），素材缩略图与话术列表挤在里面要么太小、
 * 要么得滚很久。与其把侧栏加宽挤画布，不如让面板能「浮出来」自己调大小 ——
 * 这正是「元素无法调整大小位置」的解法：拖动标题栏挪位置，拖右下角改尺寸。
 *
 * 两个实现细节：
 * - 用 portal 挂到 body：右栏是 overflow 容器，浮窗留在里面会被滚动/裁剪；
 * - 拖动用 window 级 pointermove（不是元素级），指针滑出元素也不会掉帧丢失；
 *   位移 clamp 在视口内，缩到最小尺寸为止，避免拖没了找不回来。
 */

import { useRef } from 'react'
import { createPortal } from 'react-dom'

const MIN_W = 240
const MIN_H = 180

export default function FloatPanel({ title, win, onWin, onClose, children }) {
  /** 拖动期间要读最新的 win / onWin，但不想让 handler 依赖变化而反复解绑 */
  const live = useRef({ win, onWin })
  live.current = { win, onWin }

  const startDrag = (mode) => (e) => {
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const { win: w0, onWin: cb } = live.current
    const sx = e.clientX
    const sy = e.clientY
    const start = { ...w0 }

    const move = (ev) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      if (mode === 'move') {
        const maxX = Math.max(4, window.innerWidth - start.w - 8)
        const maxY = Math.max(4, window.innerHeight - 36)
        cb({
          x: Math.max(4, Math.min(maxX, start.x + dx)),
          y: Math.max(4, Math.min(maxY, start.y + dy)),
        })
      } else {
        cb({ w: Math.max(MIN_W, start.w + dx), h: Math.max(MIN_H, start.h + dy) })
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return createPortal(
    <div className="float-panel" style={{ left: win.x, top: win.y, width: win.w, height: win.h }}>
      <div
        className="fp-head"
        onPointerDown={startDrag('move')}
        onDoubleClick={onClose}
        title="拖动挪位置，双击收回侧栏"
      >
        <span className="fp-title">{title}</span>
        <button type="button" className="fp-close" onClick={onClose} title="收回侧栏">
          ⤡
        </button>
      </div>
      <div className="fp-body">{children}</div>
      <div className="fp-resize" onPointerDown={startDrag('resize')} title="拖动调整大小" />
    </div>,
    document.body,
  )
}
