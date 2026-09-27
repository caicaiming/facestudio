/**
 * ZonePanel.jsx —— 医美部位面板
 *
 * 与 SubunitPanel 的区别：
 *   - 亚单位按【美学分区】组织，回答「哪里不够美」；
 *   - 本面板按【可施术部位】组织，回答「打哪里、打什么、打多少」，
 *     每行直接给出适用项目、风险等级与换算后的毫米幅度。
 *
 * 交互沿用 SubunitPanel 的约定（−/＋ 长按步进、分区折叠、悬停高亮），
 * 保持一致的手感，避免咨询师在两套面板间切换时重新学习。
 *
 * ⚠️ 面板上的项目名与剂量仅用于沟通示意，不构成医疗建议。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { SITES, SITE_ZONES, sitesOf } from './zones.js'
import { siteAmplitude } from './aesthetic.js'

const RANGE = { min: -15, max: 15, step: 1 }

/** 长按连续步进：首次延迟 400ms，之后每 90ms 一次 */
const REPEAT_DELAY = 400
const REPEAT_INTERVAL = 90

const RISK_LABEL = { high: '高风险', mid: '中风险', low: '低风险' }

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

  useEffect(() => stop, [stop])
  useEffect(() => {
    if (disabled) stop()
  }, [disabled, stop])

  const bump = (dir) => {
    onChange((v) => {
      const next = v + dir * RANGE.step
      if (next < RANGE.min || next > RANGE.max) return v
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
        disabled={disabled || value <= RANGE.min}
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
        disabled={disabled || value >= RANGE.max}
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

export default function ZonePanel({
  values,
  points,
  scale,
  onChange,
  onResetZone,
  onResetAll,
  onHighlight,
  disabled = false,
  defaultCollapsed = false,
}) {
  // P0 分区（眶周 / 颧颊 / 鼻 / 颏）默认展开：医美最高频
  const [open, setOpen] = useState(() => {
    const o = {}
    for (const z of SITE_ZONES) o[z.key] = z.lever === 'P0'
    return o
  })
  // 默认收起：全部 25 个部位的说明与参考剂量展开后近千像素，
  // 会把下面的参数面板挤出好几屏。它是查阅资料，不是日常操作项。
  const [showDetail, setShowDetail] = useState(false)
  // 整个面板可折叠：与亚单位面板同为「局部形变」的入口，
  // 同时展开会把左栏拉长到三四屏。折叠后仅留标题行，一键展开。
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const activeList = SITES.filter((s) => values[s.key])
  const active = activeList.length
  const activeIn = (zoneKey) => sitesOf(zoneKey).filter((s) => values[s.key]).length
  const highRiskActive = activeList.filter((s) => s.risk === 'high').length

  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }))
  const allOpen = SITE_ZONES.every((z) => open[z.key])

  /** 档位 → 毫米（控制点处的峰值位移） */
  const mmOf = (site) => {
    const v = values[site.key] ?? 0
    if (!v || !points || !scale?.ok) return null
    const a = siteAmplitude(points, site.key, v, scale)
    return a.ok ? a.mm : null
  }

  return (
    <div className={`subunit-block zone-block${collapsed ? ' collapsed' : ''}`}>
      <div className="subunit-head">
        <button
          type="button"
          className="subunit-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          title={collapsed ? '展开面板' : '收起面板'}
        >
          <span className="su-caret">{collapsed ? '▸' : '▾'}</span>
          <span className="subunit-title">医美部位</span>
        </button>
        <span className={`subunit-badge ${active ? 'on' : ''}`}>
          {active ? `${active} 个部位` : '未设定'}
        </span>
        {highRiskActive > 0 && (
          <span className="zone-risk-flag" title="含高风险部位，须医师评估">
            {highRiskActive} 高风险
          </span>
        )}
        <button
          type="button"
          className="btn-mini"
          onClick={() => {
            const o = {}
            for (const z of SITE_ZONES) o[z.key] = !allOpen
            setOpen(o)
          }}
        >
          {allOpen ? '全部收起' : '全部展开'}
        </button>
        <button type="button" className="btn-mini" disabled={disabled || !active} onClick={onResetAll}>
          归零
        </button>
      </div>

      <div className="subunit-body" hidden={collapsed}>
        <p className="note">
          ＋ 为填充 / 外扩，− 为收紧 / 内收。悬停部位名会在主图高亮该部位的作用点。
          {scale?.ok ? '幅度已换算为毫米（瞳距估算）。' : '当前无法换算毫米。'}
        </p>

        {SITE_ZONES.map((z) => {
        const list = sitesOf(z.key)
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
                <p className="su-zone-focus">{z.note}</p>
                {z.key === 'ear' && (
                  <p className="su-zone-warn">
                    耳区在 68 关键点中无任何点位，位置按「耳上缘≈眉线、耳垂≈鼻底」外推。
                    <b>需露耳照片</b>；长发遮挡时形变会连带发丝。颅耳角（耳朵立起角度）正面照无法评估，
                    须看侧面或 45° 斜位。
                  </p>
                )}
                {list.map((site) => {
                  const mm = mmOf(site)
                  const v = values[site.key] ?? 0
                  return (
                    <div
                      key={site.key}
                      className={`su-row ${v ? 'active' : ''}`}
                      title={`${site.projects.join(' / ')}｜${site.note}`}
                      onMouseEnter={() => onHighlight?.(site.key)}
                      onMouseLeave={() => onHighlight?.(null)}
                    >
                      <span className="su-name">
                        {site.label}
                        <em className={`su-risk ${site.risk}`}>{RISK_LABEL[site.risk]}</em>
                        {site.virtual && (
                          <em
                            className="su-virtual"
                            title="68 关键点在该区域没有点位，位置为几何推演；形变是近似模拟"
                          >
                            推演
                          </em>
                        )}
                      </span>
                      <span className="su-hint">
                        {site.projects[0]}
                        {mm != null && (
                          <b className="zone-mm">
                            {mm > 0 ? '+' : ''}
                            {mm.toFixed(1)}mm
                          </b>
                        )}
                      </span>
                      <Stepper
                        value={v}
                        disabled={disabled}
                        onChange={(updater) => {
                          const cur = v
                          const next = updater(cur)
                          if (next !== cur) onChange(site.key, next)
                        }}
                      />
                    </div>
                  )
                })}
                <button
                  type="button"
                  className="btn-mini zone-reset"
                  disabled={disabled || !n}
                  onClick={() => onResetZone(z.key)}
                >
                  本区归零
                </button>
              </div>
            )}
          </div>
        )
      })}

      <button type="button" className="btn-mini notes-toggle" onClick={() => setShowDetail((v) => !v)}>
        {showDetail ? '收起' : '查看'}部位说明与参考剂量（{SITES.length}）
      </button>
      {showDetail && (
        <ul className="su-notes">
          {SITES.map((s) => (
            <li key={s.key}>
              <strong>{s.label}</strong>
              <span>
                {s.projects.join(' / ')}
                {s.doseRef !== '—' ? `　参考 ${s.doseRef}` : ''}
                {s.risk === 'high' ? '　⚠ 高风险' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
        <p className="note">
          共 {SITES.length} 个部位。项目与剂量仅用于沟通示意，实际方案须由执业医师面诊确定。
        </p>
      </div>
    </div>
  )
}
