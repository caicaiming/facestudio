/**
 * App.jsx —— 状态机、流程编排、三栏布局
 * 状态与错误码定义见《开发文档》第 5 章。
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import FaceCanvas, { CUSTOM_BASE } from './FaceCanvas.jsx'
import ParamSlider from './ParamSlider.jsx'
import SubunitPanel from './SubunitPanel.jsx'
import {
  measureFace,
  getDeformedPoints,
  applyPointOffsets,
  emptyOffsets,
  IDEAL,
} from './measure.js'
import { buildFullPoints, displaceAnchors, displaceByIDW } from './anchors.js'
import { estimateHairline } from './hairline.js'
import { analyzeFace, SLIDERS, DEFAULT_PARAMS } from './analyze.js'
import { autoTune, POINT_MOVES, MIRROR_KEY } from './autoTune.js'
import {
  buildFrame,
  eyeCenters,
  calibrateTransform,
  applyTransform,
  frameDiagnostics,
} from './frame.js'
import { delaunayTriangles } from './delaunay.js'
import { TRIANGLES } from './triangles.js'
import { POINT_GROUPS, POINT_NAMES, POINT_OFFSET_RANGE, pointLabel } from './pointMeta.js'
import { applySubunitOffsets, emptySubunits, subunitsOf } from './subunits.js'
import { applySiteOffsets, earAnchorOffsets, emptySites, siteAnchors, sitesOf } from './zones.js'
import { buildPlan, mmScale } from './aesthetic.js'
import ZonePanel from './ZonePanel.jsx'
import PlanPanel from './PlanPanel.jsx'

/** 自定义控制点位移范围（图片自然像素） */
const CUSTOM_OFFSET_RANGE = 60

/** 加点时与已有点的最小间距（相对图片宽度），避免产生退化三角形 */
const MIN_POINT_GAP_RATIO = 0.012

const VIEWS = [
  { key: 'detection', label: '检测' },
  { key: 'adjustment', label: '调整' },
  { key: 'reference', label: '对照' },
]

const OVERLAYS = [
  { key: 'mesh', label: '网格' },
  { key: 'points', label: '点位' },
  { key: 'three', label: '三庭' },
  { key: 'symmetry', label: '对称' },
]

/**
 * 对比表行定义：指标 → 取值 / 格式化 / 差值格式化 / 理想值。
 * 理想值用于判定「改善」还是「恶化」：偏离理想值变小即改善。
 */
