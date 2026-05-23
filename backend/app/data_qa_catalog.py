from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DataQaField:
    id: str
    expression: str
    label: str
    value_type: str = "text"
    keywords: tuple[str, ...] = ()


@dataclass(frozen=True)
class DataQaSqlExample:
    question: str
    sql: str
    chart_type: str = "table"


@dataclass(frozen=True)
class DataQaDataset:
    id: str
    label: str
    description: str
    from_sql: str
    scope_expression: str
    fields: dict[str, DataQaField]
    keywords: tuple[str, ...] = ()
    sql_examples: tuple[DataQaSqlExample, ...] = ()


DATA_QA_DATASETS: dict[str, DataQaDataset] = {
    "projects": DataQaDataset(
        id="projects",
        label="项目",
        description="项目基础信息，用于按项目统计授权范围内的数据。",
        from_sql="project p",
        scope_expression="p.id",
        keywords=("project", "项目", "项目分布", "跨项目", "所有项目"),
        fields={
            "id": DataQaField("id", "p.id", "项目 ID", "uuid", ("项目id",)),
            "code": DataQaField("code", "p.code", "项目编码", "text", ("项目编号",)),
            "name": DataQaField("name", "p.name", "项目名称", "text"),
            "status": DataQaField("status", "p.status", "项目状态", "text"),
            "created_at": DataQaField("created_at", "p.created_at", "创建时间", "timestamp"),
        },
        sql_examples=(
            DataQaSqlExample(
                question="当前授权范围内有多少个项目？",
                sql="SELECT COUNT(*) AS project_count FROM project p LIMIT 1",
                chart_type="table",
            ),
        ),
    ),
    "tags": DataQaDataset(
        id="tags",
        label="TAG",
        description="项目 TAG / 位号台账，可按状态、类别、PBS 统计。",
        from_sql="""
            tag t
            LEFT JOIN project p ON p.id = t.project_id
            LEFT JOIN class c ON c.id = t.class_id
            LEFT JOIN pbs_node pn ON pn.id = t.pbs_node_id
        """,
        scope_expression="t.project_id",
        keywords=("tag", "tags", "位号", "标签", "设备位号", "对象", "台账"),
        fields={
            "id": DataQaField("id", "t.id", "TAG ID", "uuid"),
            "project_id": DataQaField("project_id", "t.project_id", "项目 ID", "uuid"),
            "project_code": DataQaField("project_code", "p.code", "项目编码", "text", ("项目", "项目编号")),
            "project_name": DataQaField("project_name", "p.name", "项目名称", "text", ("项目",)),
            "tag_no": DataQaField("tag_no", "t.tag_no", "TAG 编号", "text", ("位号", "编号")),
            "name": DataQaField("name", "t.name", "TAG 名称", "text"),
            "status": DataQaField("status", "t.status", "状态", "text", ("状态",)),
            "class_name": DataQaField("class_name", "c.name", "类别", "text", ("类别", "class")),
            "pbs_code": DataQaField("pbs_code", "pn.code", "PBS 编码", "text", ("pbs",)),
            "pbs_name": DataQaField("pbs_name", "pn.name", "PBS 名称", "text", ("pbs",)),
            "created_at": DataQaField("created_at", "t.created_at", "创建时间", "timestamp"),
        },
        sql_examples=(
            DataQaSqlExample(
                question="这个项目现在有多少个 TAG？",
                sql="SELECT COUNT(*) AS tag_count FROM tag t LIMIT 1",
                chart_type="table",
            ),
            DataQaSqlExample(
                question="按状态统计 TAG 数量",
                sql="SELECT t.status AS status, COUNT(*) AS tag_count FROM tag t GROUP BY t.status ORDER BY tag_count DESC LIMIT 100",
                chart_type="bar",
            ),
            DataQaSqlExample(
                question="按类别统计 TAG 数量",
                sql="SELECT c.name AS class_name, COUNT(*) AS tag_count FROM tag t LEFT JOIN class c ON c.id = t.class_id GROUP BY c.name ORDER BY tag_count DESC LIMIT 100",
                chart_type="bar",
            ),
            DataQaSqlExample(
                question="各项目分别有多少个 TAG？",
                sql="SELECT p.name AS project_name, COUNT(*) AS tag_count FROM tag t LEFT JOIN project p ON p.id = t.project_id GROUP BY p.name ORDER BY tag_count DESC LIMIT 100",
                chart_type="bar",
            ),
        ),
    ),
    "documents": DataQaDataset(
        id="documents",
        label="文档",
        description="项目文档台账，可按状态、专业、类型、当前版次统计。",
        from_sql="""
            document d
            LEFT JOIN project p ON p.id = d.project_id
            LEFT JOIN class dc ON dc.id = d.class_id
            LEFT JOIN document_revision dr ON dr.id = d.current_revision_id
        """,
        scope_expression="d.project_id",
        keywords=("document", "documents", "文档", "文件", "图纸", "资料", "交付物"),
        fields={
            "id": DataQaField("id", "d.id", "文档 ID", "uuid"),
            "project_id": DataQaField("project_id", "d.project_id", "项目 ID", "uuid"),
            "project_code": DataQaField("project_code", "p.code", "项目编码", "text", ("项目", "项目编号")),
            "project_name": DataQaField("project_name", "p.name", "项目名称", "text", ("项目",)),
            "document_no": DataQaField("document_no", "d.document_no", "文档编号", "text", ("编号",)),
            "title": DataQaField("title", "d.title", "标题", "text"),
            "discipline": DataQaField("discipline", "d.discipline", "专业", "text", ("专业",)),
            "status": DataQaField("status", "d.status", "状态", "text"),
            "document_type": DataQaField("document_type", "dc.name", "文档类型", "text", ("类型",)),
            "current_revision_no": DataQaField("current_revision_no", "dr.revision_no", "当前版次", "text", ("版次", "版本")),
            "created_at": DataQaField("created_at", "d.created_at", "创建时间", "timestamp"),
        },
        sql_examples=(
            DataQaSqlExample(
                question="按专业统计文档数量",
                sql="SELECT d.discipline AS discipline, COUNT(*) AS document_count FROM document d GROUP BY d.discipline ORDER BY document_count DESC LIMIT 100",
                chart_type="bar",
            ),
        ),
    ),
    "equipment": DataQaDataset(
        id="equipment",
        label="设备",
        description="项目设备资产台账，可按资产状态、类别、厂家、型号统计。",
        from_sql="""
            equipment e
            LEFT JOIN project p ON p.id = e.project_id
            LEFT JOIN class ec ON ec.id = e.class_id
        """,
        scope_expression="e.project_id",
        keywords=("equipment", "设备", "资产", "厂家", "型号", "实物"),
        fields={
            "id": DataQaField("id", "e.id", "设备 ID", "uuid"),
            "project_id": DataQaField("project_id", "e.project_id", "项目 ID", "uuid"),
            "project_code": DataQaField("project_code", "p.code", "项目编码", "text", ("项目", "项目编号")),
            "project_name": DataQaField("project_name", "p.name", "项目名称", "text", ("项目",)),
            "equipment_no": DataQaField("equipment_no", "e.equipment_no", "设备编号", "text", ("编号",)),
            "name": DataQaField("name", "e.name", "设备名称", "text"),
            "asset_status": DataQaField("asset_status", "e.asset_status", "资产状态", "text", ("状态",)),
            "manufacturer": DataQaField("manufacturer", "e.manufacturer", "厂家", "text"),
            "model": DataQaField("model", "e.model", "型号", "text"),
            "class_name": DataQaField("class_name", "ec.name", "设备类别", "text", ("类别", "class")),
            "created_at": DataQaField("created_at", "e.created_at", "创建时间", "timestamp"),
        },
        sql_examples=(
            DataQaSqlExample(
                question="按资产状态统计设备数量",
                sql="SELECT e.asset_status AS asset_status, COUNT(*) AS equipment_count FROM equipment e GROUP BY e.asset_status ORDER BY equipment_count DESC LIMIT 100",
                chart_type="bar",
            ),
        ),
    ),
    "pbs_nodes": DataQaDataset(
        id="pbs_nodes",
        label="PBS 节点",
        description="项目 PBS/WBS 层级节点，可按节点类型、层级、状态统计。",
        from_sql="""
            pbs_node pn
            LEFT JOIN project p ON p.id = pn.project_id
            LEFT JOIN pbs_level_template plt ON plt.id = pn.level_template_id
        """,
        scope_expression="pn.project_id",
        keywords=("pbs", "wbs", "节点", "分解结构", "层级"),
        fields={
            "id": DataQaField("id", "pn.id", "PBS ID", "uuid"),
            "project_id": DataQaField("project_id", "pn.project_id", "项目 ID", "uuid"),
            "project_code": DataQaField("project_code", "p.code", "项目编码", "text", ("项目", "项目编号")),
            "project_name": DataQaField("project_name", "p.name", "项目名称", "text", ("项目",)),
            "code": DataQaField("code", "pn.code", "PBS 编码", "text", ("编码",)),
            "name": DataQaField("name", "pn.name", "PBS 名称", "text"),
            "node_type": DataQaField("node_type", "pn.node_type", "节点类型", "text", ("类型",)),
            "status": DataQaField("status", "pn.status", "状态", "text"),
            "level_name": DataQaField("level_name", "plt.name", "层级", "text", ("层级",)),
            "created_at": DataQaField("created_at", "pn.created_at", "创建时间", "timestamp"),
        },
        sql_examples=(
            DataQaSqlExample(
                question="按节点类型统计 PBS 节点数量",
                sql="SELECT pn.node_type AS node_type, COUNT(*) AS pbs_node_count FROM pbs_node pn GROUP BY pn.node_type ORDER BY pbs_node_count DESC LIMIT 100",
                chart_type="bar",
            ),
        ),
    ),
    "relations": DataQaDataset(
        id="relations",
        label="关系",
        description="项目内文档、TAG、PBS 之间的关系实例。",
        from_sql="""
            project_relation pr
            LEFT JOIN project p ON p.id = pr.project_id
            LEFT JOIN relation_type rt ON rt.id = pr.relation_type_id
        """,
        scope_expression="pr.project_id",
        keywords=("relation", "relations", "关系", "关联", "链接"),
        fields={
            "id": DataQaField("id", "pr.id", "关系 ID", "uuid"),
            "project_id": DataQaField("project_id", "pr.project_id", "项目 ID", "uuid"),
            "project_code": DataQaField("project_code", "p.code", "项目编码", "text", ("项目", "项目编号")),
            "project_name": DataQaField("project_name", "p.name", "项目名称", "text", ("项目",)),
            "relation_type": DataQaField("relation_type", "rt.name", "关系类型", "text", ("类型",)),
            "source_kind": DataQaField("source_kind", "pr.source_kind", "源类型", "text"),
            "target_kind": DataQaField("target_kind", "pr.target_kind", "目标类型", "text"),
            "created_at": DataQaField("created_at", "pr.created_at", "创建时间", "timestamp"),
        },
        sql_examples=(
            DataQaSqlExample(
                question="按关系类型统计关系数量",
                sql="SELECT rt.name AS relation_type, COUNT(*) AS relation_count FROM project_relation pr LEFT JOIN relation_type rt ON rt.id = pr.relation_type_id GROUP BY rt.name ORDER BY relation_count DESC LIMIT 100",
                chart_type="bar",
            ),
        ),
    ),
    "tag_equipment_assignments": DataQaDataset(
        id="tag_equipment_assignments",
        label="TAG 设备安装关系",
        description="TAG 与设备资产的安装/分配历史，通过 TAG 所属项目限定查询范围。",
        from_sql="""
            tag_equipment_assignment tea
            JOIN tag t ON t.id = tea.tag_id
            JOIN equipment e ON e.id = tea.equipment_id
        """,
        scope_expression="t.project_id",
        keywords=("assignment", "安装", "分配", "tag设备", "设备安装", "当前设备"),
        fields={
            "id": DataQaField("id", "tea.id", "安装关系 ID", "uuid"),
            "tag_no": DataQaField("tag_no", "t.tag_no", "TAG 编号", "text", ("位号",)),
            "equipment_no": DataQaField("equipment_no", "e.equipment_no", "设备编号", "text", ("设备",)),
            "status": DataQaField("status", "tea.status", "关系状态", "text", ("状态",)),
            "is_current": DataQaField("is_current", "tea.is_current", "是否当前", "boolean", ("当前",)),
            "installed_from": DataQaField("installed_from", "tea.installed_from", "安装开始", "date"),
            "installed_to": DataQaField("installed_to", "tea.installed_to", "安装结束", "date"),
            "created_at": DataQaField("created_at", "tea.created_at", "创建时间", "timestamp"),
        },
        sql_examples=(
            DataQaSqlExample(
                question="当前安装关系有多少条？",
                sql="SELECT COUNT(*) AS assignment_count FROM tag_equipment_assignment tea JOIN tag t ON t.id = tea.tag_id WHERE tea.is_current = true LIMIT 1",
                chart_type="table",
            ),
        ),
    ),
}


