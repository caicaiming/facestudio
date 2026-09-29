/**
 * zones.js —— 医美部位层（注射 / 治疗部位）
 *
 * ## 为什么需要它
 *
 * 68 个关键点只覆盖眉以下的五官与下颌轮廓：**额头、太阳穴、苹果肌、泪沟、
 * 面颊完全没有点**。而这四处恰恰是填充类项目做得最多的部位。
 * 现有的亚单位（subunits.js）被迫「借眉点表达额头」—— 本质上是拿错误的
 * 控制中心做形变：拖「额部高度」实际动的是眉毛，额头本身没有约束点。
 *
 * ## 解决办法：在规范坐标系里定义部位
 *
 * 这些部位的位置在【规范坐标系】里其实是稳定的。frame.js 已把脸归一化到
 * 「原点 = 两眼中点、单位 = 眼间距」，那么「太阳穴在眉尾外上方」「苹果肌在
 * 眼下外侧」这类解剖描述就能写成一个不随照片变化的 (u, v) 公式。
 *
 * ## 相对锚定，而不是写死坐标
 *
 * 直接写死 (u, v) 绝对值会翻车：长脸和圆脸的额头高度能差一倍，
 * 瘦脸和胖脸的面颊宽度也不同。所以部位的 (u, v) 一律写成
 * 【实测锚量的线性组合】：
 *
 *   v = vBrowTop − 0.5 × (vBrowTop − vHairline)   额部中央 = 眉到发际线的中点
 *   u = ±0.60 × uHalf                             苹果肌 = 面半宽的 60% 处
 *
 * 锚量（vBrowTop / vHairline / uHalf …）全部从当前这张脸实测，
 * 脸型差异被自动吸收 —— 长脸的额头点靠上，圆脸的靠下，但都在额头正中。
 *
 * ## 位移方向
 *
 * 每个部位声明一个规范坐标方向 dir：
 *   ＋ 档位 = 填充 / 外扩（沿 dir 推）
 *   − 档位 = 收紧 / 内收（沿 −dir 推）
 * 位移按到控制点的高斯距离衰减，与 subunits.js 同一套模型，故两者可安全叠加。
 *
 * ⚠️ 剂量区间（doseRef）为公开资料中的常规参考范围，仅供沟通示意，
 *    不构成医疗建议，实际用量必须由执业医师面诊决定。
 *
 * 纯函数层：零 React 依赖，可直接 node --test。
 */

import { frameOf, frameFaceWidth, project, unproject, alongY } from './frame.js'

// ---------------------------------------------------------------- 分区

/** 医美一级分区（正面观）。lever：P0 高频 / P1 常见 / P2 按需 */
export const SITE_ZONES = [
  { key: 'forehead', label: '额部', lever: 'P1', note: '额部扁平、凹陷' },
  { key: 'temple', label: '颞部（太阳穴）', lever: 'P1', note: '太阳穴凹陷' },
  { key: 'periorbital', label: '眶周', lever: 'P0', note: '泪沟、睑颊沟' },
  { key: 'cheek', label: '颧颊', lever: 'P0', note: '苹果肌、面颊容量' },
  { key: 'nose', label: '鼻部', lever: 'P0', note: '鼻根、鼻背、鼻基底' },
  { key: 'lip', label: '唇部', lever: 'P1', note: '唇形与容量' },
  { key: 'chin', label: '颏部', lever: 'P0', note: '颏长、颏突度' },
  { key: 'jaw', label: '下颌缘', lever: 'P1', note: '轮廓清晰度、咬肌' },
  { key: 'ear', label: '耳部', lever: 'P2', note: '耳基底、耳廓轮廓（需露耳）' },
]

// ---------------------------------------------------------------- 部位定义

