import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from psycopg import IntegrityError

from app.main import app


client = TestClient(app)


class RelationApiTest(unittest.TestCase):
    def test_lists_project_relations(self):
        relations = [
            {
                "id": "rel-1",
                "project_id": "project-1",
                "relation_type_id": "type-1",
                "relation_type_code": "document_links_tag",
                "relation_type_name": "Document Links Tag",
                "is_symmetric": False,
                "source_kind": "document",
                "source_id": "doc-1",
                "target_kind": "tag",
                "target_id": "tag-1",
                "sort_order": 0,
                "note": None,
                "source_system": None,
                "metadata": {},
                "created_at": "2026-04-15T00:00:00Z",
                "updated_at": "2026-04-15T00:00:00Z",
            }
        ]

        with patch("app.main.list_project_relations", return_value=relations) as list_project_relations:
            response = client.get(
                "/api/projects/project-1/relations",
                params={"entity_kind": "document", "entity_id": "doc-1", "direction": "outbound"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": relations})
        list_project_relations.assert_called_once_with(
            "project-1",
            {
                "entity_kind": "document",
                "entity_id": "doc-1",
                "relation_type": None,
                "source_kind": None,
                "target_kind": None,
                "direction": "outbound",
            },
        )

    def test_creates_project_relation(self):
        created = {
            "id": "rel-1",
            "project_id": "project-1",
            "relation_type_id": "type-1",
            "relation_type_code": "tag_relates_tag",
            "relation_type_name": "Tag Relates Tag",
            "is_symmetric": True,
            "source_kind": "tag",
            "source_id": "tag-1",
            "target_kind": "tag",
            "target_id": "tag-2",
            "sort_order": 1,
            "note": "same skid",
            "source_system": "manual",
            "metadata": {"group": "A"},
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T00:00:00Z",
        }

        with patch("app.main.create_project_relation", return_value=created) as create_project_relation:
            response = client.post(
                "/api/projects/project-1/relations",
                json={
                    "relation_type_code": "tag_relates_tag",
                    "source_kind": "tag",
                    "source_id": "tag-1",
                    "target_kind": "tag",
                    "target_id": "tag-2",
                    "sort_order": 1,
                    "note": "same skid",
                    "source_system": "manual",
                    "metadata": {"group": "A"},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": created})
        create_project_relation.assert_called_once_with(
            "project-1",
            {
                "relation_type_code": "tag_relates_tag",
                "source_kind": "tag",
                "source_id": "tag-1",
                "target_kind": "tag",
                "target_id": "tag-2",
                "sort_order": 1,
                "note": "same skid",
                "source_system": "manual",
                "metadata": {"group": "A"},
            },
        )

    def test_returns_404_for_missing_relation_type(self):
        with patch("app.main.create_project_relation", side_effect=ValueError("Relation type not found")):
            response = client.post(
                "/api/projects/project-1/relations",
                json={
                    "relation_type_code": "missing",
                    "source_kind": "document",
                    "source_id": "doc-1",
                    "target_kind": "tag",
                    "target_id": "tag-1",
                    "metadata": {},
                },
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Relation type not found"})

    def test_returns_409_for_duplicate_relation(self):
        with patch("app.main.create_project_relation", side_effect=IntegrityError("duplicate key")):
            response = client.post(
                "/api/projects/project-1/relations",
                json={
                    "relation_type_code": "document_links_tag",
                    "source_kind": "document",
                    "source_id": "doc-1",
                    "target_kind": "tag",
                    "target_id": "tag-1",
                    "metadata": {},
                },
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "Relation already exists"})

    def test_deletes_project_relation(self):
        with patch("app.main.delete_project_relation", return_value=True) as delete_project_relation:
            response = client.delete("/api/projects/project-1/relations/rel-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        delete_project_relation.assert_called_once_with("project-1", "rel-1")


if __name__ == "__main__":
    unittest.main()
