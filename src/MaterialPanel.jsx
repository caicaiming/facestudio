/**
 * MaterialPanel.jsx —— 内置标注素材库
 *
 * 10 张透明 PNG 迁自自研「图片融合」工具（原为 base64 内联，已落为静态文件）。
 * 点一下贴到画布中央，之后用「移动」工具摆位置、拖角缩大小。
 *
 * 素材是【讲解用示意图】（骨相点位、明暗面、弧形轨迹…），不是照片效果 ——
 * 它们的作用是把抽象的解剖概念摆到顾客脸旁，让沟通从「我说的你想象一下」
 * 变成「就在这儿」。
 *
 * 本组件只出内容，外壳（卡片标题 / 折叠）由 AnnSection 统一提供。
 */

import { MATERIALS, materialUrl } from './materials.js'

export default function MaterialPanel({ onPick }) {
  return (
    <div className="ann-body">
      <div className="ann-mats">
        {MATERIALS.map((m) => (
          <button
            key={m.slug}
            type="button"
            className="ann-mat"
            title={`${m.name}（${m.w}×${m.h}）`}
            onClick={() => onPick(m)}
          >
            <img src={materialUrl(m)} alt={m.name} loading="lazy" draggable={false} />
            <span>{m.name}</span>
          </button>
        ))}
      </div>
      <p className="note">点一下贴到画面中央，再用「移动」工具摆到要讲的位置（[] 缩放、, . 旋转）。</p>
    </div>
  )
}