/**
 * 部位项字段：
 *   key      唯一标识
 *   zone     所属分区
 *   label    中文名
 *   pair     是否左右成对（true 时 at / idxPair 给出【图像右】侧，左侧自动镜像）
 *   idx      中轴控制点索引（优先于 at）
 *   idxPair  [图像左, 图像右] 控制点索引
 *   at       (ctx) => {u, v}，pair 时 u 恒为正、语义「距中轴距离」
 *   dir      {u, v} 填充方向（规范坐标；pair 时 u 恒为正，语义「向外侧」；v 负=向上）
 *   radius   影响半径（面宽比例）
 *   scale    满档（±100）位移量占面宽的比例
 *   projects 适用项目
 *   doseRef  常规参考剂量（字符串，仅沟通用）
 *   risk     'high' | 'mid' | 'low' 血管风险等级
 *   note     沟通要点
 *   virtual  true 表示该部位在 68 点里【完全没有对应点】，位置纯几何外推，
 *            且该处可能没有网格顶点覆盖 —— 形变为近似模拟，不可当作真实解剖效果
 *   anchorScale 仅 virtual 部位使用：满档（±100）时对外缘锚点的位移量，
 *            单位为面宽比例。用于把三角网格边界真实推到耳朵外侧
 *            （控制点附近没有 68 点，不推锚点就看不到任何变化）
 */
