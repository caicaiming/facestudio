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
  frameFaceWidth,
  frameOf,
} from './frame.js'
import { delaunayTriangles } from './delaunay.js'
import { TRIANGLES } from './triangles.js'
import { POINT_GROUPS, POINT_NAMES, POINT_OFFSET_RANGE, pointLabel } from './pointMeta.js'
import { applySubunitOffsets, emptySubunits, subunitsOf } from './subunits.js'
import {
  applySiteDepthOffsets,
  applySiteOffsets,
  earAnchorOffsets,
  emptySites,
  siteAnchors,
  sitesOf,
} from './zones.js'
import { buildPlan, fmtMm, mmScale, pxToMm, sliderAmplitudeMm } from './aesthetic.js'
import { reliefOf } from './relief.js'
import {
  DETECT_MAX_EDGE,
  detectScale,
  mapPointsBack,
  mapBoxBack,
} from './detect.js'
import ZonePanel from './ZonePanel.jsx'
import PlanPanel from './PlanPanel.jsx'
import AnnSection from './AnnSection.jsx'
import AnnotateBar from './AnnotateBar.jsx'
import LayerPanel from './LayerPanel.jsx'
import MaterialPanel from './MaterialPanel.jsx'
import PhrasePanel from './PhrasePanel.jsx'
import {
  MAT_INIT_RATIO,
  defaultAnnStyle,
  drawStack,
  layerBox,
  makeMaterial,
  makeText,
  rotateLayer,
  scaleLayer,
  translateLayer,
} from './annotations.js'
import {
  MATERIALS,
  MAT_IMG_CACHE,
  ensureMaterial,
  materialReady,
  materialUrl,
} from './materials.js'
import { loadCustomPhrases, saveCustomPhrases } from './phrases.js'
import { fitPanels, loadPanels, savePanels } from './annPanels.js'
import {
  MARKER_SCALE_MAX,
  MARKER_SCALE_MIN,
  defaultLayerState,
  flattenStack,
  isLayerOn,
  layerAlpha,
  layerMarkerScale,
  loadLayerState,
  moveContent,
  moveMarker,
  overlayOf,
  overlayPreset,
  patchLayer,
  saveLayerState,
  toggleLayer,
} from './layers.js'

/**
 * 模型权重目录。
 *
 * 必须跟随部署 base 走，不能硬编码 '/models'：GitHub Pages 部署在子路径
 * `https://<user>.github.io/<repo>/` 下，绝对路径会请求到站点根域而 404。
 * `import.meta.env.BASE_URL` 由 Vite 在构建期按 `base` 静态替换
 * （dev 为 '/'、相对 base 为 './'、子路径 base 为 '/<repo>/'），三种场景都成立。
 */
const MODEL_URL = `${import.meta.env.BASE_URL}models`

/** 自定义控制点位移范围（图片自然像素） */
const CUSTOM_OFFSET_RANGE = 60

/** 标注撤销栈深度：标注数量本就不多，30 步足够覆盖一次沟通的全部改动 */
const ANN_UNDO_MAX = 30

/** 加点时与已有点的最小间距（相对图片宽度），避免产生退化三角形 */
const MIN_POINT_GAP_RATIO = 0.012

const VIEWS = [
  { key: 'detection', label: '检测' },
  { key: 'adjustment', label: '调整' },
  { key: 'reference', label: '对照' },
]

/**
 * 叠加预设：只是「一次打开一组图层」的快捷方式，不再是独立状态。
 * 真正的状态在图层栈里（layerState），面板里单独改动后这里就不高亮了。
 */
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

/**
 * 把图片按 scale 画到离屏 canvas，供检测使用。
 *
 * 走 canvas 而不是直接缩放 img 元素：canvas 的 drawImage 用的是高质量
 * 重采样，比检测器内部那次「一步缩到 416」的双线性保真得多 ——
 * 这正是大图点位走形的根因（见 detect.js 顶部说明）。
 */
function downscaleToCanvas(img, scale) {
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale))
  cv.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale))
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, cv.width, cv.height)
  return cv
}

