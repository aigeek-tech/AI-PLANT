from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
import re
from typing import Any

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

from .data_qa_catalog import DataQaDataset, DataQaField, get_data_qa_dataset
from .data_qa_models import DataQaFilter, DataQaMeasure, DataQaQueryPlan, DataQaSqlDraft


class DataQaSqlError(RuntimeError):
    pass


@dataclass(frozen=True)
class CompiledDataQaQuery:
    sql: str
    params: list[Any] | dict[str, Any]
    columns: list[str]
    column_labels: dict[str, str]
    limit: int
    warnings: list[str] = field(default_factory=list)


POSTGRES_DIALECT = "postgres"
DEFAULT_SQL_LIMIT = 100
MAX_SQL_LIMIT = 500
_OUTPUT_IDENTIFIER_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


class DataQaSqlCompiler:
    def compile_sql_draft(self, draft: DataQaSqlDraft, *, allowed_project_ids: list[str]) -> CompiledDataQaQuery:
        project_ids = [str(project_id).strip() for project_id in allowed_project_ids if str(project_id).strip()]
        if not project_ids:
            raise DataQaSqlError("智能问数没有可用的授权项目范围。")
        if not draft.success:
            raise DataQaSqlError(draft.message or "模型认为无法生成 SQL。")
        if not draft.dataset or not draft.sql:
            raise DataQaSqlError("模型没有返回可执行的 SQL 草案。")

        dataset = get_data_qa_dataset(draft.dataset)
        if dataset is None:
            raise DataQaSqlError(f"不支持的数据集: {draft.dataset}")
        if not dataset.scope_expression:
            raise DataQaSqlError("数据集缺少项目边界，拒绝执行。")

        tree = self._parse_single_select(draft.sql)
        self._validate_sql_tree(tree, dataset)

        scoped_tree = self._inject_scope(tree, dataset.scope_expression)
        limited_tree, limit, warnings = self._ensure_limit(scoped_tree)
        params: dict[str, Any] = {"authorized_project_ids": project_ids}
        parameterized_tree = self._parameterize_literals(limited_tree, params)
        columns = self._select_columns(parameterized_tree)

        return CompiledDataQaQuery(
            sql=parameterized_tree.sql(dialect=POSTGRES_DIALECT, pretty=True),
            params=params,
            columns=columns,
            column_labels={column: column for column in columns},
            limit=limit,
            warnings=warnings,
        )

    def compile(self, plan: DataQaQueryPlan, *, allowed_project_ids: list[str]) -> CompiledDataQaQuery:
        project_ids = [str(project_id).strip() for project_id in allowed_project_ids if str(project_id).strip()]
        if not project_ids:
            raise DataQaSqlError("智能问数没有可用的授权项目范围。")

        dataset = get_data_qa_dataset(plan.dataset)
        if dataset is None:
            raise DataQaSqlError(f"不支持的数据集: {plan.dataset}")
        if not dataset.scope_expression:
            raise DataQaSqlError("数据集缺少项目边界，拒绝执行。")

        dimensions = [self._require_field(dataset, field_id) for field_id in plan.dimensions]
        measures = plan.measures or [DataQaMeasure(field="id", aggregation="count", alias="row_count")]

        select_parts: list[str] = []
        group_by_parts: list[str] = []
        columns: list[str] = []
        labels: dict[str, str] = {}

        for field in dimensions:
            alias = field.id
            select_parts.append(f"{field.expression} AS {alias}")
            group_by_parts.append(field.expression)
            columns.append(alias)
            labels[alias] = field.label

        for measure in measures:
            field = self._require_field(dataset, measure.field)
            alias = measure.alias or _default_measure_alias(field.id, measure.aggregation)
            expression = self._compile_measure(field, measure)
            select_parts.append(f"{expression} AS {alias}")
            columns.append(alias)
            labels[alias] = _measure_label(field, measure)

        where_parts = [f"{dataset.scope_expression} = ANY(%s::uuid[])"]
        params: list[Any] = [project_ids]
        for item in plan.filters:
            where_sql, where_params = self._compile_filter(dataset, item)
            where_parts.append(where_sql)
            params.extend(where_params)

        order_by = self._compile_sort(plan, dataset, columns)
        limit = min(max(int(plan.limit or 100), 1), 500)

        sql_parts = [
            "SELECT",
            f"    {', '.join(select_parts)}",
            "FROM",
            f"    {_compact_sql(dataset.from_sql)}",
            "WHERE",
            f"    {' AND '.join(where_parts)}",
        ]
        if group_by_parts:
            sql_parts.append(f"GROUP BY {', '.join(group_by_parts)}")
        if order_by:
            sql_parts.append(f"ORDER BY {order_by}")
        sql_parts.extend(["LIMIT %s"])
        params.append(limit)

        return CompiledDataQaQuery(
            sql="\n".join(sql_parts),
            params=params,
            columns=columns,
            column_labels=labels,
            limit=limit,
            warnings=[],
        )

    def _parse_single_select(self, sql: str) -> exp.Select:
        try:
            statements = sqlglot.parse(sql, read=POSTGRES_DIALECT)
        except ParseError as error:
            raise DataQaSqlError(f"模型生成的 SQL 无法解析: {error}") from error

        statements = [statement for statement in statements if statement is not None]
        if len(statements) != 1:
            raise DataQaSqlError("智能问数只允许一条 SELECT 语句。")
        tree = statements[0]
        if not isinstance(tree, exp.Select):
            raise DataQaSqlError("智能问数只允许 SELECT 查询。")
        return tree

    def _validate_sql_tree(self, tree: exp.Select, dataset: DataQaDataset) -> None:
        if tree.args.get("into"):
            raise DataQaSqlError("智能问数不允许 SELECT INTO。")
        if any(tree.find_all(exp.Placeholder)):
            raise DataQaSqlError("模型 SQL 不允许自带参数占位符。")
        if any(tree.find_all(exp.With, exp.Subquery, exp.Union, exp.Except, exp.Intersect)):
            raise DataQaSqlError("智能问数 V1 暂不允许 CTE、子查询或集合查询。")
        if any(tree.find_all(exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Drop, exp.Alter, exp.Merge, exp.Command, exp.Copy)):
            raise DataQaSqlError("智能问数只允许只读查询。")
        self._validate_functions(tree)
        self._validate_no_select_star(tree)
        self._validate_output_aliases(tree)
        query_aliases = self._validate_table_aliases(tree, dataset)
        self._validate_join_boundaries(tree, dataset, query_aliases)
        self._validate_columns(tree, dataset, query_aliases)

    def _validate_functions(self, tree: exp.Select) -> None:
        for function in tree.find_all(exp.Anonymous):
            name = str(function.name or "").lower()
            if name not in {"date_trunc", "nullif"}:
                raise DataQaSqlError(f"不允许的 SQL 函数: {function.name}")

    def _validate_no_select_star(self, tree: exp.Select) -> None:
        for star in tree.find_all(exp.Star):
            if isinstance(star.parent, exp.Count):
                continue
            raise DataQaSqlError("智能问数不允许 SELECT *，必须显式选择字段。")

    def _validate_output_aliases(self, tree: exp.Select) -> None:
        for expression in tree.expressions:
            alias = str(expression.alias_or_name or "").strip().lower()
            if not alias or not _OUTPUT_IDENTIFIER_RE.match(alias):
                raise DataQaSqlError("SELECT 字段必须使用小写字母、数字和下划线组成的输出名。")

    def _validate_table_aliases(self, tree: exp.Select, dataset: DataQaDataset) -> dict[str, str]:
        allowed_aliases = _catalog_alias_map(dataset)
        query_aliases = _query_alias_map(tree)
        if not query_aliases:
            raise DataQaSqlError("SQL 必须查询语义目录中的数据表。")

        scope_alias = _scope_alias(dataset)
        if scope_alias not in query_aliases:
            raise DataQaSqlError("SQL 缺少项目边界表，拒绝执行。")

        for alias, table_name in query_aliases.items():
            allowed_table = allowed_aliases.get(alias)
            if allowed_table is None:
                raise DataQaSqlError(f"SQL 使用了未授权的表别名: {alias}")
            if allowed_table != table_name:
                raise DataQaSqlError(f"表别名 {alias} 必须引用 {allowed_table}，不能引用 {table_name}。")
        return query_aliases

    def _validate_join_boundaries(self, tree: exp.Select, dataset: DataQaDataset, query_aliases: dict[str, str]) -> None:
        expected_pairs = _catalog_join_pairs(dataset)
        query_pairs = _query_join_pairs(tree)
        for alias, pairs in expected_pairs.items():
            if alias not in query_aliases:
                continue
            if not pairs.issubset(query_pairs.get(alias, set())):
                raise DataQaSqlError(f"表别名 {alias} 必须按语义目录定义的关系连接。")

    def _validate_columns(self, tree: exp.Select, dataset: DataQaDataset, query_aliases: dict[str, str]) -> None:
        allowed_columns = _catalog_allowed_columns(dataset)
        output_aliases = _select_aliases(tree)
        for column in tree.find_all(exp.Column):
            table_alias = str(column.table or "").lower()
            column_name = str(column.name or "").lower()
            if not column_name:
                continue
            if not table_alias:
                if column_name in output_aliases and _has_ancestor(column, (exp.Order, exp.Ordered)):
                    continue
                raise DataQaSqlError(f"字段 {column_name} 必须带表别名。")
            if table_alias not in query_aliases:
                raise DataQaSqlError(f"字段 {table_alias}.{column_name} 使用了未连接的表别名。")
            if (table_alias, column_name) not in allowed_columns:
                raise DataQaSqlError(f"字段 {table_alias}.{column_name} 不在语义目录白名单内。")

    def _inject_scope(self, tree: exp.Select, scope_expression: str) -> exp.Select:
        scoped_tree = tree.copy()
        condition = sqlglot.parse_one(
            f"{scope_expression} = ANY(%(authorized_project_ids)s::uuid[])",
            read=POSTGRES_DIALECT,
        )
        current_where = scoped_tree.args.get("where")
        if current_where is None:
            scoped_tree.set("where", exp.Where(this=condition))
        else:
            scoped_tree.set("where", exp.Where(this=exp.and_(condition, current_where.this)))
        return scoped_tree

    def _ensure_limit(self, tree: exp.Select) -> tuple[exp.Select, int, list[str]]:
        warnings: list[str] = []
        limit_expression = tree.args.get("limit")
        if limit_expression is None:
            warnings.append(f"模型 SQL 未显式限制返回行数，已自动添加 LIMIT {DEFAULT_SQL_LIMIT}。")
            return tree.limit(DEFAULT_SQL_LIMIT), DEFAULT_SQL_LIMIT, warnings

        expression = limit_expression.expression
        if isinstance(expression, exp.Literal) and not expression.is_string:
            requested_limit = _literal_to_int(expression)
            if requested_limit < 1:
                warnings.append(f"模型 SQL 的 LIMIT 小于 1，已改为 LIMIT {DEFAULT_SQL_LIMIT}。")
                return tree.limit(DEFAULT_SQL_LIMIT), DEFAULT_SQL_LIMIT, warnings
            if requested_limit > MAX_SQL_LIMIT:
                warnings.append(f"模型 SQL 的 LIMIT 超过 {MAX_SQL_LIMIT}，已截断为 LIMIT {MAX_SQL_LIMIT}。")
                return tree.limit(MAX_SQL_LIMIT), MAX_SQL_LIMIT, warnings
            return tree, requested_limit, warnings

        warnings.append(f"模型 SQL 的 LIMIT 不是常量，已改为 LIMIT {DEFAULT_SQL_LIMIT}。")
        return tree.limit(DEFAULT_SQL_LIMIT), DEFAULT_SQL_LIMIT, warnings

    def _parameterize_literals(self, tree: exp.Select, params: dict[str, Any]) -> exp.Select:
        counter = 1

        def replace_literal(node: exp.Expression) -> exp.Expression:
            nonlocal counter
            if not isinstance(node, exp.Literal):
                return node
            name = f"dataqa_param_{counter}"
            counter += 1
            params[name] = _literal_to_param(node)
            return exp.Placeholder(this=name)

        return tree.transform(replace_literal, copy=True)

    def _select_columns(self, tree: exp.Select) -> list[str]:
        columns: list[str] = []
        for index, expression in enumerate(tree.expressions):
            alias = str(expression.alias_or_name or "").strip()
            columns.append(alias if alias and alias != "*" else f"column_{index + 1}")
        return columns

    def _require_field(self, dataset: DataQaDataset, field_id: str) -> DataQaField:
        field = dataset.fields.get(field_id)
        if field is None:
            raise DataQaSqlError(f"数据集 {dataset.id} 不支持字段: {field_id}")
        return field

    def _compile_measure(self, field: DataQaField, measure: DataQaMeasure) -> str:
        aggregation = measure.aggregation
        if aggregation == "count":
            return "COUNT(*)"
        if aggregation == "count_distinct":
            return f"COUNT(DISTINCT {field.expression})"
        if aggregation in {"sum", "avg"} and field.value_type not in {"number", "integer"}:
            raise DataQaSqlError(f"字段 {field.id} 不是数值字段，不能执行 {aggregation}")
        return f"{aggregation.upper()}({field.expression})"

    def _compile_filter(self, dataset: DataQaDataset, item: DataQaFilter) -> tuple[str, list[Any]]:
        field = self._require_field(dataset, item.field)
        operator = item.operator
        if operator == "is_null":
            return f"{field.expression} IS NULL", []
        if operator == "not_null":
            return f"{field.expression} IS NOT NULL", []
        if operator == "eq":
            return f"{field.expression} = %s", [item.value]
        if operator == "neq":
            return f"{field.expression} <> %s", [item.value]
        if operator == "gt":
            return f"{field.expression} > %s", [item.value]
        if operator == "gte":
            return f"{field.expression} >= %s", [item.value]
        if operator == "lt":
            return f"{field.expression} < %s", [item.value]
        if operator == "lte":
            return f"{field.expression} <= %s", [item.value]
        if operator == "contains":
            return f"LOWER(COALESCE({field.expression}::text, '')) LIKE %s", [f"%{str(item.value or '').lower()}%"]
        if operator == "starts_with":
            return f"LOWER(COALESCE({field.expression}::text, '')) LIKE %s", [f"{str(item.value or '').lower()}%"]
        if operator == "in":
            values = item.value if isinstance(item.value, list) else []
            values = values[:100]
            if not values:
                raise DataQaSqlError("IN 过滤器必须提供非空数组。")
            return f"{field.expression} = ANY(%s)", [values]
        raise DataQaSqlError(f"不支持的过滤操作: {operator}")

    def _compile_sort(self, plan: DataQaQueryPlan, dataset: DataQaDataset, selected_columns: list[str]) -> str:
        if not plan.sort:
            if plan.dimensions and len(selected_columns) > len(plan.dimensions):
                return f"{selected_columns[-1]} DESC"
            return ""

        order_parts: list[str] = []
        allowed_output_columns = set(selected_columns)
        for sort in plan.sort:
            if sort.field in allowed_output_columns:
                order_parts.append(f"{sort.field} {sort.direction.upper()}")
                continue
            raise DataQaSqlError("智能问数只能按已选择的维度或指标排序。")
        return ", ".join(order_parts)


