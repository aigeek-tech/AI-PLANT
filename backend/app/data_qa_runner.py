from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import json
from threading import Event
from typing import Any

from pydantic import ValidationError

from .agent_models import AgentRunResult
from .agent_runner import AgentJobCancelled
from .ai_client import complete_chat_messages
from .authorization import AuthenticatedUser, build_authenticated_user
from .data_qa_catalog import select_relevant_datasets, serialize_catalog
from .data_qa_models import DataQaSqlDraft
from .data_qa_scope import DataQaScope, DataQaScopeError, DataScopeResolver
from .data_qa_sql import CompiledDataQaQuery, DataQaSqlCompiler, DataQaSqlError
from .db import fetch_one, get_connection
from .repository import get_ai_settings_secret


DATA_QA_BACKEND_ID = "smart-design-data-qa"
MAX_RESULT_ROWS = 200


class DataQaRunner:
    def create_session_dir(self, _run_id: str) -> None:
        return None

    def terminate(self) -> None:
        return None

    def run(self, run: dict, emit_event, cancel_event: Event) -> AgentRunResult:
        _raise_if_cancelled(cancel_event)
        settings = _load_enabled_ai_settings()
        current_user = load_data_qa_user(str(run.get("created_by") or ""))
        question = str(run.get("prompt") or "").strip()
        if not question:
            raise RuntimeError("智能问数问题不能为空。")

        scope = DataScopeResolver().resolve(
            question=question,
            context_scope=str(run.get("context_scope") or "none"),
            context_ref=run.get("context_ref") if isinstance(run.get("context_ref"), dict) else {},
            current_user=current_user,
        )
        emit_event("scope_resolved", "已解析问数权限范围", {"scope": _scope_payload(scope)})

        _raise_if_cancelled(cancel_event)
        datasets = select_relevant_datasets(question)
        catalog_payload = serialize_catalog(datasets)
        emit_event(
            "catalog_selected",
            "已选择语义目录",
            {"datasets": [item["id"] for item in catalog_payload], "catalog": catalog_payload},
        )

        _raise_if_cancelled(cancel_event)
        draft, planner_responses, compiled = _generate_and_compile_sql(
            settings=settings,
            question=question,
            scope=scope,
            catalog=catalog_payload,
            run=run,
            emit_event=emit_event,
            cancel_event=cancel_event,
        )
        emit_event(
            "sql_compiled",
            "已校验并编译只读参数化 SQL",
            {
                "generated_sql": compiled.sql,
                "columns": compiled.columns,
                "params_count": _params_count(compiled.params),
            },
        )

        _raise_if_cancelled(cancel_event)
        query_result = execute_data_qa_query(compiled)
        emit_event(
            "sql_executed",
            "已执行只读查询",
            {
                "row_count": query_result["row_count"],
                "truncated": query_result["truncated"],
            },
        )

        _raise_if_cancelled(cancel_event)
        chart = _build_chart(draft, query_result)
        answer_response: dict | None = None
        try:
            answer_response = complete_chat_messages(
                settings,
                messages=_build_answer_messages(
                    question=question,
                    scope=scope,
                    draft=draft,
                    generated_sql=compiled.sql,
                    query_result=query_result,
                ),
            )
            answer = str(answer_response.get("text") or "").strip() or _fallback_answer(query_result)
        except Exception:
            answer = _fallback_answer(query_result)
        emit_event("answer_generated", "已生成结果解读", {"answer": answer})
        emit_event("assistant_message", answer, {"message": answer})

        usage = _merge_usage(
            *[response.get("usage") for response in planner_responses],
            answer_response.get("usage") if answer_response else None,
        )
        if usage:
            emit_event("usage", "模型用量", {"usage": usage})

        data_qa = {
            "generated_sql": compiled.sql,
            "columns": query_result["columns"],
            "rows": query_result["rows"],
            "row_count": query_result["row_count"],
            "truncated": query_result["truncated"],
            "chart": chart,
            "execution_steps": _execution_steps(scope, catalog_payload, draft, compiled, query_result),
            "warnings": [*compiled.warnings],
            "scope": _scope_payload(scope),
            "sql_draft": draft.model_dump(by_alias=True),
        }
        return AgentRunResult(
            result={
                "answer": answer,
                "backend": DATA_QA_BACKEND_ID,
                "model": (answer_response or {}).get("model") or _last_response_model(planner_responses) or settings.get("model"),
                "usage": usage,
                "data_qa": data_qa,
            }
        )