export const SITES = [
  // ---- 额部 ----
  {
    key: 'foreheadCenter',
    zone: 'forehead',
    label: '额部中央',
    pair: false,
    at: (c) => ({ u: 0, v: c.vBrowTop - 0.5 * (c.vBrowTop - c.vHairline) }),
    dir: { u: 0, v: -1 },
    radius: 0.2,
    scale: 0.2,
    projects: ['玻尿酸填充', '自体脂肪填充'],
    doseRef: '1.0–3.0 ml',
    risk: 'mid',
    note: '额部扁平、横向凹陷的首选部位；需注意额部血管走行',
  },
  {
    key: 'frontalEminence',
    zone: 'forehead',
    label: '额结节',
    pair: true,
    at: (c) => ({ u: 0.42 * c.uHalf, v: c.vBrowTop - 0.28 * (c.vBrowTop - c.vHairline) }),
    dir: { u: 0.35, v: -0.85 },
    radius: 0.13,
    scale: 0.16,
    projects: ['玻尿酸填充'],
    doseRef: '每侧 0.3–0.8 ml',
    risk: 'mid',
    note: '额部两侧高点，决定额部立体感',
  },
  {
    key: 'foreheadLateral',
    zone: 'forehead',
    label: '额颞交界',
    pair: true,
    at: (c) => ({ u: 0.86 * c.uHalf, v: c.vBrowTop - 0.22 * (c.vBrowTop - c.vHairline) }),
    dir: { u: 0.9, v: -0.35 },
    radius: 0.12,
    scale: 0.15,
    projects: ['玻尿酸填充', '自体脂肪填充'],
    doseRef: '每侧 0.3–0.8 ml',
    risk: 'mid',
    note: '与太阳穴衔接处，过渡不顺会出现台阶感',
  },

  // ---- 颞部 ----
  {
    key: 'temple',
    zone: 'temple',
    label: '太阳穴',
    pair: true,
    at: (c) => ({ u: 1.02 * c.uHalf, v: c.vBrowTop + 0.4 * (0 - c.vBrowTop) }),
    dir: { u: 1, v: -0.15 },
    radius: 0.12,
    scale: 0.2,
    projects: ['玻尿酸填充', '自体脂肪填充'],
    doseRef: '每侧 0.5–1.5 ml',
    risk: 'high',
    note: '颞部凹陷显颧骨突出；颞浅动脉走行区，属高风险部位',
  },

  // ---- 眶周 ----
  {
    key: 'tearTrough',
    zone: 'periorbital',
    label: '泪沟',
    pair: true,
    at: (c) => ({ u: 0.75 * c.uEyeInner, v: c.vEyeBottom + 0.28 * (c.vSubnasal - c.vEyeBottom) }),
    dir: { u: 0.25, v: -0.75 },
    radius: 0.08,
    scale: 0.1,
    projects: ['玻尿酸填充', '胶原蛋白填充'],
    doseRef: '每侧 0.2–0.5 ml',
    risk: 'high',
    note: '眼下内侧凹陷；皮肤薄、易出现丁达尔现象，需小剂量浅层',
  },
  {
    key: 'infraorbital',
    zone: 'periorbital',
    label: '眶下区（睑颊沟）',
    pair: true,
    at: (c) => ({ u: 0.42 * c.uHalf, v: c.vEyeBottom + 0.45 * (c.vSubnasal - c.vEyeBottom) }),
    dir: { u: 0.15, v: -0.7 },
    radius: 0.1,
    scale: 0.11,
    projects: ['玻尿酸填充', '胶原蛋白填充'],
    doseRef: '每侧 0.3–0.8 ml',
    risk: 'high',
    note: '泪沟外侧延伸，与苹果肌衔接',
  },

  // ---- 颧颊 ----
  {
    key: 'malar',
    zone: 'cheek',
    label: '苹果肌',
    pair: true,
    at: (c) => ({ u: 0.6 * c.uHalf, v: c.vEyeBottom + 0.62 * (c.vSubnasal - c.vEyeBottom) }),
    dir: { u: 0.35, v: -0.6 },
    radius: 0.14,
    scale: 0.18,
    projects: ['玻尿酸填充', '自体脂肪填充'],
    doseRef: '每侧 0.5–1.5 ml',
    risk: 'mid',
    note: '颧前脂肪垫；决定中面部年轻感，过量会显脸宽',
  },
  {
    key: 'zygomaticArch',
    zone: 'cheek',
    label: '颧弓',
    pair: true,
    at: (c) => ({ u: 0.97 * c.uHalf, v: c.vEyeBottom + 0.12 * (c.vSubnasal - c.vEyeBottom) }),
    dir: { u: 1, v: 0 },
    radius: 0.11,
    scale: 0.14,
    projects: ['玻尿酸填充（少量支撑）'],
    doseRef: '每侧 0.2–0.5 ml',
    risk: 'mid',
    note: '多为评估参考，通常不单独注射',
  },
  {
    key: 'midCheek',
    zone: 'cheek',
    label: '面颊中部',
    pair: true,
    at: (c) => ({ u: 0.7 * c.uHalf, v: c.vSubnasal + 0.3 * (c.vChin - c.vSubnasal) }),
    dir: { u: 0.55, v: -0.2 },
    radius: 0.15,
    scale: 0.16,
    projects: ['玻尿酸填充', '自体脂肪填充'],
    doseRef: '每侧 0.5–1.2 ml',
    risk: 'mid',
    note: '面颊凹陷、颊部容量流失',
  },
  {
    key: 'jowl',
    zone: 'cheek',
    label: '口角下颌（嘟嘟肉）',
    pair: true,
    at: (c) => ({ u: 0.6 * c.uHalf, v: c.vSubnasal + 0.72 * (c.vChin - c.vSubnasal) }),
    dir: { u: 0.7, v: 0.5 },
    radius: 0.12,
    scale: 0.14,
    projects: ['收紧类（超声 / 射频）', '溶脂'],
    doseRef: '—',
    risk: 'mid',
    note: '− 档位为收紧内收；此部位以收紧为主，不建议填充',
  },

  // ---- 鼻部（68 点已有点位，直接用索引更准）----
  {
    key: 'noseRoot',
    zone: 'nose',
    label: '鼻根',
    pair: false,
    idx: [27],
    dir: { u: 0, v: -0.25 },
    radius: 0.06,
    scale: 0.1,
    projects: ['玻尿酸隆鼻'],
    doseRef: '0.2–0.5 ml',
    risk: 'high',
    note: '决定鼻额角与鼻梁起点高度；鼻背动脉区，高风险',
  },
  {
    key: 'noseDorsum',
    zone: 'nose',
    label: '鼻背',
    pair: false,
    idx: [28, 29, 30],
    dir: { u: 0, v: -0.35 },
    radius: 0.07,
    scale: 0.11,
    projects: ['玻尿酸隆鼻'],
    doseRef: '0.3–0.8 ml',
    risk: 'high',
    note: '鼻梁线条；需沿中线连续注射，避免出现节段感',
  },
  {
    key: 'noseTip',
    zone: 'nose',
    label: '鼻尖',
    pair: false,
    idx: [30, 33],
    dir: { u: 0, v: -0.3 },
    radius: 0.06,
    scale: 0.09,
    projects: ['玻尿酸鼻尖塑形'],
    doseRef: '0.1–0.3 ml',
    risk: 'high',
    note: '鼻尖上旋与突出度；血供复杂，高风险部位',
  },
  {
    key: 'noseBase',
    zone: 'nose',
    label: '鼻基底',
    pair: true,
    at: (c) => ({ u: 0.55 * c.uNoseWing, v: c.vSubnasal }),
    dir: { u: 0.5, v: 0.25 },
    radius: 0.09,
    scale: 0.12,
    projects: ['玻尿酸填充', '自体脂肪填充'],
    doseRef: '每侧 0.2–0.5 ml',
    risk: 'mid',
    note: '鼻翼基底凹陷会加重法令纹上段；填充后中面部显饱满',
  },
  {
    key: 'alar',
    zone: 'nose',
    label: '鼻翼',
    pair: true,
    idxPair: [31, 35],
    dir: { u: 1, v: 0 },
    radius: 0.05,
    scale: 0.08,
    projects: ['鼻翼缩小（手术）', '肉毒素（鼻翼外张）'],
    doseRef: '—',
    risk: 'low',
    note: '− 档位为内收缩窄；注射只能微调，明显宽大需手术',
  },

  // ---- 唇部 ----
  {
    key: 'upperLip',
    zone: 'lip',
    label: '上唇',
    pair: false,
    idx: [50, 51, 52, 61, 62],
    dir: { u: 0, v: -0.9 },
    radius: 0.07,
    scale: 0.1,
    projects: ['玻尿酸丰唇'],
    doseRef: '0.3–0.8 ml',
    risk: 'low',
    note: '上下唇理想比例约 1:1.5',
  },
  {
    key: 'lowerLip',
    zone: 'lip',
    label: '下唇',
    pair: false,
    idx: [56, 57, 58, 64, 65, 66],
    dir: { u: 0, v: 0.9 },
    radius: 0.07,
    scale: 0.1,
    projects: ['玻尿酸丰唇'],
    doseRef: '0.3–0.8 ml',
    risk: 'low',
    note: '丰唇需上下唇同时评估，避免比例失衡',
  },
  {
    key: 'mouthCorner',
    zone: 'lip',
    label: '口角',
    pair: true,
    idxPair: [48, 54],
    dir: { u: 0.8, v: -0.6 },
    radius: 0.06,
    scale: 0.09,
    projects: ['玻尿酸填充', '肉毒素（降口角肌）'],
    doseRef: '每侧 0.1–0.3 ml',
    risk: 'low',
    note: '口角下垂显苦相；＋ 档位为上提外展',
  },

  // ---- 颏部 ----
  {
    key: 'chin',
    zone: 'chin',
    label: '颏尖',
    pair: false,
    idx: [8],
    dir: { u: 0, v: 1 },
    radius: 0.12,
    scale: 0.18,
    projects: ['玻尿酸隆颏'],
    doseRef: '0.5–1.5 ml',
    risk: 'mid',
    note: '决定下庭长度与侧面突度；与鼻尖、唇的颏唇线联动',
  },
  {
    key: 'mentolabial',
    zone: 'chin',
    label: '颏唇沟',
    pair: false,
    at: (c) => ({ u: 0, v: c.vMouthBottom + 0.45 * (c.vChin - c.vMouthBottom) }),
    dir: { u: 0, v: 0.35 },
    radius: 0.07,
    scale: 0.08,
    projects: ['玻尿酸填充'],
    doseRef: '0.2–0.5 ml',
    risk: 'mid',
    note: '颏唇沟过深显嘴凸，填充可协调侧貌',
  },

  // ---- 下颌缘 ----
  {
    key: 'jawline',
    zone: 'jaw',
    label: '下颌缘',
    pair: true,
    idxPair: [5, 11],
    dir: { u: 1, v: 0.15 },
    radius: 0.13,
    scale: 0.16,
    projects: ['收紧类（超声 / 射频）', '溶脂', '肉毒素（颈阔肌）'],
    doseRef: '—',
    risk: 'mid',
    note: '− 档位为收紧内收；轮廓模糊优先收紧而非填充',
  },
  {
    key: 'masseter',
    zone: 'jaw',
    label: '咬肌',
    pair: true,
    at: (c) => ({ u: 0.95 * c.uHalf, v: c.vJawAngle * 0.92 }),
    dir: { u: 1, v: 0.1 },
    radius: 0.13,
    scale: 0.16,
    projects: ['肉毒素（瘦脸）'],
    doseRef: '每侧 20–40 U',
    risk: 'mid',
    note: '− 档位为咬肌萎缩后的内收；见效需 2–4 周',
  },

  // ---- 耳部 ----
  //
  // ⚠️ 这是全部部位里可靠性最低的一组，三条限制必须让使用者知道：
  //
  //  1. 68 点在耳区【一个点都没有】。位置完全靠解剖比例外推：
  //     耳上缘 ≈ 眉线、耳垂底 ≈ 鼻底（经典面部比例），横向以面宽为参考。
  //     头发盖住耳朵时，外推点落在头发上，形变会连带拉扯发丝。
  //
  //  2. 正面照只能表达耳朵「外展多少」，无法表达颅耳角（耳朵立起来的角度）。
  //     精灵耳的真实评估必须看侧面 / 45° 斜位。
  //
  //  3. 三角网格在耳区没有真实顶点（只有外缘锚点 72/75 在附近），
  //     所以耳朵档位除了推动 68 点，还要额外推动外缘锚点 ——
  //     见 earAnchorOffsets()。即便如此仍是整块拉伸，不是耳廓形变。
  {
    key: 'earBase',
    zone: 'ear',
    label: '耳基底',
    pair: true,
    virtual: true,
    at: (c) => ({ u: 1.02 * c.uHalf, v: c.vEarTop + 0.45 * c.earLen }),
    dir: { u: 1, v: 0 },
    radius: 0.14,
    scale: 0.2,
    anchorScale: 0.34,
    projects: ['玻尿酸填充（耳基底）'],
    doseRef: '每侧 0.5–1.5 ml',
    risk: 'mid',
    note: '耳后颅耳沟处，俗称「精灵耳」：＋档位耳廓外展，正面露耳面积增大、脸视觉变窄；颅耳角需侧面照评估',
  },
  {
    key: 'earHelix',
    zone: 'ear',
    label: '耳轮轮廓',
    pair: true,
    virtual: true,
    at: (c) => ({ u: 1.22 * c.uHalf, v: c.vEarTop + 0.3 * c.earLen }),
    dir: { u: 1, v: -0.3 },
    radius: 0.11,
    scale: 0.14,
    anchorScale: 0.26,
    projects: ['玻尿酸填充（耳廓支撑）', '手术（耳廓成形）'],
    doseRef: '每侧 0.2–0.5 ml',
    risk: 'mid',
    note: '耳廓外缘弧度与外展度；明显形态异常以手术为主，注射仅能微调',
  },
  {
    key: 'earLobe',
    zone: 'ear',
    label: '耳垂',
    pair: true,
    virtual: true,
    at: (c) => ({ u: 1.1 * c.uHalf, v: c.vEarBottom - 0.1 * c.earLen }),
    dir: { u: 0.3, v: 1 },
    radius: 0.08,
    scale: 0.1,
    anchorScale: 0.16,
    projects: ['玻尿酸填充'],
    doseRef: '每侧 0.2–0.5 ml',
    risk: 'low',
    note: '耳垂饱满度；＋档位饱满外展，− 档位收紧贴附',
  },
]

