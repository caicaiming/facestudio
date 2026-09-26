/**
 * subunits.js —— 面部美学亚单位与 68 关键点的映射 + 亚单位级局部形变
 *
 * 方法论来源：Burget & Menick 美学分区 + 东方人面部解剖 + 实操美学项目，
 * 整理见《面部亚单位完整清单》（九大分区 → 二级亚单位 → 五层组织 → 三维度评估）。
 *
 * 与 5 路预设滑块（measure.js DEFORMERS）的关系：
 *   滑块是「整脸级组合形变」，亚单位是「局部精细形变」，二者叠加、互不覆盖。
 *   滑块适合快速定调（脸变长/变窄），亚单位适合按医美沟通粒度逐个推拉
 *   （鼻翼收窄、上唇增厚、下颌缘收紧……）。
 *
 * 形变模型：每个亚单位声明若干【核心点 + 方向】，其余 68 点按到核心点的
 * 高斯距离衰减跟随。镜像亚单位（如鼻翼）必须成对给反向权重，否则会拉垮
 * 权重 0.2 的对称分。
 *
 * ⚠️ 位移量一律按【面宽】归一（unit = |p16.x − p0.x|），跨分辨率结果一致。
 */

// ---------------------------------------------------------------- 分区定义

/**
 * 九大一级分区（正面观）。
 * lever 为《清单》7.3 的优先级分层：P0 必做 / P1 明显加分 / P2 锦上添花 / P3 按需。
 */
export const ZONES = [
  { key: 'forehead', label: '额部', en: 'Forehead', lever: 'P1', focus: '饱满度、光泽、纹理平整' },
  { key: 'brow', label: '眉部', en: 'Eyebrows', lever: 'P1', focus: '眉头对齐鼻翼、眉峰对齐眼外角' },
  { key: 'eye', label: '眼/眶周', en: 'Periorbital', lever: 'P0', focus: '眼裂大小、对称性、上睑松弛' },
  { key: 'nose', label: '鼻部', en: 'Nose', lever: 'P0', focus: '鼻梁挺直、鼻翼宽度、鼻尖突出度' },
  { key: 'cheek', label: '颧/面颊', en: 'Malar/Cheek', lever: 'P1', focus: '颧骨高度、苹果肌饱满、颊部平滑' },
  { key: 'fold', label: '鼻唇沟区', en: 'Nasolabial', lever: 'P1', focus: '法令纹深度（衰老标志）' },
  { key: 'lip', label: '唇部', en: 'Lips', lever: 'P1', focus: '上下唇 1:1.5、唇峰唇珠、口角' },
  { key: 'jaw', label: '下颌/颏', en: 'Jawline/Chin', lever: 'P0', focus: '颏长突出度、下颌角、下颌缘清晰' },
  { key: 'ear', label: '耳部', en: 'Ears', lever: 'P3', focus: '颅耳角 30°、耳廓对称' },
]

/**
 * 二级亚单位。
 * core:  [点索引, x 方向权重, y 方向权重] —— ＋档位下的移动方向（y 向下为正）
 * radius: 影响半径（面宽比例），决定形变是局部还是扩散
 * scale: 满档（±100）位移量占面宽的比例
 * lever: 该亚单位的杠杆等级（用于 UI 排序与提示）
 */
