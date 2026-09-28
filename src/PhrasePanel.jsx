/**
 * PhrasePanel.jsx —— 医美话术库弹层
 *
 * 60 条内置话术（7 大类）迁自自研「图片融合」工具，措辞原样保留 —— 那是一线
 * 咨询师的实际用语，改成书面语反而不好用。
 *
 * 两个入口共用这一个弹层：
 *   - 标注工具条的「话术库」：画到一半想配一句话；
 *   - 右栏「分析文案」卡片：系统给的文案偏理性，补一句顾客听得懂的。
 * 两个入口的行为一致 —— 点条目即在照片上落一条文字标注，
 * 因为话术最终是要【指着照片说】的，脱离照片的话术清单没有意义。
 *
 * 自定义话术存 localStorage（见 phrases.js），跨会话保留。
 */

import { useMemo, useState } from 'react'
import { CUSTOM_CAT, searchPhrases } from './phrases.js'

export default function PhrasePanel({ custom, onPick, onAddCustom, onRemoveCustom, onClose }) {
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState('')
  const groups = useMemo(() => searchPhrases(q, custom), [q, custom])
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  const addCustom = () => {
    const v = draft.trim()
    if (!v) return
    onAddCustom?.(v)
    setDraft('')
  }

  return (
    <div className="modal-mask" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>话术库</strong>
          <span className="dim">点一条 → 在照片上落一条文字标注</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          <input
            className="ph-search"
            value={q}
            placeholder="搜索，如：泪沟 / 鼻部 / 填充"
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />

          {total === 0 && <p className="note">没有匹配的话术。可在下方添加自己的常用语。</p>}

          {groups.map((g) => (
            <div key={g.cat} className="ph-group">
              <div className="ph-cat">
                {g.cat}
                <span className="ph-num">{g.items.length}</span>
              </div>
              <div className="ph-items">
                {g.items.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="ph-item"
                    onClick={() => {
                      onPick?.(t)
                      onClose?.()
                    }}
                    title="点击插入为文字标注"
                  >
                    {t}
                    {g.cat === CUSTOM_CAT && (
                      <span
                        className="ph-del"
                        role="button"
                        tabIndex={-1}
                        title="删除该自定义话术"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveCustom?.(t)
                        }}
                      >
                        ×
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="modal-foot">
          <input
            className="ph-add"
            value={draft}
            placeholder="添加自己的常用话术"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCustom()
            }}
          />
          <button type="button" className="btn-accent sm" disabled={!draft.trim()} onClick={addCustom}>
            添加
          </button>
          <span className="dim">自定义话术保存在本机，换设备不带走。</span>
        </div>
      </div>
    </div>
  )
}