// ---------------------------------------------------------------- 锚量上下文

const AVG = (a) => a.reduce((x, y) => x + y, 0) / a.length

/**
 * 从 68 点提取规范坐标锚量，供部位的 at() 使用。
 * 全部为规范坐标（无量纲，单位 = 眼间距）。
 *
 * @param {Point[]} points 68 点（图像像素）
 * @param {{hairlineY?:number}} opts 图像实测发际线 y；缺省则几何估算
 */
export function zoneContext(points, opts = {}) {
  const frame = frameOf(points)
  const S = frame.valid && frame.S > 0 ? frame.S : 1
  const V = (i) => project(points[i], frame).v
  const U = (i) => project(points[i], frame).u

  // 眉线最上（v 最小 = 最靠上）
  let vBrowTop = Infinity
  for (let i = 17; i <= 26; i++) vBrowTop = Math.min(vBrowTop, V(i))

  // 眼裂最低
  let vEyeBottom = -Infinity
  for (let i = 36; i <= 47; i++) vEyeBottom = Math.max(vEyeBottom, V(i))

  // 平均眼裂高度（规范单位），用于发际线几何兜底
  const eyeOpening =
    (Math.abs(alongY(points[37], points[41], frame)) +
      Math.abs(alongY(points[38], points[40], frame)) +
      Math.abs(alongY(points[43], points[47], frame)) +
      Math.abs(alongY(points[44], points[46], frame))) /
    4 /
    S

  // 发际线：优先用图像实测值（hairline.js），否则按眉上 5.5 个眼裂高度估算
  // 与 measure.js 的三级方案保持同一系数，避免两处口径打架
  let vHairline = null
  if (Number.isFinite(opts.hairlineY)) {
    vHairline = project({ x: points[27].x, y: opts.hairlineY }, frame).v
  }
  if (!Number.isFinite(vHairline) || vHairline >= vBrowTop) {
    vHairline = vBrowTop - 5.5 * eyeOpening
  }

  // 横向锚量取左右平均的绝对值：脸略有不对称时不至于把部位点推偏
  const symU = (a, b) => (Math.abs(U(a)) + Math.abs(U(b))) / 2

  // 耳部纵向范围：经典面部比例 —— 耳上缘约与眉线齐平、耳垂底约与鼻底齐平。
  // 68 点在耳区没有任何点，这两个锚量是耳部外推的唯一纵向依据。
  const earLen = V(33) - vBrowTop // 眉线 → 鼻底
  const vEarTop = vBrowTop - 0.04 * earLen // 耳上缘略高于眉线
  const vEarBottom = V(33) + 0.06 * earLen // 耳垂略低于鼻底

  return {
    // 耳部（68 点无覆盖，纯比例外推）
    vEarTop,
    vEarBottom,
    earLen,
    // 纵向
    vBrowTop,
    vHairline,
    vEyeBottom,
    vNoseRoot: V(27),
    vNoseTip: V(30),
    vSubnasal: V(33),
    vMouthTop: V(62),
    vMouthBottom: V(66),
    vChin: V(8),
    vJawAngle: (V(4) + V(12)) / 2,
    // 横向（距中轴的距离，恒为正）
    uHalf: symU(0, 16),
    uBrowTail: symU(17, 26),
    uEyeInner: symU(39, 42),
    uEyeOuter: symU(36, 45),
    uNoseWing: symU(31, 35),
    uMouthCorner: symU(48, 54),
    uJawAngle: symU(4, 12),
    // 参考量
    eyeOpening,
    frame,
  }
}

