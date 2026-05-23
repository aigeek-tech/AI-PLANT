# Smart Design Repository Instructions

本文件是本仓库内 AI agent 的最高优先级项目约束入口。
任何进入 `D:\ai-geek\smart_design` 及其子目录的 AI，都必须先遵循本文件，再开始分析、修改、测试和汇报。
如果本文件与更高优先级系统/开发者/用户指令冲突，以更高优先级指令为准；否则默认严格执行本文件。

详细说明见 `docs/AI_DEVELOPMENT_REQUIREMENTS.md`，但即使不打开该文档，AI 也必须能仅凭本文件完成合规工作。

## 1. 项目事实

- 前端目录：`frontend`
- 后端目录：`backend`
- 详细文档目录：`docs`
- 前端技术栈：React 19、Vite、TypeScript、Tailwind CSS v3、React Router、Lucide React、clsx、pnpm
- 后端技术栈：FastAPI、Pydantic、psycopg、PostgreSQL、openpyxl、httpx、boto3
- 本地基础设施：`docker-compose.yml` 提供 PostgreSQL 16 和 MinIO
- 默认端口：
  - 前端：`5173`
  - 后端：`3001`
  - PostgreSQL：`55432`
  - MinIO API：`9000`
  - MinIO Console：`9001`

## 2. 全局工作原则

- 先读现有实现，再修改代码；禁止凭空臆造不存在的分层、模块或约定。
- 优先复用现有模式、组件、数据结构和命名；禁止为了“更优雅”大面积重写无关代码。
- 默认做最小可审查改动；每次修改都应当清楚说明影响范围。
- 发现工作区已有用户改动时，不得回滚或覆盖，除非用户明确要求。
- 没有充分理由时，不要新增依赖、不要引入新的基础设施、不要更换已有技术路线。
- 文档、代码、测试、migration、README、启动脚本之间必须保持一致。

## 3. 改前强制检查

开始修改前，必须完成以下动作：

1. 确认相关目录、文件、现有实现和调用路径。
2. 确认改动是否涉及：
   - 前端 UI / 样式
   - 后端 API / 数据模型
   - 数据库 schema / migration / seed
   - 依赖变更
   - 文件上传、对象存储、密钥或外部服务
3. 如果是 cleanup / refactor / deslop：
   - 先写清理计划
   - 优先补回归测试
   - 再做小步修改
4. 如果是数据库相关改动：
   - 先检查 `backend/db/migrations`
   - 确认下一个 migration 编号
   - 检查是否需要同步 `docker-compose.yml`、`backend/README.md`、seed、queries、tests

## 4. 前端规则

- 必须延续当前视觉语言：蓝色主色、浅色背景、玻璃态卡片、工程软件风格。
- 样式基线来自：
  - `frontend/src/index.css`
  - `frontend/tailwind.config.js`
- UI 优先复用：
  - `frontend/src/components/ui`
  - `frontend/src/components/layout`
  - `frontend/src/components/ui/buttonStyles.ts`
- 禁止无理由引入新的 UI 框架、图标库、CSS-in-JS 方案或全局样式体系。
- 新页面或新模块必须显式处理：
  - loading
  - error
  - empty
  - success feedback
- 修改 API 返回结构时，必须同步更新：
  - `frontend/src/lib/api.ts`
  - 所有相关页面/组件调用方
- 除非用户明确要求，不要做纯审美式重写，不要整体改主题。

## 5. 后端规则

- FastAPI 路由层负责输入输出和错误映射，不负责塞满业务细节。
- 新 API 必须先定义 Pydantic 请求模型。
- 所有文本字段都应做最小必要的：
  - 非空校验
  - `strip()`
  - 空字符串归一化
- repository 层负责数据访问，service 层负责业务编排。
- `backend/app/main.py` 不应持续膨胀；新增复杂领域时优先拆分到独立模块。
- 数据访问必须沿用 psycopg 参数化 SQL，禁止字符串拼接 SQL。
- 返回结构变更时，必须同步前端类型和调用方。

## 6. 数据库与 Migration 规则

- 任何 schema 变更都必须新增 migration，不得直接改历史 migration。
- 只有在“明确重建未发布基线”时，才允许调整历史 migration；若这样做，必须在汇报中明确声明。
- 新 migration 文件名格式：`backend/db/migrations/NNNN_descriptive_name.sql`
- 编号前必须先检查现有 migration，避免继续扩大当前重复编号问题。
- migration 必须便于审查，尽量明确：
  - 约束
  - 索引
  - 默认值
  - 数据迁移策略
  - 兼容性影响
  - 回滚风险
- 修改 migration 后，必须检查是否需要同步更新：
  - `docker-compose.yml`
  - `backend/README.md`
  - `backend/db/seeds`
  - `backend/db/queries`
  - `backend/tests`

## 7. 依赖规则

- 默认禁止新增依赖；必须先证明现有依赖无法满足需求。
- 前端新增依赖时，必须同时更新：
  - `frontend/package.json`
  - `frontend/pnpm-lock.yaml`
  - 变更说明中的 bundle / 维护风险
- 后端新增依赖时，必须同时更新：
  - `backend/requirements.txt`
  - 变更说明中的安全 / 许可证 / 部署影响
- 禁止提交生成物和本地环境目录，包括但不限于：
  - `.venv`
  - `node_modules`
  - `dist`
  - `__pycache__`
  - 本地缓存
  - 临时导出文件

## 8. 测试与验证规则

- 后端改动必须补充或更新 `backend/tests` 下的 pytest。
- 前端改动至少应验证：
  - `pnpm lint`
  - `pnpm build`
- 后端改动至少应验证：
  - `python -m pytest`
  - 或在 `backend` 目录下运行等价 pytest 命令
- 数据库 / API 改动必须额外验证：
  - repository / API 测试
  - 前后端类型一致性
- 如果本次只改文档或规范，至少做静态自检，确认路径、命令、端口和技术栈描述正确。
- 未运行的验证必须在最终汇报中明确写出，不得假装已验证。

## 9. 安全规则

- 禁止写入真实密钥、token、密码、生产地址或凭据。
- 示例只能使用占位符或本地开发默认值。
- 涉及 AI 设置、对象存储、文件上传、文件访问、数据库连接时，必须避免泄漏 secret。
- 所有用户输入都必须在系统边界验证。
- 文件上传逻辑必须校验：
  - 文件名
  - 类型
  - 大小
  - 状态流转

## 10. 汇报规则

最终汇报必须简洁且完整，至少包含：

- 做了什么
- 改了哪些文件
- 运行了哪些验证
- 哪些验证没跑
- 剩余风险或注意事项

如果改动涉及 migration、依赖、API 契约或安全边界，必须单独点明。

## 11. 执行口令

如果任务不明确，先查代码和现有文档，再决定实现方式。
如果任务明确，直接执行，不要停在空泛建议。
如果发现本文件未覆盖的细节，优先遵循“复用现有模式、最小改动、显式验证”的原则。
