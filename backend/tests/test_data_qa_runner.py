from threading import Event
from unittest.mock import patch

from app.agent_models import AgentRunResult
from app.authorization import AuthenticatedUser
from app.data_qa_runner import DataQaRunner


def make_user():
    return AuthenticatedUser(
        id="user-1",
        username="user-1",
        email=None,
        display_name="User One",
        status="active",
        last_login_at=None,
        created_at="2026-04-26T00:00:00Z",
        updated_at="2026-04-26T00:00:00Z",
        system_permissions=set(),
        project_permissions={"project-1": {"project.read"}},
        standard_permissions={},
        roles=[],
    )


def test_data_qa_runner_returns_structured_data_qa_result():
    emitted: list[tuple[str, str, dict]] = []
    run = {
        "id": "run-1",
        "created_by": "user-1",
        "prompt": "按状态统计 TAG 数量",
        "context_scope": "database",
        "context_ref": {"project_id": "project-1"},
    }
    settings = {
        "provider": "ai-geek",
        "base_url": "https://api.example.com",
        "endpoint_path": "/v1/chat/completions",
        "model": "test-model",
        "api_key": "secret-key",
        "temperature": 0.2,
        "max_tokens": 4096,
        "timeout_seconds": 30,
        "is_enabled": True,
    }

    responses = [
        {
            "text": '{"success":true,"dataset":"tags","sql":"SELECT t.status AS status, COUNT(*) AS tag_count FROM tag t GROUP BY t.status ORDER BY tag_count DESC LIMIT 100","tables":["tag"],"chart-type":"bar","chart":{"type":"bar","x":"status","y":"tag_count"}}',
            "model": "test-model",
            "usage": {"total_tokens": 20},
        },
        {
            "text": "项目内共有两个 TAG 状态分组。",
            "model": "test-model",
            "usage": {"total_tokens": 10},
        },
    ]

    with (
        patch("app.data_qa_runner.get_ai_settings_secret", return_value=settings),
        patch("app.data_qa_runner.load_data_qa_user", return_value=make_user()),
        patch(
            "app.data_qa_scope.fetch_all",
            return_value=[{"id": "project-1", "code": "P-001", "name": "项目一"}],
        ),
        patch("app.data_qa_runner.complete_chat_messages", side_effect=responses),
        patch(
            "app.data_qa_runner.execute_data_qa_query",
            return_value={
                "columns": [{"key": "status", "label": "状态"}, {"key": "tag_count", "label": "TAG 数量"}],
                "rows": [{"status": "active", "tag_count": 3}, {"status": "archived", "tag_count": 1}],
                "row_count": 2,
                "truncated": False,
            },
        ) as execute_query,
    ):
        result = DataQaRunner().run(
            run,
            lambda event_type, message=None, payload=None: emitted.append((event_type, message or "", payload or {})),
            Event(),
        )

    assert isinstance(result, AgentRunResult)
    assert result.result["answer"] == "项目内共有两个 TAG 状态分组。"
    assert result.result["data_qa"]["generated_sql"] == execute_query.call_args.args[0].sql
    assert result.result["data_qa"]["sql_draft"]["dataset"] == "tags"
    assert result.result["data_qa"]["rows"][0]["tag_count"] == 3
    assert [event[0] for event in emitted] == [
        "scope_resolved",
        "catalog_selected",
        "query_planned",
        "sql_compiled",
        "sql_executed",
        "answer_generated",
        "assistant_message",
        "usage",
    ]


def test_data_qa_runner_uses_llm_sql_for_simple_count():
    emitted: list[tuple[str, str, dict]] = []
    run = {
        "id": "run-2",
        "created_by": "user-1",
        "prompt": "这个活项目现在有多少个tag",
        "context_scope": "project",
        "context_ref": {"project_id": "project-1"},
    }
    settings = {
        "provider": "ai-geek",
        "base_url": "https://api.example.com",
        "endpoint_path": "/v1/chat/completions",
        "model": "test-model",
        "api_key": "secret-key",
        "temperature": 0.2,
        "max_tokens": 4096,
        "timeout_seconds": 30,
        "is_enabled": True,
    }

    with (
        patch("app.data_qa_runner.get_ai_settings_secret", return_value=settings),
        patch("app.data_qa_runner.load_data_qa_user", return_value=make_user()),
        patch(
            "app.data_qa_scope.fetch_all",
            return_value=[{"id": "project-1", "code": "P-001", "name": "项目一"}],
        ),
        patch(
            "app.data_qa_runner.complete_chat_messages",
            side_effect=[
                {
                    "text": '{"success":true,"dataset":"tags","sql":"SELECT COUNT(*) AS tag_count FROM tag t LIMIT 1","tables":["tag"],"chart-type":"table"}',
                    "model": "test-model",
                    "usage": {"total_tokens": 12},
                },
                RuntimeError("请求上游接口超时"),
            ],
        ) as complete_chat,
        patch(
            "app.data_qa_runner.execute_data_qa_query",
            return_value={
                "columns": [{"key": "tag_count", "label": "TAG 数量"}],
                "rows": [{"tag_count": 7}],
                "row_count": 1,
                "truncated": False,
            },
        ),
    ):
        result = DataQaRunner().run(
            run,
            lambda event_type, message=None, payload=None: emitted.append((event_type, message or "", payload or {})),
            Event(),
        )

    assert complete_chat.call_count == 2
    assert result.result["answer"] == "查询结果：TAG 数量为 7。"
    assert result.result["data_qa"]["rows"] == [{"tag_count": 7}]
    assert [event[0] for event in emitted] == [
        "scope_resolved",
        "catalog_selected",
        "query_planned",
        "sql_compiled",
        "sql_executed",
        "answer_generated",
        "assistant_message",
        "usage",
    ]