// ---------------------------------------------------------------- 控制点

/**
 * 计算全部部位的控制点（图像像素坐标）与填充方向（图像单位向量）。
 *
 * @returns {Array<{site, pts:Point[], dirs:Array<{x,y}>}>}
 */
export function siteAnchors(points, ctx, frame = null) {
  const f = frame || (ctx && ctx.frame) || frameOf(points)
  const c = ctx || zoneContext(points)

  // 规范方向 → 图像方向
  const toImg = (du, dv) => {
    const x = du * f.X.x + dv * f.Y.x
    const y = du * f.X.y + dv * f.Y.y
    const n = Math.hypot(x, y) || 1
    return { x: x / n, y: y / n }
  }
  const toImgPt = (cu) => unproject(cu, f)

  const out = []
  for (const site of SITES) {
    const pts = []
    const dirs = []

    if (site.idx) {
      const cv = {
        u: AVG(site.idx.map((i) => project(points[i], f).u)),
        v: AVG(site.idx.map((i) => project(points[i], f).v)),
      }
      pts.push(toImgPt(cv))
      dirs.push(toImg(site.dir.u, site.dir.v))
    } else if (site.idxPair) {
      // idxPair = [图像左, 图像右]；左为 −u 侧，右为 ＋u 侧
      for (let k = 0; k < 2; k++) {
        const i = site.idxPair[k]
        const cu = { u: project(points[i], f).u, v: project(points[i], f).v }
        pts.push(toImgPt(cu))
        const sign = k === 0 ? -1 : 1
        dirs.push(toImg(sign * site.dir.u, site.dir.v))
      }
    } else if (site.at) {
      const cu = site.at(c)
      if (site.pair) {
        pts.push(toImgPt({ u: -cu.u, v: cu.v }))
        dirs.push(toImg(-site.dir.u, site.dir.v))
        pts.push(toImgPt({ u: cu.u, v: cu.v }))
        dirs.push(toImg(site.dir.u, site.dir.v))
      } else {
        pts.push(toImgPt(cu))
        dirs.push(toImg(site.dir.u, site.dir.v))
      }
    }
    if (pts.length) out.push({ site, pts, dirs })
  }
  return out
}

