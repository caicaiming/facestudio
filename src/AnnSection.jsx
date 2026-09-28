/**
 * AnnSection.jsx —— 标注板块的外壳
 *
 * 画线工具 / 素材 / 图层 / 话术库四个板块共用这一个壳：卡片 + 标题 + 折叠。
 *
 * 之所以要把「壳」抽出来而不是让每个面板各画各的：
 * - 折叠要作用在【标题】上（标题永远可见，只有内容收起）。如果折叠写在外层，
 *   收起后标题也没了，用户就再也找不到这个板块；
 * - 四个板块长得一样，用户才知道它们是并列的四个抽屉，而不是四个互不相干的页面。
 *
 * 折叠状态由 App 持有（annFold），跨板块互不影响 —— 可以只开「素材」画图、
 * 只开「话术库」配文案，按需占用画面高度。
 */

export default function AnnSection({ title, badge, fold, onFold, disabled, children }) {
  return (
    <section className={`ann-section${fold ? ' folded' : ''}${disabled ? ' off' : ''}`}>
      <h2 className="card-title ann-sec-title">
        <button
          type="button"
          className="ann-fold"
          onClick={onFold}
          aria-expanded={!fold}
          title={fold ? '展开' : '折叠'}
        >
          <span className="ann-caret">{fold ? '▸' : '▾'}</span>
          {title}
          {badge != null && badge !== '' && <span className="ann-count">{badge}</span>}
        </button>
      </h2>
      {!fold && <div className="ann-sec-body">{children}</div>}
    </section>
  )
}
