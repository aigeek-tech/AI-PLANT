import unittest
from unittest.mock import patch

from app import repository


class StandardRepositoryTest(unittest.TestCase):
    def test_get_standard_detail_includes_equipment_definitions(self):
        standard = {
            "id": "standard-1",
            "code": "CFIHOS",
            "name": "CFIHOS",
            "version_label": "2.0",
            "thumbnail_url": None,
            "status": "active",
            "metadata": {},
        }
        tag_class = {
            "id": "tag-class-1",
            "code": "PIPE",
            "name": "Pipe",
            "parent_id": None,
            "level_no": 1,
            "description": None,
            "status": "active",
            "applies_to": "tag",
            "attribute_count": 1,
        }
        equipment_class = {
            "id": "equipment-class-1",
            "code": "PIPE_SPOOL",
            "name": "Pipe Spool",
            "parent_id": None,
            "level_no": 1,
            "description": None,
            "status": "active",
            "applies_to": "equipment",
            "attribute_count": 1,
        }
        tag_attribute = {
            "id": "tag-attribute-1",
            "class_id": "tag-class-1",
            "standard_id": None,
            "code": "line_no",
            "name": "Line No",
            "applies_to": "tag",
        }
        equipment_attribute = {
            "id": "equipment-attribute-1",
            "class_id": "equipment-class-1",
            "standard_id": None,
            "code": "manufacturer",
            "name": "Manufacturer",
            "applies_to": "equipment",
        }

        with (
            patch("app.repository.fetch_one", side_effect=[standard, {"total": 0}, {"total": 0}]),
            patch("app.repository.fetch_all", side_effect=[
                [tag_class],
                [tag_attribute],
                [equipment_class],
                [equipment_attribute],
                [],
            ]),
        ):
            detail = repository.get_standard_detail("standard-1", include_attributes=True)

        self.assertEqual(detail["classes"][0]["attributes"], [tag_attribute])
        self.assertEqual(detail["equipment_classes"][0]["attributes"], [equipment_attribute])
        self.assertEqual(detail["equipment_common_attribute_count"], 0)

    def test_list_standard_common_attributes_filters_equipment_domain(self):
        with (
            patch("app.repository.fetch_one", side_effect=[{"id": "standard-1"}, {"total": 1}]) as fetch_one,
            patch("app.repository.fetch_all", return_value=[]),
        ):
            result = repository.list_standard_common_attributes("standard-1", applies_to="equipment")

        self.assertEqual(result["total"], 1)
        count_sql = fetch_one.call_args_list[1].args[0]
        self.assertIn("ad.applies_to IN ('equipment', 'both')", count_sql)

    def test_list_class_attributes_uses_parent_class_domain(self):
        with (
            patch("app.repository.fetch_one", side_effect=[{"id": "class-1", "applies_to": "equipment"}, {"total": 1}]) as fetch_one,
            patch("app.repository.fetch_all", return_value=[]),
        ):
            result = repository.list_class_attributes("class-1")

        self.assertEqual(result["total"], 1)
        count_sql = fetch_one.call_args_list[1].args[0]
        self.assertIn("ad.applies_to IN ('equipment', 'both')", count_sql)

    def test_create_attribute_infers_equipment_domain_from_parent_class(self):
        created_attribute = {
            "id": "attribute-1",
            "class_id": "equipment-class-1",
            "code": "manufacturer",
            "name": "Manufacturer",
            "applies_to": "equipment",
        }
        payload = {
            "code": "manufacturer",
            "name": "Manufacturer",
            "value_type": "string",
            "is_required": False,
            "enum_options": [],
        }

        with (
            patch("app.repository.fetch_one", return_value={"id": "equipment-class-1", "applies_to": "equipment"}),
            patch("app.repository.execute_one", return_value=created_attribute) as execute_one,
        ):
            result = repository.create_attribute(payload, class_id="equipment-class-1")

        self.assertEqual(result, created_attribute)
        params = execute_one.call_args.args[1]
        self.assertEqual(params[-2:], ("equipment", "equipment"))


if __name__ == "__main__":
    unittest.main()