def _catalog_alias_map(dataset: DataQaDataset) -> dict[str, str]:
    tree = _parse_catalog_from_sql(dataset)
    aliases: dict[str, str] = {}
    for table in tree.find_all(exp.Table):
        if table.db or table.catalog:
            raise DataQaSqlError("语义目录不支持跨 schema 表引用。")
        aliases[str(table.alias_or_name).lower()] = str(table.name).lower()
    return aliases


def _query_alias_map(tree: exp.Select) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for table in tree.find_all(exp.Table):
        if table.db or table.catalog:
            raise DataQaSqlError("智能问数不允许跨 schema 表引用。")
        alias = str(table.alias_or_name).lower()
        table_name = str(table.name).lower()
        if alias in aliases and aliases[alias] != table_name:
            raise DataQaSqlError(f"表别名重复: {alias}")
        aliases[alias] = table_name
    return aliases


def _scope_alias(dataset: DataQaDataset) -> str:
    expression = sqlglot.parse_one(dataset.scope_expression, read=POSTGRES_DIALECT)
    column = next(expression.find_all(exp.Column), None)
    if column is None or not column.table:
        raise DataQaSqlError("数据集项目边界必须包含表别名。")
    return str(column.table).lower()


def _catalog_join_pairs(dataset: DataQaDataset) -> dict[str, set[tuple[str, str]]]:
    tree = _parse_catalog_from_sql(dataset)
    expected_pairs: dict[str, set[tuple[str, str]]] = {}
    for join in tree.find_all(exp.Join):
        target = join.this
        if not isinstance(target, exp.Table):
            continue
        alias = str(target.alias_or_name).lower()
        pairs = _equality_column_pairs(join.args.get("on"))
        if pairs:
            expected_pairs.setdefault(alias, set()).update(pairs)
    return expected_pairs