// ---------------------------------------------------------------- 形变

/**
 * 应用部位级形变。
 *
 * 与 subunits.js 同一套高斯衰减模型：控制点处位移最大，
 * 距控制点越远衰减越快（w = exp(−3(d/r)²)）。
 * 位移量按【规范面宽】归一，跨分辨率、跨姿态一致。
 *
 * @param {Point[]} points  原始 68 点
 * @param {?Object} values  {siteKey: 档位}，−15…＋15；＋ 填充 / − 收紧
 * @param {{hairlineY?:number}} opts
 * @returns {Point[]} 新数组，不修改入参
 */
/**
 * 凹凸档位有多少比例「顺手」转成轮廓位移。
 *
 * 纯光影不改轮廓，看久了像贴了张图 —— 真实的填充是**既鼓起来、又向外撑一点**。
 * 但也不能给太多：凹凸的意义本就在于「不改轮廓、只改明暗」，给一半以上
 * 就和位移档位没区别了。0.25 是实测下来的平衡点：肉眼能看出饱满感，
 * 又不会让人以为调了位移。
 */
export const DEPTH_TO_CONTOUR = 0.25

export function applySiteOffsets(points, values, opts = {}) {
  return applySiteOffsetsBy(points, values, opts, 1)
}

/**
 * 凹凸档位对轮廓的轻微推动（与位移档位叠加，互不覆盖）。
 * 与 `applySiteOffsets` 共用同一套高斯核，只是幅度 × DEPTH_TO_CONTOUR。
 */
