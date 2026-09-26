/**
 * 构建期工具：由标准 68 点人脸模板预计算 Delaunay 三角剖分，固化到 src/triangles.js
 * 运行：node scripts/gen-triangles.mjs
 *
 * 说明：三角剖分只依赖点集拓扑，不依赖具体人脸，因此用一份标准对称模板计算一次后固化即可。
 */

// ---- 1. 标准 68 点模板（归一化坐标系：x 向右，y 向下，中心 x=50）----
const CX = 50
const M = (x, y) => [CX + x, y]

function buildTemplate() {
  const pts = new Array(68)

  // 0-16 下颌轮廓：从左耳侧绕下巴尖到右耳侧的半椭圆
  // 注意：0/16 位于耳根高度（约与鼻尖持平），而非额头高度
  const R = 48
  const Y_TOP = 52
  const H_JAW = 53
  for (let i = 0; i <= 16; i++) {
    const theta = (Math.PI * i) / 16
    pts[i] = M(-R * Math.cos(theta), Y_TOP + H_JAW * Math.sin(theta))
  }

  // 17-21 右眉（图像左侧）：17=眉梢（外侧）→21=眉头（内侧）
  const browR = [
    [-38, 40], [-33, 33], [-27, 30], [-20, 32], [-12, 36],
  ]
  // 22-26 左眉（图像右侧）：22=眉头（内侧）→26=眉梢（外侧）
  const browL = [
    [12, 36], [20, 32], [27, 30], [33, 33], [38, 40],
  ]
  for (let i = 0; i < 5; i++) pts[17 + i] = M(...browR[i])
  for (let i = 0; i < 5; i++) pts[22 + i] = M(...browL[i])

  pts[27] = M(0, 38) // 眉心

  // 28-30 鼻梁（30=鼻尖）
  pts[28] = M(0, 48)
  pts[29] = M(0, 57)
  pts[30] = M(0, 66)

  // 31-35 鼻翼下缘（33=鼻中隔下点）
  pts[31] = M(-6, 72)
  pts[32] = M(-11, 74)
  pts[33] = M(0, 76)
  pts[34] = M(11, 74)
  pts[35] = M(6, 72)

  // 36-41 右眼：36=外眦, 39=内眦
  const eyeR = [
    [-30, 52], [-24, 46], [-18, 47], [-12, 52], [-18, 57], [-24, 57],
  ]
  // 42-47 左眼：42=内眦, 45=外眦
  const eyeL = [
    [12, 52], [18, 47], [24, 46], [30, 52], [24, 57], [18, 57],
  ]
  for (let i = 0; i < 6; i++) pts[36 + i] = M(...eyeR[i])
  for (let i = 0; i < 6; i++) pts[42 + i] = M(...eyeL[i])

  // 48-59 外唇：48/54=口角, 51=上唇中点, 57=下唇中点
  const lipOut = [
    [-20, 88], [-13, 85], [-6, 84], [0, 85], [6, 84], [13, 85],
    [20, 88], [13, 93], [6, 95], [0, 96], [-6, 95], [-13, 93],
  ]
  for (let i = 0; i < 12; i++) pts[48 + i] = M(...lipOut[i])

  // 60-67 内唇
  const lipIn = [
    [-13, 88], [-6, 87], [0, 87.5], [6, 87], [13, 88], [6, 91], [0, 91.5], [-6, 91],
  ]
  for (let i = 0; i < 8; i++) pts[60 + i] = M(...lipIn[i])

  return pts
}

// ---- 1b. 追加外围锚点（68 → 76）----
// 复用运行时同源公式，保证构建期剖分与运行时点集拓扑完全一致。
const { buildAnchors, FULL_COUNT } = await import('../src/anchors.js')

// ---- 2. 剖分（复用运行时同源算法 src/delaunay.js）----
const { delaunayTriangles } = await import('../src/delaunay.js')

const template68 = buildTemplate()
const anchors = buildAnchors(template68.map(([x, y]) => ({ x, y })))
const pts = template68
  .map(([x, y]) => ({ x, y }))
  .concat(anchors.map((a) => ({ x: a.x, y: a.y })))
const tris = delaunayTriangles(pts)

// ---- 3. 输出 src/triangles.js ----
const body = tris.map((t) => `  [${t.join(', ')}],`).join('\n')
const out = `/**
 * ${FULL_COUNT} 点 Delaunay 三角剖分索引表（构建期由 scripts/gen-triangles.mjs 预计算固化）
 * 共 ${tris.length} 个三角形。索引 0–67 为 68 关键点，68–75 为外围锚点（见 anchors.js）。
 * 索引含义见《开发文档》第 4 章 68 点索引规范。
 *
 * 为什么含锚点：68 点最上只到眉毛，若只剖分 68 点则额头落在网格之外，
 * 额头类形变无法作用于照片。锚点围出包裹额头的外轮廓，使纹理映射覆盖整脸。
 *
 * ⚠️ 本文件为生成产物，请勿手工编辑；如需重新生成请运行：node scripts/gen-triangles.mjs
 */
export const TRIANGLES = [
${body}
]
`
const { writeFileSync, mkdirSync } = await import('node:fs')
mkdirSync(new URL('../src/', import.meta.url), { recursive: true })
writeFileSync(new URL('../src/triangles.js', import.meta.url), out, 'utf8')
console.log(`生成完成：${tris.length} 个三角形 -> src/triangles.js`)
