# Smart Design AI 开发要求

本文件是 `AGENTS.md` 的展开版说明，用于解释规则、提供检查清单，并帮助未来的 AI 或开发者在本仓库内保持稳定、一致、可审查的实现方式。

权威顺序：

1. 系统 / 开发者 / 用户即时指令
2. 仓库根目录 `AGENTS.md`
3. 本文档
4. 各子目录未来可能新增的更深层 `AGENTS.md`

---

## 1. 目标

这套规范的目标不是“限制发挥”，而是降低以下风险：

- AI 忽略现有项目结构，擅自发明新架构
- 样式风格失控，页面越做越不像同一个产品
- 数据库变更没有 migration，导致环境不可重复
- API 变了但前端类型没同步
- 新增依赖过于随意，带来维护、安全和部署负担
- 汇报只说“完成了”，没有验证证据和风险说明

本仓库的默认策略是：基于现状演进，而不是推倒重来。

---

## 2. 仓库现状基线

### 2.1 目录

- `frontend`：React + Vite 前端
- `backend`：FastAPI + PostgreSQL 后端
- `backend/db/migrations`：数据库 migration
- `backend/tests`：后端 pytest
- `docs`：产品和工程说明文档
- `docker-compose.yml`：本地 PostgreSQL / MinIO 基础设施
- `start-dev.ps1`：本地开发启动脚本

### 2.2 技术栈

前端以 `frontend/package.json` 为准：

- React 19
- Vite
- TypeScript
- Tailwind CSS v3
- React Router
- Lucide React
- clsx
- pnpm

后端以 `backend/requirements.txt` 为准：

- FastAPI
- Pydantic
- psycopg
- PostgreSQL
- openpyxl
- httpx
- boto3

### 2.3 本地端口

以现有配置为准：

- Frontend: `5173`
- Backend: `3001`
- PostgreSQL: `55432`
- MinIO API: `9000`
- MinIO Console: `9001`

如果未来修改这些端口，必须同步更新文档、启动脚本和相关说明。

---

## 3. AI 的标准工作方式

AI 在这个仓库中工作时，必须遵循以下默认流程：

1. 先读相关代码和目录
2. 确认是否已有现成模式可复用
3. 确认改动是否跨越前端、后端、数据库、依赖、安全边界
4. 做最小必要改动
5. 运行对应验证
6. 用简洁但完整的方式汇报

禁止行为：

- 没看代码就直接改
- 为了“更现代”擅自更换技术栈
- 无业务理由重写现有页面或重构整层结构
- 无说明地新增依赖
- 只改数据库，不补 migration
- 改 API 却不改前端类型
- 把未验证内容说成“已完成”

---

## 4. 前端开发要求

### 4.1 风格约束

前端必须延续当前设计基调，核心参考：

- `frontend/src/index.css`
- `frontend/tailwind.config.js`
- `frontend/src/components/layout/*`
- `frontend/src/components/ui/*`

当前视觉特征：

- 蓝色为主色
- 浅色背景
- 玻璃态卡片和轻微发光效果

允许优化，但不允许脱离这个方向做成完全不同的产品风格。

### 4.2 组件复用优先级

新增 UI 时按以下顺序决策：

1. 先复用 `frontend/src/components/ui`
2. 再复用现有页面中的局部模式
3. 最后才新增新组件

禁止无理由引入：

- 新 UI 框架
- 新图标库
- CSS-in-JS
- 大规模全局样式覆盖

### 4.3 交互状态

任何新增页面、列表、表单或数据面板，至少要考虑：

- loading
- error
- empty
- success feedback

不允许只实现 happy path。

### 4.4 类型和 API 一致性

前端所有 API 类型以 `frontend/src/lib/api.ts` 为统一入口之一。

当后端返回字段发生变化时，必须同步更新：

- `frontend/src/lib/api.ts`
- 相关页面
- 相关组件

如果不确定字段形态，先看现有调用，再决定改法。

---

## 5. 后端开发要求

### 5.1 路由、模型、仓储职责

默认职责边界：

- `main.py`：路由注册、请求模型、HTTP 错误映射
- `repository`：数据库访问
- `service`：业务编排和跨模块流程

如果新增功能较复杂，不要继续把所有逻辑堆到 `backend/app/main.py`。

### 5.2 输入验证

所有 API 输入都必须在边界做校验。

推荐最低要求：

- `Field(...)` 做长度或范围约束
- 对文本字段 `strip()`
- 空白字符串归一化
- 枚举值显式限制

这不是“代码风格问题”，而是系统边界约束。

### 5.3 SQL 规则

数据库访问必须沿用 psycopg 参数化方式。

允许：

```python
cursor.execute(
    "SELECT * FROM project WHERE id = %s",
    (project_id,),
)
```

禁止：

```python
cursor.execute(f"SELECT * FROM project WHERE id = '{project_id}'")
```

