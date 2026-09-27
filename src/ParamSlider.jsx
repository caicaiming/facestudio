/**
 * ParamSlider.jsx —— 滑块 + 精确数值输入
 *
 * 滑块便于快速试参数，但难以落在精确值上；数值输入框可直接键入目标值。
 * 两者共享同一个值，输入时做范围钳制，非法输入在提交时回滚为当前值。
 *
 * 数值框采用「本地字符串 + 提交时同步」：编辑过程中允许出现 "", "-", "1."
 * 这类中间态，不会被外部 value 打断；提交后才写回上层状态。
 *
 * ⚠️ 判断「正在编辑」必须依据【真实焦点】，而不是自己维护的 editing 标记：
 * 画布拖拽时会 preventDefault 阻止焦点转移，输入框此后收不到 blur，自建标记
 * 永远不复位，导致「拖点后数字框永远停在你最后键入的值」这种错位。
 */

import { useEffect, useRef, useState } from 'react'
import { SLIDER_TRAVEL, hitSliderThumb, sliderTravelToValue } from './drag.js'

/** 由 step 推断显示精度，避免出现 0.30000000000000004 这类浮点尾巴 */
function decimalsOf(step) {
  const s = String(step)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

export default function ParamSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  disabled = false,
  hint = '',
  onChange,
  onReset,
}) {
  const dec = decimalsOf(step)
  const fmt = (v) => (Number.isFinite(v) ? v.toFixed(dec) : '0')
  const [text, setText] = useState(() => fmt(value))
  const inputRef = useRef(null)
  const rangeRef = useRef(null)
  /** 相对拖动的现场：按下时的值与坐标 */
  const dragRef = useRef(null)
  /** 最近一次实际派发的值（window 上的监听读不到最新 props） */
  const emittedRef = useRef(value)

  // 焦点在本框内时不跟随外部值（保护键入中间态）；其余情况一律同步，
  // 保证画布拖拽等操作产生的外部变化能如实反映到数字框。
  useEffect(() => {
    const el = inputRef.current
    if (el && document.activeElement === el) return
    setText(fmt(value))
  }, [value, dec])

  /** 提交：解析 → 钳制到 [min,max] → 写回。非法输入回滚为当前值 */
  const commit = (raw) => {
    let v = parseFloat(raw)
    if (!Number.isFinite(v)) {
      setText(fmt(value))
      return
    }
    v = clamp(v, min, max)
    // 按 step 网格对齐，避免手动输入出现步长以外的值导致滑块刻度错位
    v = Math.round(v / step) * step
    v = clamp(Number(v.toFixed(dec)), min, max)
    setText(fmt(v))
    if (v !== value) onChange(v)
  }

  /** 步进：钳制到 [min,max] 并对齐 step 网格，与手动输入走同一套规则 */
  const bump = (dir) => {
    if (disabled) return
    const raw = clamp(value + dir * step, min, max)
    const v = clamp(Number((Math.round(raw / step) * step).toFixed(dec)), min, max)
    setText(fmt(v))
    if (v !== value) onChange(v)
  }

  /**
   * 滑块接管为【相对拖动】。
   *
   * 原生 range 是位置映射：拖到轨道 80% 处就是 80% 的值，与鼠标走了多远无关。
   * 在 ±15 的窄量程 + 约 180px 的轨道上，这等于每 6px 跳一档，一抖就到底。
   * 改为相对位移后，默认要拖 2.2 倍轨道宽度才走完整量程，按住 Shift 再降到
   * 约 1/4 —— 手感上有明确的「阻力」。
   *
   * 只在【按下点确实落在滑块上】时接管；点在轨道其他位置时保持原生行为
   * （直接跳到该位置），否则用户会觉得「点中间怎么没反应」。
   */
  const onRangePointerDown = (e) => {
    if (disabled || e.button != null && e.button !== 0) return
    const el = rangeRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (!hitSliderThumb(e.clientX, rect, value, { min, max })) return

    dragRef.current = { x: e.clientX, v: value, rect: el.getBoundingClientRect() }
    emittedRef.current = value
    el.focus()
    e.preventDefault()

    const onMove = (ev) => {
      const d = dragRef.current
      if (!d) return
      const next = sliderTravelToValue(d.v, ev.clientX - d.x, d.rect.width, { min, max, step }, {
        fine: ev.shiftKey,
      })
      if (next !== emittedRef.current) {
        emittedRef.current = next
        onChange(next)
      }
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  useEffect(() => () => {
    dragRef.current = null
  }, [])

  const zeroPos = ((0 - min) / (max - min)) * 100
  const valPos = ((value - min) / (max - min)) * 100
  const left = Math.min(zeroPos, valPos)
  const width = Math.abs(valPos - zeroPos)

  return (
    <div className="slider-row">
      <div className="slider-head">
        <span className="slider-label">{label}</span>
        <div className="num-field">
          <button
            type="button"
            className="step-btn"
            disabled={disabled || value <= min}
            aria-label={`${label}减一档`}
            title="− 一档（可精确微调）"
            onClick={() => bump(-1)}
          >
            −
          </button>
          <input
            ref={inputRef}
            type="number"
            className={`num-input ${value > 0 ? 'pos' : value < 0 ? 'neg' : ''}`}
            value={text}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            aria-label={`${label}数值`}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit(e.currentTarget.value)
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                setText(fmt(value))
                e.currentTarget.blur()
              }
            }}
          />
          <button
            type="button"
            className="step-btn"
            disabled={disabled || value >= max}
            aria-label={`${label}加一档`}
            title="＋ 一档（可精确微调）"
            onClick={() => bump(1)}
          >
            ＋
          </button>
          {unit && <span className="num-unit">{unit}</span>}
        </div>
      </div>
      <div className="slider">
        <div className="slider-track" />
        <div
          className={`slider-fill ${value < 0 ? 'neg' : 'pos'}`}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
        <input
          ref={rangeRef}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          title={`拖动调 ${label}（按住 Shift 精调）`}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onReset?.()}
          onPointerDown={onRangePointerDown}
        />
      </div>
      {hint && <div className="slider-hint">{hint}</div>}
    </div>
  )
}