DEFAULT_DATASET_IDS = ("tags", "documents", "equipment", "pbs_nodes")


def get_data_qa_dataset(dataset_id: str) -> DataQaDataset | None:
    return DATA_QA_DATASETS.get(dataset_id)


def select_relevant_datasets(question: str, *, limit: int = 5) -> list[DataQaDataset]:
    normalized_question = question.strip().lower()
    scored: list[tuple[int, DataQaDataset]] = []
    for dataset in DATA_QA_DATASETS.values():
        score = 0
        search_terms = (dataset.id, dataset.label, dataset.description, *dataset.keywords)
        for term in search_terms:
            if term and term.lower() in normalized_question:
                score += 4
        for field in dataset.fields.values():
            for term in (field.id, field.label, *field.keywords):
                if term and term.lower() in normalized_question:
                    score += 1
        scored.append((score, dataset))

    selected = [dataset for score, dataset in sorted(scored, key=lambda item: item[0], reverse=True) if score > 0]
    if not selected:
        selected = [DATA_QA_DATASETS[dataset_id] for dataset_id in DEFAULT_DATASET_IDS]

    project_dataset = DATA_QA_DATASETS["projects"]
    if any(marker in normalized_question for marker in ("各项目", "所有项目", "全部项目", "跨项目", "项目对比")):
        selected = [project_dataset, *[dataset for dataset in selected if dataset.id != project_dataset.id]]

    return selected[: max(1, limit)]


def serialize_catalog(datasets: list[DataQaDataset]) -> list[dict]:
    return [
        {
            "id": dataset.id,
            "label": dataset.label,
            "description": dataset.description,
            "from_sql": dataset.from_sql,
            "project_scope": dataset.scope_expression,
            "fields": [
                {
                    "id": field.id,
                    "expression": field.expression,
                    "label": field.label,
                    "value_type": field.value_type,
                    "keywords": list(field.keywords),
                }
                for field in dataset.fields.values()
            ],
            "sql_examples": [
                {
                    "question": example.question,
                    "sql": example.sql,
                    "chart-type": example.chart_type,
                }
                for example in dataset.sql_examples
            ],
        }
        for dataset in datasets
    ]
