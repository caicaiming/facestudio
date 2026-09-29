/**
 * SubunitPanel.jsx —— 面部亚单位精调面板
 *
 * 按《面部亚单位完整清单》的九大分区组织，每个二级亚单位一行，用 −/＋ 步进
 * 按钮做 1 档微调（滑块拖不准时用它落到精确值）。
 *
 * 交互约定：
 * - 行内 −/＋ 各步进 1 档，长按连续步进（pointerdown 后 400ms 起 90ms/次）
 * - 悬停某行 → 在主图上高亮该亚单位对应的关键点（onHighlight）
 * - 分区标题可折叠；P0 分区默认展开（杠杆最高，最常用）
 * - 「仅供评估」列出正面照无法独立形变的亚单位，避免用户误以为工具漏了
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SUBUNITS,
  SUBUNIT_RANGE,
  ZONES,
  NON_WARPABLE,
  activeCountOf,
  coreIndicesOf,
  subunitsOf,
} from './subunits.js'
import { fmtMm, subunitAmplitudeMm } from './aesthetic.js'

/** 长按连续步进：首次延迟 400ms，之后每 90ms 一次 */
const REPEAT_DELAY = 400
const REPEAT_INTERVAL = 90

function Stepper({ value, onChange, disabled }) {
  const timerRef = useRef(0)
  const timeoutRef = useRef(0)

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = 0
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = 0
    }
  }, [])

  // 组件卸载 / 禁用时务必停表，否则会持续改状态
  useEffect(() => stop, [stop])
  useEffect(() => {
    if (disabled) stop()
  }, [disabled, stop])

  const bump = (dir) => {
    onChange((v) => {
      const next = v + dir * SUBUNIT_RANGE.step
      if (next < SUBUNIT_RANGE.min || next > SUBUNIT_RANGE.max) return v
      return next
    })
  }

  const start = (dir) => {
    if (disabled) return
    bump(dir)
    timeoutRef.current = setTimeout(() => {
      timerRef.current = setInterval(() => bump(dir), REPEAT_INTERVAL)
    }, REPEAT_DELAY)
  }

  return (
    <div className="stepper">
      <button
        type="button"
        className="step-btn"
        disabled={disabled || value <= SUBUNIT_RANGE.min}
        aria-label="减一档"
        onPointerDown={(e) => {
          e.preventDefault()
          start(-1)
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      >
        −
      </button>
      <span
        className={`step-val ${value > 0 ? 'pos' : value < 0 ? 'neg' : ''}`}
        title="当前档位（−15 … ＋15）"
      >
        {value > 0 ? `+${value}` : value}
      </span>
      <button
        type="button"
        className="step-btn"
        disabled={disabled || value >= SUBUNIT_RANGE.max}
        aria-label="加一档"
        onPointerDown={(e) => {
          e.preventDefault()
          start(1)
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      >
        ＋
      </button>
    </div>
  )
}

export default function SubunitPanel({
  values,
  onChange,
  onResetZone,
  onResetAll,
  onHighlight,
  disabled = false,
  defaultCollapsed = false,
  // 毫米标定：档位本身没有物理含义，靠它换算成 mm 才知道推了多少
  points = null,
  scale = null,
}) {
  // P0 分区默认展开：杠杆最高、最常用；其余折叠，避免面板过长
  const [open, setOpen] = useState(() => {
    const o = {}
    for (const z of ZONES) o[z.key] = z.lever === 'P0'
    return o
  })
  const [showNotes, setShowNotes] = useState(false)
  // 整个面板可折叠：它与医美部位面板同为「局部形变」两套入口，
  // 同时展开会把左栏拉到三四屏。折叠后只剩标题行，一键即可展开。
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const active = activeCountOf(values)
  const activeIn = (zoneKey) =>
    subunitsOf(zoneKey).filter((s) => values[s.key]).length

  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }))
  const allOpen = ZONES.every((z) => open[z.key])

  return (
    <div className={`subunit-block${collapsed ? ' collapsed' : ''}`}>
      <div className="subunit-head">
        <button
          type="button"
          className="subunit-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          title={collapsed ? '展开面板' : '收起面板'}
        >
          <span className="su-caret">{collapsed ? '▸' : '▾'}</span>
          <span className="subunit-title">亚单位精调</span>
        </button>
        <span className={`subunit-badge ${active ? 'on' : ''}`}>
          {active ? `${active} 项已调整` : '未调整'}
        </span>
        <button
          type="button"
          className="btn-mini"
          onClick={() => {
            const o = {}
            for (const z of ZONES) o[z.key] = !allOpen
            setOpen(o)
          }}
        >
          {allOpen ? '全部收起' : '全部展开'}
        </button>
        <button
          type="button"
          className="btn-mini"
          disabled={disabled || !active}
          onClick={onResetAll}
        >
          归零
        </button>
      </div>

      <div className="subunit-body" hidden={collapsed}>
        <p className="note">
          按美学分区做局部推拉，＋/− 每次 1 档，按住可连续步进。悬停行名会在主图高亮对应点位。
        </p>

        {ZONES.map((z) => {
        const list = subunitsOf(z.key)
        const n = activeIn(z.key)
        return (
          <div key={z.key} className={`su-zone ${open[z.key] ? 'open' : ''}`}>
            <button
              type="button"
              className="su-zone-head"
              onClick={() => toggle(z.key)}
              aria-expanded={!!open[z.key]}
            >
              <span className="su-caret">{open[z.key] ? '▾' : '▸'}</span>
              <span className="su-zone-name">{z.label}</span>
              <span className={`su-lever ${z.lever.toLowerCase()}`}>{z.lever}</span>
              {n > 0 && <span className="su-zone-badge">{n}</span>}
            </button>
            {open[z.key] && (
              <div className="su-zone-body">
                <p className="su-zone-focus">{z.focus}</p>
                {list.length === 0 && (
                  <p className="su-empty">该分区在正面照中无可独立形变的亚单位。</p>
                )}
                {list.map((su) => {
                  const v = values[su.key] ?? 0
                  const mm = fmtMm(subunitAmplitudeMm(points, su.key, v, scale))
                  return (
                    <div
                      key={su.key}
                      className={`su-row ${v ? 'active' : ''}`}
                      title={su.hint}
                      onMouseEnter={() => onHighlight?.(coreIndicesOf(su))}
                      onMouseLeave={() => onHighlight?.(null)}
                    >
                      <span className="su-name">{su.label}</span>
                      <span className="su-hint">{su.hint}</span>
                      {mm && <span className="su-mm">{mm}</span>}
                      <Stepper
                        value={v}
                        disabled={disabled}
                        onChange={(updater) => {
                          const cur = values[su.key] ?? 0
                          const next = updater(cur)
                          if (next !== cur) onChange(su.key, next)
                        }}
                      />
                    </div>
                  )
                })}
                {list.length > 0 && (
                  <button
                    type="button"
                    className="btn-mini zone-reset"
                    disabled={disabled || !n}
                    onClick={() => onResetZone(z.key)}
                  >
                    本区归零
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      <button
        type="button"
        className="btn-mini notes-toggle"
        onClick={() => setShowNotes((v) => !v)}
      >
        {showNotes ? '收起' : '查看'}仅供评估、无法形变的亚单位（{NON_WARPABLE.length}）
      </button>
      {showNotes && (
        <ul className="su-notes">
          {NON_WARPABLE.map((n) => (
            <li key={n.zone + n.label}>
              <strong>{n.label}</strong>
              <span>{n.why}</span>
            </li>
          ))}
        </ul>
      )}
        <p className="note">
          共 {SUBUNITS.length} 个可形变亚单位，均按面宽归一，跨分辨率手感一致。
        </p>
      </div>
    </div>
  )
}