export function applySiteDepthOffsets(points, values, opts = {}) {
  return applySiteOffsetsBy(points, values, opts, DEPTH_TO_CONTOUR)
}

function applySiteOffsetsBy(points, values, opts = {}, factor = 1) {
  if (!Array.isArray(points) || points.length !== 68) return points
  if (!values) return points

  const frame = frameOf(points)
  const ctx = opts.ctx || zoneContext(points, opts)
  const anchors = siteAnchors(points, ctx, frame)
  const W = frame.valid ? frameFaceWidth(points, frame) : Math.abs(points[16].x - points[0].x)
  if (!(W > 0)) return points

  // 检查是否真的有非零档位，避免白算一遍
  let any = false
  for (const a of anchors) {
    const v = values[a.site.key]
    if (Number.isFinite(v) && v !== 0) {
      any = true
      break
    }
  }
  if (!any) return points

  const out = points.map((p) => ({ x: p.x, y: p.y }))

  for (const { site, pts, dirs } of anchors) {
    const v = values[site.key]
    if (!Number.isFinite(v) || v === 0) continue

    // 档位 −15…＋15 → 位移占面宽比例（scale 以满档 ±100 定义）
    const amp = (v / 100) * site.scale * W * factor
    const r = site.radius * W
    const inv2 = 1 / (r * r)

    for (let i = 0; i < 68; i++) {
      // 取所有控制点中最强的那个权重（成对的点天然左右抵消）
      let wMax = 0
      let dir = null
      for (let k = 0; k < pts.length; k++) {
        const dx = points[i].x - pts[k].x
        const dy = points[i].y - pts[k].y
        const w = Math.exp(-3 * (dx * dx + dy * dy) * inv2)
        if (w > wMax) {
          wMax = w
          dir = dirs[k]
        }
      }
      if (wMax <= 0 || !dir) continue
      out[i].x += amp * wMax * dir.x
      out[i].y += amp * wMax * dir.y
    }
  }
  return out
}

// ---------------------------------------------------------------- 耳部锚点推动