def _query_join_pairs(tree: exp.Select) -> dict[str, set[tuple[str, str]]]:
    query_pairs: dict[str, set[tuple[str, str]]] = {}
    for join in tree.find_all(exp.Join):
        target = join.this
        if not isinstance(target, exp.Table):
            raise DataQaSqlError("智能问数只允许直接 JOIN 白名单表。")
        alias = str(target.alias_or_name).lower()
        pairs = _equality_column_pairs(join.args.get("on"))
        if not pairs:
            raise DataQaSqlError(f"JOIN {alias} 缺少字段等值连接条件。")
        query_pairs.setdefault(alias, set()).update(pairs)
    return query_pairs


def _equality_column_pairs(expression: exp.Expression | None) -> set[tuple[str, str]]:
    if expression is None:
        return set()
    pairs: set[tuple[str, str]] = set()
    for item in expression.find_all(exp.EQ):
        left = item.left
        right = item.right
        if not isinstance(left, exp.Column) or not isinstance(right, exp.Column):
            continue
        if not left.table or not right.table:
            continue
        pair = tuple(sorted((_qualified_column(left), _qualified_column(right))))
        pairs.add(pair)
    return pairs


def _catalog_allowed_columns(dataset: DataQaDataset) -> set[tuple[str, str]]:
    columns: set[tuple[str, str]] = set()
    for field in dataset.fields.values():
        columns.update(_columns_in_sql_expression(field.expression))
    columns.update(_columns_in_sql_expression(dataset.scope_expression))
    for column in _parse_catalog_from_sql(dataset).find_all(exp.Column):
        columns.add((str(column.table).lower(), str(column.name).lower()))
    return columns


