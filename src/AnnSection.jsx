/**
 * AnnSection.jsx —— 标注面板的外壳（侧栏小节 / 可拖动浮窗 两种形态）
 *
 * 画线工具 / 素材 / 图层 / 话术库四个面板共用这一个壳，保证它们看起来
 * 是并列的四个抽屉，而不是四个互不相干的页面。
 *
 * 两种形态：
 * - **侧栏小节**：折在右栏卡片里，标题即折叠开关（收起后标题仍在，
 *   否则用户再也找不到这个面板）；
 * - **浮窗**（点标题右侧 ⇱）：由 FloatPanel 承担，可拖动位置、拖右下角改
 *   尺寸，位置尺寸跨会话记忆。右栏原位置留一条「已浮出」占位，点它收回。
 *
 * 之所以要浮窗：侧栏宽度固定（260–320px），素材缩略图和话术列表挤在里面
 * 要么看不清、要么滚很久；加宽侧栏又会挤压画布。让面板自己浮出来调大小，
 * 是唯一两边都不牺牲的解。
 */

import FloatPanel from './FloatPanel.jsx'

export default function AnnSection({
  title,
  badge,
  fold,
  onFold,
  floating = false,
  win,
  onWin,
  onFloat,
  children,
}) {
  // ---- 浮窗态：内容搬到浮窗里，侧栏留占位条（收回的唯一入口）----
  if (floating) {
    return (
      <>
        <div className="ann-section floated" title="该面板已浮出，点击收回侧栏">
          <h2 className="card-title ann-sec-title">
            <button type="button" className="ann-fold" onClick={onFloat}>
              <span className="ann-caret">⤡</span>
              {title}
              <span className="ann-count">浮窗中</span>
            </button>
          </h2>
        </div>
        <FloatPanel title={title} win={win} onWin={onWin} onClose={onFloat}>
          {children}
        </FloatPanel>
      </>
    )
  }

  // ---- 侧栏态 ----
  return (
    <section className={`ann-section${fold ? ' folded' : ''}`}>
      <h2 className="card-title ann-sec-title">
        <button type="button" className="ann-fold" onClick={onFold} aria-expanded={!fold} title={fold ? '展开' : '折叠'}>
          <span className="ann-caret">{fold ? '▸' : '▾'}</span>
          {title}
          {badge != null && badge !== '' && <span className="ann-count">{badge}</span>}
        </button>
        <button
          type="button"
          className="ann-pop"
          onClick={onFloat}
          title="浮窗显示：可拖动位置、拖右下角改大小"
          aria-label={`${title} 浮窗显示`}
        >
          ⇱
        </button>
      </h2>
      {!fold && <div className="ann-sec-body">{children}</div>}
    </section>
  )
}