export const SUBUNITS = [
  // ---- 额部：无独立点位，借眉位与眉上区域间接表达 ----
  {
    key: 'foreheadHeight',
    zone: 'forehead',
    label: '额部高度',
    hint: '＋ 额头变高（眉位上移）',
    lever: 'P1',
    scale: 0.22,
    radius: 0.18,
    core: [[17, 0, -1], [19, 0, -1], [21, 0, -1], [22, 0, -1], [24, 0, -1], [26, 0, -1]],
  },
  {
    key: 'foreheadWidth',
    zone: 'forehead',
    label: '额部宽度',
    hint: '＋ 太阳穴外扩',
    lever: 'P2',
    scale: 0.18,
    radius: 0.16,
    core: [[17, -1, 0], [26, 1, 0]],
  },

  // ---- 眉部 ----
  {
    key: 'browHeight',
    zone: 'brow',
    label: '眉位高低',
    hint: '＋ 整体上提 / − 下压',
    lever: 'P1',
    scale: 0.20,
    radius: 0.13,
    core: [[18, 0, -1], [19, 0, -1], [20, 0, -1], [21, 0, -1], [22, 0, -1], [23, 0, -1], [24, 0, -1], [25, 0, -1]],
  },
  {
    key: 'browPeak',
    zone: 'brow',
    label: '眉峰高度',
    hint: '＋ 眉峰上挑',
    lever: 'P2',
    scale: 0.16,
    radius: 0.10,
    core: [[19, 0, -1], [24, 0, -1]],
  },
  {
    key: 'browSpan',
    zone: 'brow',
    label: '眉头间距',
    hint: '＋ 拉开 / − 靠近',
    lever: 'P2',
    scale: 0.14,
    radius: 0.10,
    core: [[21, -1, 0], [22, 1, 0]],
  },
  {
    key: 'browTail',
    zone: 'brow',
    label: '眉尾',
    hint: '＋ 眉尾上扬',
    lever: 'P2',
    scale: 0.16,
    radius: 0.09,
    core: [[17, 0, -1], [26, 0, -1]],
  },

  // ---- 眼 / 眶周 ----
  {
    key: 'eyeOpening',
    zone: 'eye',
    label: '眼裂高度',
    hint: '＋ 开大眼裂（上下睑同时外扩）',
    lever: 'P0',
    scale: 0.14,
    radius: 0.07,
    core: [
      [37, 0, -1], [38, 0, -1], [43, 0, -1], [44, 0, -1],
      [40, 0, 1], [41, 0, 1], [46, 0, 1], [47, 0, 1],
    ],
  },
  {
    key: 'upperLid',
    zone: 'eye',
    label: '上睑',
    hint: '＋ 上睑上提（改善松弛/下垂）',
    lever: 'P0',
    scale: 0.14,
    radius: 0.08,
    core: [[37, 0, -1], [38, 0, -1], [43, 0, -1], [44, 0, -1]],
  },
  {
    key: 'lowerLid',
    zone: 'eye',
    label: '下睑',
    hint: '＋ 下移（卧蚕/眼袋方向）',
    lever: 'P1',
    scale: 0.14,
    radius: 0.08,
    core: [[40, 0, 1], [41, 0, 1], [46, 0, 1], [47, 0, 1]],
  },
  {
    key: 'innerCanthus',
    zone: 'eye',
    label: '内眼角',
    hint: '＋ 内眦内移（眼距变窄）',
    lever: 'P1',
    scale: 0.12,
    radius: 0.07,
    core: [[39, 1, 0], [42, -1, 0]],
  },
  {
    key: 'outerCanthus',
    zone: 'eye',
    label: '外眼角',
    hint: '＋ 外眦外移（眼裂变长）',
    lever: 'P1',
    scale: 0.12,
    radius: 0.07,
    core: [[36, -1, 0], [45, 1, 0]],
  },

  // ---- 鼻部（Burget 8 亚单位中，正面照可独立形变的 5 个）----
  {
    key: 'noseRoot',
    zone: 'nose',
    label: '鼻根',
    hint: '＋ 起点上移（鼻根变高）',
    lever: 'P0',
    scale: 0.16,
    radius: 0.10,
    core: [[27, 0, -1], [28, 0, -1]],
  },
  {
    key: 'noseDorsum',
    zone: 'nose',
    label: '鼻梁',
    hint: '＋ 鼻梁上提延长',
    lever: 'P0',
    scale: 0.14,
    radius: 0.09,
    core: [[29, 0, -1], [30, 0, -1]],
  },
  {
    key: 'noseTip',
    zone: 'nose',
    label: '鼻尖',
    hint: '＋ 鼻尖下移（延长）/ − 上翘',
    lever: 'P0',
    scale: 0.16,
    radius: 0.08,
    core: [[30, 0, 1], [33, 0, 1]],
  },
  {
    key: 'noseWidth',
    zone: 'nose',
    label: '鼻翼宽度',
    hint: '＋ 变宽 / − 收窄',
    lever: 'P0',
    scale: 0.13,
    radius: 0.07,
    core: [[31, -1, 0], [32, -1, 0], [34, 1, 0], [35, 1, 0]],
  },
  {
    key: 'noseBase',
    zone: 'nose',
    label: '鼻基底',
    hint: '＋ 填充（鼻翼外侧上提）',
    lever: 'P1',
    scale: 0.12,
    radius: 0.08,
    core: [[32, 0, -1], [34, 0, -1]],
  },

  // ---- 颧 / 面颊 ----
  {
    key: 'cheekbone',
    zone: 'cheek',
    label: '颧骨宽度',
    hint: '＋ 外扩 / − 内推',
    lever: 'P1',
    scale: 0.20,
    radius: 0.19,
    core: [[2, -1, 0], [3, -1, 0], [4, -1, 0], [12, 1, 0], [13, 1, 0], [14, 1, 0]],
  },
  {
    key: 'malarFat',
    zone: 'cheek',
    label: '苹果肌',
    hint: '＋ 上提饱满',
    lever: 'P1',
    scale: 0.14,
    radius: 0.10,
    core: [[3, 0, -1], [4, 0, -1], [12, 0, -1], [13, 0, -1]],
  },
  {
    key: 'cheekHollow',
    zone: 'cheek',
    label: '颊部饱满度',
    hint: '＋ 外扩（改善凹陷）',
    lever: 'P2',
    scale: 0.16,
    radius: 0.15,
    core: [[5, -1, 0], [6, -1, 0], [10, 1, 0], [11, 1, 0]],
  },

  // ---- 唇部 ----
  {
    key: 'upperLip',
    zone: 'lip',
    label: '上唇厚度',
    hint: '＋ 增厚（上唇缘上移）',
    lever: 'P1',
    scale: 0.14,
    radius: 0.09,
    core: [[50, 0, -1], [51, 0, -1], [52, 0, -1]],
  },
  {
    key: 'lowerLip',
    zone: 'lip',
    label: '下唇厚度',
    hint: '＋ 增厚（下唇缘下移）',
    lever: 'P1',
    scale: 0.14,
    radius: 0.09,
    core: [[56, 0, 1], [57, 0, 1], [58, 0, 1]],
  },
  {
    key: 'lipBead',
    zone: 'lip',
    label: '唇珠',
    hint: '＋ 唇珠突出',
    lever: 'P2',
    scale: 0.08,
    radius: 0.05,
    core: [[62, 0, 1]],
  },
  {
    key: 'lipWidth',
    zone: 'lip',
    label: '唇宽',
    hint: '＋ 变宽 / − 收窄',
    lever: 'P1',
    scale: 0.14,
    radius: 0.09,
    core: [[48, -1, 0], [54, 1, 0]],
  },
  {
    key: 'mouthCorner',
    zone: 'lip',
    label: '口角',
    hint: '＋ 上扬 / − 下垂',
    lever: 'P1',
    scale: 0.12,
    radius: 0.08,
    core: [[48, 0, -1], [54, 0, -1]],
  },

  // ---- 下颌 / 颏 ----
  {
    key: 'chinLength',
    zone: 'jaw',
    label: '颏部长度',
    hint: '＋ 加长 / − 缩短',
    lever: 'P0',
    scale: 0.32,
    radius: 0.22,
    core: [[8, 0, 1]],
  },
  {
    key: 'chinWidth',
    zone: 'jaw',
    label: '颏部宽度',
    hint: '＋ 变宽 / − 收窄',
    lever: 'P1',
    scale: 0.14,
    radius: 0.10,
    core: [[6, -1, 0], [7, -1, 0], [9, 1, 0], [10, 1, 0]],
  },
  {
    key: 'jawAngle',
    zone: 'jaw',
    label: '下颌角',
    hint: '＋ 外扩变宽 / − 内收',
    lever: 'P0',
    scale: 0.18,
    radius: 0.17,
    core: [[0, -1, 0], [1, -1, 0], [15, 1, 0], [16, 1, 0]],
  },
  {
    key: 'jawEdge',
    zone: 'jaw',
    label: '下颌缘',
    hint: '− 收紧 / ＋ 外扩',
    lever: 'P0',
    scale: 0.16,
    radius: 0.15,
    core: [[4, -1, 0], [5, -1, 0], [11, 1, 0], [12, 1, 0]],
  },
  {
    key: 'mentolabial',
    zone: 'jaw',
    label: '颏唇沟',
    hint: '＋ 变浅 / − 加深',
    lever: 'P2',
    scale: 0.10,
    radius: 0.07,
    core: [[57, 0, -1]],
  },
]

