import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from psycopg import IntegrityError

from app.main import ProjectUpdate, app, delete_existing_project, delete_existing_project_tag, update_existing_project


client = TestClient(app)


class ProjectApiTest(unittest.TestCase):
    def test_updates_project(self):
        project = {
            "id": "project-1",
            "code": "PRJ-001",
            "name": "海上平台改造",
            "overview": "更新后的项目概况",
            "reference_attributes": {"standard_id": "standard-1"},
            "thumbnail_url": None,
            "status": "active",
            "metadata": {},
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T01:00:00Z",
        }
        payload = ProjectUpdate(
            code="PRJ-001",
            name="海上平台改造",
            overview="更新后的项目概况",
            reference_attributes={"standard_id": "standard-1"},
            thumbnail_url=None,
            status="active",
        )

        with patch("app.main.update_project", return_value=project) as update_project:
            response = update_existing_project("project-1", payload)

        self.assertEqual(response, {"data": project})
        update_project.assert_called_once_with(
            "project-1",
            {
                "code": "PRJ-001",
                "name": "海上平台改造",
                "overview": "更新后的项目概况",
                "reference_attributes": {"standard_id": "standard-1"},
                "thumbnail_url": None,
                "status": "active",
            },
        )

    def test_updates_project_with_thumbnail_data_url(self):
        thumbnail_url = "data:image/webp;base64,aGVsbG8="
        project = {
            "id": "project-1",
            "code": "PRJ-001",
            "name": "海上平台改造",
            "overview": "更新后的项目概况",
            "reference_attributes": {"standard_id": "standard-1"},
            "thumbnail_url": thumbnail_url,
            "status": "active",
            "metadata": {},
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T01:00:00Z",
        }
        payload = ProjectUpdate(
            code="PRJ-001",
            name="海上平台改造",
            overview="更新后的项目概况",
            reference_attributes={"standard_id": "standard-1"},
            thumbnail_url=thumbnail_url,
            status="active",
        )

        with patch("app.main.update_project", return_value=project) as update_project:
            response = update_existing_project("project-1", payload)

        self.assertEqual(response, {"data": project})
        update_project.assert_called_once_with(
            "project-1",
            {
                "code": "PRJ-001",
                "name": "海上平台改造",
                "overview": "更新后的项目概况",
                "reference_attributes": {"standard_id": "standard-1"},
                "thumbnail_url": thumbnail_url,
                "status": "active",
            },
        )

    def test_rejects_non_image_project_thumbnail(self):
        response = client.patch(
            "/api/projects/project-1",
            json={
                "code": "PRJ-001",
                "name": "海上平台改造",
                "overview": None,
                "reference_attributes": {},
                "thumbnail_url": "data:text/html;base64,PGh0bWw+",
                "status": "active",
            },
        )

        self.assertEqual(response.status_code, 422)

    def test_rejects_oversized_project_thumbnail(self):
        oversized_thumbnail = "data:image/webp;base64," + ("A" * 520000)

        response = client.patch(
            "/api/projects/project-1",
            json={
                "code": "PRJ-001",
                "name": "海上平台改造",
                "overview": None,
                "reference_attributes": {},
                "thumbnail_url": oversized_thumbnail,
                "status": "active",
            },
        )

        self.assertEqual(response.status_code, 422)

    def test_returns_404_for_missing_project_update(self):
        payload = ProjectUpdate(
            code="PRJ-404",
            name="缺失项目",
            overview=None,
            reference_attributes={},
            thumbnail_url=None,
            status="active",
        )

        with patch("app.main.update_project", return_value=None):
            with self.assertRaises(HTTPException) as ctx:
                update_existing_project("missing", payload)

        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(ctx.exception.detail, "Project not found")

    def test_returns_409_for_duplicate_project_code_on_update(self):
        payload = ProjectUpdate(
            code="PRJ-001",
            name="海上平台改造",
            overview=None,
            reference_attributes={},
            thumbnail_url=None,
            status="active",
        )

        with patch("app.main.update_project", side_effect=IntegrityError("duplicate key")):
            with self.assertRaises(HTTPException) as ctx:
                update_existing_project("project-1", payload)

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail, "Project code already exists")

    def test_deletes_project(self):
        deleted_project = {"id": "project-1", "name": "海上平台改造"}
        current_user = Mock()
        current_user.has_permission.side_effect = lambda permission, project_id=None: permission == "project.update"

        with patch("app.main.delete_project", return_value=deleted_project) as delete_project:
            response = delete_existing_project("project-1", current_user=current_user)

        self.assertEqual(response, {"ok": True})
        delete_project.assert_called_once_with("project-1")

    def test_returns_404_for_missing_project_delete(self):
        current_user = Mock()
        current_user.has_permission.return_value = True

        with patch("app.main.delete_project", return_value=None):
            with self.assertRaises(HTTPException) as ctx:
                delete_existing_project("missing", current_user=current_user)

        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(ctx.exception.detail, "Project not found")

    def test_deletes_project_tag(self):
        with patch("app.main.delete_project_tag", return_value=True) as delete_project_tag:
            response = delete_existing_project_tag("tag-1")

        self.assertEqual(response, {"ok": True})
        delete_project_tag.assert_called_once_with("tag-1")

    def test_returns_404_for_missing_project_tag_delete(self):
        with patch("app.main.delete_project_tag", return_value=False):
            with self.assertRaises(HTTPException) as ctx:
                delete_existing_project_tag("missing")

        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(ctx.exception.detail, "Tag not found")

    def test_searches_project_tags_with_structured_filters(self):
        search_result = {
            "items": [
                {
                    "id": "tag-1",
                    "project_id": "project-1",
                    "tag_no": "P-1001",
                    "name": "进料泵",
                    "pbs_node_id": "pbs-1",
                    "pbs_node_code": "SYS-01",
                    "pbs_node_name": "注入系统",
                    "class_id": "class-pump",
                    "class_name": "泵",
                    "parent_tag_id": None,
                    "parent_tag_no": None,
                    "parent_tag_name": None,
                    "attribute_values": {"power": 55},
                    "matched_attribute_codes": ["power"],
                    "status": "active",
                    "created_at": "2026-04-15T00:00:00Z",
                    "updated_at": "2026-04-15T00:00:00Z",
                }
            ],
            "page": 1,
            "page_size": 20,
            "total": 1,
            "total_pages": 1,
            "has_more": False,
            "mode": "structured",
        }

        with patch("app.main.search_project_tags", return_value=search_result) as search_project_tags:
            response = client.post(
                "/api/projects/project-1/tags/search",
                json={
                    "mode": "structured",
                    "pbs_node_id": "pbs-1",
                    "include_descendants": True,
                    "keyword": "泵",
                    "class_id": "class-pump",
                    "attribute_filters": [
                        {"code": "power", "operator": "gte", "value": 50},
                    ],
                    "page": 1,
                    "page_size": 20,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": search_result})
        search_project_tags.assert_called_once_with(
            "project-1",
            {
                "mode": "structured",
                "pbs_node_id": "pbs-1",
                "include_descendants": True,
                "keyword": "泵",
                "class_id": "class-pump",
                "attribute_filters": [{"code": "power", "operator": "gte", "value": 50}],
                "page": 1,
                "page_size": 20,
            },
        )

    def test_returns_400_for_invalid_tag_search_operator(self):
        with patch("app.main.search_project_tags", side_effect=ValueError("Unsupported operator: between")):
            response = client.post(
                "/api/projects/project-1/tags/search",
                json={
                    "pbs_node_id": "pbs-1",
                    "attribute_filters": [
                        {"code": "power", "operator": "between", "value": [10, 50]},
                    ],
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Unsupported operator: between"})

    def test_forwards_tag_search_include_children_when_provided(self):
        search_result = {
            "items": [],
            "page": 1,
            "page_size": 20,
            "total": 0,
            "total_pages": 1,
            "has_more": False,
            "mode": "browse",
        }

        with patch("app.main.search_project_tags", return_value=search_result) as search_project_tags:
            response = client.post(
                "/api/projects/project-1/tags/search",
                json={
                    "mode": "browse",
                    "pbs_node_id": "pbs-1",
                    "include_descendants": True,
                    "include_children": False,
                    "page": 1,
                    "page_size": 20,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": search_result})
        search_project_tags.assert_called_once_with(
            "project-1",
            {
                "mode": "browse",
                "pbs_node_id": "pbs-1",
                "include_descendants": True,
                "include_children": False,
                "attribute_filters": [],
                "page": 1,
                "page_size": 20,
            },
        )

    def test_returns_404_for_missing_tag_search_pbs_node(self):
        with patch("app.main.search_project_tags", side_effect=LookupError("PBS node not found")):
            response = client.post(
                "/api/projects/project-1/tags/search",
                json={"pbs_node_id": "missing"},
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "PBS node not found"})


if __name__ == "__main__":
    unittest.main()
