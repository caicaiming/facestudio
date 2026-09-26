# Face Studio

浏览器端面部比例分析 Demo。上传正面人脸照 → 自动检测 68 个关键点 → 计算三庭五眼等 5 项几何指标 → 用滑块模拟形变 → 输出量化处方建议。

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

## 使用流程

1. 打开页面，等待右上角状态变为**就绪**（首次需加载模型权重）
2. 点击「上传照片」或直接把图片拖入画布区（支持 JPG / PNG，示例照见 `public/sample-face.png`）
3. 切换**视图**（检测 / 调整 / 对照）与**叠加层**（网格 / 点位 / 三庭 / 对称）
4. 在左栏拖动 5 路滑块 —— **照片会实时变形**（拖动自动切到「调整」视图；双击滑块归零）
5. 右栏查看综合评分、几何指标、处方建议与分析文案

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
| 纯函数层 | `measure.js` / `analyze.js` 零 React 依赖，可 `node --test` 单测 |

重新生成三角剖分表：

```bash
node scripts/gen-triangles.mjs
```

## 目录说明

```
src/
├── main.jsx         入口
├── App.jsx          状态机、流程编排、三栏布局
├── FaceCanvas.jsx   双画布四图层绘制（原图 / 形变 / 叠加 / 网格）
├── ParamSlider.jsx  滑块 + 数值输入双通道控件
├── measure.js       几何测量 + 5 路形变（纯函数）
├── analyze.js       评分、处方、文案（纯函数）
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
