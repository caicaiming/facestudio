/**
 * PlanPanel.jsx —— 医美方案面板
 *
 * 把 aesthetic.js 生成的方案渲染成可直接给顾客看（或复制给医生）的形式：
 *   部位 → 项目 → 幅度 mm → 参考剂量 → 风险等级
 *
 * 设计要点：
 * - 毫米标定放在最上面：mm 值全靠瞳距估算，必须让使用者一眼看到标定依据，
 *   避免把估算值当成测量结果读给顾客；
 * - 高风险部位用独立徽标标出，这类部位（太阳穴 / 泪沟 / 鼻部）有血管栓塞风险；
 * - 自动建议与「本次设计项目」分开陈列：前者是系统推断，后者是咨询师设定，
 *   两者混在一起会被误读成已确认方案；
 * - 免责声明不可折叠、不可隐藏。
 */

import { useState } from 'react'
import { IPD_MM } from './aesthetic.js'

const RISK_TEXT = { high: '高风险', mid: '中风险', low: '低风险' }

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立即 revoke 在部分浏览器会中断下载，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const stamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export default function PlanPanel({ plan, disabled, gender, ipdMm, onGender, onIpdMm, onExportImage }) {
  const [copied, setCopied] = useState(false)
  const [exported, setExported] = useState(false)
  const has = plan && (plan.items.length > 0 || plan.suggestions.length > 0)

  const copy = async () => {
    if (!plan?.text) return
    try {
      await navigator.clipboard.writeText(plan.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用时（非安全上下文 / 无权限）退化为下载，不静默失败
      download(`面部设计方案_${stamp()}.txt`, plan.text)
    }
  }

  return (
    <div className="card plan-card">
      <h2 className="card-title">医美方案</h2>

      {/* ---- 毫米标定 ---- */}
      <div className="plan-scale">
        <span className="plan-scale-label">瞳距标定</span>
        <div className="seg sm">
          {[
            { k: 'female', label: `女 ${IPD_MM.female}` },
            { k: 'male', label: `男 ${IPD_MM.male}` },
            { k: null, label: '默认' },
          ].map((o) => (
            <button
              key={String(o.k)}
              type="button"
              className={gender === o.k ? 'active' : ''}
              disabled={disabled}
              onClick={() => {
                onGender(o.k)
                onIpdMm(null)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <input
          className="score-input sm"
          type="number"
          min={40}
          max={90}
          step={1}
          placeholder="自定义"
          value={ipdMm ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value)
            onIpdMm(Number.isFinite(v) ? v : null)
          }}
          title="已知瞳距时填入，可得更准的毫米换算"
        />
        <span className="plan-scale-unit">mm</span>
      </div>
      {plan?.scale?.ok ? (
        <p className="note">
          {plan.scale.note}
          {plan.scale.faceWidthMm > 0 && `；面宽约 ${Math.round(plan.scale.faceWidthMm)}mm`}
          。改标定只影响毫米读数，不改动照片形变。
        </p>
      ) : (
        <p className="note warn">瞳距不可用，毫米换算已停用。</p>
      )}

      {/* ---- 本次设计项目 ---- */}
      {plan?.items.length > 0 ? (
        <ul className="plan-items">
          {plan.items.map((it) => (
            <li key={it.key} className={`plan-item risk-${it.risk}`}>
              <div className="plan-item-head">
                <span className="plan-name">{it.label}</span>
                <span className={`plan-risk ${it.risk}`}>{RISK_TEXT[it.risk]}</span>
                {it.mm != null && (
                  <span className="plan-mm">
                    {it.mm > 0 ? '+' : ''}
                    {it.mm}mm
                  </span>
                )}
              </div>
              <div className="plan-proj">{it.projects.join(' / ')}</div>
              <div className="plan-meta">
                <span>{it.direction}</span>
                {it.doseRef !== '—' && <span>参考 {it.doseRef}</span>}
                {it.virtual && <span className="plan-virtual">几何推演</span>}
              </div>
              <div className="plan-note">{it.note}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">
          尚未设定部位。在左栏「医美部位」中调整任一部位，这里会生成对应项目与幅度。
        </p>
      )}

      {/* ---- 自动建议 ---- */}
      {plan?.suggestions.length > 0 && (
        <>
          <h3 className="plan-sub">系统建议（需面诊确认）</h3>
          <ul className="plan-sugg">
            {plan.suggestions.map((s, i) => (
              <li key={`${s.key}-${i}`}>
                <div className="plan-sugg-head">
                  <span className="plan-name">{s.label}</span>
                  {s.mm != null && s.mm !== 0 && <span className="plan-mm">建议 +{s.mm}mm</span>}
                  <span className={`plan-conf ${s.confidence}`}>
                    {s.confidence === 'high' ? '依据充分' : s.confidence === 'mid' ? '可参考' : '弱推断'}
                  </span>
                </div>
                <div className="plan-evidence">{s.evidence}</div>
                <div className="plan-note">{s.reason}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ---- 风险提示 ---- */}
      {plan?.warnings.length > 0 && (
        <ul className="plan-warn">
          {plan.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {/* ---- 导出 ---- */}
      <div className="plan-actions">
        <button
          className="btn-accent"
          disabled={disabled || !onExportImage}
          onClick={() => {
            const ok = onExportImage?.()
            setExported(!!ok)
            setTimeout(() => setExported(false), 2000)
          }}
        >
          {exported ? '已导出' : '导出对比图'}
        </button>
        <button className="btn-ghost" disabled={disabled || !has} onClick={copy}>
          {copied ? '已复制' : '复制方案'}
        </button>
        <button
          className="btn-ghost"
          disabled={disabled || !plan}
          onClick={() => download(`面部设计方案_${stamp()}.txt`, plan.text)}
        >
          下载 .txt
        </button>
      </div>
      <p className="plan-disclaimer">
        对比图为数学插值模拟，非真实术后效果预测。
      </p>

      <p className="plan-disclaimer">{plan?.disclaimer}</p>
    </div>
  )
}
