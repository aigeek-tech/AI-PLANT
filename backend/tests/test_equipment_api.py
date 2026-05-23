import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


class EquipmentApiTest(unittest.TestCase):
    def test_returns_tag_equipment_implementation(self):
        implementation = {
            "tag_id": "tag-1",
            "tag_class": {"id": "class-pump", "code": "PUMP", "name": "Pump"},
            "compatible_equipment_classes": [
                {"id": "eq-class-1", "code": "CENTRIFUGAL_PUMP", "name": "Centrifugal Pump"}
            ],
            "current_assignment": {
                "id": "assignment-1",
                "tag_id": "tag-1",
                "equipment_id": "equipment-1",
                "installed_from": "2026-04-20",
                "installed_to": None,
                "is_current": True,
                "status": "active",
                "equipment": {
                    "id": "equipment-1",
                    "equipment_no": "EQ-P-101A-001",
                    "name": "P-101A installed pump",
                    "class_name": "Centrifugal Pump",
                },
            },
            "assignment_history": [],
        }

        with patch("app.main.get_tag_equipment_implementation", return_value=implementation) as get_implementation:
            response = client.get("/api/projects/project-1/tags/tag-1/equipment-implementation")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": implementation})
        get_implementation.assert_called_once_with("project-1", "tag-1")

    def test_returns_404_for_missing_tag_equipment_implementation(self):
        with patch("app.main.get_tag_equipment_implementation", return_value=None):
            response = client.get("/api/projects/project-1/tags/missing/equipment-implementation")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Tag not found"})

    def test_creates_project_equipment(self):
        created = {
            "id": "equipment-1",
            "project_id": "project-1",
            "equipment_no": "EQ-P-101A-001",
            "name": "P-101A installed pump",
            "class_id": "eq-class-1",
            "manufacturer": "Flowserve",
            "model": "A4 V726",
            "serial_no": "SN-001",
            "purchase_order_no": "PO-001",
            "asset_status": "in_service",
            "attribute_values": {
                "CFIHOS-10000158": "Flowserve",
                "CFIHOS-10000159": "A4 V726",
            },
            "metadata": {},
        }

        payload = {
            "equipment_no": " EQ-P-101A-001 ",
            "name": " P-101A installed pump ",
            "class_id": "eq-class-1",
            "manufacturer": " Flowserve ",
            "model": " A4 V726 ",
            "serial_no": " SN-001 ",
            "purchase_order_no": " PO-001 ",
            "asset_status": "in_service",
            "attribute_values": {
                "CFIHOS-10000158": " Flowserve ",
                "CFIHOS-10000159": "A4 V726",
            },
            "metadata": {},
        }

        with patch("app.main.create_project_equipment", return_value=created) as create_equipment:
            response = client.post("/api/projects/project-1/equipment", json=payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": created})
        create_equipment.assert_called_once_with(
            "project-1",
            {
                "equipment_no": "EQ-P-101A-001",
                "name": "P-101A installed pump",
                "class_id": "eq-class-1",
                "manufacturer": "Flowserve",
                "model": "A4 V726",
                "serial_no": "SN-001",
                "purchase_order_no": "PO-001",
                "asset_status": "in_service",
                "attribute_values": {
                    "CFIHOS-10000158": " Flowserve ",
                    "CFIHOS-10000159": "A4 V726",
                },
                "metadata": {},
            },
        )

    def test_rejects_blank_equipment_no(self):
        response = client.post(
            "/api/projects/project-1/equipment",
            json={"equipment_no": " ", "name": "Pump", "asset_status": "in_service"},
        )

        self.assertEqual(response.status_code, 422)

    def test_assigns_equipment_to_tag(self):
        assignment = {
            "id": "assignment-1",
            "tag_id": "tag-1",
            "equipment_id": "equipment-1",
            "installed_from": "2026-04-20",
            "installed_to": None,
            "is_current": True,
            "status": "active",
            "notes": "Initial install",
        }

        payload = {
            "equipment_id": "equipment-1",
            "installed_from": "2026-04-20",
            "is_current": True,
            "notes": " Initial install ",
        }

        with patch("app.main.assign_equipment_to_tag", return_value=assignment) as assign_equipment:
            response = client.post("/api/projects/project-1/tags/tag-1/equipment-assignments", json=payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": assignment})
        assign_equipment.assert_called_once_with(
            "project-1",
            "tag-1",
            {
                "equipment_id": "equipment-1",
                "installed_from": "2026-04-20",
                "installed_to": None,
                "is_current": True,
                "status": "active",
                "notes": "Initial install",
            },
        )

    def test_returns_400_for_cross_project_assignment(self):
        with patch(
            "app.main.assign_equipment_to_tag",
            side_effect=ValueError("Equipment does not belong to this project"),
        ):
            response = client.post(
                "/api/projects/project-1/tags/tag-1/equipment-assignments",
                json={"equipment_id": "equipment-from-other-project", "installed_from": "2026-04-20"},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Equipment does not belong to this project"})


if __name__ == "__main__":
    unittest.main()
