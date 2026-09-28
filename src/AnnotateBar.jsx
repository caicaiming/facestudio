/**
 * AnnotateBar.jsx —— 标注工具条
 *
 * 融合自自研「图片融合」工具的画线能力：画笔 / 直线 / 箭头 / 矩形 / 椭圆 /
 * 文字 / 橡皮 / 移动，外加色板、粗细、透明度与几个形状开关。
 *
 * 两条取舍：
 * - 只显示与当前工具相关的旋钮（选箭头才出箭头大小、选文字才出字号），
 *   否则一排十几个控件在 13px 字号下会挤成一片，找不到要调的那个；
 * - 撤销 / 重做按【整栈快照】做（见 App），不逐笔画回放 —— 标注数量少，
 *   快照最省心，且天然覆盖「删除 / 上下移层 / 换样式」这些非绘制操作。
 */

import { ANN_COLORS, ANN_TOOLS } from './annotations.js'

/** 与形状类工具相关的开关：只在对应工具下出现 */
const TOGGLES = [
  { key: 'dash', label: '虚线', tools: ['pen', 'line', 'arrow', 'rect', 'ellipse'] },
  { key: 'fill', label: '填充', tools: ['rect', 'ellipse'] },
  { key: 'shape', label: '45°吸附', tools: ['line', 'arrow'] },
  { key: 'outline', label: '描边', tools: ['text'] },
  { key: 'bold', label: '加粗', tools: ['text'] },
  { key: 'bg', label: '底衬', tools: ['text'] },
]

export default function AnnotateBar({
  tool,
  style,
  onTool,
  onStyle,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
  count,
  dock,
  onDock,
  onPhrases,
  onExport,
}) {
  const set = (patch) => onStyle({ ...style, ...patch })
  const showToggle = (t) => t.tools.includes(tool)
  const isText = tool === 'text'
  const isArrow = tool === 'arrow'

  return (
    <div className="ann-bar">
      <div className="ann-row">
        <div className="ann-group ann-tools" role="group" aria-label="标注工具">
          {ANN_TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`ann-tool${tool === t.key ? ' active' : ''}`}
              onClick={() => onTool(t.key)}
              title={t.label}
            >
              <span className="ann-tool-icon">{t.icon}</span>
              <span className="ann-tool-label">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="ann-group ann-colors" role="group" aria-label="颜色">
          {ANN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`ann-swatch${style.color === c ? ' active' : ''}`}
              style={{ background: c }}
              onClick={() => set({ color: c })}
              title={c}
              aria-label={`颜色 ${c}`}
            />
          ))}
        </div>
      </div>

      <div className="ann-row">
        <label className="ann-knob">
          <span>{isText ? '字号' : '粗细'}</span>
          <input
            type="range"
            min={isText ? 16 : 2}
            max={isText ? 120 : 40}
            step={1}
            value={isText ? style.font : style.width}
            onChange={(e) => {
              const v = Number(e.target.value)
              set(isText ? { font: v } : { width: v })
            }}
          />
          <b>{isText ? style.font : style.width}</b>
        </label>

        <label className="ann-knob">
          <span>透明度</span>
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={style.alpha}
            onChange={(e) => set({ alpha: Number(e.target.value) })}
          />
          <b>{style.alpha}%</b>
        </label>

        {isArrow && (
          <label className="ann-knob">
            <span>箭头</span>
            <input
              type="range"
              min={10}
              max={60}
              step={2}
              value={style.arrowH}
              onChange={(e) => set({ arrowH: Number(e.target.value) })}
            />
            <b>{style.arrowH}</b>
          </label>
        )}

        {TOGGLES.filter(showToggle).map((t) => (
          <button
            key={t.key}
            type="button"
            className={`ann-chip${style[t.key] ? ' active' : ''}`}
            onClick={() => set({ [t.key]: !style[t.key] })}
          >
            {t.label}
          </button>
        ))}

        <div className="ann-group ann-actions">
          <button type="button" className="ann-chip" disabled={!canUndo} onClick={onUndo} title="撤销（Ctrl+Z）">
            撤销
          </button>
          <button
            type="button"
            className="ann-chip"
            disabled={!canRedo}
            onClick={onRedo}
            title="重做（Ctrl+Shift+Z）"
          >
            重做
          </button>
          <button type="button" className="ann-chip" disabled={!count} onClick={onClear}>
            清空
          </button>
          <span className="ann-count">{count} 层</span>
        </div>

        <div className="ann-group ann-actions">
          <button
            type="button"
            className={`ann-chip${dock === 'layers' ? ' active' : ''}`}
            onClick={() => onDock(dock === 'layers' ? null : 'layers')}
          >
            图层
          </button>
          <button
            type="button"
            className={`ann-chip${dock === 'materials' ? ' active' : ''}`}
            onClick={() => onDock(dock === 'materials' ? null : 'materials')}
          >
            素材
          </button>
          <button type="button" className="ann-chip accent" onClick={onPhrases}>
            话术库
          </button>
          <button
            type="button"
            className="ann-chip"
            disabled={!count}
            onClick={onExport}
            title="导出原始照片 + 标注（不含对比图的右侧）"
          >
            导出标注图
          </button>
        </div>
      </div>

      <p className="ann-hint">
        {tool === 'pen' && '按住拖动自由勾画，适合圈出凹陷区、描下颌线。'}
        {tool === 'line' && '拖动画直线；开「45°吸附」可画出水平 / 垂直 / 对角的标准线。'}
        {tool === 'arrow' && '最常用：指着某个部位给顾客看。尖端落在要讲的那个点上。'}
        {tool === 'rect' && '框出区域（如「苹果肌范围」）；开填充可半透明覆盖。'}
        {tool === 'ellipse' && '圈出圆形区域（如「鼻头」「颧骨高点」）。'}
        {tool === 'text' && '在照片上点一下输入文字；回车确定，Esc 取消。'}
        {tool === 'era' && '点一下删掉整条标注（对象级橡皮，不是擦像素）。'}
        {tool === 'move' && '拖动已有标注挪位置；点空白处拖动画面。'}
        {'　选中后：方向键微调，Delete 删除'}
        {tool === 'move' && '，[ ] 缩放素材、, . 旋转素材'}
      </p>
    </div>
  )
}