def _columns_in_sql_expression(sql_expression: str) -> set[tuple[str, str]]:
    expression = sqlglot.parse_one(sql_expression, read=POSTGRES_DIALECT)
    columns: set[tuple[str, str]] = set()
    for column in expression.find_all(exp.Column):
        if column.table and column.name:
            columns.add((str(column.table).lower(), str(column.name).lower()))
    return columns


def _qualified_column(column: exp.Column) -> str:
    return f"{str(column.table).lower()}.{str(column.name).lower()}"


def _parse_catalog_from_sql(dataset: DataQaDataset) -> exp.Select:
    try:
        tree = sqlglot.parse_one(f"SELECT 1 FROM {dataset.from_sql}", read=POSTGRES_DIALECT)
    except ParseError as error:
        raise DataQaSqlError(f"语义目录数据集 {dataset.id} 无法解析: {error}") from error
    if not isinstance(tree, exp.Select):
        raise DataQaSqlError(f"语义目录数据集 {dataset.id} 必须是 SELECT FROM 片段。")
    return tree


def _select_aliases(tree: exp.Select) -> set[str]:
    aliases: set[str] = set()
    for expression in tree.expressions:
        alias = str(expression.alias_or_name or "").strip().lower()
        if alias and alias != "*":
            aliases.add(alias)
    return aliases