export default function App() {
  const [phase, setPhase] = useState('loading-model')
  const [imageSrc, setImageSrc] = useState(null)
  const [points, setPoints] = useState(null)
  /** 检测器原始点位：基准点校准的还原基准，重置时回到这里 */
  const [rawPoints, setRawPoints] = useState(null)
  const [activeAnchor, setActiveAnchor] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [params, setParams] = useState(DEFAULT_PARAMS)
  // 68 个关键点的逐点位移（自然像素），与 5 路预设滑块相互独立
  const [pointOffsets, setPointOffsets] = useState(emptyOffsets)
  // 面部亚单位档位（−15…＋15），按美学分区的局部精细形变，独立于滑块与逐点位移
  const [subunitValues, setSubunitValues] = useState(emptySubunits)
  // 医美部位档位（−15…＋15）：＋ 填充 / 外扩，− 收紧 / 内收
  const [siteValues, setSiteValues] = useState(emptySites)
  /**
   * 医美部位的【凹凸】档位（第三个自由度）。
   * 与 siteValues（平面位移）分开存：一个是轮廓往哪挪，一个是鼓起来还是瘪下去，
   * 语义完全不同，混在一个数里就没法分别调、也没法分别讲给顾客听。
   */
  const [siteDepths, setSiteDepths] = useState(emptySites)
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
  // ---- 标注（画线 / 文字 / 素材）----
  const [annOn, setAnnOn] = useState(false)
  const [annTool, setAnnTool] = useState('arrow')
  const [annStyle, setAnnStyle] = useState(defaultAnnStyle)
  /** 图层栈：数组序即 z 序，末尾 = 最上层。坐标一律为图片自然像素 */
  const [annLayers, setAnnLayers] = useState([])
  /**
   * 图层面板里当前选中的行：内容层是它的 id，系统层是 'sys:<key>'。
   * 用同一个 state 是因为「选中的是哪一个图层」本来就只有一个答案 ——
   * 分成两个状态会让「点了系统层，画线还在选中」这种鬼影状态出现。
   */
  const [layerSel, setLayerSel] = useState(null)
  /**
   * 统一图层栈（见 layers.js）：系统层的可见性 / 锁定 / 不透明度 / 标记大小 / 层序。
   * 跨会话记忆 —— 咨询师每次打开都在讲同一类方案，没必要重设一遍。
   */
  const [layerState, setLayerState] = useState(loadLayerState)
  useEffect(() => saveLayerState(layerState), [layerState])
  /**
   * 基准点显示与否只有一个事实来源：图层栈的 anchors 层。
   * 此前这里是一个独立的 useState，与图层面板的眼睛互不知道对方存在 ——
   * 点了左栏「隐藏基准点」，图层面板的眼睛还亮着；在面板里点眼睛也救不回来，
   * 表现就是「基准点不见了，怎么点都点不回来」。Stage 31 补记收编进图层栈。
   * （必须声明在 layerState 之后 —— memo/派生值的 TDZ 教训见开发历程 Stage 31。）
   */
  const showAnchors = isLayerOn(layerState, 'anchors')
  /** 四个标注板块各自的折叠状态：默认只开「工具」，其余按需展开，不白占画面高度 */
  const [annFold, setAnnFold] = useState({ tools: false, materials: true, layers: true, phrases: true })
  const toggleAnnFold = useCallback((k) => setAnnFold((f) => ({ ...f, [k]: !f[k] })), [])
  /**
   * 四个面板的浮窗状态：是否浮出 + 位置尺寸（跨会话记忆）。
   * 侧栏宽度是固定的，素材缩略图 / 话术列表挤在里面看不清也翻不动 ——
   * 浮出来自己调大小，比加宽侧栏挤画布划算。
   */
  const [annPanels, setAnnPanels] = useState(() => loadPanels())
  const setPanelWin = useCallback((k, patch) => {
    setAnnPanels((p) => ({ ...p, [k]: { ...p[k], ...patch } }))
  }, [])
  const togglePanelFloat = useCallback((k) => {
    setAnnPanels((p) => ({ ...p, [k]: { ...p[k], float: !p[k].float } }))
    // 浮出的同时把折叠打开，免得收回侧栏后是个收起状态
    setAnnFold((f) => (f[k] ? { ...f, [k]: false } : f))
  }, [])
  /** 专注模式：隐藏左右栏，画布占满 —— 小屏下照片才有得看 */
  const [focus, setFocus] = useState(false)
  /** 右栏「插入话术标注」的弹层入口（板块内的话术库是常驻的，不走弹层） */
  const [phrasesOpen, setPhrasesOpen] = useState(false)
  const [customPhrases, setCustomPhrases] = useState(() => loadCustomPhrases())
  // 撤销 / 重做：整栈快照。标注栈通常只有十几层，快照比逐操作回放省心
  const [annPast, setAnnPast] = useState([])
  const [annFuture, setAnnFuture] = useState([])
  /** 供只绑定一次的键盘回调读取最新值 */
  const annLayersRef = useRef(annLayers)
  annLayersRef.current = annLayers
  // 检测元数据：用于基于形变后点位重新测量「调整后指标」
  const [base, setBase] = useState(null)
  // 调整记录快照
  const [history, setHistory] = useState([])
  /**
   * 叠加预设（工具栏那排 seg）由图层栈反推 —— 不再单独存一份状态，
   * 否则「面板里改了、按钮还亮着」这种两套真相的 bug 迟早出现。
   */
  const overlayKey = overlayOf(layerState)
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
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
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
        /**
         * 大图先降采样再检测（见 detect.js）。
         *
         * 直接把 4000px 级的原图喂给检测器，框会明显走形、点位挤成一团
         * （实测放大 3× 后平均偏差 78px）。先缩到最长边 ≤ DETECT_MAX_EDGE，
         * 检测结果再按同一系数还原到原图坐标，尺寸无关性就回来了。
         *
         * 降采样后万一没检出（小脸被缩没了），退回原图再试一次 ——
         * 宁可多跑一次检测，也不要误报「未检测到人脸」。
         */
        const s = detectScale(img.naturalWidth, img.naturalHeight, DETECT_MAX_EDGE)
        const input = s < 1 ? downscaleToCanvas(img, s) : img
        const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416 })
        let det = await faceapi.detectSingleFace(input, opts).withFaceLandmarks()
        let usedScale = s
        if (!det && s < 1) {
          det = await faceapi.detectSingleFace(img, opts).withFaceLandmarks()
          usedScale = 1
        }

        if (!det) {
          setImageSrc(url)
          setRawPoints(null)
          setPoints(null)
          setMetrics(null)
          setPhase('error')
          setError({ code: 'NO_FACE', message: ERROR_TEXT.NO_FACE })
          return
        }

        // 点位与检测框都在「检测用图」坐标系里，统一还原到原图坐标
        const pts = mapPointsBack(
          det.landmarks.positions.map((p) => ({ x: p.x, y: p.y })),
          usedScale,
        )
        if (pts.length !== 68) {
          setImageSrc(url)
          setRawPoints(null)
          setPoints(null)
          setMetrics(null)
          setPhase('error')
          setError({ code: 'INVALID_LANDMARKS', message: ERROR_TEXT.INVALID_LANDMARKS })
          return
        }

        const b = mapBoxBack(det.detection.box, usedScale)
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
        // 标注钉在原图的自然像素上，换图即失效，一并清空（含撤销栈）
        setAnnLayers([])
        setLayerSel(null)
        setAnnPast([])
        setAnnFuture([])
        resetAutoTune()
        setView('detection')
        // 换图不清用户的图层设置，只兜底一种情况：四个叠加层全关着时
        // 新照片上什么都没有，看着像坏了 —— 那就替他开回网格。
        setLayerState((st) => (overlayOf(st) === 'none' ? overlayPreset(st, 'mesh') : st))
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
   *
   * 点位手动位移走 useDeferredValue（低优先级）：拖点每帧 setState 会连带
   * 预览区 warp 全图重贴图（最贵的一环）+ 右栏指标重算，同步做就是拖动
   * 跳帧的根源。deferred 让 React 优先保障主图点位跟手，预览与指标以并发
   * 节奏跟进 —— 主观感受从「跳帧卡顿」变成「预览稍滞后但顺滑」。
   */
  const deferredOffsets = useDeferredValue(pointOffsets)
  const deferredCustom = useDeferredValue(customPoints)
  // 凹凸同样降为低优先级：它同时要重算高度场（影响光影层）与指标
  const deferredSiteDepths = useDeferredValue(siteDepths)
  const previewPoints = useMemo(() => {
    if (!points) return null
    // 形变五层叠加：5 路预设滑块 → 亚单位局部形变 → 医美部位位移 →
    //               医美部位凹凸（顺手撑一点轮廓）→ 逐点手动位移
    // 医美部位作用在【虚拟控制点】上（额头/太阳穴/苹果肌等 68 点未覆盖处），
    // 位置由规范坐标系外推，故换任何一张脸都落在同一解剖位置。
    const d = applyPointOffsets(
      applySiteDepthOffsets(
        applySiteOffsets(
          applySubunitOffsets(getDeformedPoints(points, params), subunitValues),
          siteValues,
          { hairlineY: base?.hairlineY },
        ),
        deferredSiteDepths,
        { hairlineY: base?.hairlineY },
      ),
      deferredOffsets,
    )
    // 锚点软跟随：减小大形变时侧面三角形的剪切，避免发丝纹理拉成条纹
    // 耳部档位额外推动外缘锚点 —— 68 点在耳区没有点，不动锚点就看不到变化
    const anchorsD = earAnchorOffsets(points, displaceAnchors(anchors, points, d), siteValues, {
      hairlineY: base?.hairlineY,
    })
    if (deferredCustom.length === 0) return d.concat(anchorsD)
    // 自定义点：先跟随邻近关键点的整体形变（IDW），再叠加用户手动位移。
    // 只跟随不手动位移时，它表现为「局部锚定」；拖它则做局部推拉。
    const customD = displaceByIDW(
      deferredCustom.map((c) => ({ x: c.x, y: c.y })),
      points,
      d,
    ).map((p, i) => ({ x: p.x + deferredCustom[i].dx, y: p.y + deferredCustom[i].dy }))
    return d.concat(anchorsD, customD)
  }, [
    points,
    params,
    subunitValues,
    siteValues,
    deferredSiteDepths,
    deferredOffsets,
    deferredCustom,
    anchors,
    base,
  ])

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
  /**
   * 导出前把用到的素材图都等解码完。
   *
   * 素材是异步解码的 PNG，直接导出会画出一层空 —— 而导出是一次性动作，
   * 用户不会察觉「少画了一层」，只会拿到一张缺东西的图。3 秒兜底：
   * 宁可少一层也不要卡死导出。
   */
  const waitMaterials = () =>
    new Promise((resolve) => {
      const pending = [
        ...new Set(
          annLayersRef.current.filter((l) => l.kind === 'material' && !materialReady(l.src)).map((l) => l.src),
        ),
      ]
      if (!pending.length) return resolve()
      let left = pending.length
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      for (const s of pending) ensureMaterial(s, () => (--left <= 0 ? finish() : undefined))
      window.setTimeout(finish, 3000)
    })

  /**
   * 凹凸光影的部位控制点（图像像素坐标）。
   * 光影是对着【形变后】的脸画的，故用 previewPoints，且跟随点位一起更新。
   * 在 App 里算一次，主图与导出共用 —— 两处各算一遍还得保证对得上，没必要。
   * ⚠️ 必须声明在导出函数之前：依赖数组会在渲染时求值，声明靠后就是 TDZ。
   */
  const reliefAnchors = useMemo(() => {
    if (!previewPoints) return null
    return siteAnchors(previewPoints.slice(0, 68), null, null)
  }, [previewPoints])
  /** 面宽（图像像素）：凹凸的半径与高度都按它归一，导出合成也要用 */
  const faceWidthPx = useMemo(() => {
    if (!previewPoints) return 0
    return frameFaceWidth(previewPoints.slice(0, 68), frameOf(previewPoints.slice(0, 68)))
  }, [previewPoints])

  /**
   * 把标注层画到导出画布上。
   *
   * k0 取「自然宽 ÷ 屏幕布局宽」—— 与画布上的算法完全一致（见
   * FaceCanvas 的 annK0），所以导出图里的线宽、字号与屏幕上看到的一致。
   * 标注坐标本来就是自然像素，左右两幅直接复用同一份栈。
   */
  const stampAnnotations = (ctx, w, h, dx, dispW) => {
        const layers = annLayersRef.current
        if (!layers.length) return
        const k0 = dispW > 0 ? w / dispW : 1
        ctx.save()
        ctx.translate(dx, 0)
        // 隐藏的层不进导出图 —— 屏幕上看不见，导出里冒出来就是惊吓
        drawStack(ctx, layers.filter((it) => it.visible !== false), k0, MAT_IMG_CACHE)
        ctx.restore()
  }

  /**
   * 把凹凸光影合成到导出画布。
   *
   * 屏幕上靠 CSS `mix-blend-mode: soft-light` 混合，导出是纯 canvas，没有 CSS ——
   * 这里用 `globalCompositeOperation` 达成同一效果，保证发给顾客的图
   * 与当面演示的观感一致（不然「屏幕上明明看得出饱满感，图里却平了」）。
   */
  const stampRelief = (ctx, warpCanvas, dx, w, h) => {
    if (!reliefAnchors || !warpCanvas?.width || !faceWidthPx) return
    const sh = reliefOf(reliefAnchors, siteDepths, {
      w: warpCanvas.width,
      h: warpCanvas.height,
      W: faceWidthPx,
      // warp 画布是降采样过的，光影网格按它的坐标系算，再一起拉伸
      k: warpCanvas.width / w,
    })
    if (!sh) return
    const buf = document.createElement('canvas')
    buf.width = sh.gw
    buf.height = sh.gh
    buf.getContext('2d').putImageData(new ImageData(sh.data, sh.gw, sh.gh), 0, 0)
    ctx.save()
    ctx.globalCompositeOperation = 'soft-light'
    ctx.globalAlpha = layerAlpha(layerState, 'relief')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(buf, dx, 0, w, h)
    ctx.restore()
  }

  const exportComparison = useCallback(async () => {
    const wraps = document.querySelectorAll('.canvas-duo .canvas-wrap')
    if (wraps.length < 2) return false
    const img = wraps[0]?.querySelector('img')
    const warp = wraps[1]?.querySelector('canvas.warp')
    const w = img?.naturalWidth || 0
    const h = img?.naturalHeight || 0
    if (!w || !h || !warp || !warp.width) return false

    await waitMaterials()

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
    // 凹凸光影只盖右侧（术后）：屏幕上看到的光影，导出图里也必须有，
    // 否则发给顾客的图和当面演示的不是一个东西
    stampRelief(ctx, warp, w + gap, w, h)
    // 标注同时盖在两侧：它是针对这张照片画的，术前术后都该看得见
    const dispW = img.clientWidth || 0
    stampAnnotations(ctx, w, h, 0, dispW)
    stampAnnotations(ctx, w, h, w + gap, dispW)

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
    // stampRelief 要读最新的凹凸档位与图层不透明度，故这几项必须在依赖里
  }, [stampRelief, reliefAnchors, siteDepths, layerState, faceWidthPx])

  /** 只导出原始照片 + 标注（不拼对比图）：给顾客发「问题标注图」时用 */
  const exportAnnotated = useCallback(async () => {
    const wrap = document.querySelector('.canvas-duo .canvas-wrap')
    const img = wrap?.querySelector('img')
    const w = img?.naturalWidth || 0
    const h = img?.naturalHeight || 0
    if (!w || !h) return false

    await waitMaterials()

    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const ctx = out.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
    stampAnnotations(ctx, w, h, 0, img.clientWidth || 0)

    const a = document.createElement('a')
    a.href = out.toDataURL('image/png')
    a.download = `面部标注_${new Date().toISOString().slice(0, 10)}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    return true
  }, [])

  // ---------------------------------------------------------------- 标注

  /**
   * 提交新图层栈：先把旧栈压入撤销栈，再写新栈。
   * 读 ref 而非闭包里的 annLayers —— 画布的指针回调不随渲染重建，
   * 用闭包会拿到过期数组，连续画两笔就只剩最后一笔。
   */
  const commitAnn = useCallback((next) => {
    const cur = annLayersRef.current
    const v = typeof next === 'function' ? next(cur) : next
    if (v === cur) return
    setAnnPast((p) => [...p.slice(-(ANN_UNDO_MAX - 1)), cur])
    setAnnFuture([])
    setAnnLayers(v)
  }, [])

  const annAdd = useCallback(
    (item) => {
      commitAnn((cur) => [...cur, item])
      setLayerSel(item.id)
    },
    [commitAnn],
  )

  const annUpdate = useCallback(
    (i, item) => commitAnn((cur) => cur.map((x, k) => (k === i ? item : x))),
    [commitAnn],
  )

  const annErase = useCallback(
    (i) => {
      commitAnn((cur) => cur.filter((_, k) => k !== i))
      setLayerSel(null)
    },
    [commitAnn],
  )

  /**
   * 缩放当前选中层（绕自身中心等比）。
   * 素材 / 箭头 / 框 / 文字 / 画笔走的都是同一套 scaleLayer，区别只在各类别
   * 的「尺寸字段」不同（w/h、arrowH、font、线宽），模型内部已分别处理。
   */
  const scaleSel = useCallback(
    (f) => {
      const layers = annLayersRef.current
      const i = layers.findIndex((x) => x.id === layerSel)
      if (i < 0) return
      const it = layers[i]
      // 锁住的层不允许变形（可见性与浓淡仍可调 —— 那两样不算「动它」）
      if (it.lock) return
      const box = layerBox(it)
      if (box) annUpdate(i, scaleLayer(it, f, f, { x: box.cx, y: box.cy }, box.rot))
    },
    [layerSel, annUpdate],
  )

  /** 旋转当前选中层（素材/框/文字存 rot，线段与画笔把角度烤进坐标） */
  const rotateSel = useCallback(
    (deg) => {
      const layers = annLayersRef.current
      const i = layers.findIndex((x) => x.id === layerSel)
      if (i < 0) return
      if (layers[i].lock) return
      annUpdate(i, rotateLayer(layers[i], deg))
    },
    [layerSel, annUpdate],
  )

  // ---------------------------------------------------------------- 统一图层栈

  /** 面板要展示的栈：系统层与内容层摊平后的单一列表（自下而上） */
  const layerStack = useMemo(() => flattenStack(layerState, annLayers), [layerState, annLayers])

  /** 内容层的补丁：走撤销栈，与画线同一个「改一次记一步」的粒度 */
  const patchContent = useCallback(
    (row, patch) => {
      const cur = annLayersRef.current[row.index]
      if (!cur) return
      annUpdate(row.index, { ...cur, ...patch })
    },
    [annUpdate],
  )

  const layerToggleVisible = useCallback(
    (row) => {
      if (row.sys) setLayerState((st) => patchLayer(st, row.key, { visible: row.visible === false }))
      else patchContent(row, { visible: row.visible === false })
    },
    [patchContent],
  )

  const layerToggleLock = useCallback(
    (row) => {
      if (row.sys) setLayerState((st) => patchLayer(st, row.key, { lock: !row.lock }))
      else patchContent(row, { lock: !row.lock })
    },
    [patchContent],
  )

  const layerMove = useCallback(
    (row, dir) => {
      if (row.sys) setLayerState((st) => moveMarker(st, row.key, dir))
      else commitAnn((cur) => moveContent(cur, row.index, dir))
    },
    [commitAnn],
  )

  const layerRemove = useCallback(
    (row) => {
      if (row.sys) return // 系统层删不得：它是画布的固定组成部分，只能隐藏
      setLayerSel(null)
      annErase(row.index)
    },
    [annErase],
  )

  const layerRename = useCallback(
    (row, name) => {
      if (row.sys) setLayerState((st) => patchLayer(st, row.key, { name }))
      else patchContent(row, { name })
    },
    [patchContent],
  )

  /** 不透明度：素材贴脸挡视线时调淡比挪开省事，标记层同理 */
  const layerAlpha = useCallback(
    (row, a) => {
      const v = Math.min(1, Math.max(0.15, a))
      if (row.sys) setLayerState((st) => patchLayer(st, row.key, { alpha: v }))
      else patchContent(row, { alpha: v })
    },
    [patchContent],
  )

  /** 标记大小：只放大「画出来的标记」，不动点位数据本身 */
  const layerMarker = useCallback((row, dir) => {
    if (!row.sys) return
    setLayerState((st) => {
      const cur = layerMarkerScale(st, row.key)
      const next = Math.min(MARKER_SCALE_MAX, Math.max(MARKER_SCALE_MIN, cur + dir * 0.25))
      return patchLayer(st, row.key, { marker: next })
    })
  }, [])

  const layerReset = useCallback(() => {
    setLayerState(defaultLayerState())
    setLayerSel(null)
  }, [])

  const undoAnn = () => {
    if (annPast.length === 0) return
    const prev = annPast[annPast.length - 1]
    setAnnPast(annPast.slice(0, -1))
    setAnnFuture((f) => [annLayers, ...f])
    setAnnLayers(prev)
  }

  const redoAnn = () => {
    if (annFuture.length === 0) return
    const next = annFuture[0]
    setAnnFuture(annFuture.slice(1))
    setAnnPast((p) => [...p, annLayers])
    setAnnLayers(next)
  }

  const clearAnn = () => {
    commitAnn([])
    setLayerSel(null)
  }

  /** 素材贴到画面中央：高度取画布短边的 60%（与融合工具的出厂值一致） */
  const addMaterial = (m) => {
    // 从素材板块贴素材时可能还没开标注模式，顺手打开，省得用户回头找开关
    setAnnOn(true)
    const w = base?.w || 1000
    const h = base?.h || 1000
    const s = (Math.min(w, h) * MAT_INIT_RATIO) / Math.max(m.w, m.h)
    annAdd(
      makeMaterial(materialUrl(m), m.name, w / 2, h / 2, Math.round(m.w * s), Math.round(m.h * s)),
    )
    setAnnTool('move')
  }

  /**
   * 话术落为文字标注。
   * 多次插入按行错开（第 n 条下移 n×7.5% 图高）—— 都落在同一点会叠成一团，
   * 顾客根本看不清。
   */
  const addPhraseText = (text) => {
    const w = base?.w || 1000
    const h = base?.h || 1000
    const n = annLayersRef.current.filter((l) => l.kind === 'text').length
    setAnnOn(true)
    annAdd(makeText(w * 0.05, h * (0.14 + 0.075 * (n % 10)), text, annStyle))
  }

  const addCustomPhrase = (t) =>
    setCustomPhrases((cur) => (cur.includes(t) ? cur : [...cur, t]))

  const removeCustomPhrase = (t) => setCustomPhrases((cur) => cur.filter((x) => x !== t))

  // 自定义话术持久化
  useEffect(() => {
    saveCustomPhrases(customPhrases)
  }, [customPhrases])

  // 浮窗位置尺寸持久化
  useEffect(() => {
    savePanels(annPanels)
  }, [annPanels])

  // 换显示器 / 转屏后，把跑出视口的浮窗拉回来（不拉就等于面板丢了）
  useEffect(() => {
    let t = 0
    const onResize = () => {
      clearTimeout(t)
      t = setTimeout(() => setAnnPanels((p) => fitPanels(p)), 200)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // 标注模式与加点模式互斥：两者都要「点空白处」，同时开会互相打架
  useEffect(() => {
    if (annOn) setAddMode(false)
  }, [annOn])

  // 标注快捷键：撤销 / 重做 / 删除 / 方向键微调 / 素材缩放旋转
  useEffect(() => {
    if (!annOn) return
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault()
          if (e.shiftKey) redoAnn()
          else undoAnn()
        }
        return
      }
      const layers = annLayersRef.current
      const i = layers.findIndex((x) => x.id === layerSel)
      if (i < 0) return
      const it = layers[i]
      // 锁住的层：删除与位移都不生效（缩放旋转由 scaleSel / rotateSel 自己挡）
      if (it.lock) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        annErase(i)
        return
      }
      const step = Math.max(1, (base?.w || 1000) * 0.002)
      const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (nudge[e.key]) {
        e.preventDefault()
        const [dx, dy] = nudge[e.key]
        annUpdate(i, translateLayer(it, dx, dy))
        return
      }
      // 缩放 / 旋转：任何图层都支持（素材、箭头、框、文字、画笔一视同仁）
      if (e.key === '[' || e.key === ']') {
        e.preventDefault()
        scaleSel(e.key === '[' ? 0.9 : 1 / 0.9)
        return
      }
      if (e.key === ',' || e.key === '.') {
        e.preventDefault()
        rotateSel(e.key === ',' ? -15 : 15)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annOn, layerSel, annPast, annFuture, annLayers, base, scaleSel, rotateSel])

  /** 传给画布的标注状态（预览区不带标注：一份栈只服务一张照片） */
  const ann = useMemo(
    () => ({
      enabled: annOn && !!points,
      tool: annTool,
      style: annStyle,
      layers: annLayers,
      sel: layerSel,
    }),
    [annOn, points, annTool, annStyle, annLayers, layerSel],
  )

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
  /**
   * 凹凸光影的部位控制点（图像像素坐标）。
   * 光影是对着【形变后】的脸画的，故用 previewPoints，且跟随点位一起更新。
   * 在 App 里算一次，主图与导出共用，避免两处各算一遍还对不齐。
   */

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
        overlay: overlayKey,
        layerState,
        customPoints,
        triangles,
        displayPoints,
        previewPoints,
        pointOffsets,
        subunitValues,
        // 凹凸档位：冒烟脚本要验证「调了凹凸确实产生光影」
        siteDepths: deferredSiteDepths,
        // 标注：冒烟脚本要读图层栈验证「画出来的东西确实进了数据」
        ann: { on: annOn, tool: annTool, style: annStyle, layers: annLayers, sel: layerSel },
      }
    }
  }, [
    points,
    metrics,
    params,
    view,
    overlayKey,
    layerState,
    customPoints,
    triangles,
    displayPoints,
    previewPoints,
    pointOffsets,
    subunitValues,
    deferredSiteDepths,
    annOn,
    annTool,
    annStyle,
    annLayers,
    layerSel,
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

      <main className={`layout${focus ? ' focus' : ''}`}>
        {/* ---------------- 左栏：点位调整（整个功能域） ---------------- */}
        <aside className="col-left card">
          <h2 className="group-head">点位调整</h2>
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
                onClick={() => setLayerState((st) => toggleLayer(st, 'anchors'))}
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
                    hint={
                      fmtMm(pxToMm(c[axis], scale))
                        ? `图像像素 · 约 ${fmtMm(pxToMm(c[axis], scale))}`
                        : '图像像素，随照片分辨率变化'
                    }
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
                    // px 只对这张照片成立；换成 mm 才知道实际推了多远
                    hint={
                      fmtMm(pxToMm(o[axis], scale))
                        ? `图像像素 · 约 ${fmtMm(pxToMm(o[axis], scale))}`
                        : '图像像素，随照片分辨率变化'
                    }
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
                拖动时右上角可调灵敏度，默认½阻尼；按住 <kbd>Shift</kbd> 最精细（¼）、按住 <kbd>Alt</kbd> 临时跟手。
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

          {SLIDERS.map((s) => {
            const v = params[s.key] ?? 0
            // 档位是无量纲的，光看数字不知道推了多少；换算成 mm 才有物理感
            const mm = fmtMm(sliderAmplitudeMm(points, s.key, v, scale))
            return (
              <ParamSlider
                key={s.key}
                label={s.label}
                value={v}
                min={s.min}
                max={s.max}
                step={s.step}
                unit="档"
                disabled={!points}
                hint={mm ? `${s.hint} · 峰值位移约 ${mm}` : s.hint}
                onChange={(v2) => {
                  setParams((p) => ({ ...p, [s.key]: v2 }))
                  // 调参即视为要调整，自动切到「调整」视图查看照片形变
                  setView((cur) => (cur === 'adjustment' ? cur : 'adjustment'))
                }}
                onReset={() => setParams((p) => ({ ...p, [s.key]: 0 }))}
              />
            )
          })}
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
            depths={siteDepths}
            points={points}
            scale={scale}
            disabled={!points}
            onChange={(key, v) => {
              setSiteValues((s) => ({ ...s, [key]: v }))
              // 调部位即视为要调整，自动切到「调整」视图查看照片形变
              setView((cur) => (cur === 'adjustment' ? cur : 'adjustment'))
            }}
            onDepthChange={(key, v) => {
              setSiteDepths((s) => ({ ...s, [key]: v }))
              // 凹凸只在形变照上才看得到，同样切到「调整」视图
              setView((cur) => (cur === 'adjustment' ? cur : 'adjustment'))
            }}
            onResetZone={(zoneKey) => {
              // 归零要连凹凸一起归 —— 只清位移、留着凹凸，脸会「鼓着但没挪」
              const keys = sitesOf(zoneKey).map((s) => s.key)
              setSiteValues((s) => {
                const next = { ...s }
                for (const k of keys) next[k] = 0
                return next
              })
              setSiteDepths((s) => {
                const next = { ...s }
                for (const k of keys) next[k] = 0
                return next
              })
            }}
            onResetAll={() => {
              setSiteValues(emptySites())
              setSiteDepths(emptySites())
            }}
            onHighlight={setHighlightSite}
          />

          {/* ---------------- 亚单位精调 ---------------- */}
          {/* 默认折叠：医美部位与亚单位是「局部形变」的两套入口，
              同时展开会把左栏拉到三四屏。需要精细微调时点标题展开。 */}
          <SubunitPanel
            defaultCollapsed
            values={subunitValues}
            points={points}
            scale={scale}
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
            {/* 叠加预设：一次性开一组图层。真正的开关在右栏「图层」面板里 */}
            <div className="seg">
              {OVERLAYS.map((o) => (
                <button
                  key={o.key}
                  className={overlayKey === o.key ? 'active' : ''}
                  disabled={!points}
                  onClick={() => setLayerState((st) => overlayPreset(st, o.key))}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {/* 标注模式：开启后画布的指针事件全部交给标注工具，点位拖动暂停 */}
            <div className="seg">
              <button
                className={annOn ? 'active' : ''}
                disabled={!points}
                onClick={() => setAnnOn((v) => !v)}
                title="在照片上画线、加文字、贴示意图"
              >
                标注
              </button>
            </div>
            {/* 专注模式：小屏下左右栏吃掉太多宽度，照片只剩一小块 */}
            <button
              type="button"
              className={`tool-focus${focus ? ' active' : ''}`}
              onClick={() => setFocus((v) => !v)}
              title={focus ? '退出专注模式（恢复左右栏）' : '专注模式：隐藏左右栏，画布最大化'}
            >
              ⛶ 专注
            </button>
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
                overlay={overlayKey}
                layerState={layerState}
                relief={{ anchors: reliefAnchors, values: deferredSiteDepths }}
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
                mmPerPixel={scale?.ok ? scale.mmPerPixel : 0}
                ann={ann}
                onAnnAdd={annAdd}
                onAnnUpdate={annUpdate}
                onAnnErase={annErase}
                onAnnSelect={setLayerSel}
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
                relief={{ anchors: reliefAnchors, values: deferredSiteDepths }}
                maxEdge={900}
                triangles={triangles}
                customCount={0}
                emptyTitle="调整后预览"
                emptyHint="上传照片后，这里实时显示调整效果"
              />
            </div>
          </div>

          {/* 中栏只留照片本身 —— 标注组曾放在画布下方，实测把画布压矮一大截，
              照片是主角，任何常驻面板都不该抢它的高度（现移入右栏「标注」组）。 */}

          {warnings.length > 0 && (
            <div className="banner warn">
              {warnings.map((w, i) => (
                <span key={i}>{w.text}</span>
              ))}
            </div>
          )}
        </section>

        {/* ---------------- 右栏：标注组 + 指标与处方 ----------------
             按功能域分区：【标注】整组在上，【测量与方案】在下，
             组内各自折叠，一眼看出"哪几块是一伙的"。 */}
        <aside className="col-right">
          <h2 className="group-head ann">标注</h2>
          <div className="card ann-group">
            <section className="ann-board">
              <AnnSection
                title="画线工具"
                badge={annLayers.length ? `${annLayers.length} 层` : null}
                fold={annFold.tools}
                onFold={() => toggleAnnFold('tools')}
                floating={annPanels.tools.float}
                win={annPanels.tools}
                onWin={(patch) => setPanelWin('tools', patch)}
                onFloat={() => togglePanelFloat('tools')}
              >
                {annOn ? (
                  <AnnotateBar
                    tool={annTool}
                    style={annStyle}
                    onTool={setAnnTool}
                    onStyle={setAnnStyle}
                    onUndo={undoAnn}
                    onRedo={redoAnn}
                    onClear={clearAnn}
                    canUndo={annPast.length > 0}
                    canRedo={annFuture.length > 0}
                    count={annLayers.length}
                    onExport={exportAnnotated}
                  />
                ) : (
                  <div className="ann-off">
                    <p className="note">点上方工具条的「标注」即可在照片上画箭头、圈范围、写字。</p>
                    <button type="button" className="btn-accent sm" onClick={() => setAnnOn(true)}>
                      开启标注
                    </button>
                  </div>
                )}
              </AnnSection>

              <AnnSection
                title="素材"
                badge={MATERIALS.length}
                fold={annFold.materials}
                onFold={() => toggleAnnFold('materials')}
                floating={annPanels.materials.float}
                win={annPanels.materials}
                onWin={(patch) => setPanelWin('materials', patch)}
                onFloat={() => togglePanelFloat('materials')}
              >
                <MaterialPanel onPick={addMaterial} />
              </AnnSection>

              <AnnSection
                title="图层"
                badge={annLayers.length || null}
                fold={annFold.layers}
                onFold={() => toggleAnnFold('layers')}
                floating={annPanels.layers.float}
                win={annPanels.layers}
                onWin={(patch) => setPanelWin('layers', patch)}
                onFloat={() => togglePanelFloat('layers')}
              >
                <LayerPanel
                  stack={layerStack}
                  sel={layerSel}
                  onSelect={setLayerSel}
                  onToggleVisible={layerToggleVisible}
                  onToggleLock={layerToggleLock}
                  onMove={layerMove}
                  onRemove={layerRemove}
                  onRename={layerRename}
                  onAlpha={layerAlpha}
                  onMarker={layerMarker}
                  onScale={scaleSel}
                  onRotate={rotateSel}
                  onReset={layerReset}
                />
              </AnnSection>

              <AnnSection
                title="话术库"
                badge="7 类"
                fold={annFold.phrases}
                onFold={() => toggleAnnFold('phrases')}
                floating={annPanels.phrases.float}
                win={annPanels.phrases}
                onWin={(patch) => setPanelWin('phrases', patch)}
                onFloat={() => togglePanelFloat('phrases')}
              >
                <PhrasePanel
                  inline
                  custom={customPhrases}
                  onPick={addPhraseText}
                  onAddCustom={addCustomPhrase}
                  onRemoveCustom={removeCustomPhrase}
                />
              </AnnSection>
            </section>
          </div>

          <h2 className="group-head">测量与方案</h2>
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
              {/* 话术库第二入口：系统文案偏理性，补一句顾客听得懂的落到照片上 */}
              <button
                className="btn-ghost sm"
                disabled={!points}
                onClick={() => setPhrasesOpen(true)}
              >
                插入话术标注
              </button>
            </div>
          )}
        </aside>
      </main>

      {phrasesOpen && (
        <PhrasePanel
          custom={customPhrases}
          onPick={addPhraseText}
          onAddCustom={addCustomPhrase}
          onRemoveCustom={removeCustomPhrase}
          onClose={() => setPhrasesOpen(false)}
        />
      )}

      <footer className="disclaimer">
        本工具仅提供面部几何特征的可视化测量，不构成任何医疗、美容或整形建议。
      </footer>
    </div>
  )
}
