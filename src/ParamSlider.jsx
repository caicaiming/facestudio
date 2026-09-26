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

  const zeroPos = ((0 - min) / (max - min)) * 100
  const valPos = ((value - min) / (max - min)) * 100
  const left = Math.min(zeroPos, valPos)
  const width = Math.abs(valPos - zeroPos)

  return (
    <div className="slider-row">
      <div className="slider-head">
        <span className="slider-label">{label}</span>
        <div className="num-field">
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
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onReset?.()}
        />
      </div>
      {hint && <div className="slider-hint">{hint}</div>}
    </div>
  )
}