def load_data_qa_user(user_id: str) -> AuthenticatedUser:
    row = fetch_one(
        """
        SELECT id, username, email, display_name, status, last_login_at, created_at, updated_at
        FROM user_account
        WHERE id = %s
        """,
        (user_id,),
    )
    if row is None:
        raise RuntimeError("当前用户不存在，无法执行智能问数。")
    return build_authenticated_user(row)


def execute_data_qa_query(compiled: CompiledDataQaQuery) -> dict:
    rows: list[dict] = []
    column_names = compiled.columns
    with get_connection() as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION READ ONLY")
                cursor.execute("SET LOCAL statement_timeout = '10000ms'")
                cursor.execute(compiled.sql, _execute_params(compiled.params))
                if cursor.description:
                    column_names = [column.name for column in cursor.description]
                rows = [_json_safe_row(dict(row)) for row in cursor.fetchall()]

    limited_rows = rows[:MAX_RESULT_ROWS]
    return {
        "columns": [{"key": key, "label": compiled.column_labels.get(key, key)} for key in column_names],
        "rows": limited_rows,
        "row_count": len(limited_rows),
        "truncated": len(rows) > len(limited_rows),
    }


def _execute_params(params: list[Any] | dict[str, Any]) -> tuple[Any, ...] | dict[str, Any]:
    if isinstance(params, dict):
        return params
    return tuple(params)


def _load_enabled_ai_settings() -> dict:
    settings = get_ai_settings_secret()
    if not settings.get("is_enabled", True):
        raise RuntimeError("AI settings are disabled")
    if not str(settings.get("model") or "").strip():
        raise RuntimeError("AI model is not configured")
    if not settings.get("api_key"):
        raise RuntimeError("AI API key is not configured")
    if not str(settings.get("base_url") or "").strip():
        raise RuntimeError("AI base URL is not configured")
    return settings


def _generate_and_compile_sql(
    *,
    settings: dict,
    question: str,
    scope: DataQaScope,
    catalog: list[dict],
    run: dict,
    emit_event,
    cancel_event: Event,
) -> tuple[DataQaSqlDraft, list[dict], CompiledDataQaQuery]:
    responses: list[dict] = []
    previous_error: str | None = None
    previous_response: str | None = None
    compiler = DataQaSqlCompiler()

    for attempt in range(1, 3):
        _raise_if_cancelled(cancel_event)
        response = complete_chat_messages(
            settings,
            messages=_build_sql_draft_messages(
                question=question,
                scope=scope,
                catalog=catalog,
                run=run,
                previous_error=previous_error,
                previous_response=previous_response,
            ),
        )
        responses.append(response)
        previous_response = str(response.get("text") or "")
        try:
            draft = _parse_sql_draft(previous_response)
            emit_event(
                "query_planned",
                "已生成 SQL 查询草案",
                {"draft": draft.model_dump(by_alias=True), "source": "llm", "attempt": attempt},
            )
            compiled = compiler.compile_sql_draft(draft, allowed_project_ids=scope.project_ids)
            return draft, responses, compiled
        except (RuntimeError, DataQaSqlError) as error:
            previous_error = str(error)
            if attempt >= 2:
                raise RuntimeError(f"模型生成的 SQL 未通过校验: {previous_error}") from error
            emit_event(
                "query_retry",
                "SQL 草案未通过校验，正在重新生成",
                {"attempt": attempt, "error": previous_error},
            )

    raise RuntimeError("模型生成的 SQL 未通过校验。")


