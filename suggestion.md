# Spark 2.0 Viewer 差异分析与优化方案

## 核对范围

- 本地实现：`frontend/src/components/documents/SparkDocumentViewer.tsx`、`DocumentPreviewDialog.tsx`、`frontend/package.json`。
- 官方能力：Spark 2.0 Preview 文档、`@sparkjsdev/spark@2.0.0` 类型定义与本仓库 `spark/*` 示例。
- 本次不纳入：WebXR、动态编辑/动画、环境贴图、多视口递归渲染、3DGS 训练或转换工具 UI。这些更偏展示/创作，不适合当前工程文档预览的稳定使用场景。

## 官方能力摘要

| 官方 Spark 2.0 能力 | 工程 viewer 价值 | 本地现状 | 建议 |
| --- | --- | --- | --- |
| `.ply/.spz/.splat/.ksplat/.sog` 等格式加载 | 支持多来源 3DGS 资产预览 | 已识别并可打开 | 保持，不扩大到未验证工程格式 |
| `.rad + .radc` 分页 LoD 流式加载 | 大型厂站/装置区模型核心能力 | 已走后端受控路由并开启 paged | 保持并补质量档位 |
| `lodSplatScale/lodRenderScale/lodSplatCount` | 控制清晰度、带宽和移动端性能 | 只有固定 `lodSplatScale` | 增加“流畅/均衡/精细” |
| `pagedExtSplats` | 大坐标场景减少量化误差 | RAD 时已开启 | 保持 |
| `raycastable/minRaycastOpacity/raycast` | 双击定位、坐标读取、模型点选基础 | 未开启 | 增加双击聚焦和坐标反馈 |
| `SparkControls` FPS 风格导航 | 巡检式浏览 | 已接入 | 保持，补操作提示和焦点处理 |
| 多个 `SplatMesh` 混合渲染 | 多模型叠加 | 当前后端契约仅单 visualization | 暂不做，避免 API 和资产关系膨胀 |
| 编辑、recolor、modifier、动画 | 创作/特效 | 未接入 | 不建议加入工程预览 |
| WebXR/VR | 沉浸式展示 | 未接入 | 暂不建议，硬件和现场流程不稳定 |

## 官方 API 取舍清单

| API / 用法 | 官方用途 | 工业预览取舍 |
| --- | --- | --- |
| `SparkRenderer` | 接入 Three.js 渲染、排序、LoD、分页、render target | 已用；补充 LoD 性能档位 |
| `SplatMesh` | 加载文件、stream、paged、raycast、editable、modifier | 已用；新增 `raycastable`，不启用 editable |
| `SparkControls` / `FpsMovement` / `PointerControls` | FPS/鼠标/触控导航 | 已用；继续作为巡检式浏览方式 |
| `PackedSplats` / `ExtSplats` / `PagedSplats` / `SplatPager` | 内存、精度、分页资产结构 | 间接使用；通过 `.rad/.radc` 后端资产链路落地 |
| `SplatLoader` / `PlyReader` / `SpzReader` / `transcodeSpz` | 文件类型识别、读取、转码 | 当前上传/转换由后端负责，前端 viewer 不重复做转码 |
| `SplatEdit` / `SplatEdits` / `RgbaArray` | 点级编辑、颜色/位移改写 | 不纳入；工程预览应保持源资产可信，不在浏览器改模型 |
| `SplatGenerator` / `generators` / `modifiers` / `dyno` | GPU 动态生成和 shader graph | 不纳入；适合创意/研究，不适合稳定审图 |
| `SplatSkinning` / `hands` / `SparkXr` | 骨骼动画、手部输入、XR | 不纳入；当前文档预览没有硬件和验收流程 |
| `SparkPortals` | 门户/递归视图 | 不纳入；会增加认知负担，对工程审查收益低 |
| `Readback` / render target / cube map / env map | 离屏读取、截图、环境贴图 | 暂不纳入；后续若做自动缩略图或问题截图可单独评估 |
| `splatConstructors` | 构造坐标轴、文字、图片 splats | 暂不纳入；如需工程坐标轴，建议用 Three.js 常规 overlay，更可控 |
| `OldSparkRenderer` / `OldSparkViewpoint` | 兼容旧版 0.1 API | 不使用；本项目已锁定 `@sparkjsdev/spark@2.0.0` |

## 多轮校验结论

1. 功能适配校验：工程场景需要“看得清、跑得动、能定位、能回到业务对象”，不需要创作型编辑能力。
2. 技术契约校验：本次优化只改前端组件状态和 Spark 参数，不改变 `DocumentVisualizationAccess`、上传、migration、对象存储或依赖。
3. 安全边界校验：继续使用后端鉴权后的 `viewer_url/source_url/annotation_manifest_url`，不暴露对象存储地址，不写入任何密钥。
4. 可回退校验：新增能力是 UI 操作和运行时参数；若某资产不支持 raycast，只显示“未命中”，不会影响加载。

## 修改意见

- 增加质量档位：
  - 流畅：降低 LoD splat 数量和像素比，适合移动端、远程会审。
  - 均衡：默认档，保持当前效果。
  - 精细：提高 LoD 细节，适合桌面端局部审查。
- 增加双击定位：
  - 双击模型表面后，通过 Spark raycast 获取世界坐标。
  - 摄像机沿当前视线移动到该点附近，实现“点哪里，看哪里”。
  - 顶部显示最近定位坐标，便于工程沟通。
- 优化标注操作：
  - 点击标注先飞到标注位置并选中。
  - 标注带业务对象时，再提供进入 TAG/文档/PBS 的动作，避免误点后直接离开 3D 场景。
- 保留官方 LoD/RAD 参数：
  - RAD 分页继续使用 `paged: true`、`pagedExtSplats`、视锥 foveation。
  - 不把 WebXR、编辑、动画、多模型叠加纳入当前迭代。

## 实施计划

1. 在 `SparkDocumentViewer.tsx` 内新增 viewer refs、质量档位状态、raycast 双击聚焦、坐标反馈和选中标注面板。
2. 保留 `DocumentPreviewDialog.tsx` 的业务跳转回调，但在 viewer 内改成“点击标注先定位，确认后再打开关联对象”。
3. 运行前端 `pnpm lint` 和 `pnpm build`。
4. 复核不涉及 API、migration、依赖和后端安全边界。

## 参考来源

- Spark 2.0 Preview - New Features in 2.0: https://sparkjs.dev/2.0.0-preview/docs/new-features-2.0/
- Spark 2.0 Preview - Getting Started with Level-of-Detail: https://sparkjs.dev/2.0.0-preview/docs/lod-getting-started/
- 本地安装包类型定义：`frontend/node_modules/@sparkjsdev/spark/dist/types/SparkRenderer.d.ts`、`SplatMesh.d.ts`、`controls.d.ts`
