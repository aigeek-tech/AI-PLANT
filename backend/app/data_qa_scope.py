from __future__ import annotations

from dataclasses import dataclass

from .authorization import AuthenticatedUser
from .db import fetch_all


class DataQaScopeError(RuntimeError):
    pass


@dataclass(frozen=True)
class DataQaScope:
    mode: str
    project_ids: list[str]
    projects: list[dict]

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "project_ids": self.project_ids,
            "projects": self.projects,
        }


class DataScopeResolver:
    def resolve(
        self,
        *,
        question: str,
        context_scope: str,
        context_ref: dict | None,
        current_user: AuthenticatedUser,
    ) -> DataQaScope:
        context = context_ref if isinstance(context_ref, dict) else {}
        normalized_question = question.strip().lower()

        explicit_ids = _extract_project_ids(context)
        if explicit_ids:
            return self._resolve_specified_project_ids(explicit_ids, current_user)

        context_project_id = _extract_single_project_id(context)
        requests_cross_project = _requests_cross_project(normalized_question)
        if context_project_id and not requests_cross_project:
            return self._resolve_current_project(context_project_id, current_user)

        authorized_projects = self._load_authorized_projects(current_user)
        if not authorized_projects:
            raise DataQaScopeError("当前用户没有可读取的项目，无法执行智能问数。")

        specified = _match_named_projects(normalized_question, authorized_projects)
        if specified:
            return DataQaScope(
                mode="specified_projects",
                project_ids=[str(project["id"]) for project in specified],
                projects=specified,
            )

        if context_scope == "project" and context_project_id and not requests_cross_project:
            return self._resolve_current_project(context_project_id, current_user)

        return DataQaScope(
            mode="authorized_projects",
            project_ids=[str(project["id"]) for project in authorized_projects],
            projects=authorized_projects,
        )

    def _resolve_current_project(self, project_id: str, current_user: AuthenticatedUser) -> DataQaScope:
        if not current_user.has_permission("project.read", project_id=project_id):
            raise DataQaScopeError("当前用户没有读取当前项目的权限。")
        projects = self._load_projects_by_ids([project_id], current_user)
        if not projects:
            raise DataQaScopeError("当前项目不存在或已归档。")
        return DataQaScope(
            mode="current_project",
            project_ids=[str(projects[0]["id"])],
            projects=projects,
        )

    def _resolve_specified_project_ids(self, project_ids: list[str], current_user: AuthenticatedUser) -> DataQaScope:
        unauthorized = [project_id for project_id in project_ids if not current_user.has_permission("project.read", project_id=project_id)]
        if unauthorized:
            raise DataQaScopeError("请求包含当前用户无权读取的项目。")
        projects = self._load_projects_by_ids(project_ids, current_user)
        found_ids = {str(project["id"]) for project in projects}
        missing_ids = [project_id for project_id in project_ids if project_id not in found_ids]
        if missing_ids:
            raise DataQaScopeError("指定项目不存在或已归档。")
        return DataQaScope(mode="specified_projects", project_ids=project_ids, projects=projects)

    def _load_authorized_projects(self, current_user: AuthenticatedUser) -> list[dict]:
        if current_user.has_system_permission("project.read"):
            return fetch_all(
                """
                SELECT id::text AS id, code, name
                FROM project
                WHERE status <> 'archived'
                ORDER BY code, name
                """
            )

        project_ids = current_user.project_ids_with_permission("project.read")
        if not project_ids:
            return []
        return self._load_projects_by_ids(project_ids, current_user)

    def _load_projects_by_ids(self, project_ids: list[str], current_user: AuthenticatedUser) -> list[dict]:
        if not project_ids:
            return []
        if not current_user.has_system_permission("project.read"):
            allowed_ids = set(current_user.project_ids_with_permission("project.read"))
            project_ids = [project_id for project_id in project_ids if project_id in allowed_ids]
        if not project_ids:
            return []
        return fetch_all(
            """
            SELECT id::text AS id, code, name
            FROM project
            WHERE id = ANY(%s::uuid[])
              AND status <> 'archived'
            ORDER BY code, name
            """,
            (project_ids,),
        )


def _extract_single_project_id(context_ref: dict) -> str | None:
    value = context_ref.get("project_id")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _extract_project_ids(context_ref: dict) -> list[str]:
    raw_ids = context_ref.get("project_ids")
    if isinstance(raw_ids, list):
        return _dedupe_text_values(raw_ids)

    explicit = context_ref.get("specified_project_ids")
    if isinstance(explicit, list):
        return _dedupe_text_values(explicit)
    return []


def _dedupe_text_values(values: list[object]) -> list[str]:
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = value.strip()
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def _requests_cross_project(question: str) -> bool:
    return any(marker in question for marker in ("所有项目", "全部项目", "跨项目", "各项目", "项目对比", "全局"))


def _match_named_projects(question: str, authorized_projects: list[dict]) -> list[dict]:
    matches: list[dict] = []
    for project in authorized_projects:
        code = str(project.get("code") or "").strip().lower()
        name = str(project.get("name") or "").strip().lower()
        if (code and code in question) or (name and name in question):
            matches.append(project)
    return matches
