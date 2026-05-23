# AI PLANT

AI PLANT（智能工厂）是一个面向工程项目交付数据的 Web 系统，用于管理工程标准、项目数据、TAG/设备台账、文档资料和三维可视化资产。仓库包含前端、后端、数据库迁移、初始化样例数据和本地开发基础设施。

## 功能概览

- **工程标准库**：维护标准、分类层级、属性定义、文档类型和专业交付要求，内置 CFIHOS 样例标准数据。
- **项目数据管理**：创建项目，绑定参考标准，管理项目 PBS、TAG、设备实例和 TAG-设备实现关系。
- **TAG 与设备台账**：支持按标准分类查看 TAG/设备属性，维护设备实现历史和属性值。
- **文档管理与预览**：按项目归档文档、版本和修订，支持 Office、PDF、CAD 等文档预览链路。
- **三维模型可视化**：支持 Spark RAD/RADC 资产的浏览和语义对象关联，开源样例内置 `pump_room` 三维模型。
- **数据质量检查**：提供项目数据质量检查、标准漂移检查、属性缺失/异常检查等后端工具和页面入口。
- **权限与登录**：内置 RBAC 权限、HttpOnly Cookie 会话、首个管理员 bootstrap 流程。
- **品牌设置**：默认使用 AI PLANT / 智能工厂与艾极科技 Logo；支持通过系统设置上传自定义 Logo 和登录背景图。
- **可信插件机制**：保留通用插件注册、安装、权限和菜单扩展机制；本开源基线不包含进度管理等业务插件包。

## 内置样例数据

开源基线包含可直接启动体验的数据：

- CFIHOS 标准数据。
- KBT-CPF sample 项目数据。
- `pump_room` 文档记录、可视化元数据、Spark RAD/RADC 资产和源模型包。
- 登录背景图和默认品牌基础数据。

对象存储样例文件位于 `sample-data/minio`。其中 `pump_room` 源模型 zip 使用 Git LFS 管理，克隆仓库后请确保已经拉取 LFS 文件。

## 技术栈

- 前端：React 19、Vite、TypeScript、Tailwind CSS、React Router、Lucide React、pnpm。
- 后端：FastAPI、Pydantic、psycopg、PostgreSQL、openpyxl、httpx、boto3。
- 本地基础设施：PostgreSQL 16、MinIO、kkFileView、Docker Compose。
- 默认端口：前端 `5173`，后端 `3001`，PostgreSQL `55432`，MinIO `9000/9001`，kkFileView `8012`。

## 快速启动

### 1. 克隆仓库并拉取 LFS 文件

```bash
git clone https://github.com/aigeek-tech/AI-Plant.git
cd AI-Plant
git lfs pull
```

### 2. 启动本地基础设施

```bash
docker compose up -d postgres minio minio-init kkfileview
```

首次启动 PostgreSQL 会自动应用迁移和 seed。MinIO 初始化任务会把 `sample-data/minio` 下的样例对象同步到本地 bucket。

### 3. 启动后端

```bash
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 3001
```

### 4. 启动前端

```bash
cd frontend
pnpm install
pnpm dev
```

然后打开 `http://localhost:5173`。如果数据库中没有管理员账号，登录页会引导创建首个管理员。

Windows 本地开发也可以使用仓库根目录的脚本：

```powershell
.\start-dev.ps1
```

## 目录结构

- `frontend`：React/Vite 前端应用。
- `backend`：FastAPI 后端、数据库迁移、seed、测试和工具脚本。
- `backend/db/migrations`：数据库 schema 迁移。
- `backend/db/seeds`：初始化样例数据。
- `sample-data/minio`：MinIO 对象存储样例文件。
- `deploy`：离线部署和 Home 环境部署相关 compose/脚本。
- `docs`：设计文档和 AI 开发约束。

## 验证

常用验证命令：

```bash
cd frontend
pnpm lint
pnpm build
```

```bash
cd backend
python -m pytest
```

如果修改数据库迁移或 seed，建议使用空数据库重新应用迁移和 seed，确认样例项目、CFIHOS 数据、`pump_room` 文档和 MinIO 对象都能正常加载。

## 开源边界

本仓库是基础开源版本：

- 包含通用插件机制。
- 不包含进度管理/项目治理等业务插件包。
- 不包含本地密钥、AI API Key、用户会话、运行日志或私有缓存。
- 包含 CFIHOS/sample 项目/`pump_room` 样例数据，用于开箱演示系统能力。

## License

本项目按仓库根目录 `LICENSE` 分发。商业使用被允许，但必须保留版权声明、`NOTICE` 文件以及 Aigeek / 艾极科技 Logo 和归属声明。第三方依赖继续遵循各自许可证。
