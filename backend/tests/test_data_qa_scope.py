from unittest.mock import patch

import pytest

from app.authorization import AuthenticatedUser
from app.data_qa_scope import DataQaScopeError, DataScopeResolver


def make_user(*, system_permissions=None, project_permissions=None):
    return AuthenticatedUser(
        id="user-1",
        username="user-1",
        email=None,
        display_name="User One",
        status="active",
        last_login_at=None,
        created_at="2026-04-26T00:00:00Z",
        updated_at="2026-04-26T00:00:00Z",
        system_permissions=set(system_permissions or []),
        project_permissions=project_permissions or {},
        standard_permissions={},
        roles=[],
    )


def test_resolver_uses_current_project_when_context_is_project():
    current_user = make_user(project_permissions={"project-1": {"project.read"}, "project-2": {"project.read"}})

    with patch(
        "app.data_qa_scope.fetch_all",
        return_value=[{"id": "project-1", "code": "P-001", "name": "当前项目"}],
    ) as fetch_all:
        scope = DataScopeResolver().resolve(
            question="统计 TAG 数量",
            context_scope="project",
            context_ref={"project_id": "project-1"},
            current_user=current_user,
        )

    assert scope.mode == "current_project"
    assert scope.project_ids == ["project-1"]
    fetch_all.assert_called_once()


def test_resolver_allows_cross_project_question_from_project_context():
    current_user = make_user(project_permissions={"project-1": {"project.read"}, "project-2": {"project.read"}})

    with patch(
        "app.data_qa_scope.fetch_all",
        return_value=[
            {"id": "project-1", "code": "P-001", "name": "项目一"},
            {"id": "project-2", "code": "P-002", "name": "项目二"},
        ],
    ):
        scope = DataScopeResolver().resolve(
            question="统计所有项目的 TAG 数量",
            context_scope="project",
            context_ref={"project_id": "project-1"},
            current_user=current_user,
        )

    assert scope.mode == "authorized_projects"
    assert scope.project_ids == ["project-1", "project-2"]


def test_resolver_uses_all_authorized_projects_without_project_context():
    current_user = make_user(project_permissions={"project-1": {"project.read"}, "project-2": {"project.read"}})

    with patch(
        "app.data_qa_scope.fetch_all",
        return_value=[
            {"id": "project-1", "code": "P-001", "name": "项目一"},
            {"id": "project-2", "code": "P-002", "name": "项目二"},
        ],
    ):
        scope = DataScopeResolver().resolve(
            question="各项目文档数量",
            context_scope="none",
            context_ref={},
            current_user=current_user,
        )

    assert scope.mode == "authorized_projects"
    assert scope.project_ids == ["project-1", "project-2"]


def test_resolver_allows_system_project_read_to_query_all_projects():
    current_user = make_user(system_permissions={"project.read"})

    with patch(
        "app.data_qa_scope.fetch_all",
        return_value=[
            {"id": "project-1", "code": "P-001", "name": "项目一"},
            {"id": "project-2", "code": "P-002", "name": "项目二"},
        ],
    ) as fetch_all:
        scope = DataScopeResolver().resolve(
            question="所有项目设备分布",
            context_scope="none",
            context_ref={},
            current_user=current_user,
        )

    assert scope.mode == "authorized_projects"
    assert scope.project_ids == ["project-1", "project-2"]
    assert "status <> 'archived'" in fetch_all.call_args.args[0]


def test_resolver_rejects_explicit_project_without_permission():
    current_user = make_user(project_permissions={"project-1": {"project.read"}})

    with patch(
        "app.data_qa_scope.fetch_all",
        return_value=[{"id": "project-1", "code": "P-001", "name": "项目一"}],
    ):
        with pytest.raises(DataQaScopeError):
            DataScopeResolver().resolve(
                question="统计项目二的 TAG",
                context_scope="database",
                context_ref={"project_ids": ["project-2"]},
                current_user=current_user,
            )