禁止字符串拼接 SQL，不论是否“看起来安全”。

---

## 6. 数据库修改要求

### 6.1 Migration 是唯一入口

任何 schema 变更都必须走 `backend/db/migrations`。

默认规则：

- 新增 migration，而不是修改旧 migration
- 文件名使用 `NNNN_descriptive_name.sql`
- 写之前先检查现有编号

后续新增 migration 时，必须先检查目录，避免继续制造编号冲突。

### 6.2 Migration 内容要求

每个 migration 至少要做到：

- 能看懂它改了什么
- 能看懂对现有数据的影响
- 能看懂是否引入约束和索引
- 能判断兼容性和风险

如果 migration 涉及数据迁移，必须额外说明：

- 旧数据怎么兼容
- 是否需要一次性修复脚本
- 是否需要更新 seed / query / test

### 6.3 修改 migration 后的联动检查

涉及数据库改动时，要主动检查这些文件是否也该改：

- `docker-compose.yml`
- `backend/README.md`
- `backend/db/seeds/*`
- `backend/db/queries/*`
- `backend/tests/*`

如果有一处漏改，后续环境很容易变得不可重复。

---

## 7. 依赖管理要求

### 7.1 默认策略

默认不新增依赖。

只有在以下条件同时满足时，才考虑新增：

1. 现有依赖确实无法满足
2. 复用已有实现成本明显更高
3. 新依赖的维护、安全、许可证和部署影响可接受

### 7.2 前端依赖

前端新增依赖时，必须同步更新：

- `frontend/package.json`
- `frontend/pnpm-lock.yaml`

并在最终汇报中说明：

- 为什么现有依赖不够
- 对 bundle 大小和维护成本的影响

### 7.3 后端依赖

后端新增依赖时，必须：

- 固定版本写入 `backend/requirements.txt`
- 在汇报中说明安全、许可证和部署影响

### 7.4 禁止提交的内容

不要把以下内容作为“正常改动”提交：

- `.venv`
- `node_modules`
- `dist`
- `__pycache__`
- 本地缓存目录
- 本地导出文件
- 临时脚本产物

---

## 8. 测试与验证要求

### 8.1 基本原则

任何改动完成后，都要有与改动匹配的验证。
验证不一定总是“大而全”，但必须真实、明确、可说明。

### 8.2 前端改动

前端改动至少应验证：

```bash
cd frontend
pnpm lint
pnpm build
```

如果涉及数据交互或复杂页面，还应补充手工验证路径，例如：

- 进入哪个页面
- 操作什么按钮
- 预期看到什么结果

### 8.3 后端改动

后端改动至少应验证：

```bash
cd backend
python -m pytest
```

如果只需要局部验证，也应明确说明跑了哪些测试文件。

### 8.4 数据库 / API 改动

数据库或 API 改动时，除了 pytest 之外，还应确认：

- repository 层逻辑被覆盖
- API 层行为被覆盖
- 前端类型已同步

### 8.5 文档类改动

如果本次只修改规范或文档，至少要做：

- 路径存在性检查
- 端口一致性检查
- 技术栈一致性检查
- 文档之间不冲突检查

---

## 9. 安全要求

### 9.1 Secrets

禁止把真实 secrets 写入代码、文档或示例中，包括：

- API key
- token
- 密码
- 生产 URL
- 生产 bucket 配置

示例里只能使用：

- 占位符
- 本地默认开发值

### 9.2 输入和文件处理

所有用户输入都应在边界校验。

涉及文件上传、对象存储、下载链接、预签名地址时，必须检查：

- 文件名是否合法
- MIME type 是否符合预期
- size 是否受控
- 状态流转是否完整
- 是否会泄漏敏感路径或 secret

---

## 10. Cleanup / Refactor 特别要求

当任务属于 cleanup、refactor、deslop 时，额外执行：

1. 先说明清理目标和范围
2. 优先锁定现有行为
3. 一次只处理一个明显问题
4. 优先删除和复用，不优先新增抽象
5. 不得顺手重写无关模块

如果没有测试保护，就先补测试，再清理。

---

## 11. 最终汇报模板

最终汇报应尽量简洁，但必须包含以下信息：

- 本次做了什么
- 变更文件有哪些
- 跑了什么验证
- 哪些验证没有跑
- 剩余风险或注意事项

如果涉及以下任一项，必须单独点明：

- migration
- 依赖变更
- API 契约变更
- 安全边界调整

---

## 12. AI 自检清单

在提交或结束前，AI 应至少自问一遍：

- 我是否先读了现有代码？
- 我是否复用了现有模式？
- 我是否避免了无关重写？
- 我是否在数据库变更时新增了 migration？
- 我是否同步更新了前后端契约？
- 我是否避免新增无必要依赖？
- 我是否运行或明确说明了验证？
- 我是否诚实写出了剩余风险？

如果其中有任何一项答案是否定的，应先修正，再结束。