def _has_ancestor(node: exp.Expression, ancestor_types: tuple[type[exp.Expression], ...]) -> bool:
    current = node.parent
    while current is not None:
        if isinstance(current, ancestor_types):
            return True
        current = current.parent
    return False


def _literal_to_int(expression: exp.Literal) -> int:
    try:
        return int(str(expression.this))
    except (TypeError, ValueError):
        return DEFAULT_SQL_LIMIT


def _literal_to_param(expression: exp.Literal) -> Any:
    if expression.is_string:
        return str(expression.this)
    raw_value = str(expression.this)
    if re.match(r"^[+-]?\d+$", raw_value):
        try:
            return int(raw_value)
        except ValueError:
            return raw_value
    try:
        return Decimal(raw_value)
    except (InvalidOperation, ValueError):
        return raw_value


def _default_measure_alias(field_id: str, aggregation: str) -> str:
    if aggregation == "count":
        return f"{field_id}_count"
    if aggregation == "count_distinct":
        return f"{field_id}_distinct_count"
    return f"{field_id}_{aggregation}"


def _measure_label(field: DataQaField, measure: DataQaMeasure) -> str:
    labels = {
        "count": "数量",
        "count_distinct": "去重数量",
        "sum": "合计",
        "avg": "平均",
        "min": "最小",
        "max": "最大",
    }
    return f"{field.label}{labels.get(measure.aggregation, measure.aggregation)}"


def _compact_sql(sql: str) -> str:
    return " ".join(part.strip() for part in sql.splitlines() if part.strip())