def _build_sql_draft_messages(
    *,
    question: str,
    scope: DataQaScope,
    catalog: list[dict],
    run: dict,
    previous_error: str | None = None,
    previous_response: str | None = None,
) -> list[dict]:
    return [
        {
            "role": "system",
            "content": "\n".join(
                [
                    "You are SQLBot-style Smart Design data QA.",
                    "Return one JSON object only. Do not return Markdown or explanations outside JSON.",
                    "Generate PostgreSQL SELECT SQL from the provided semantic catalog.",
                    "The backend will parse, validate, parameterize, inject authorization scope, and execute the SQL.",
                    "Never invent dataset ids, tables, aliases, columns, fields, project ids, or project filters.",
                    "Use only one dataset from catalog. Use table aliases exactly as shown in from_sql.",
                    "Use only explicit selected columns. Never use SELECT * except COUNT(*).",
                    "Every selected expression must have a lowercase snake_case output name.",
                    "When joining helper tables, use the exact relationship shown in from_sql.",
                    "Do not add project scope predicates yourself; the backend injects authorized project scope.",
                    "Always include a constant LIMIT, default 100 unless the user clearly asks for a smaller number.",
                    "Schema: {\"success\": true, \"dataset\": string, \"sql\": string, \"tables\": string[], \"chart-type\": \"bar|column|line|pie|table\", \"chart\": {\"type\": \"bar|column|line|pie|table\", \"x\": string, \"y\": string}, \"brief\": string}. If impossible: {\"success\": false, \"message\": string}.",
                ]
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "question": question,
                    "context_scope": run.get("context_scope") or "none",
                    "scope": {
                        "mode": scope.mode,
                        "project_count": len(scope.project_ids),
                        "projects": [
                            {"code": project.get("code"), "name": project.get("name")}
                            for project in scope.projects[:20]
                        ],
                    },
                    "catalog": catalog,
                    "previous_error": previous_error,
                    "previous_response": previous_response,
                },
                ensure_ascii=False,
                default=str,
            ),
        },
    ]


def _build_answer_messages(
    *,
    question: str,
    scope: DataQaScope,
    draft: DataQaSqlDraft,
    generated_sql: str,
    query_result: dict,
) -> list[dict]:
    return [
        {
            "role": "system",
            "content": "\n".join(
                [
                    "You are a concise engineering data analyst inside Smart Design.",
                    "Answer in Chinese.",
                    "Explain what the result shows. Mention empty or truncated results plainly.",
                    "Do not claim access outside the resolved authorization scope.",
                ]
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "question": question,
                    "scope": {"mode": scope.mode, "project_count": len(scope.project_ids)},
                    "sql_draft": draft.model_dump(by_alias=True),
                    "generated_sql": generated_sql,
                    "columns": query_result.get("columns"),
                    "rows": query_result.get("rows"),
                    "row_count": query_result.get("row_count"),
                    "truncated": query_result.get("truncated"),
                },
                ensure_ascii=False,
                default=str,
            ),
        },
    ]


def _parse_sql_draft(raw_text: object) -> DataQaSqlDraft:
    text = str(raw_text or "").strip()
    if not text:
        raise RuntimeError("模型没有返回 SQL 草案。")
    try:
        payload = json.loads(_extract_json_object(text))
        return DataQaSqlDraft.model_validate(payload)
    except json.JSONDecodeError as error:
        raise RuntimeError("模型返回的 SQL 草案不是有效 JSON。") from error
    except ValidationError as error:
        raise RuntimeError(f"模型返回的 SQL 草案不符合约束: {error.errors()[0]['msg']}") from error


