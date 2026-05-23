# 项目级 TAG Excel 导入体验方案

## Summary
- 首版做“项目级多 PBS 节点 TAG 导入”，入口放在项目详情页顶部，用户不需要先选中某个 PBS 节点。
- 文件格式采用 `.xlsx` Excel 模板；首版只导入设备级 TAG，不导入部件/组件父子层级。
- 导入采用“先校验预览，再确认提交”的两阶段流程，错误数据在系统内表格化修正，不强迫用户反复改 Excel 再上传。
- 冲突 TAG 不静默覆盖；系统列出所有冲突行，允许用户批量选择“更新已有 TAG”或“跳过”，确认后再提交。

## User Flow
- 用户点击“导入 TAG”进入导入向导，第一步下载当前项目专属模板，模板包含 TAG 数据页、PBS 节点参考页、Class 参考页和填写说明。
- 用户上传 Excel 后，系统只做解析和校验，不写入正式 TAG 表，生成导入预览。
- 预览页分为“可导入”“需修正”“冲突确认”“警告”四类，并在顶部展示总行数、可导入数、错误数、冲突数。
- 对错误行，用户直接在预览表格中编辑单元格；每次编辑后只重新校验相关行，立即更新错误提示。
- 对已有 `tag_no` 冲突，系统展示冲突列表和现有 TAG 摘要；用户可多选后批量设为“更新已有”或“跳过”。
- 所有阻塞错误修正完、所有冲突有处理动作后，才启用“确认导入”。
- 提交后展示结果页：新增数、更新数、跳过数、失败数、失败原因导出入口，并刷新项目 TAG 列表。

## Key Changes
- Excel 模板字段固定为 `tag_no`、`name`、`pbs_code`、`class_code` 加动态属性列；`tag_no`、`name`、`pbs_code` 必填，`class_code` 建议填写。
- `pbs_code` 用于把 TAG 挂载到项目内 PBS 节点；如果当前迁移链未正式包含 `pbs_node` 和 `tag.pbs_node_id`，先补齐正规迁移，避免导入后 TAG 无法在页面中出现。
- 属性列用稳定编码识别，推荐表头格式为 `属性名称 [attribute_code]`；后端只按 `attribute_code` 写入 `attribute_values`，避免中文名称变更导致导入失效。
- 校验规则包括必填字段、项目内重复 `tag_no`、Excel 内重复 `tag_no`、PBS 节点不存在、Class 不存在、必填属性缺失、枚举值非法、数字/整数/布尔/日期类型非法。
- Excel 内部重复 `tag_no` 是阻塞错误，默认要求用户修改；项目内已有 `tag_no` 是冲突确认项，默认不导入，需用户明确选择更新或跳过。
- 更新已有 TAG 时只更新用户确认冲突行对应的 `name`、`pbs_node_id`、`class_id`、`attribute_values`，并保留 `id`、`project_id`、创建时间和非导入范围字段。

## API And Types
- 新增 `GET /api/projects/{project_id}/tag-import-template`，返回当前项目的 Excel 模板，模板由项目关联标准、PBS 节点、Class 和属性定义动态生成。
- 新增 `POST /api/projects/{project_id}/tag-imports/validate`，接收 Excel 文件，创建导入草稿作业，返回 `job_id`、统计摘要和第一页行级校验结果。
- 新增 `GET /api/projects/{project_id}/tag-imports/{job_id}`，支持按 `status=ready|error|conflict|warning` 分页读取导入行。
- 新增 `PATCH /api/projects/{project_id}/tag-imports/{job_id}/rows/{row_id}`，保存用户在预览表格中的单元格修正并重新校验该行。
- 新增 `POST /api/projects/{project_id}/tag-imports/{job_id}/commit`，按用户确认的冲突处理动作执行事务性写入，返回新增、更新、跳过和失败明细。
- 前端新增类型 `TagImportJob`、`TagImportRow`、`TagImportIssue`、`TagImportConflictAction`，并在 `api.ts` 增加对应请求函数。
- 后端建议新增 `tag_import_job` 与 `tag_import_row` 两张表保存草稿、原始行、规范化行、问题列表和冲突动作，避免大文件预览全部塞在内存或单个 JSON 字段里。

## UX Details
- 上传前检查文件扩展名、大小、必需工作表和表头，明显错误在前端直接提示。
- 预览表格支持按错误类型过滤、只看冲突、只看当前页错误、跳转到下一条错误。
- 每个错误单元格显示明确原因，例如“PBS 编码不存在”“枚举值必须是 A/B/C”“该属性为必填”。
- `pbs_code` 和 `class_code` 错误时提供下拉搜索建议，用户可在单元格里选择正确节点或类别。
- 冲突确认区不弹逐条确认框，而是用列表批量处理；用户仍能展开任一冲突行查看 Excel 值与系统现有值差异。
- 导入过程中按钮进入不可重复提交状态；后端提交使用事务，失败时不产生半导入数据。
- 导入完成后保留导入记录和错误文件导出，便于用户追踪本次导入结果。

## Test Plan
- 后端单元测试覆盖 Excel 解析、表头识别、类型转换、必填校验、枚举校验、PBS/Class 映射、Excel 内重复和项目内冲突识别。
- API 测试覆盖模板下载、validate 不写正式 TAG、行内修正后重新校验、commit 新增、commit 更新已有、commit 跳过冲突、事务失败回滚。
- 前端测试覆盖上传向导状态、错误表格编辑、错误筛选、冲突批量动作、未解决错误时禁用提交、导入完成摘要。
- 集成场景覆盖一个项目下多个 PBS 节点的 Excel 导入、错误 `pbs_code` 修正后成功导入、已有 `tag_no` 经确认后更新。
- 性能验收以 5,000 行 TAG 为首版目标，validate 和预览分页可用，提交过程有明确进度和不可重复提交保护。

## Assumptions
- 首版只支持 `.xlsx`，需要新增一个后端 Excel 解析依赖；如果后续坚持不加依赖，则文件格式需降级为 CSV。
- 首版只导入设备级 TAG，不处理 `parent_tag_id` 和部件层级。
- 项目内 PBS 节点编码应保持唯一；如果发现历史数据不唯一，导入校验必须阻塞并提示先修复 PBS 编码。
- 冲突处理默认是“列出并确认”，不是逐条弹窗，也不是默认覆盖。
- 导入前必须完成 dry-run 校验，正式写入只能发生在用户点击确认导入之后。