const PCT = (v) => `${(v * 100).toFixed(1)}`
const D_PCT = (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}`
const D_NUM = (d, n = 1) => `${d > 0 ? '+' : ''}${d.toFixed(n)}`

/**
 * eps：判定「有变化」的最小量，须与 dfmt 的显示精度一致。
 * 否则会出现「+0.0」这类看着像没变却带上正负号的 Δ
 * （对称偏差单位是百分数、只显示 1 位小数，阈值应取 0.05 而非 0.0005）。
 */
const EPS_PCT1 = 0.0005 // 比例值，显示为 ×.x%  → 0.05%
const EPS_SYM = 0.05 // 已是百分数，显示 ×.x   → 0.05

const COMPARE_ROWS = [
  { key: 'upper', label: '上庭', ideal: IDEAL.three, eps: EPS_PCT1, get: (m) => m.three.upper, fmt: (v) => `${PCT(v)}%`, dfmt: D_PCT },
  { key: 'middle', label: '中庭', ideal: IDEAL.three, eps: EPS_PCT1, get: (m) => m.three.middle, fmt: (v) => `${PCT(v)}%`, dfmt: D_PCT },
  { key: 'lower', label: '下庭', ideal: IDEAL.three, eps: EPS_PCT1, get: (m) => m.three.lower, fmt: (v) => `${PCT(v)}%`, dfmt: D_PCT },
  { key: 'five', label: '五眼偏差', ideal: 0, eps: EPS_PCT1, get: (m) => m.five.deviation, fmt: (v) => `${PCT(v)}%`, dfmt: D_PCT },
  { key: 'symmetry', label: '对称偏差', ideal: 0, eps: EPS_SYM, get: (m) => m.symmetry, fmt: (v) => `${v.toFixed(1)}%`, dfmt: (d) => `${d > 0 ? '+' : ''}${d.toFixed(1)}` },
  { key: 'golden', label: '黄金分割', ideal: IDEAL.golden, eps: EPS_PCT1, get: (m) => m.golden, fmt: (v) => v.toFixed(3), dfmt: (d) => D_NUM(d, 3) },
  { key: 'balance', label: '视觉重心', ideal: IDEAL.balance, eps: EPS_PCT1, get: (m) => m.balance, fmt: (v) => v.toFixed(3), dfmt: (d) => D_NUM(d, 3) },
]

/** 生成一条记录的变更摘要（相对原始指标） */
function snapshotSummary(item, baseline) {
  if (!baseline || !baseline.valid || !item.metrics || !item.metrics.valid) return '—'
  const parts = []
  for (const r of COMPARE_ROWS) {
    const a = r.get(baseline)
    const b = r.get(item.metrics)
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    const d = b - a
    if (Math.abs(d) < 0.0005) continue
    parts.push(`${r.label} ${r.dfmt(d)}`)
  }
  return parts.slice(0, 3).join('　') || '与原始一致'
}

const ERROR_TEXT = {
  MODEL_LOAD_FAILED: '模型权重加载失败，请确认 public/models 目录完整后重试。',
  NO_BACKEND: '当前浏览器既不支持 WebGL，也无法降级到 CPU 后端，无法运行模型。',
  NO_FACE: '未检测到人脸，请更换正面清晰照片后重试。',
  INVALID_LANDMARKS: '关键点异常，无法测量。',
  IMAGE_DECODE_FAILED: '图片格式不支持或已损坏。',
}

/**
 * 初始化 tfjs 后端：优先 WebGL，失败则降级 CPU。
 * 无 GPU 的设备（虚拟机、部分远程桌面、禁用硬件加速的浏览器）下 WebGL 不可用，
 * 若不降级会直接导致模型加载失败。CPU 后端推理较慢但可用。
 */
async function initBackend(faceapi) {
  for (const name of ['webgl', 'cpu']) {
    try {
      await faceapi.tf.setBackend(name)
      await faceapi.tf.ready()
      if (faceapi.tf.getBackend() === name) return name
    } catch {
      /* 尝试下一个后端 */
    }
  }
  throw new Error('NO_BACKEND')
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'))
    img.src = src
  })
}

export default function App() {
  const [phase, setPhase] = useState('loading-model')
  const [imageSrc, setImageSrc] = useState(null)
  const [points, setPoints] = useState(null)
  /** 检测器原始点位：基准点校准的还原基准，重置时回到这里 */
  const [rawPoints, setRawPoints] = useState(null)
  /** 是否在主图上绘制并可抓取基准点 */
  const [showAnchors, setShowAnchors] = useState(true)
  const [activeAnchor, setActiveAnchor] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [params, setParams] = useState(DEFAULT_PARAMS)
  // 68 个关键点的逐点位移（自然像素），与 5 路预设滑块相互独立
  const [pointOffsets, setPointOffsets] = useState(emptyOffsets)
  // 面部亚单位档位（−15…＋15），按美学分区的局部精细形变，独立于滑块与逐点位移
  const [subunitValues, setSubunitValues] = useState(emptySubunits)
  // 医美部位档位（−15…＋15）：＋ 填充 / 外扩，− 收紧 / 内收
  const [siteValues, setSiteValues] = useState(emptySites)
  // 毫米标定：瞳距参考值取性别均值，用于把档位换算成医美沟通用的 mm
  const [gender, setGender] = useState(null)
  const [ipdMm, setIpdMm] = useState(null)
  // 主图上高亮显示的点位（悬停亚单位行时给出），仅作视觉指示
  const [highlight, setHighlight] = useState(null)
  // 悬停医美部位时高亮该部位的作用点（虚拟控制点，不在 68 点内）
  const [highlightSite, setHighlightSite] = useState(null)
  const [selectedPoint, setSelectedPoint] = useState(null)
  const [groupKey, setGroupKey] = useState('all')
  const [view, setView] = useState('detection')
  // 用户自定义控制点：{id, x, y, dx, dy}；x/y 为源位置，dx/dy 为手动位移
  const [customPoints, setCustomPoints] = useState([])
  const [addMode, setAddMode] = useState(false)
  // 检测元数据：用于基于形变后点位重新测量「调整后指标」
  const [base, setBase] = useState(null)
  // 调整记录快照
  const [history, setHistory] = useState([])
  const [overlay, setOverlay] = useState('mesh')
  const [error, setError] = useState(null)
  const [backend, setBackend] = useState(null)
  const faceapiRef = useRef(null)
  const urlRef = useRef(null)

  // ---- 模型权重加载（face-api 动态 import，应用外壳可先渲染）----
  const [loadToken, setLoadToken] = useState(0)
  useEffect(() => {
    let cancelled = false
    setPhase('loading-model')
    setError(null)
    Promise.all([
      import('@vladmandic/face-api').then((m) => {
        faceapiRef.current = m
        return m
      }),
    ])
      .then(([faceapi]) => initBackend(faceapi))
      .then((b) => {
        if (cancelled) throw new Error('cancelled')
        setBackend(b)
        const faceapi = faceapiRef.current
        return Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        ])
      })
      .then(() => {
        if (!cancelled) setPhase('ready')
      })
      .catch((e) => {
        if (cancelled || e.message === 'cancelled') return
        setPhase('error')
        const code = e.message === 'NO_BACKEND' ? 'NO_BACKEND' : 'MODEL_LOAD_FAILED'
        setError({ code, message: ERROR_TEXT[code] })
      })
    return () => {
      cancelled = true
    }
  }, [loadToken])

  // ---- 检测流程 ----
  const handleFile = useCallback(
    async (file) => {
      const faceapi = faceapiRef.current
      if (!file || !faceapi) return
      setError(null)
      setPhase('detecting')
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      const url = URL.createObjectURL(file)
      urlRef.current = url
      try {
        const img = await loadImage(url)
        const det = await faceapi
          .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416 }))
          .withFaceLandmarks()

        if (!det) {
          setImageSrc(url)
          setRawPoints(null)
          setPoints(null)
          setMetrics(null)
          setPhase('error')
          setError({ code: 'NO_FACE', message: ERROR_TEXT.NO_FACE })
          return
        }

        const pts = det.landmarks.positions.map((p) => ({ x: p.x, y: p.y }))
        if (pts.length !== 68) {
          setImageSrc(url)
          setRawPoints(null)
          setPoints(null)
          setMetrics(null)
          setPhase('error')
          setError({ code: 'INVALID_LANDMARKS', message: ERROR_TEXT.INVALID_LANDMARKS })
          return
        }

        const b = det.detection.box
        const hairlineY = estimateHairline(img, pts)
        const m = measureFace(
          pts,
          img.naturalWidth,
          img.naturalHeight,
          { x: b.x, y: b.y, width: b.width, height: b.height },
          det.detection.score,
          hairlineY,
        )

        setBase({
          w: img.naturalWidth,
          h: img.naturalHeight,
          box: { x: b.x, y: b.y, width: b.width, height: b.height },
          score: det.detection.score,
          hairlineY,
        })
        setImageSrc(url)
        setRawPoints(pts)
        setPoints(pts)
        setActiveAnchor(null)
        setMetrics(m)
        setParams(DEFAULT_PARAMS)
        setPointOffsets(emptyOffsets())
        setSubunitValues(emptySubunits())
        setHighlight(null)
        setSelectedPoint(null)
        setCustomPoints([])
        setAddMode(false)
        setHistory([])
        resetAutoTune()
        setView('detection')
        setOverlay('mesh')
        setPhase('done')
      } catch {
        setImageSrc(url)
        setRawPoints(null)
        setPoints(null)
        setMetrics(null)
        setPhase('error')
        setError({ code: 'IMAGE_DECODE_FAILED', message: ERROR_TEXT.IMAGE_DECODE_FAILED })
      }
    },
    [],
  )

  const onDrop = (e) => {
    e.preventDefault()
    if (phase === 'loading-model') return
    handleFile(e.dataTransfer.files?.[0])
  }

  // ---- 派生数据 ----
  // 完整源点集：68 关键点 + 8 外围锚点 + N 自定义点。
  // 锚点由原始点推导一次后固定，充当边界约束（见 anchors.js）。
  const srcFull = useMemo(() => {
    if (!points) return null
    const base = buildFullPoints(points)
    return customPoints.length ? base.concat(customPoints.map((c) => ({ x: c.x, y: c.y }))) : base
  }, [points, customPoints])

  const anchors = useMemo(() => (srcFull ? srcFull.slice(68, 76) : null), [srcFull])

  // ---- 基准坐标系 ----
  // 原点 = 两眼质心中点，单位 = 眼间距。这套定义与照片无关：
  // 换任何一张脸，原点都在同一个解剖位置、一个单位都是同一个眼间距。
  const frame = useMemo(() => (points ? buildFrame(points) : null), [points])
  const frameAnchors = useMemo(() => (points ? eyeCenters(points) : null), [points])
  /** 相对自动检测的平移量（像素）：判断用户有没有动过基准点 */
  const calibShift = useMemo(() => {
    if (!rawPoints || !points) return 0
    const a = eyeCenters(rawPoints)
    const c = eyeCenters(points)
    if (!a.L || !c.L) return 0
    return Math.hypot(c.L.x - a.L.x, c.L.y - a.L.y)
  }, [rawPoints, points])
  const frameDiag = useMemo(
    () => (frame ? frameDiagnostics(frame, { shift: calibShift }) : null),
    [frame, calibShift],
  )
  const isCalibrated = frameDiag?.calibrated ?? false

  /**
   * 拖动基准点：整组点位【纯平移】跟随。
   *
   * 这里刻意不做相似变换 —— 单点微动会同时改变两眼连线的角度与长度，
   * 实测拖 50px 就能让脸旋转 14°、眼间距缩水 10%，既不可预测也不符合
   * 「微调基准点」的直觉。检测器最常见的误差就是整体偏移，纯平移正好对症，
   * 且 roll / 眼间距保持恒定，诊断不会跳变。
   * 姿态与尺度由基准坐标系在测量时自动归一，不需要用户手动摆。
   */
  const dragAnchor = useCallback((which, dx, dy) => {
    setPoints((cur) => {
      if (!cur) return cur
      return cur.map((p) => ({ x: p.x + dx, y: p.y + dy }))
    })
  }, [])

  /** 旋转摆正：把整组点绕原点转到两眼连线水平（roll = 0） */
  const levelFace = useCallback(() => {
    setPoints((cur) => {
      if (!cur || !frame) return cur
      const a = (-frame.roll * Math.PI) / 180
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      const { x: ox, y: oy } = frame.O
      return cur.map((p) => {
        const dx = p.x - ox
        const dy = p.y - oy
        return { x: ox + dx * cos - dy * sin, y: oy + dx * sin + dy * cos }
      })
    })
  }, [frame])

  /** 放弃校准，回到检测器原始点位 */
  const resetCalibration = useCallback(() => {
    if (!rawPoints) return
    setPoints(rawPoints)
    setActiveAnchor(null)
  }, [rawPoints])

  // 三角剖分：无自定义点时沿用构建期固化的表；加了点则按新点集重算一次。
  // 只在加/删自定义点时触发，不进入拖动时的每帧路径。
  const triangles = useMemo(() => {
    if (!srcFull || customPoints.length === 0) return TRIANGLES
    return delaunayTriangles(srcFull)
  }, [srcFull, customPoints.length])

  /**
   * 形变后的完整点集（预览区与「调整后指标」共用）。
   * 与 view 无关 —— 预览区常驻显示调整结果，故任何视图下都要能算出形变点位。
   */
  const previewPoints = useMemo(() => {
    if (!points) return null
    // 形变四层叠加：5 路预设滑块 → 亚单位局部形变 → 医美部位形变 → 逐点手动位移
    // 医美部位作用在【虚拟控制点】上（额头/太阳穴/苹果肌等 68 点未覆盖处），
    // 位置由规范坐标系外推，故换任何一张脸都落在同一解剖位置。
    const d = applyPointOffsets(
      applySiteOffsets(
        applySubunitOffsets(getDeformedPoints(points, params), subunitValues),
        siteValues,
        { hairlineY: base?.hairlineY },
      ),
      pointOffsets,
    )
    // 锚点软跟随：减小大形变时侧面三角形的剪切，避免发丝纹理拉成条纹
    // 耳部档位额外推动外缘锚点 —— 68 点在耳区没有点，不动锚点就看不到变化
    const anchorsD = earAnchorOffsets(points, displaceAnchors(anchors, points, d), siteValues, {
      hairlineY: base?.hairlineY,
    })
    if (customPoints.length === 0) return d.concat(anchorsD)
    // 自定义点：先跟随邻近关键点的整体形变（IDW），再叠加用户手动位移。
    // 只跟随不手动位移时，它表现为「局部锚定」；拖它则做局部推拉。
    const customD = displaceByIDW(
      customPoints.map((c) => ({ x: c.x, y: c.y })),
      points,
      d,
    ).map((p, i) => ({ x: p.x + customPoints[i].dx, y: p.y + customPoints[i].dy }))
    return d.concat(anchorsD, customD)
  }, [points, params, subunitValues, siteValues, pointOffsets, customPoints, anchors, base])

  /**
   * 主图点集：主图始终显示原图照片，叠加层必须与照片同坐标系，否则点位会浮在
   * 「上一状态」的脸上（滑块一动就整体错位）。因此这里只叠加用户手动位移，
   * 不含滑块形变 —— 滑块效果一律由预览区（previewPoints）呈现。
   */
  const editedPoints = useMemo(() => {
    if (!srcFull) return null
    // applyPointOffsets 只接受恰好 68 点的点集（内部 isValidPoints 校验），
    // 因此先切片应用，再把锚点与自定义点拼回。
    const out = applyPointOffsets(srcFull.slice(0, 68), pointOffsets).concat(
      srcFull.slice(68).map((p) => ({ x: p.x, y: p.y })),
    )
    // 自定义点：原始落点 + 手动位移（锚点 68–75 保持原位，作为网格外框）
    for (let n = 0; n < customPoints.length; n++) {
      const i = CUSTOM_BASE + n
      if (i >= out.length) break
      out[i] = { x: out[i].x + customPoints[n].dx, y: out[i].y + customPoints[n].dy }
    }
    return out
  }, [srcFull, pointOffsets, customPoints])

  const displayPoints = useMemo(() => {
    if (!points) return null
    // 「对照」视图不画叠加层，点位取原始值即可；其余视图用与照片对齐的编辑态点集
    return view === 'reference' ? srcFull : editedPoints
  }, [points, view, editedPoints, srcFull])

  // ---- 逐点位移回调 ----
  const setOffset = useCallback((i, dx, dy) => {
    setPointOffsets((prev) => {
      const next = prev.slice()
      next[i] = { dx, dy }
      return next
    })
  }, [])

  /** 画布拖拽：增量累加到该点既有位移上 */
  const handlePointDrag = useCallback((i, ddx, ddy) => {
    if (i >= CUSTOM_BASE) {
      const n = i - CUSTOM_BASE
      setCustomPoints((prev) =>
        prev.map((c, k) => (k === n ? { ...c, dx: c.dx + ddx, dy: c.dy + ddy } : c)),
      )
    } else {
      setPointOffsets((prev) => {
        const next = prev.slice()
        const o = next[i] || { dx: 0, dy: 0 }
        next[i] = { dx: o.dx + ddx, dy: o.dy + ddy }
        return next
      })
    }
    setView((cur) => (cur === 'adjustment' ? cur : 'adjustment'))
  }, [])

  const handlePointSelect = useCallback((i) => {
    setSelectedPoint(i)
    // 选中关键点时自动落到包含它的分组，便于在下拉里看到当前点；
    // 自定义点不属于任何解剖分组，保持当前分组不变。
    setGroupKey((cur) => {
      const g = POINT_GROUPS.find((x) => x.key !== 'all' && i >= x.from && i <= x.to)
      return g ? g.key : cur
    })
  }, [])

  // ---- 目标分数反解 ----
  const [targetScore, setTargetScore] = useState('85')
  const [tuning, setTuning] = useState(false)
  const [tuneResult, setTuneResult] = useState(null)
  const [maxReachable, setMaxReachable] = useState(null)
  // 自动调整前的现场，供「撤销」回退
  const tuneSnapshotRef = useRef(null)

  /** 换图 / 重置后清掉上一次自动调整的结果与现场 */
  const resetAutoTune = useCallback(() => {
    setTuneResult(null)
    setMaxReachable(null)
    tuneSnapshotRef.current = null
  }, [])

  /** 把求解结果翻译成一句人话 + 一行动过的清单 */
  const describeTune = useCallback((r, goal) => {
    const details = []
    for (const s of SLIDERS) {
      const v = Math.round(r.params[s.key] ?? 0)
      if (v) details.push(`${s.label} ${v > 0 ? '+' : '−'}${Math.abs(v)}`)
    }
    for (const m of POINT_MOVES) {
      const v = r.vars?.[m.key] ?? 0
      if (Math.abs(v) < 1e-6) continue
      details.push(`${m.label} ${v > 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(1)}%`)
    }
    const mv = r.vars?.[MIRROR_KEY] ?? 0
    if (mv > 1e-6) details.push(`对称化 ${(mv * 100).toFixed(0)}%`)

    const score = r.score
    if (score == null) return { ok: false, text: '这张照片无法完成测量，换一张正面清晰照片试试。', details }
    // 先看有没有真的命中：上下 2 分内都算达成，避免「目标 88 拿到 87」被报成失败
    if (Math.abs(score - goal) <= 2) {
      return { ok: true, text: `✓ 已达成 ${score} 分（原 ${r.startScore ?? '—'} 分）。`, details }
    }
    if (r.ceiling) {
      return {
        ok: false,
        text: `目标 ${goal} 分超出可达范围，已给到这张脸的当前最优 ${score} 分。`,
        details,
      }
    }
    return {
      ok: true,
      text: `已调到 ${score} 分（目标 ${goal} 分，差 ${Math.abs(score - goal)} 分）。`,
      details,
    }
  }, [])

  const handleAutoTune = useCallback(() => {
    if (!points || !base) return
    const goal = Number(targetScore)
    if (!Number.isFinite(goal)) return
    setTuning(true)
    setTuneResult(null)
    // 让「计算中」先渲染出来，再进 100ms 量级的搜索，避免界面看起来卡住
    window.setTimeout(() => {
      // 始终从原始照片出发求解：若以当前位移为基底继续叠加，
      // 连续反解会层层累积（同一次目标第二次结果更高），结果不再可复现。
      const r = autoTune({ points, base, target: goal })
      tuneSnapshotRef.current = { params, pointOffsets }
      setParams(r.params)
      setPointOffsets(r.offsets)
      setView('adjustment')
      setTuneResult(describeTune(r, goal))
      setTuning(false)
    }, 30)
  }, [points, base, targetScore, params, pointOffsets, describeTune])

  const undoAutoTune = useCallback(() => {
    const snap = tuneSnapshotRef.current
    if (!snap) return
    setParams(snap.params)
    setPointOffsets(snap.pointOffsets)
    tuneSnapshotRef.current = null
    setTuneResult(null)
  }, [])

  // 换图后探一次「可达上限」，让用户在输入目标前就知道这张脸能被推到多高
  useEffect(() => {
    if (!points || !base) {
      setMaxReachable(null)
      return
    }
    const id = window.setTimeout(() => {
      const r = autoTune({ points, base, target: 100 })
      if (Number.isFinite(r.maxScore)) setMaxReachable(r.maxScore)
    }, 400)
    return () => window.clearTimeout(id)
  }, [points, base])

  // ---- 自定义控制点 ----
  const addCustomPoint = useCallback(
    (x, y) => {
      if (!srcFull) return
      // 与已有控制点过近会产生退化三角形（纹理映射出现空洞），直接忽略
      const minGap = (base?.w || 1000) * MIN_POINT_GAP_RATIO
      for (const p of srcFull) {
        if (Math.hypot(p.x - x, p.y - y) < minGap) return
      }
      const index = CUSTOM_BASE + customPoints.length
      setCustomPoints((prev) => [...prev, { id: `${Date.now()}_${prev.length}`, x, y, dx: 0, dy: 0 }])
      setSelectedPoint(index)
      setAddMode(false)
      setView((cur) => (cur === 'adjustment' ? cur : 'adjustment'))
    },
    [srcFull, base, customPoints.length],
  )

  const setCustomOffset = useCallback((n, dx, dy) => {
    setCustomPoints((prev) => prev.map((c, k) => (k === n ? { ...c, dx, dy } : c)))
  }, [])

  const removeCustomPoint = useCallback((n) => {
    setCustomPoints((prev) => prev.filter((_, k) => k !== n))
    // 后续点索引前移一位，选中态需要同步修正
    setSelectedPoint((cur) => {
      if (cur == null || cur < CUSTOM_BASE) return cur
      const idx = cur - CUSTOM_BASE
      if (idx === n) return null
      return idx > n ? cur - 1 : cur
    })
  }, [])

  /**
   * 导出术前 / 术后对比图。
   *
   * 医美咨询最核心的交付物就是这张对比图 —— 顾客看方案文本没感觉，
   * 看图才有。左取主图的原始照片，右取预览区的形变画布，拼成一张 PNG。
   *
   * 直接读 DOM 里的 <img> 与 <canvas>：两者都已加载完成，
   * 不必再走一遍绘制管线，也避免引入额外的截图依赖。
   */
  const exportComparison = useCallback(() => {
    const wraps = document.querySelectorAll('.canvas-duo .canvas-wrap')
    if (wraps.length < 2) return false
    const img = wraps[0]?.querySelector('img')
    const warp = wraps[1]?.querySelector('canvas.warp')
    const w = img?.naturalWidth || 0
    const h = img?.naturalHeight || 0
    if (!w || !h || !warp || !warp.width) return false

    const gap = Math.round(w * 0.03)
    const out = document.createElement('canvas')
    out.width = w * 2 + gap
    out.height = h
    const ctx = out.getContext('2d')

    ctx.fillStyle = '#0b0b0f'
    ctx.fillRect(0, 0, out.width, out.height)
    // warp 画布按 maxEdge 缩放过，drawImage 时统一拉回原图尺寸
    ctx.drawImage(img, 0, 0, w, h)
    ctx.drawImage(warp, w + gap, 0, w, h)

    const fs = Math.max(14, Math.round(h * 0.035))
    ctx.font = `600 ${fs}px system-ui, "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const labels = [
      ['调整前', 0],
      ['调整后（模拟）', w + gap],
    ]
    for (const [text, x] of labels) {
      const tw = ctx.measureText(text).width
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
      ctx.fillRect(x + w / 2 - tw / 2 - fs * 0.4, fs * 0.4, tw + fs * 0.8, fs * 1.6)
      ctx.fillStyle = '#fff'
      ctx.fillText(text, x + w / 2, fs * 0.6)
    }

    const a = document.createElement('a')
    a.href = out.toDataURL('image/png')
    a.download = `面部对比_${new Date().toISOString().slice(0, 10)}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    return true
  }, [])

  const clearCustomPoints = useCallback(() => {
    setCustomPoints([])
    setAddMode(false)
    setSelectedPoint((cur) => (cur != null && cur >= CUSTOM_BASE ? null : cur))
  }, [])

  // ---- 调整后指标：基于形变后的点位重新测量（而非沿用原始 metrics）----
  // 用 previewPoints 而非 displayPoints：预览区常驻，故对比数据不随主图视图切换而消失。
  const adjustedMetrics = useMemo(() => {
    if (!base || !previewPoints) return null
    return measureFace(
      previewPoints.slice(0, 68),
      base.w,
      base.h,
      base.box,
      base.score,
      base.hairlineY,
    )
  }, [base, previewPoints])

  const adjustedScore = useMemo(
    () => (adjustedMetrics && adjustedMetrics.valid ? analyzeFace(adjustedMetrics).score : null),
    [adjustedMetrics],
  )

  // ---- 毫米标定：把归一化比例换算成医美沟通用的 mm ----
  // 瞳距是稳定的天然标尺（成年女性约 62mm、男性约 64mm），误差约 ±5%。
  const scale = useMemo(
    () => (points ? mmScale(points, { ipdMm, gender, faceHeightPx: metrics?.faceHeight }) : null),
    [points, ipdMm, gender, metrics],
  )

  // 部位档位同样降为低优先级更新，与右栏保持一致的响应节奏
  const deferredSiteValues = useDeferredValue(siteValues)

  // ---- 医美部位的作用点（供主图叠加层绘制）----
  // 只在有部位被调整或悬停时计算，避免每次渲染都跑一遍外推。
  const siteMarkers = useMemo(() => {
    if (!points) return null
    const hasActive = Object.values(deferredSiteValues || {}).some(
      (v) => Number.isFinite(v) && v !== 0,
    )
    if (!hasActive && !highlightSite) return null
    return siteAnchors(points, null).map((a) => ({
      key: a.site.key,
      label: a.site.label,
      pts: a.pts,
      active: highlightSite === a.site.key,
      on: hasActive && Number.isFinite(deferredSiteValues[a.site.key]) && deferredSiteValues[a.site.key] !== 0,
    }))
  }, [points, deferredSiteValues, highlightSite])

  const adjustedCount = useMemo(
    () => pointOffsets.reduce((n, o) => n + (o && (o.dx || o.dy) ? 1 : 0), 0),
    [pointOffsets],
  )

  // ---- 调整记录快照 ----
  const saveSnapshot = useCallback(() => {
    if (!adjustedMetrics || !adjustedMetrics.valid) return
    setHistory((h) =>
      [
        {
          id: Date.now(),
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          params: { ...params },
          pointOffsets: pointOffsets.map((o) => ({ ...o })),
          customPoints: customPoints.map((c) => ({ ...c })),
          metrics: adjustedMetrics,
          score: adjustedScore,
        },
        ...h,
      ].slice(0, 20),
    )
  }, [adjustedMetrics, adjustedScore, params, pointOffsets, customPoints])

  const restoreSnapshot = useCallback((item) => {
    setParams({ ...item.params })
    setPointOffsets((item.pointOffsets || []).map((o) => ({ ...o })))
    setCustomPoints((item.customPoints || []).map((c) => ({ ...c })))
    setView('adjustment')
  }, [])

  const removeSnapshot = useCallback((id) => {
    setHistory((h) => h.filter((x) => x.id !== id))
  }, [])

  /** 选中的是自定义点时，返回其在 customPoints 中的下标，否则 null */
  const selectedCustom =
    selectedPoint != null && selectedPoint >= CUSTOM_BASE ? selectedPoint - CUSTOM_BASE : null

  const activeGroup = POINT_GROUPS.find((g) => g.key === groupKey) || POINT_GROUPS[0]
  const groupPoints = useMemo(() => {
    const out = []
    for (let i = activeGroup.from; i <= activeGroup.to; i++) out.push(i)
    return out
  }, [activeGroup])

  // 右栏（评分/处方/文案）只依赖 params 做「已调整项抑制」，无需与拖动同帧。
  // 用 useDeferredValue 降为低优先级更新，让滑块与照片形变始终先于右栏响应。
  const deferredParams = useDeferredValue(params)
  const analysis = useMemo(
    () => (metrics ? analyzeFace(metrics, deferredParams) : null),
    [metrics, deferredParams],
  )

  // ---- 医美方案：部位 + 项目 + 幅度 + 剂量 ----
  // ⚠️ 必须在 analysis 之后声明：plan 要读 analysis.score 做「调整前评分」。
  //    放到前面会命中 TDZ（Cannot access 'analysis' before initialization）。
  const plan = useMemo(
    () =>
      points && metrics
        ? buildPlan(points, {
            metrics,
            score: analysis?.score,
            adjustedMetrics,
            adjustedScore,
            siteValues: deferredSiteValues,
            ipdMm,
            gender,
          })
        : null,
    [points, metrics, analysis, adjustedMetrics, adjustedScore, deferredSiteValues, ipdMm, gender],
  )

  /** 综合评分变化量（必须在 analysis 之后声明） */
  const scoreDiff =
    analysis?.score && adjustedScore ? adjustedScore.total - analysis.score.total : NaN

  const warnings = []
  if (metrics && metrics.valid) {
    if (metrics.confidence < 0.5) warnings.push({ level: 'warn', text: '检测置信度偏低，结果仅供参考。' })
    if (metrics.yaw > 0.15) warnings.push({ level: 'warn', text: '疑似侧脸，三庭测量误差较大。' })
  }

  const busy = phase === 'loading-model' || phase === 'detecting'

  // Esc 退出加点模式
  useEffect(() => {
    if (!addMode) return
    const onKey = (e) => {
      if (e.key === 'Escape') setAddMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addMode])

  // 开发期调试句柄（生产构建剔除）
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__faceStudio = {
        points,
        metrics,
        params,
        view,
        overlay,
        customPoints,
        triangles,
        displayPoints,
        previewPoints,
        pointOffsets,
        subunitValues,
      }
    }
  }, [
    points,
    metrics,
    params,
    view,
    overlay,
    customPoints,
    triangles,
    displayPoints,
    previewPoints,
    pointOffsets,
    subunitValues,
  ])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          Face Studio
          <span className="brand-sub">面部比例分析 · Demo</span>
        </div>
        <div className="topbar-right">
          <span className={`status status-${phase}`}>
            {phase === 'loading-model' && '模型加载中…'}
            {phase === 'ready' && `就绪${backend === 'cpu' ? '（CPU 降级）' : ''}`}
            {phase === 'detecting' && '检测中…'}
            {phase === 'done' && '分析完成'}
            {phase === 'error' && '异常'}
          </span>
          <label className={`upload ${busy && phase !== 'detecting' ? 'disabled' : ''}`}>
            上传照片
            <input
              type="file"
              accept="image/jpeg,image/png"
              disabled={phase === 'loading-model'}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
        </div>
      </header>

      {error && (
        <div className="banner error">
          <span>
            [{error.code}] {error.message}
          </span>
          {error.code === 'MODEL_LOAD_FAILED' && (
            <button onClick={() => setLoadToken((t) => t + 1)}>重试加载</button>
          )}
        </div>
      )}

      <main className="layout">
        {/* ---------------- 左栏：参数滑块 ---------------- */}
        <aside className="col-left card">
          {/* ---------------- 基准点校准（决定全部点位的第一层） ---------------- */}
          <h2 className="card-title">基准点校准</h2>
          <div className="frame-block">
            <p className="frame-desc">
              整张脸的坐标系由<strong>两个基准点</strong>决定：原点在两眼中点，
              单位是眼间距。<strong>换任何一张脸都是同一套定义</strong>，
              所以测量结果跨照片可比。点位若整体偏移，拖动基准点即可整组校正。
            </p>
            {frameDiag ? (
              <div className={`frame-diag ${frameDiag.level}`}>
                <div className="frame-stats">
                  <span>
                    歪头 <b>{frameDiag.roll.toFixed(1)}°</b>
                  </span>
                  <span>
                    眼间距 <b>{Math.round(frameDiag.ipd)}</b> px
                  </span>
                  {isCalibrated && (
                    <span>
                      已校准 位移 <b>{Math.round(frameDiag.shift)}</b> px
                    </span>
                  )}
                </div>
                <p className="frame-text">{frameDiag.text}</p>
              </div>
            ) : (
              <p className="note">上传照片后显示基准诊断。</p>
            )}
            <div className="frame-actions">
              <button
                className={`btn-ghost sm${showAnchors ? ' active' : ''}`}
                disabled={!points}
                onClick={() => setShowAnchors((v) => !v)}
              >
                {showAnchors ? '隐藏基准点' : '显示基准点'}
              </button>
              <button
                className="btn-ghost sm"
                disabled={!points || !frame || Math.abs(frame.roll) < 0.5}
                onClick={levelFace}
                title="绕两眼中点旋转，直到两眼连线水平"
              >
                摆正至水平
              </button>
              <button
                className="btn-ghost sm"
                disabled={!points || !isCalibrated}
                onClick={resetCalibration}
              >
                还原自动检测
              </button>
            </div>
            <p className="frame-hint">
              青色圆环即基准点（画面左 / 右眼质心），可直接拖动；
              整组 68 点会按平移 + 旋转 + 缩放同步校正。
            </p>
          </div>

          {/* ---------------- 自定义控制点 ---------------- */}
          <h2 className="card-title sub">自定义控制点</h2>
          <div className="custom-bar">
            <button
              className={`btn-ghost sm${addMode ? ' active' : ''}`}
              disabled={!points}
              onClick={() => {
                setAddMode((m) => !m)
                setView((cur) => (cur === 'reference' ? 'detection' : cur))
              }}
            >
              {addMode ? '取消加点' : '＋ 添加控制点'}
            </button>
            <button
              className="btn-ghost sm"
              disabled={customPoints.length === 0}
              onClick={clearCustomPoints}
            >
              清除全部
            </button>
          </div>
          <p className="note">
            {addMode
              ? '在照片空白处点击落点；命中已有的点则是拖动。加完自动退出。'
              : `已添加 ${customPoints.length} 个控制点。自定义点会接入三角网格，可单独推拉做局部形变。`}
          </p>

          {customPoints.length > 0 && (
            <ul className="custom-list">
              {customPoints.map((c, n) => (
                <li key={c.id} className={selectedPoint === CUSTOM_BASE + n ? 'active' : ''}>
                  <button
                    className="custom-item"
                    onClick={() => setSelectedPoint(CUSTOM_BASE + n)}
                  >
                    <span className="custom-badge">C{n + 1}</span>
                    <span className="custom-coord">
                      {Math.round(c.x)}, {Math.round(c.y)}
                    </span>
                    {c.dx || c.dy ? (
                      <span className="custom-delta">
                        {c.dx > 0 ? '+' : ''}
                        {c.dx.toFixed(0)} / {c.dy > 0 ? '+' : ''}
                        {c.dy.toFixed(0)}
                      </span>
                    ) : null}
                  </button>
                  <button
                    className="custom-del"
                    title="删除该控制点"
                    onClick={() => removeCustomPoint(n)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedCustom != null && customPoints[selectedCustom] && (
            <>
              <div className="point-current">
                <span className="point-badge custom">C{selectedCustom + 1}</span>
                <span>
                  自定义点（原 {Math.round(customPoints[selectedCustom].x)},{' '}
                  {Math.round(customPoints[selectedCustom].y)}）
                </span>
              </div>
              {['dx', 'dy'].map((axis) => {
                const c = customPoints[selectedCustom]
                return (
                  <ParamSlider
                    key={axis}
                    label={axis === 'dx' ? '水平位移' : '垂直位移'}
                    value={c[axis]}
                    min={-CUSTOM_OFFSET_RANGE}
                    max={CUSTOM_OFFSET_RANGE}
                    step={0.5}
                    unit="px"
                    onChange={(v) =>
                      setCustomOffset(
                        selectedCustom,
                        axis === 'dx' ? v : c.dx,
                        axis === 'dy' ? v : c.dy,
                      )
                    }
                    onReset={() =>
                      setCustomOffset(
                        selectedCustom,
                        axis === 'dx' ? 0 : c.dx,
                        axis === 'dy' ? 0 : c.dy,
                      )
                    }
                  />
                )
              })}
              <div className="point-actions">
                <button
                  className="btn-ghost sm"
                  onClick={() => setCustomOffset(selectedCustom, 0, 0)}
                >
                  重置该点
                </button>
              </div>
              <p className="note">
                自定义点默认跟随邻近关键点的整体形变；这里的位移是在该基础上<strong>额外的局部推拉</strong>。
              </p>
            </>
          )}

          {/* ---------------- 逐点微调 ---------------- */}
          <h2 className="card-title sub">逐点微调</h2>

          <div className="point-picker">
            <select
              value={groupKey}
              disabled={!points}
              onChange={(e) => setGroupKey(e.target.value)}
              aria-label="点位分组"
            >
              {POINT_GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
            <select
              value={selectedPoint ?? ''}
              disabled={!points}
              onChange={(e) =>
                setSelectedPoint(e.target.value === '' ? null : Number(e.target.value))
              }
              aria-label="选择点位"
            >
              <option value="">选择点位…</option>
              {groupPoints.map((i) => (
                <option key={i} value={i}>
                  {pointLabel(i)}
                </option>
              ))}
            </select>
          </div>

          {/* 自定义点（索引 ≥ 76）不属于关键点面板，由上方「自定义控制点」区块接管 */}
          {selectedPoint != null && selectedPoint < 68 ? (
            <>
              <div className="point-current">
                <span className="point-badge">{selectedPoint}</span>
                <span>{POINT_NAMES[selectedPoint]}</span>
              </div>

              {['dx', 'dy'].map((axis) => {
                const o = pointOffsets[selectedPoint] || { dx: 0, dy: 0 }
                return (
                  <ParamSlider
                    key={axis}
                    label={axis === 'dx' ? '水平位移' : '垂直位移'}
                    value={o[axis]}
                    min={-POINT_OFFSET_RANGE}
                    max={POINT_OFFSET_RANGE}
                    step={0.5}
                    unit="px"
                    onChange={(v) => {
                      setOffset(
                        selectedPoint,
                        axis === 'dx' ? v : o.dx,
                        axis === 'dy' ? v : o.dy,
                      )
                      setView((cur) => (cur === 'adjustment' ? cur : 'adjustment'))
                    }}
                    onReset={() =>
                      setOffset(selectedPoint, axis === 'dx' ? 0 : o.dx, axis === 'dy' ? 0 : o.dy)
                    }
                  />
                )
              })}

              <div className="point-actions">
                <button
                  className="btn-ghost sm"
                  onClick={() => setOffset(selectedPoint, 0, 0)}
                >
                  重置该点
                </button>
                <button
                  className="btn-ghost sm"
                  disabled={adjustedCount === 0}
                  onClick={() => setPointOffsets(emptyOffsets())}
                >
                  点位全部归零
                </button>
              </div>
              <p className="note">
                已调整 <strong>{adjustedCount}</strong> 个点。也可直接在照片上拖动点位（切到「点位」叠加层更好点选）。
              </p>
            </>
          ) : (
            <p className="note">
              选择点位后可调其水平 / 垂直位移，也可直接在照片上拖动点位。
              {selectedPoint != null && selectedPoint >= CUSTOM_BASE && '（当前选中自定义点，见上方「自定义控制点」面板）'}
            </p>
          )}

          <h2 className="card-title sub">调整参数</h2>

          {/* ---------------- 目标分数反解 ---------------- */}
          <div className="auto-tune">
            <div className="auto-tune-row">
              <label htmlFor="target-score">目标分数</label>
              <input
                id="target-score"
                className="score-input"
                type="number"
                min={0}
                max={100}
                step={1}
                value={targetScore}
                disabled={!points}
                onChange={(e) => setTargetScore(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAutoTune()
                }}
              />
              <button className="btn-accent" disabled={!points || tuning} onClick={handleAutoTune}>
                {tuning ? '计算中…' : '自动调整'}
              </button>
            </div>
            {tuneResult && <p className={`tune-msg ${tuneResult.ok ? 'ok' : 'warn'}`}>{tuneResult.text}</p>}
            {tuneResult && tuneResult.details.length > 0 && (
              <p className="tune-detail">已写入：{tuneResult.details.join(' · ')}</p>
            )}
            {tuneResult && <button className="btn-ghost sm" onClick={undoAutoTune}>撤销这次调整</button>}
            <p className="note">
              输入想要的分数即可反解参数：先用 5 路滑块自然形变，不足部分再用关键点和对称度补足
              {typeof maxReachable === 'number' && `。这张脸当前手法上限约 ${maxReachable} 分`}。
            </p>
          </div>

          {SLIDERS.map((s) => (
            <ParamSlider
              key={s.key}
              label={s.label}
              value={params[s.key] ?? 0}
              min={s.min}
              max={s.max}
              step={s.step}
              disabled={!points}
              hint={s.hint}
              onChange={(v) => {
                setParams((p) => ({ ...p, [s.key]: v }))
                // 调参即视为要调整，自动切到「调整」视图查看照片形变
                setView((cur) => (cur === 'adjustment' ? cur : 'adjustment'))
              }}
              onReset={() => setParams((p) => ({ ...p, [s.key]: 0 }))}
            />
          ))}
          <button
            className="btn-ghost"
            disabled={!points}
            onClick={() => setParams(DEFAULT_PARAMS)}
          >
            全部归零
          </button>
          <p className="note">
            滑块为数学插值形变，<strong>不预测真实术后效果</strong>。双击滑块可单独归零。
          </p>

          {/* ---------------- 医美部位 ---------------- */}
          <ZonePanel
            values={siteValues}
            points={points}
            scale={scale}
            disabled={!points}
            onChange={(key, v) => {
              setSiteValues((s) => ({ ...s, [key]: v }))
              // 调部位即视为要调整，自动切到「调整」视图查看照片形变
              setView((cur) => (cur === 'adjustment' ? cur : 'adjustment'))
            }}
            onResetZone={(zoneKey) =>
              setSiteValues((s) => {
                const next = { ...s }
                for (const site of sitesOf(zoneKey)) next[site.key] = 0
                return next
              })
            }
            onResetAll={() => setSiteValues(emptySites())}
            onHighlight={setHighlightSite}
          />

          {/* ---------------- 亚单位精调 ---------------- */}
          {/* 默认折叠：医美部位与亚单位是「局部形变」的两套入口，
              同时展开会把左栏拉到三四屏。需要精细微调时点标题展开。 */}
          <SubunitPanel
            defaultCollapsed
            values={subunitValues}
            disabled={!points}
            onChange={(key, v) => {
              setSubunitValues((s) => ({ ...s, [key]: v }))
              setView((cur) => (cur === 'adjustment' ? cur : 'adjustment'))
            }}
            onResetZone={(zoneKey) =>
              setSubunitValues((s) => {
                const next = { ...s }
                for (const su of subunitsOf(zoneKey)) next[su.key] = 0
                return next
              })
            }
            onResetAll={() => setSubunitValues(emptySubunits())}
            onHighlight={setHighlight}
          />
        </aside>

        {/* ---------------- 中栏：画布 ---------------- */}
        <section className="col-center">
          <div className="toolbar">
            <div className="seg">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  className={view === v.key ? 'active' : ''}
                  disabled={!points}
                  onClick={() => setView(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className="seg">
              {OVERLAYS.map((o) => (
                <button
                  key={o.key}
                  className={overlay === o.key ? 'active' : ''}
                  disabled={!points}
                  onClick={() => setOverlay(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="canvas-duo">
            <div
              className="canvas-box card"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
            >
              <span className="pane-tag">原始</span>
              <FaceCanvas
                imageSrc={imageSrc}
                points={displayPoints}
                srcPoints={srcFull}
                overlay={overlay}
                view={view}
                metrics={metrics}
                selectedPoint={selectedPoint}
                interactive={!!points && view !== 'reference'}
                onPointSelect={handlePointSelect}
                onPointDrag={handlePointDrag}
                triangles={triangles}
                customCount={customPoints.length}
                addMode={addMode}
                onAddPoint={addCustomPoint}
                showWarp={false}
                highlight={highlight}
                siteMarkers={siteMarkers}
                frameAnchors={frameAnchors}
                showAnchors={showAnchors && view !== 'reference'}
                onAnchorDrag={dragAnchor}
                onAnchorSelect={setActiveAnchor}
                activeAnchor={activeAnchor}
              />
            </div>

            {/* 预览区：常驻显示形变后的照片。点位/滑块一变，这里立即重绘，无需切视图 */}
            <div className="canvas-box card">
              <span className="pane-tag accent">调整后预览</span>
              <FaceCanvas
                imageSrc={imageSrc}
                points={previewPoints}
                srcPoints={srcFull}
                overlay="none"
                view="adjustment"
                showWarp
                maxEdge={900}
                triangles={triangles}
                customCount={0}
                emptyTitle="调整后预览"
                emptyHint="上传照片后，这里实时显示调整效果"
              />
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="banner warn">
              {warnings.map((w, i) => (
                <span key={i}>{w.text}</span>
              ))}
            </div>
          )}
        </section>

        {/* ---------------- 右栏：指标与处方 ---------------- */}
        <aside className="col-right">
          <div className="card">
            <h2 className="card-title">综合评分</h2>
            {analysis && analysis.score ? (
              <>
                <div className="score-total">
                  <span className="score-num">{analysis.score.total}</span>
                  <span className="score-grade">{analysis.score.grade}</span>
                </div>
                <div className="score-items">
                  {Object.entries(analysis.score.items).map(([k, v]) => (
                    <div className="score-item" key={k}>
                      <span className="si-key">
                        {{
                          three: '三庭',
                          five: '五眼',
                          symmetry: '对称',
                          golden: '黄金分割',
                          balance: '视觉重心',
                        }[k]}
                      </span>
                      <div className="si-bar">
                        <div className="si-bar-fill" style={{ width: `${v}%` }} />
                      </div>
                      <span className="si-val">{v}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="dim">暂无数据</p>
            )}
          </div>

          <div className="card">
            <h2 className="card-title">几何指标</h2>
            {metrics && metrics.valid ? (
              <table className="metrics">
                <tbody>
                  <tr>
                    <td>上庭</td>
                    <td>{(metrics.three.upper * 100).toFixed(1)}% *</td>
                    <td className="dim">≈33.3%</td>
                  </tr>
                  <tr>
                    <td>中庭</td>
                    <td>{(metrics.three.middle * 100).toFixed(1)}%</td>
                    <td className="dim">≈33.3%</td>
                  </tr>
                  <tr>
                    <td>下庭</td>
                    <td>{(metrics.three.lower * 100).toFixed(1)}%</td>
                    <td className="dim">≈33.3%</td>
                  </tr>
                  <tr>
                    <td>五眼偏差</td>
                    <td>{(metrics.five.deviation * 100).toFixed(1)}%</td>
                    <td className="dim">0%</td>
                  </tr>
                  <tr>
                    <td>对称偏差</td>
                    <td>{metrics.symmetry.toFixed(1)}%</td>
                    <td className="dim">0%</td>
                  </tr>
                  <tr>
                    <td>黄金分割</td>
                    <td>{metrics.golden.toFixed(3)}</td>
                    <td className="dim">0.618</td>
                  </tr>
                  <tr>
                    <td>视觉重心</td>
                    <td>{metrics.balance.toFixed(3)}</td>
                    <td className="dim">0.550</td>
                  </tr>
                  <tr>
                    <td>置信度</td>
                    <td>{(metrics.confidence * 100).toFixed(1)}%</td>
                    <td className="dim">—</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="dim">无法测量</p>
            )}
            <p className="note">* 上庭基于发际线估算，非实测值。</p>
          </div>

          {/* ---------------- 调整对比 ---------------- */}
          <div className="card">
            <h2 className="card-title">调整对比</h2>
            {metrics && metrics.valid && adjustedMetrics && adjustedMetrics.valid ? (
              <>
                <table className="metrics compare">
                  <thead>
                    <tr>
                      <th>指标</th>
                      <th>原始</th>
                      <th>调整后</th>
                      <th>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE_ROWS.map((r) => {
                      const a = r.get(metrics)
                      const b = r.get(adjustedMetrics)
                      const okA = Number.isFinite(a)
                      const okB = Number.isFinite(b)
                      const d = okA && okB ? b - a : NaN
                      // 偏离理想值变小 = 改善
                      const dir =
                        !Number.isFinite(d) || Math.abs(d) < r.eps
                          ? 'flat'
                          : Math.abs(b - r.ideal) < Math.abs(a - r.ideal)
                            ? 'better'
                            : 'worse'
                      return (
                        <tr key={r.key}>
                          <td>{r.label}</td>
                          <td className="dim">{okA ? r.fmt(a) : '—'}</td>
                          <td>{okB ? r.fmt(b) : '—'}</td>
                          <td className={`delta ${dir}`}>
                            {Number.isFinite(d) && Math.abs(d) >= r.eps ? r.dfmt(d) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="row-score">
                      <td>综合评分</td>
                      <td className="dim">{analysis?.score?.total ?? '—'}</td>
                      <td>{adjustedScore?.total ?? '—'}</td>
                      <td
                        className={`delta ${
                          scoreDiff > 0 ? 'better' : scoreDiff < 0 ? 'worse' : 'flat'
                        }`}
                      >
                        {scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff < 0 ? `${scoreDiff}` : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="note">
                  调整后指标基于形变后的关键点<strong>重新测量</strong>得出。
                  <span className="delta better">绿色</span>为更接近理想值，
                  <span className="delta worse">红色</span>为偏离更多。
                </p>
              </>
            ) : (
              <p className="dim">暂无数据</p>
            )}
          </div>

          {/* ---------------- 调整记录 ---------------- */}
          <div className="card">
            <h2 className="card-title">调整记录</h2>
            <button
              className="btn-ghost"
              disabled={!points || !(adjustedMetrics && adjustedMetrics.valid)}
              onClick={saveSnapshot}
            >
              记录当前状态
            </button>
            {history.length > 0 ? (
              <ul className="history">
                {history.map((it, i) => (
                  <li key={it.id}>
                    <div className="hist-head">
                      <span className="hist-idx">#{history.length - i}</span>
                      <span className="hist-time">{it.time}</span>
                      {it.score && (
                        <span className="hist-score">
                          {it.score.total} · {it.score.grade}
                        </span>
                      )}
                    </div>
                    <div className="hist-sum">{snapshotSummary(it, metrics)}</div>
                    <div className="hist-actions">
                      <button onClick={() => restoreSnapshot(it)}>恢复</button>
                      <button onClick={() => removeSnapshot(it.id)}>删除</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="note">
                暂无记录。调好一组参数后点「记录当前状态」保存快照，可随时恢复对比。
              </p>
            )}
          </div>

          <PlanPanel
            plan={plan}
            disabled={!points}
            gender={gender}
            ipdMm={ipdMm}
            onGender={setGender}
            onIpdMm={setIpdMm}
            onExportImage={exportComparison}
          />

          <div className="card">
            <h2 className="card-title">处方建议</h2>
            {analysis && analysis.advice.length > 0 ? (
              <ul className="advice">
                {analysis.advice.map((a, i) => (
                  <li key={i} className={`advice-${a.priority}`}>
                    <div className="advice-head">
                      <span className="advice-target">{a.target}</span>
                      <span className={`tag tag-${a.priority}`}>
                        {a.priority === 'high' ? '高' : a.priority === 'mid' ? '中' : '低'}
                      </span>
                    </div>
                    <div className="advice-action">{a.action}</div>
                    <div className="advice-reason">{a.reason}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dim">暂无数据</p>
            )}
          </div>

          {analysis && analysis.copy && (
            <div className="card">
              <h2 className="card-title">分析文案</h2>
              <p className="copy">{analysis.copy}</p>
            </div>
          )}
        </aside>
      </main>

      <footer className="disclaimer">
        本工具仅提供面部几何特征的可视化测量，不构成任何医疗、美容或整形建议。
      </footer>
    </div>
  )
}