def _extract_json_object(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`").strip()
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start < 0 or end < start:
        raise json.JSONDecodeError("No JSON object found", stripped, 0)
    return stripped[start : end + 1]


def _build_chart(draft: DataQaSqlDraft, query_result: dict) -> dict | None:
    chart_type = draft.chart.type if draft.chart is not None else draft.chart_type
    if chart_type == "table":
        return None
    rows = query_result.get("rows")
    if not isinstance(rows, list) or not rows:
        return None
    x_key = draft.chart.x if draft.chart is not None else None
    y_key = draft.chart.y if draft.chart is not None else None
    x_key = x_key or _first_non_numeric_column(query_result)
    y_key = y_key or (_first_numeric_column(query_result, exclude={x_key} if x_key else set()))
    if not x_key or not y_key:
        return None
    data = [
        {"x": row.get(x_key), "y": row.get(y_key)}
        for row in rows
        if isinstance(row, dict) and row.get(x_key) is not None and isinstance(row.get(y_key), (int, float))
    ]
    if not data:
        return None
    return {"type": chart_type, "x": x_key, "y": y_key, "data": data}


def _first_non_numeric_column(query_result: dict) -> str | None:
    rows = query_result.get("rows")
    columns = query_result.get("columns")
    if not isinstance(rows, list) or not isinstance(columns, list):
        return None
    for column in columns:
        if not isinstance(column, dict):
            continue
        key = str(column.get("key") or "")
        if not key:
            continue
        if any(isinstance(row, dict) and row.get(key) is not None and not isinstance(row.get(key), (int, float)) for row in rows):
            return key
    return None


def _first_numeric_column(query_result: dict, *, exclude: set[str]) -> str | None:
    rows = query_result.get("rows")
    columns = query_result.get("columns")
    if not isinstance(rows, list) or not isinstance(columns, list):
        return None
    for column in columns:
        if not isinstance(column, dict):
            continue
        key = str(column.get("key") or "")
        if not key or key in exclude:
            continue
        if any(isinstance(row, dict) and isinstance(row.get(key), (int, float)) for row in rows):
            return key
    return None


def _execution_steps(
    scope: DataQaScope,
    catalog: list[dict],
    draft: DataQaSqlDraft,
    compiled: CompiledDataQaQuery,
    query_result: dict,
) -> list[dict]:
    return [
        {"step": "scope_resolved", "mode": scope.mode, "project_count": len(scope.project_ids)},
        {"step": "catalog_selected", "datasets": [item["id"] for item in catalog]},
        {"step": "query_planned", "dataset": draft.dataset, "chart_type": draft.chart_type},
        {"step": "sql_compiled", "columns": compiled.columns},
        {"step": "sql_executed", "row_count": query_result.get("row_count"), "truncated": query_result.get("truncated")},
    ]


def _scope_payload(scope: DataQaScope) -> dict:
    return {
        "mode": scope.mode,
        "project_count": len(scope.project_ids),
        "projects": [{"id": project.get("id"), "code": project.get("code"), "name": project.get("name")} for project in scope.projects],
    }


def _merge_usage(*items: object) -> dict | None:
    merged: dict[str, Any] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        for key, value in item.items():
            if isinstance(value, (int, float)):
                merged[key] = merged.get(key, 0) + value
            elif key not in merged:
                merged[key] = value
    return merged or None


def _last_response_model(responses: list[dict]) -> str | None:
    for response in reversed(responses):
        model = response.get("model")
        if model:
            return str(model)
    return None


def _params_count(params: list[Any] | dict[str, Any]) -> int:
    return len(params)


def _fallback_answer(query_result: dict) -> str:
    row_count = int(query_result.get("row_count") or 0)
    if row_count == 0:
        return "没有查到符合条件的数据。"
    columns = query_result.get("columns")
    rows = query_result.get("rows")
    if isinstance(columns, list) and len(columns) == 1 and isinstance(rows, list) and len(rows) == 1:
        column = columns[0]
        row = rows[0]
        if isinstance(column, dict) and isinstance(row, dict):
            key = str(column.get("key") or "")
            label = str(column.get("label") or key or "结果")
            value = row.get(key)
            if isinstance(value, (int, float)):
                return f"查询结果：{label}为 {_format_number(value)}。"
    return f"查询返回 {row_count} 行结果。"


def _format_number(value: int | float) -> str:
    if isinstance(value, float) and not value.is_integer():
        return f"{value:,.3f}".rstrip("0").rstrip(".")
    return f"{int(value):,}"


def _raise_if_cancelled(cancel_event: Event) -> None:
    if cancel_event.is_set():
        raise AgentJobCancelled("Agent run was cancelled")


def _json_safe_row(row: dict) -> dict:
    return {key: _json_safe_value(value) for key, value in row.items()}


def _json_safe_value(value: object) -> object:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value