/**
 * 耳部档位对外围锚点的额外位移。
 *
 * ## 为什么需要单独一个函数
 *
 * `applySiteOffsets` 只对 68 点施加位移，而【耳区一个 68 点都没有】。
 * 实测：耳轮外缘控制点距最近的关键点（0 / 16）约 0.14 倍面宽，
 * 按 radius 0.11 算高斯权重只有 exp(−3×1.6²) ≈ 0.03 —— 拖满档几乎看不出变化。
 *
 * 耳朵要产生可见形变，只能推动离它最近的外缘锚点（72 右外 / 75 左外，
 * 索引 4 与 7），让三角网格在耳朵高度真实外扩。锚点是网格边界，
 * 它向外走 → 原本在网格外的耳周像素被纳入 → 照片上耳朵区域被向外拉伸。
 *
 * ## 为什么这里不用高斯衰减
 *
 * 一开始照搬了 applySiteOffsets 的高斯模型，结果实测满档只推动 0.9px：
 * 外缘锚点距耳部控制点约 0.28 倍面宽，而 radius 只有 0.11~0.14 倍面宽，
 * 权重被压到 exp(−3×2.5²) ≈ 1e−8，等于没推。
 *
 * 而且衰减在这里语义也不对：我们要的就是「在耳朵高度把边界向外推」，
 * 被推动的对象只有 2 个锚点、本就位于耳朵高度，不需要按距离再衰减一次。
 * 改成按档位直接给定位移量（anchorScale × 档位 × 面宽），量级可控且可测。
 *
 * ## 必须知道的两条副作用
 *
 * 1. 锚点是边界约束，推动它会连带耳后的头发 / 背景一起外扩 —— 2D 形变
 *    没有耳朵蒙版，无法只动耳朵。
 * 2. 这是「整块拉伸」，不是耳廓形态变化。真实精灵耳是耳朵绕耳根转出来，
 *    耳朵本身不变大；这里做不到。
 *
 * @param {Point[]} points  原始 68 点
 * @param {Point[]} anchors 已软跟随后的 8 个锚点
 * @param {?Object} values  部位档位表
 * @param {{hairlineY?:number, ctx?:Object}} opts
 * @returns {Point[]} 叠加耳部位移后的锚点（新数组）
 */
export function earAnchorOffsets(points, anchors, values, opts = {}) {
  if (!Array.isArray(anchors) || !values) return anchors
  const earSites = SITES.filter((s) => s.zone === 'ear')
  let any = false
  for (const s of earSites) {
    if (Number.isFinite(values[s.key]) && values[s.key] !== 0) {
      any = true
      break
    }
  }
  if (!any) return anchors

  const frame = frameOf(points)
  const ctx = opts.ctx || zoneContext(points, opts)
  const W = frame.valid ? frameFaceWidth(points, frame) : Math.abs(points[16].x - points[0].x)
  if (!(W > 0)) return anchors

  const anchorsRaw = siteAnchors(points, ctx, frame)
  const out = anchors.map((p) => ({ x: p.x, y: p.y }))

  for (const { site, pts, dirs } of anchorsRaw) {
    if (site.zone !== 'ear') continue
    const v = values[site.key]
    if (!Number.isFinite(v) || v === 0) continue

    // 满档（±100）位移量 = anchorScale × 面宽。实测 0.35 档满档约 5% 面宽，
    // 既能看出耳朵外展，又不至于把边界推得把背景撕开。
    const anchorScale = site.anchorScale ?? 0.3
    const amp = (v / 100) * anchorScale * W

    for (let a = 0; a < anchors.length; a++) {
      // 只作用于外缘锚点（72 / 75）：顶部与底部锚点离耳朵太远，
      // 推动它们会让整张脸外扩，而不是「耳朵外展」
      if (a !== 4 && a !== 7) continue

      // 方向取同侧控制点的 dir（控制点成对，取更近的那个）
      const base = project(anchors[a], frame)
      let dir = null
      let best = Infinity
      for (let k = 0; k < pts.length; k++) {
        const cu = project(pts[k], frame)
        const d = Math.abs(cu.u - base.u)
        if (d < best) {
          best = d
          dir = dirs[k]
        }
      }
      if (!dir) continue
      out[a].x += amp * dir.x
      out[a].y += amp * dir.y
    }
  }
  return out
}

/** 创建一份空的部位档位表 */
export function emptySites() {
  const o = {}
  for (const s of SITES) o[s.key] = 0
  return o
}

/** 按分区取部位列表 */
export function sitesOf(zoneKey) {
  return SITES.filter((s) => s.zone === zoneKey)
}

/** 取部位定义 */
export function siteOf(key) {
  return SITES.find((s) => s.key === key) || null
}
