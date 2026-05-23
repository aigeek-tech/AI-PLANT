import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.authorization import AuthenticatedUser, require_authenticated_user
from app.main import app


client = TestClient(app)


def fake_user_without_tag_read() -> AuthenticatedUser:
    return AuthenticatedUser(
        id="limited-user",
        username="limited",
        email="limited@example.test",
        display_name="Limited User",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        system_permissions=set(),
        project_permissions={},
        standard_permissions={},
        roles=[],
    )


class TagApiTest(unittest.TestCase):
    def test_returns_project_tag_detail(self):
        detail = {
            "id": "tag-1",
            "project_id": "project-1",
            "tag_no": "P-1001",
            "name": "进料泵",
            "pbs_node_id": "pbs-1",
            "pbs_node_code": "SYS-01",
            "pbs_node_name": "进料系统",
            "class_id": "class-1",
            "class_name": "Pump",
            "parent_tag_id": None,
            "parent_tag_no": None,
            "parent_tag_name": None,
            "attribute_values": {"power": 50},
            "status": "active",
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T00:00:00Z",
            "matched_attribute_codes": [],
            "children": [
                {
                    "id": "tag-2",
                    "project_id": "project-1",
                    "tag_no": "P-1001-MTR",
                    "name": "驱动电机",
                    "matched_attribute_codes": [],
                }
            ],
            "linked_documents": [
                {
                    "id": "doc-1",
                    "project_id": "project-1",
                    "document_no": "PID-1001",
                    "title": "进料系统 P&ID",
                }
            ],
            "relations": [
                {
                    "id": "rel-1",
                    "project_id": "project-1",
                    "relation_type_code": "tag_relates_tag",
                    "relation_type_name": "Tag Relates Tag",
                    "source_kind": "tag",
                    "source_id": "tag-1",
                    "target_kind": "tag",
                    "target_id": "tag-3",
                }
            ],
        }

        with patch("app.main.get_project_tag_detail", return_value=detail) as get_project_tag_detail:
            response = client.get("/api/projects/project-1/tags/tag-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": detail})
        get_project_tag_detail.assert_called_once_with("project-1", "tag-1")

    def test_returns_404_for_missing_project_tag_detail(self):
        with patch("app.main.get_project_tag_detail", return_value=None):
            response = client.get("/api/projects/project-1/tags/missing")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Tag not found"})

    def test_returns_404_for_cross_project_tag_detail(self):
        with patch("app.main.get_project_tag_detail", return_value=None) as get_project_tag_detail:
            response = client.get("/api/projects/project-2/tags/tag-1")

        self.assertEqual(response.status_code, 404)
        get_project_tag_detail.assert_called_once_with("project-2", "tag-1")

    def test_returns_400_for_invalid_tag_references_on_create(self):
        with patch("app.main.create_project_tag", side_effect=ValueError("Parent tag does not belong to this project")):
            response = client.post(
                "/api/projects/project-1/tags",
                json={
                    "tag_no": "P-1001",
                    "name": "Pump",
                    "parent_tag_id": "tag-from-other-project",
                    "attribute_values": {},
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Parent tag does not belong to this project"})

    def test_returns_400_for_invalid_tag_references_on_update(self):
        with patch("app.main.update_project_tag", side_effect=ValueError("Tag parent would create a cycle")):
            response = client.patch(
                "/api/tags/tag-1",
                json={
                    "tag_no": "P-1001",
                    "name": "Pump",
                    "parent_tag_id": "tag-child",
                    "attribute_values": {},
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Tag parent would create a cycle"})

    def test_requires_project_tag_read_permission(self):
        previous_override = app.dependency_overrides.get(require_authenticated_user)
        app.dependency_overrides[require_authenticated_user] = fake_user_without_tag_read
        try:
            response = client.get("/api/projects/project-1/tags/tag-1")
        finally:
            if previous_override is None:
                app.dependency_overrides.pop(require_authenticated_user, None)
            else:
                app.dependency_overrides[require_authenticated_user] = previous_override

        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
