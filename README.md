# Face Studio

浏览器端面部比例分析 Demo。上传正面人脸照 → 自动检测 68 个关键点 → 计算三庭五眼等 5 项几何指标 → 用滑块模拟形变 → 输出量化处方建议。

核心能力：

- **测量**：三庭 / 五眼 / 对称 / 黄金分割 / 视觉重心，规范坐标系跨照片可比；
- **形变模拟**：5 路滑块 + 27 亚单位精调 + 医美部位档位 + 逐点拖动（带灵敏度阻尼）；档位一律标注单位并换算成毫米（按瞳距估算，误差约 ±5%）——「下巴 +8」会告诉你等于推了 3.8mm；
- **目标分数反解**：输入想要的分数，自动算出一组参数；
- **医美方案**：部位 × 项目 × 幅度 × 剂量粗估，毫米标定，一键复制 / 导出对比图；
- **画线标注**：箭头 / 画笔 / 文字 / 矩形椭圆 / 10 张解剖示意素材贴图，导出时合成进对比图；
- **统一图层栈**：照片、形变预览、三角网格、68 点位、三庭五眼、对称线、医美部位、自定义点、基准点与所有标注同列管理 —— 每层都可显隐、锁定、调不透明度、调层序（标记层还能调标记大小），设置跨会话保留；
- **话术库**：7 大类 60 条医美话术 + 自定义，点一下落到照片上。

> ⚠️ 本工具仅提供面部几何特征的可视化测量，**不构成任何医疗、美容或整形建议**。

## 快速启动

```bash
npm install
cp -r node_modules/@vladmandic/face-api/model public/models   # 拷贝模型权重
npm run dev          # http://localhost:5173
```

其他命令：

```bash
npm run build        # 生产构建（输出到 dist/）
npm run preview      # 预览生产构建
npm test             # 纯函数层单元测试
```

## 部署到 GitHub

项目是纯静态站点（构建产物约 3.6MB，含模型权重），有两条在线运行的路：

### 路线 A：GitHub Pages（要一个公开网址）

仓库已带自动部署工作流 `.github/workflows/deploy-pages.yml`：每次推送到 main
自动跑「安装 → 单测 → 构建 → 发布」，全程约 1 分钟。开启只需一次：

1. **仓库必须公开**（Settings → General → 拉到底 Danger Zone → Change visibility
   → Public）。GitHub Pages 对免费账号的私有仓库不可用，升级 Pro 可解锁。
   ⚠️ 确认时 GitHub 要求**手动输入仓库名**（`caicaiming/facestudio`）才允许
   点按钮 —— 只点了下拉没输入名字，可见性不会变。
2. Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。
3. 推送一次（或到 Actions 页手动 Run workflow），完成后访问
   `https://<用户名>.github.io/facestudio/`。

路径适配已做好：`vite.config.js` 用相对 base，模型 URL 走
`import.meta.env.BASE_URL`，仓库改名 / 换自定义域名都不用改代码。

### 部署验证（本地模拟）

上线前可在本地复刻 Pages 的子路径环境做全链路验证：

```bash
npm run build
rm -rf /tmp/pages-sim && mkdir -p /tmp/pages-sim/facestudio && cp -r dist/. /tmp/pages-sim/facestudio/
node scripts/static-server.mjs /tmp/pages-sim 8082   # 另开终端保持运行
node scripts/verify-pages.mjs
```

输出「✅ 子路径部署全链路通过」即为可部署状态。
（别用 `python -m http.server` 代替第一步：Windows 下它把 .js 发成
`text/plain`，浏览器拒绝执行模块脚本，会得到假失败。）

同一个脚本也能直接验**线上站点**（自动放宽等待、容忍公网延迟）：

```bash
VERIFY_BASE=https://<用户名>.github.io/facestudio/ node scripts/verify-pages.mjs
```

线上排查另有 `scripts/diag-online.mjs`：逐条打印模型文件加载、状态文案
时间线与所有 ≥400 的请求，适合「站点开了但功能不对」的场景。

注意两点（2026-09 实测）：
- 公网**首访**有 CDN 冷启动，模型加载可能要 20–30 秒，之后就走缓存了；
  自动化验证务必等「就绪」再上传，否则 face-api 会抛
  `load model before inference` 造成假失败（上传入口在模型就绪前本来就是禁用的）。
- 点位与编号画在 **mesh 层**、overlay 层只承载选中/拖点提示 ——
  校验脚本看的是这两层合并的内容，别只盯 overlay。

## 使用流程

1. 打开页面，等待右上角状态变为**就绪**（首次需加载模型权重）
2. 点击「上传照片」或直接把图片拖入画布区（支持 JPG / PNG，示例照见 `public/sample-face.png`）
3. 切换**视图**（检测 / 调整 / 对照）；「网格 / 点位 / 三庭 / 对称」是叠加**预设**，更细的控制在右栏「图层」面板（每层可单独显隐、锁定、调浓淡与层序）
4. 在左栏拖动 5 路滑块 —— **照片会实时变形**（拖动自动切到「调整」视图；双击滑块归零）
5. **医美模式**：在「医美部位」面板按部位调整（额头 / 太阳穴 / 苹果肌 / 泪沟 / 鼻 / 唇 / 颏 / 咬肌…），＋ 填充、− 收紧，幅度自动换算为毫米
6. 右栏「医美方案」自动生成**方案单**（部位 + 项目 + 幅度 mm + 参考剂量 + 风险等级），支持**导出对比图**、复制方案文本、下载 .txt
7. **放大查看**：画布右上角工具条 —— 「放大镜」开启后圆形窗口跟随鼠标局部放大（2×–6×，滚轮切换），看皮肤细节与点位对齐；`− / 百分比 / ＋` 整图缩放（滚轮同步），放大后**拖空白处平移画面**，拖空白点时可先平移到位再拖
8. **一屏工作台**：整页不滚动 —— 画布恒定在视口内并自动占满可用高度，左中右三栏各自独立滚动；「亚单位精调」等长面板可点标题折叠，面板标题滚动吸顶
9. 其余：右栏综合评分、几何指标、处方建议与分析文案