/**
 * 正面照无法独立形变的亚单位 —— UI 里以「仅供评估」列出，说明原因。
 * 这些项要么没有对应关键点（属皮肤/脂肪层，非几何），要么指标本身只在侧面有效。
 */
export const NON_WARPABLE = [
  { zone: 'forehead', label: '额部凹陷/饱满', why: '68 点无额部采样点，只能借眉位间接表现' },
  { zone: 'eye', label: '眶周皮肤（鱼尾纹/色沉）', why: '属皮肤质感层，非几何形变能表达' },
  { zone: 'nose', label: '鼻唇角 NLA（90–110°）', why: '仅侧面 90° 照有效，正面投影失真' },
  { zone: 'nose', label: '鼻额角 NFA（115–130°）', why: '仅侧面 90° 照有效，正面投影失真' },
  { zone: 'fold', label: '鼻唇沟/法令纹', why: '无对应关键点，需用「自定义控制点」落点后推拉' },
  { zone: 'lip', label: '上下唇比（1:1.5）', why: '比例型指标，由上唇厚度 + 下唇厚度合成' },
  { zone: 'jaw', label: '颏唇沟深度（4mm）', why: '深度需侧面测量，此处仅做纵向位置近似' },
  { zone: 'ear', label: '颅耳角（30°）', why: '正面前投影失真，且耳部仅 0/16 两个代理点' },
]

