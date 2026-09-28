/**
 * phrases.js —— 医美话术库
 *
 * 59 条内置话术整体迁自自研「图片融合」工具（分类与措辞原样保留——那是
 * 一线咨询师的实际用语），外加本工具的持久化方案：
 * - 自定义话术存 localStorage（key 见下），跨会话保留；
 * - 搜索同时匹配分类名与条目文本。
 *
 * 纯数据 + 纯函数，不依赖 DOM（localStorage 读写包 try/catch，测试环境
 * 可注入 mock）。
 */

export const PHRASES = [
  {
    cat: '轮廓',
    items: [
      '外轮廓不流畅',
      '内轮廓塌陷',
      '下颌线模糊',
      '下巴后缩',
      '下巴短小',
      '颞部凹陷',
      '发际线偏高',
      '面颊凹陷',
      '面部不对称',
      '轮廓需要提升',
    ],
  },
  {
    cat: '眼部',
    items: [
      '眉弓低平',
      '眼角下垂',
      '双眼皮不对称',
      '卧蚕缺失',
      '眶下三角区凹陷',
      '上睑窝凹陷',
      '泪沟明显',
      '眼周细纹',
      '黑眼圈',
      '眼袋突出',
    ],
  },
  {
    cat: '鼻部',
    items: [
      '山根低平',
      '鼻背宽大',
      '鼻头圆钝',
      '鼻翼基底凹陷',
      '鼻小柱短',
      '鼻三角区大',
      '鼻背弧度不佳',
      '鼻头需要抬高',
      '鼻翼外扩',
    ],
  },
  {
    cat: '唇部口周',
    items: ['口角下垂', '唇珠不明显', '唇峰不清晰', '唇形偏薄', '法令沟凹陷区'],
  },
  {
    cat: '高光影调',
    items: [
      '额部高光',
      '眉弓高光',
      '鼻部高光',
      '下颏高光',
      '苹果肌高光点',
      '亮面',
      '灰面',
      '暗面',
      '明暗交界线',
      '反光',
    ],
  },
  {
    cat: '骨相点位',
    items: ['额结节', '眉弓高点', '外眼眶骨', '颧弓高点', '颧骨突出', '下颌角宽大'],
  },
  {
    cat: '常用短句',
    items: [
      '建议填充',
      '建议提升',
      '建议收紧',
      '可少量填充',
      '需要骨性支撑',
      '左右对称度尚可',
      '轻度',
      '中度',
      '重度',
      '术后改善明显',
    ],
  },
]

export const CUSTOM_CAT = '我的话术'
export const PH_CUSTOM_KEY = 'facestudio_phrases_custom_v1'

/**
 * 读自定义话术。storage 可注入（默认 window.localStorage），
 * 任何异常都吞掉返回 []——话术库绝不能把主流程搞崩。
 */
export function loadCustomPhrases(storage) {
  try {
    const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
    const raw = s?.getItem(PH_CUSTOM_KEY)
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 存自定义话术（失败静默）。 */
export function saveCustomPhrases(items, storage) {
  try {
    const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
    s?.setItem(PH_CUSTOM_KEY, JSON.stringify(items))
  } catch {
    /* 隐私模式 / 配额满：放弃持久化即可 */
  }
}

/** 全部分类（含「我的话术」，仅当非空） */
export function allCats(custom) {
  const cats = PHRASES.map((x) => x.cat)
  if (custom && custom.length) cats.push(CUSTOM_CAT)
  return cats
}

/** 分类 → 条目 */
export function itemsOf(cat, custom) {
  if (cat === CUSTOM_CAT) return custom || []
  return PHRASES.find((x) => x.cat === cat)?.items || []
}

/**
 * 搜索：命中分类名则整类返回，否则返回条目文本包含关键词的项。
 * 返回 [{cat, items}] 保持分类分组结构。
 */
export function searchPhrases(q, custom) {
  const kw = String(q || '').trim().toLowerCase()
  if (!kw) return PHRASES.map((x) => ({ cat: x.cat, items: x.items }))
  const out = []
  for (const g of PHRASES) {
    if (g.cat.toLowerCase().includes(kw)) {
      out.push({ cat: g.cat, items: g.items })
      continue
    }
    const hit = g.items.filter((t) => t.toLowerCase().includes(kw))
    if (hit.length) out.push({ cat: g.cat, items: hit })
  }
  if (custom && custom.length) {
    const hit = custom.filter((t) => t.toLowerCase().includes(kw))
    if (hit.length) out.push({ cat: CUSTOM_CAT, items: hit })
  }
  return out
}