## 技术要点

| 项 | 说明 |
|---|---|
| 人脸检测 | `@vladmandic/face-api`（兼容 face-api.js API，基于 tfjs 4.x，Vite 下开箱即用） |
| 权重来源 | 随 npm 包分发，**无需外网下载**，离线可用 |
| 代码分割 | face-api 运行时通过动态 `import()` 拆出，应用外壳约 22KB |
| 绘制方案 | Canvas 2D 四图层（原图 / 形变 / 标注 / 网格），非调整视图由 `<img>` 原生渲染 |
| 照片形变 | 三角形仿射纹理映射（`warp.js`）：142 块源纹理预缓存，运行期仅 `setTransform + drawImage`，整脸绘制 <2ms，拖动实时 |
| 网格覆盖 | 68 关键点 + 8 外围锚点（`anchors.js`）共 76 点剖分，网格顶边从眉线扩展到额头上方，额头滑块可作用于照片；锚点软跟随（反距离加权）抑制大形变时的侧面纹理撕裂 |
| 三角剖分 | 构建期由 `scripts/gen-triangles.mjs` 预计算固化为 `src/triangles.js`（142 个三角形）；启用自定义控制点后由 `delaunay.js` 运行时重算 |
| 纯函数层 | `measure.js` / `analyze.js` / `autoTune.js` / `subunits.js` / `frame.js` / `zones.js` / `aesthetic.js` 零 React 依赖，可 `node --test` 单测 |
| 医美部位 | `zones.js`：68 点未覆盖的部位（额头 / 太阳穴 / 苹果肌 / 泪沟…）在**规范坐标系**（原点=两眼中点、单位=眼间距）里用相对锚定公式外推虚拟控制点，跨脸型自适应；高斯衰减局部形变，与亚单位可叠加 |
| 毫米换算 | `aesthetic.js`：以瞳距为天然标尺（女 62 / 男 64 / 默认 63mm，可自定义），档位 ↔ 毫米严格互逆；自动建议只基于可测比例指标，方案强制携带免责声明 |

重新生成三角剖分表：

```bash
node scripts/gen-triangles.mjs
```

## 目录说明

```
src/
├── main.jsx         入口
├── App.jsx          状态机、流程编排、三栏布局
├── FaceCanvas.jsx   双画布四图层绘制（原图 / 形变 / 叠加 / 网格）+ 缩放平移 + 跟随式放大镜
├── ParamSlider.jsx  滑块 + 数值输入双通道控件
├── measure.js       几何测量 + 5 路形变（纯函数）
├── analyze.js       评分、处方、文案（纯函数）
├── autoTune.js      目标分数反解器（坐标下降 + 点位对称位移自由度）
├── subunits.js      面部亚单位精调（九大分区 × 27 亚单位 → 关键点局部形变）
├── SubunitPanel.jsx 亚单位精调面板（−/＋ 步进、悬停高亮、分区折叠）
├── ZonePanel.jsx    医美部位面板（部位 + 项目 + 风险徽标 + 毫米读数）
├── PlanPanel.jsx    医美方案面板（方案单 / 瞳距标定 / 对比图导出）
├── zones.js         医美部位层：规范坐标系虚拟控制点 + 部位级形变（纯函数）
├── aesthetic.js     医美方案层：毫米标定 / 方案生成 / 文本导出（纯函数）
├── anchors.js       8 个外围锚点生成 + IDW 软跟随
├── delaunay.js      Delaunay 剖分（构建期与运行时共用）
├── warp.js          三角形仿射纹理映射（照片形变）
├── hairline.js      像素级发际线估算
├── pointMeta.js     68 点中文名与分组
├── triangles.js     三角剖分索引表（生成产物，勿手工编辑）
└── styles.css       全部样式（暗色主题）
```

文档：

- `开发文档.md` —— 索引规范、算法定义、模块设计与验收标准（规格说明）
- `开发历程.md` —— 从 0 到当前阶段的完整开发记录：需求、决策、踩坑与验证（过程存档）

## 常见问题

**模型加载失败（MODEL_LOAD_FAILED）**
确认 `public/models/` 下有 4 个文件（`tiny_face_detector_model*`、`face_landmark_68_model*`）。
若缺失，重新执行权重拷贝命令；也可点击横幅中的「重试加载」。

**构建时报 esbuild 平台二进制缺失**
npm 安装时偶发跳过 optional 依赖，手动补装即可：

```bash
npm install --no-save @esbuild/win32-x64@$(node -p "require('./node_modules/esbuild/package.json').version")
```

**上传后提示「未检测到人脸」**
请使用正面、光线均匀、无遮挡的照片。检测器为 TinyFaceDetector，对侧脸与小尺寸人脸不敏感。

## 已知限制

- 2D 关键点，侧脸（>15°）下三庭误差 > 15%，界面会给出提示但不做数值校正
- 上庭依赖发际线估算（检测器框顶 / 眼裂高度推算），界面以 `*` 标注
- 滑块为数学插值形变，不预测真实解剖效果
- 无相机畸变校正，广角前置镜头下鼻部存在放大效应
- 毫米数值基于瞳距估算（误差约 ±5%），仅供沟通示意；二维照片无法判断容量缺损，
  方案不构成医疗建议，实际须由执业医师面诊确定