/** 步进档位范围（与预设滑块一致，保证手感统一） */
export const SUBUNIT_RANGE = { min: -15, max: 15, step: 1 }

/** 高斯衰减系数：距离 = radius 时权重约 0.05 */
const FALLOFF_K = 3

const SUBUNIT_BY_KEY = new Map(SUBUNITS.map((s) => [s.key, s]))
export function getSubunit(key) {
  return SUBUNIT_BY_KEY.get(key) || null
}

export function emptySubunits() {
  const v = {}
  for (const s of SUBUNITS) v[s.key] = 0
  return v
}

/** 某分区下的亚单位列表 */
export function subunitsOf(zoneKey) {
  return SUBUNITS.filter((s) => s.zone === zoneKey)
}

/** 亚单位涉及的核心点索引（供画布高亮） */
export function coreIndicesOf(su) {
  return su.core.map((c) => c[0])
}

/** 已调整（非零）的亚单位数量 */
export function activeCountOf(values) {
  if (!values) return 0
  let n = 0
  for (const s of SUBUNITS) if (values[s.key]) n++
  return n
}

function faceUnitOf(pts) {
  const w = Math.abs(pts[16].x - pts[0].x)
  return w > 0 ? w : 1
}

/**
 * 计算单个亚单位在点 i 上的位移方向权重。
 * 返回 [wx, wy]：已含距离衰减，核心点为 ±1，远处趋近 0。
 *
 * 多个核心点时：方向取加权平均（镜像对在中点处自然抵消为 0，避免中间被撕扯），
 * 幅度取最大权重（保证单个核心点时严格等于高斯衰减）。
 */
function weightAt(su, pts, i, unit) {
  let sw = 0
  let sx = 0
  let sy = 0
  let wmax = 0
  for (let n = 0; n < su.core.length; n++) {
    const [j, wx, wy] = su.core[n]
    const dx = (pts[i].x - pts[j].x) / unit
    const dy = (pts[i].y - pts[j].y) / unit
    const t = (dx * dx + dy * dy) / (su.radius * su.radius)
    const w = Math.exp(-t * FALLOFF_K)
    if (w > wmax) wmax = w
    sw += w
    sx += w * wx
    sy += w * wy
  }
  if (sw <= 1e-9 || wmax < 0.02) return null
  return [wmax * (sx / sw), wmax * (sy / sw)]
}

/**
 * 应用全部亚单位形变（在预设滑块之后、逐点手动位移之前）。
 * @param {Point[]} pts    68 个关键点
 * @param {?Object<string,number>} values 亚单位档位表，缺省项视为 0
 * @returns {Point[]} 新数组；无任何调整时原样返回引用，便于下游缓存
 */
export function applySubunitOffsets(pts, values) {
  if (!pts || pts.length < 68 || !values) return pts
  let touched = false
  for (const s of SUBUNITS) {
    if (values[s.key]) {
      touched = true
      break
    }
  }
  if (!touched) return pts

  const unit = faceUnitOf(pts)
  const out = pts.map((p) => ({ x: p.x, y: p.y }))
  for (const su of SUBUNITS) {
    const v = values[su.key] || 0
    if (!v) continue
    const amp = (v / 100) * su.scale * unit
    for (let i = 0; i < 68; i++) {
      const w = weightAt(su, pts, i, unit)
      if (!w) continue
      out[i].x += amp * w[0]
      out[i].y += amp * w[1]
    }
  }
  return out
}

/**
 * 单个亚单位的位移场（调试 / 可视化用）。
 * @returns {Array<{x:number,y:number}>} 该亚单位单独作用、档位为 +1 时的位移量
 */
export function subunitField(su, pts) {
  const unit = faceUnitOf(pts)
  const out = []
  for (let i = 0; i < 68; i++) {
    const w = weightAt(su, pts, i, unit)
    const amp = (1 / 100) * su.scale * unit
    out.push(w ? { x: amp * w[0], y: amp * w[1] } : { x: 0, y: 0 })
  }
  return out
}
