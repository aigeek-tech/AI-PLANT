from contextlib import contextmanager
import unittest
from unittest.mock import MagicMock, Mock, patch

from psycopg.types.json import Json

from app.repository import (
    _append_project_tag_attribute_condition,
    _fetch_project_tag_attribute_definitions,
    _group_project_tag_children,
    _has_more_pages,
    _matched_project_tag_attribute_codes,
    _normalize_project_tag_page,
    _validate_project_tag_references,
    create_project_tag,
    get_project_tag_detail,
    search_project_tags,
)


class TagSearchRepositoryTest(unittest.TestCase):
    def test_normalizes_project_tag_page_limits(self):
        page, page_size, offset = _normalize_project_tag_page({"page": 0, "page_size": 500})

        self.assertEqual((page, page_size, offset), (1, 100, 0))

    def test_detects_has_more_pages(self):
        self.assertTrue(_has_more_pages(page=2, page_size=20, total=45))
        self.assertFalse(_has_more_pages(page=3, page_size=20, total=45))

    def test_builds_numeric_attribute_comparison(self):
        where_clauses: list[str] = []
        params: list[object] = []

        _append_project_tag_attribute_condition(
            where_clauses,
            params,
            {"code": "power", "operator": "gte", "value": 50},
        )

        self.assertIn("t.attribute_values ->> %s", where_clauses[0])
        self.assertIn("::numeric >=", where_clauses[0])
        self.assertEqual(params, ["power", "power", 50.0])

    def test_builds_exact_json_attribute_match(self):
        where_clauses: list[str] = []
        params: list[object] = []

        _append_project_tag_attribute_condition(
            where_clauses,
            params,
            {"code": "is_critical", "operator": "equals", "value": True},
        )

        self.assertEqual(where_clauses, ["t.attribute_values @> %s::jsonb"])
        self.assertIsInstance(params[0], Json)

    def test_rejects_non_numeric_range_comparison(self):
        with self.assertRaisesRegex(ValueError, "requires a numeric value"):
            _append_project_tag_attribute_condition(
                [],
                [],
                {"code": "power", "operator": "lte", "value": "high"},
            )

    def test_groups_children_under_root_tags(self):
        root = {"id": "tag-root", "tag_no": "P-1001"}
        component = {"id": "tag-child", "parent_tag_id": "tag-root", "tag_no": "P-1001-A"}

        grouped = _group_project_tag_children([root], [component])

        self.assertEqual(grouped, [{**root, "children": [component]}])

    def test_browse_search_can_skip_child_lookup(self):
        root = {
            "id": "tag-root",
            "project_id": "project-1",
            "tag_no": "P-1001",
            "name": "Pump",
            "parent_tag_id": None,
            "attribute_values": {},
        }
        cursor = Mock()
        cursor.fetchone.return_value = {"total": 1}
        cursor.fetchall.return_value = [root]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        connection.cursor.return_value.__exit__.return_value = False

        @contextmanager
        def fake_get_connection():
            yield connection

        with patch("app.repository.get_connection", fake_get_connection):
            result = search_project_tags("project-1", {"mode": "browse", "include_children": False})

        executed_sql = "\n".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertNotIn("parent_tag_id = ANY", executed_sql)
        self.assertEqual(result["items"], [{**root, "children": [], "matched_attribute_codes": []}])

    def test_fetches_project_tag_attribute_definitions_through_project_standard(self):
        common_attribute = {"id": "common-attribute", "code": "area", "standard_id": "standard-1"}
        class_attribute = {"id": "class-attribute", "code": "power", "class_id": "class-1"}
        cursor = Mock()
        cursor.fetchall.side_effect = [[common_attribute], [class_attribute]]

        result = _fetch_project_tag_attribute_definitions(cursor, "project-1", "class-1")

        self.assertEqual(result["common_attributes"], [common_attribute])
        self.assertEqual(result["class_attributes"], [class_attribute])
        executed_sql = "\n".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn("p.reference_attributes ->> 'standard_id'", executed_sql)
        self.assertIn("ad.class_id IS NULL", executed_sql)
        self.assertIn("ad.class_id = %s", executed_sql)

    def test_matches_only_defined_project_tag_attribute_codes(self):
        result = _matched_project_tag_attribute_codes(
            {"area": "A", "unknown": "value", "power": 55},
            {
                "common_attributes": [{"code": "area"}],
                "class_attributes": [{"code": "power"}],
            },
        )

        self.assertEqual(result, ["area", "power"])

    def test_project_tag_detail_returns_common_and_class_attribute_definitions(self):
        tag = {
            "id": "tag-1",
            "project_id": "project-1",
            "tag_no": "P-1001",
            "name": "Pump",
            "class_id": "class-1",
            "attribute_values": {"area": "A", "power": 55, "unknown": "value"},
        }
        child = {
            "id": "tag-child",
            "project_id": "project-1",
            "tag_no": "P-1001-M",
            "name": "Motor",
            "class_id": "child-class",
            "attribute_values": {"child_power": 10},
        }
        common_attribute = {"id": "common-attribute", "code": "area", "standard_id": "standard-1"}
        class_attribute = {"id": "class-attribute", "code": "power", "class_id": "class-1"}
        equipment_implementation = {
            "tag_id": "tag-1",
            "equipment_common_attributes": [{"code": "manufacturer"}],
            "equipment_class_attributes": [{"code": "rated_power"}],
            "current_assignment": None,
            "assignment_history": [],
        }
        cursor = Mock()
        cursor.fetchone.return_value = tag
        cursor.fetchall.side_effect = [[child], [common_attribute], [class_attribute]]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        connection.cursor.return_value.__exit__.return_value = False

        @contextmanager
        def fake_get_connection():
            yield connection

        with (
            patch("app.repository.get_connection", fake_get_connection),
            patch("app.document_repository.list_project_documents", return_value={"items": []}),
            patch("app.equipment_repository.get_tag_equipment_implementation", return_value=equipment_implementation),
            patch("app.relation_repository.list_project_relations", return_value=[]),
        ):
            result = get_project_tag_detail("project-1", "tag-1")

        self.assertEqual(result["common_attributes"], [common_attribute])
        self.assertEqual(result["class_attributes"], [class_attribute])
        self.assertEqual(result["matched_attribute_codes"], ["area", "power"])
        self.assertEqual(result["children"], [{**child, "matched_attribute_codes": []}])
        self.assertEqual(result["equipment_implementation"], equipment_implementation)
        executed_params = [call.args[1] for call in cursor.execute.call_args_list if len(call.args) > 1]
        self.assertNotIn(("project-1", "child-class"), executed_params)

    def test_rejects_tag_pbs_node_outside_project(self):
        cursor = Mock()
        cursor.fetchone.return_value = None

        with self.assertRaisesRegex(ValueError, "PBS node does not belong"):
            _validate_project_tag_references(
                cursor,
                project_id="project-1",
                payload={"pbs_node_id": "pbs-from-other-project"},
            )

    def test_rejects_tag_class_outside_project_standard(self):
        cursor = Mock()
        cursor.fetchone.return_value = None

        with self.assertRaisesRegex(ValueError, "Class must belong"):
            _validate_project_tag_references(
                cursor,
                project_id="project-1",
                payload={"class_id": "class-from-other-standard"},
            )

    def test_rejects_tag_parent_outside_project(self):
        cursor = Mock()
        cursor.fetchone.return_value = {"id": "tag-parent", "project_id": "project-2"}

        with self.assertRaisesRegex(ValueError, "Parent tag does not belong"):
            _validate_project_tag_references(
                cursor,
                project_id="project-1",
                payload={"parent_tag_id": "tag-parent"},
            )

    def test_rejects_tag_self_parent(self):
        cursor = Mock()

        with self.assertRaisesRegex(ValueError, "own parent"):
            _validate_project_tag_references(
                cursor,
                project_id="project-1",
                payload={"parent_tag_id": "tag-1"},
                tag_id="tag-1",
            )

        cursor.execute.assert_not_called()

    def test_rejects_tag_parent_cycle(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {"id": "tag-descendant", "project_id": "project-1"},
            {"id": "tag-descendant"},
        ]

        with self.assertRaisesRegex(ValueError, "cycle"):
            _validate_project_tag_references(
                cursor,
                project_id="project-1",
                payload={"parent_tag_id": "tag-descendant"},
                tag_id="tag-root",
            )

    def test_accepts_project_scoped_tag_references(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {"id": "pbs-1"},
            {"id": "class-1"},
            {"id": "tag-parent", "project_id": "project-1"},
            None,
        ]

        _validate_project_tag_references(
            cursor,
            project_id="project-1",
            payload={
                "pbs_node_id": "pbs-1",
                "class_id": "class-1",
                "parent_tag_id": "tag-parent",
            },
            tag_id="tag-child",
        )

        self.assertEqual(cursor.execute.call_count, 4)

    def test_create_tag_rejects_missing_project_before_insert(self):
        cursor = Mock()
        cursor.fetchone.return_value = None
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        connection.cursor.return_value.__exit__.return_value = False

        @contextmanager
        def fake_get_connection():
            yield connection

        with patch("app.repository.get_connection", fake_get_connection):
            with self.assertRaisesRegex(ValueError, "Project not found"):
                create_project_tag(
                    "missing-project",
                    {
                        "tag_no": "P-404",
                        "name": "Missing project tag",
                        "attribute_values": {},
                    },
                )

        cursor.execute.assert_called_once_with(
            "SELECT id FROM project WHERE id = %s",
            ("missing-project",),
        )
        connection.commit.assert_not_called()

    def test_create_tag_inserts_after_project_validation(self):
        created_tag = {
            "id": "tag-1",
            "project_id": "project-1",
            "tag_no": "P-1001",
            "name": "Pump",
        }
        cursor = Mock()
        cursor.fetchone.side_effect = [{"id": "project-1"}, created_tag]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        connection.cursor.return_value.__exit__.return_value = False

        @contextmanager
        def fake_get_connection():
            yield connection

        with patch("app.repository.get_connection", fake_get_connection):
            result = create_project_tag(
                "project-1",
                {
                    "tag_no": "P-1001",
                    "name": "Pump",
                    "attribute_values": {"power": 55},
                },
            )

        self.assertEqual(result, created_tag)
        self.assertEqual(cursor.execute.call_count, 2)
        connection.commit.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
