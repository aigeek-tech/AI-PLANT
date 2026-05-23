import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from psycopg import IntegrityError

from app.main import app


client = TestClient(app)


class StandardApiTest(unittest.TestCase):
    def test_health_checks_database(self):
        with patch("app.main.fetch_one", return_value={"ok": 1}) as fetch_one:
            response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
        fetch_one.assert_called_once_with("SELECT 1 AS ok")

    def test_lists_standards(self):
        standards = [
            {
                "id": "standard-1",
                "code": "DEC",
                "name": "DEC Engineering Standards",
                "version_label": "2024.1",
                "thumbnail_url": None,
                "status": "active",
                "metadata": {},
                "class_count": 3,
                "attribute_count": 5,
            }
        ]

        with patch("app.main.get_standards", return_value=standards):
            response = client.get("/api/standards")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": standards})

    def test_creates_standard(self):
        standard = {
            "id": "standard-3",
            "code": "ISO",
            "name": "ISO Standards",
            "version_label": "2026",
            "thumbnail_url": None,
            "status": "active",
            "metadata": {},
        }

        with patch("app.main.create_standard", return_value=standard) as create_standard:
            response = client.post(
                "/api/standards",
                json={"code": "ISO", "name": "ISO Standards", "version_label": "2026"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": standard})
        create_standard.assert_called_once_with(
            {"code": "ISO", "name": "ISO Standards", "version_label": "2026", "thumbnail_url": None, "status": "active"}
        )

    def test_downloads_standard_import_template(self):
        with patch("app.main.build_standard_import_template", return_value=b"excel-content"):
            response = client.get("/api/standards/import-template")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["content-type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.assertEqual(response.content, b"excel-content")

    def test_exports_selected_standard(self):
        export_result = (
            {"code": "DEC", "name": "DEC Engineering Standards"},
            b"excel-content",
        )

        with patch("app.main.build_standard_export_workbook", return_value=export_result):
            response = client.get("/api/standards/standard-1/export")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"excel-content")
        self.assertIn("DEC-standard-export.xlsx", response.headers["content-disposition"])

    def test_returns_404_for_missing_standard_export(self):
        with patch("app.main.build_standard_export_workbook", return_value=None):
            response = client.get("/api/standards/missing/export")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Standard not found"})

    def test_validates_uploaded_standard_import_file(self):
        import_job = {
            "job_id": "job-1",
            "summary": {"total_rows": 1, "ready_rows": 1, "error_rows": 0, "warning_rows": 0, "conflict_rows": 0, "can_commit": True},
            "rows": [],
        }

        with patch("app.main.create_standard_import_job_from_upload", return_value=import_job) as create_job:
            response = client.post(
                "/api/standards/imports/validate",
                files={"file": ("standard.xlsx", b"fake-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": import_job})
        create_job.assert_called_once()

    def test_creates_ai_standard_import_job(self):
        import_job = {
            "job_id": "job-1",
            "target_mode": "new",
            "summary": {"total_rows": 1, "ready_rows": 1, "error_rows": 0, "warning_rows": 0, "conflict_rows": 0, "can_commit": True},
            "items": [],
            "rows": [],
        }

        with patch("app.main.create_standard_import_job_from_upload", return_value=import_job) as create_job:
            response = client.post(
                "/api/standard-imports",
                data={"target_mode": "new"},
                files={"file": ("standard.docx", b"fake-docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": import_job})
        create_job.assert_called_once()
        self.assertEqual(create_job.call_args.kwargs["target_mode"], "new")

    def test_patches_standard_import_item(self):
        patched = {
            "job_id": "job-1",
            "item": {"id": "item-1", "action": "update"},
            "summary": {"total_rows": 1, "ready_rows": 1, "error_rows": 0, "warning_rows": 0, "conflict_rows": 0, "can_commit": True},
        }

        with patch("app.main.patch_standard_import_item", return_value=patched) as patch_item:
            response = client.patch(
                "/api/standard-imports/job-1/items/item-1",
                json={"values": {"code": "PUMP"}, "action": "update"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": patched})
        patch_item.assert_called_once_with("job-1", "item-1", {"values": {"code": "PUMP"}, "action": "update"})

    def test_returns_400_for_invalid_standard_import_upload(self):
        with patch("app.main.create_standard_import_job_from_upload", side_effect=ValueError("Only .xlsx files are supported")):
            response = client.post(
                "/api/standards/imports/validate",
                files={"file": ("standard.csv", b"", "text/csv")},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Only .xlsx files are supported"})

    def test_lists_standard_import_rows(self):
        listing = {
            "job_id": "job-1",
            "summary": {"total_rows": 5, "ready_rows": 3, "error_rows": 1, "warning_rows": 0, "conflict_rows": 1, "can_commit": False},
            "rows": [{"id": "row-1", "status": "error"}],
            "page": 2,
            "page_size": 10,
            "total_pages": 1,
        }

        with patch("app.main.get_standard_import_job_detail", return_value=listing) as get_job:
            response = client.get("/api/standards/imports/job-1?status=error&page=2&page_size=10")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": listing})
        get_job.assert_called_once_with("job-1", status="error", page=2, page_size=10)

    def test_updates_standard_import_conflict_choice(self):
        patched = {
            "job_id": "job-1",
            "summary": {"total_rows": 1, "ready_rows": 1, "error_rows": 0, "warning_rows": 0, "conflict_rows": 0, "can_commit": True},
            "conflict_action": "create_copy",
            "code_override": "DEC-COPY",
        }

        with patch("app.main.patch_standard_import_job", return_value=patched) as patch_job:
            response = client.patch(
                "/api/standards/imports/job-1",
                json={"conflict_action": "create_copy", "code_override": "DEC-COPY"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": patched})
        patch_job.assert_called_once_with("job-1", {"conflict_action": "create_copy", "code_override": "DEC-COPY"})

    def test_commits_standard_import_job(self):
        result = {
            "job_id": "job-1",
            "standard_id": "standard-1",
            "created_count": 4,
            "updated_count": 2,
            "skipped_count": 0,
            "failed_count": 0,
            "failures": [],
        }

        with patch("app.main.commit_standard_import_job", return_value=result) as commit_job:
            response = client.post("/api/standards/imports/job-1/commit")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": result})
        commit_job.assert_called_once_with("job-1")

    def test_returns_standard_detail(self):
        detail = {
            "id": "standard-1",
            "code": "DEC",
            "name": "DEC Engineering Standards",
            "version_label": "2024.1",
            "thumbnail_url": None,
            "status": "active",
            "metadata": {},
            "classes": [],
        }

        with patch("app.main.get_standard_detail", return_value=detail) as get_detail:
            response = client.get("/api/standards/standard-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": detail})
        get_detail.assert_called_once_with(
            "standard-1",
            include_attributes=False,
            include_tag_classes=True,
            include_equipment_classes=False,
            include_pbs_levels=True,
        )

    def test_returns_standard_detail_with_requested_scope(self):
        detail = {
            "id": "standard-1",
            "code": "DEC",
            "name": "DEC Engineering Standards",
            "version_label": "2024.1",
            "thumbnail_url": None,
            "status": "active",
            "metadata": {},
            "classes": [],
            "equipment_classes": [],
        }

        with patch("app.main.get_standard_detail", return_value=detail) as get_detail:
            response = client.get(
                "/api/standards/standard-1?include_tag_classes=false&include_equipment_classes=true&include_pbs_levels=false"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": detail})
        get_detail.assert_called_once_with(
            "standard-1",
            include_attributes=False,
            include_tag_classes=False,
            include_equipment_classes=True,
            include_pbs_levels=False,
        )

    def test_lists_standard_disciplines(self):
        disciplines = [
            {
                "id": "discipline-1",
                "standard_id": "standard-1",
                "code": "ELE",
                "name": "Electrical",
                "cfihos_unique_code": "CFIHOS-20000001",
                "description": None,
                "status": "active",
                "metadata": {},
            }
        ]

        with patch("app.main.list_standard_disciplines", return_value=disciplines) as list_disciplines:
            response = client.get("/api/standards/standard-1/disciplines")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": disciplines})
        list_disciplines.assert_called_once_with("standard-1")

    def test_lists_discipline_document_types_with_filters(self):
        rules = [{"id": "rule-1", "discipline_id": "discipline-1", "document_type_id": "doc-type-1"}]

        with patch("app.main.list_standard_discipline_document_types", return_value=rules) as list_rules:
            response = client.get(
                "/api/standards/standard-1/discipline-document-types"
                "?discipline_id=discipline-1&document_type_id=doc-type-1&asset_scope=tag"
                "&perspective=owner&lifecycle_phase=project&page=2&page_size=25"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": rules})
        list_rules.assert_called_once_with(
            "standard-1",
            {
                "discipline_id": "discipline-1",
                "document_type_id": "doc-type-1",
                "asset_scope": "tag",
                "perspective": "owner",
                "lifecycle_phase": "project",
            },
            page=2,
            page_size=25,
        )

    def test_lists_class_document_requirements_with_filters(self):
        rules = [{"id": "requirement-1", "class_id": "class-1", "document_type_id": "doc-type-1"}]

        with patch("app.main.list_standard_class_document_requirements", return_value=rules) as list_rules:
            response = client.get(
                "/api/standards/standard-1/class-document-requirements"
                "?class_id=class-1&document_type_id=doc-type-1&asset_scope=equipment"
                "&perspective=operator&lifecycle_phase=handover&page=3&page_size=10"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": rules})
        list_rules.assert_called_once_with(
            "standard-1",
            {
                "class_id": "class-1",
                "document_type_id": "doc-type-1",
                "asset_scope": "equipment",
                "perspective": "operator",
                "lifecycle_phase": "handover",
            },
            page=3,
            page_size=10,
        )

    def test_creates_and_archives_standard_rule_items(self):
        discipline = {"id": "discipline-1", "code": "ELE", "name": "Electrical"}
        discipline_rule = {"id": "rule-1", "discipline_id": "discipline-1", "document_type_id": "doc-type-1"}
        requirement = {"id": "requirement-1", "class_id": "class-1", "document_type_id": "doc-type-1"}

        with patch("app.main.create_standard_discipline", return_value=discipline) as create_discipline:
            response = client.post("/api/standards/standard-1/disciplines", json={"code": "ELE", "name": "Electrical"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": discipline})
        create_discipline.assert_called_once()

        with patch("app.main.create_standard_discipline_document_type", return_value=discipline_rule) as create_rule:
            response = client.post(
                "/api/standards/standard-1/discipline-document-types",
                json={"discipline_id": "discipline-1", "document_type_id": "doc-type-1", "asset_scope": "Tag"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": discipline_rule})
        create_rule.assert_called_once()

        with patch("app.main.create_standard_class_document_requirement", return_value=requirement) as create_requirement:
            response = client.post(
                "/api/standards/standard-1/class-document-requirements",
                json={"class_id": "class-1", "document_type_id": "doc-type-1", "asset_scope": "Equipment"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": requirement})
        create_requirement.assert_called_once()

        with patch("app.main.archive_standard_discipline_document_type", return_value={**discipline_rule, "status": "archived"}) as archive_rule:
            response = client.delete("/api/standards/standard-1/discipline-document-types/rule-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": {**discipline_rule, "status": "archived"}})
        archive_rule.assert_called_once_with("standard-1", "rule-1")

    def test_lists_standard_common_attributes_with_pagination(self):
        page = {"items": [], "page": 2, "page_size": 20, "total": 42, "total_pages": 3}

        with patch("app.main.list_standard_common_attributes", return_value=page) as list_attributes:
            response = client.get("/api/standards/standard-1/attributes?page=2&page_size=20")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": page})
        list_attributes.assert_called_once_with("standard-1", page=2, page_size=20, applies_to="tag")

    def test_lists_equipment_common_attributes_with_pagination(self):
        page = {"items": [], "page": 1, "page_size": 20, "total": 4, "total_pages": 1}

        with patch("app.main.list_standard_common_attributes", return_value=page) as list_attributes:
            response = client.get("/api/standards/standard-1/attributes?page=1&page_size=20&applies_to=equipment")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": page})
        list_attributes.assert_called_once_with("standard-1", page=1, page_size=20, applies_to="equipment")

    def test_lists_class_attributes_with_pagination(self):
        page = {"items": [], "page": 1, "page_size": 20, "total": 3, "total_pages": 1}

        with patch("app.main.list_class_attributes", return_value=page) as list_attributes:
            response = client.get("/api/classes/class-1/attributes?page=1&page_size=20")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": page})
        list_attributes.assert_called_once_with("class-1", page=1, page_size=20)

    def test_returns_404_for_missing_standard_detail(self):
        with patch("app.main.get_standard_detail", return_value=None):
            response = client.get("/api/standards/missing")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Standard not found"})

    def test_deletes_standard_without_business_links(self):
        deleted_standard = {
            "id": "standard-1",
            "code": "DEC",
            "name": "DEC Engineering Standards",
            "version_label": "2024.1",
            "thumbnail_url": None,
            "status": "active",
            "metadata": {},
        }
        blockers = {
            "project_count": 0,
            "tag_count": 0,
            "document_count": 0,
            "pbs_node_count": 0,
        }

        with patch("app.main.delete_standard_record", return_value=(deleted_standard, blockers)) as delete_standard_record:
            response = client.delete("/api/standards/standard-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": deleted_standard})
        delete_standard_record.assert_called_once_with("standard-1")

    def test_returns_404_for_missing_standard_delete(self):
        with patch("app.main.delete_standard_record", return_value=(None, {})):
            response = client.delete("/api/standards/missing")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Standard not found"})

    def test_blocks_standard_delete_when_business_links_exist(self):
        standard = {
            "id": "standard-1",
            "code": "DEC",
            "name": "DEC Engineering Standards",
            "version_label": "2024.1",
            "thumbnail_url": None,
            "status": "active",
            "metadata": {},
        }
        blockers = {
            "project_count": 2,
            "tag_count": 3,
            "document_count": 0,
            "pbs_node_count": 1,
        }

        with patch("app.main.delete_standard_record", return_value=(standard, blockers)):
            response = client.delete("/api/standards/standard-1")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "标准存在业务关联，不能删除：关联项目 2 个，TAG 3 个，PBS 节点 1 个"})

    def test_updates_standard_icon(self):
        icon = {"id": "standard-1", "thumbnail_url": "data:image/webp;base64,abc"}

        with patch("app.main.update_standard_icon", return_value=icon):
            response = client.patch(
                "/api/standards/standard-1/icon",
                json={"icon_data_url": "data:image/webp;base64,abc"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": icon})

    def test_returns_404_for_missing_standard_icon(self):
        with patch("app.main.update_standard_icon", return_value=None):
            response = client.patch(
                "/api/standards/missing/icon",
                json={"icon_data_url": "data:image/webp;base64,abc"},
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Standard not found"})

    def test_creates_standard_class(self):
        created_class = {
            "id": "class-10",
            "code": "PUMP",
            "name": "泵设备",
            "parent_id": "class-root",
            "level_no": 2,
            "description": "旋转设备下的泵类。",
            "status": "active",
        }

        with patch("app.main.create_class", return_value=created_class) as create_class:
            response = client.post(
                "/api/standards/standard-1/classes",
                json={
                    "code": "  PUMP  ",
                    "name": "  泵设备  ",
                    "parent_id": "class-root",
                    "description": "  旋转设备下的泵类。  ",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": created_class})
        create_class.assert_called_once_with(
            {
                "code": "PUMP",
                "name": "泵设备",
                "parent_id": "class-root",
                "description": "旋转设备下的泵类。",
                "status": "active",
                "applies_to": "tag",
            },
            "standard-1",
        )

    def test_creates_equipment_class(self):
        created_class = {
            "id": "class-20",
            "code": "CENTRIFUGAL_PUMP",
            "name": "离心泵",
            "parent_id": None,
            "level_no": 1,
            "description": None,
            "status": "active",
            "applies_to": "equipment",
        }

        with patch("app.main.create_class", return_value=created_class) as create_class:
            response = client.post(
                "/api/standards/standard-1/classes",
                json={
                    "code": "CENTRIFUGAL_PUMP",
                    "name": "离心泵",
                    "applies_to": "equipment",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": created_class})
        create_class.assert_called_once_with(
            {
                "code": "CENTRIFUGAL_PUMP",
                "name": "离心泵",
                "parent_id": None,
                "description": None,
                "status": "active",
                "applies_to": "equipment",
            },
            "standard-1",
        )

    def test_returns_404_for_missing_standard_on_create_class(self):
        with patch("app.main.create_class", return_value=None):
            response = client.post(
                "/api/standards/missing/classes",
                json={
                    "code": "PUMP",
                    "name": "泵设备",
                },
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Standard not found"})

    def test_returns_400_for_invalid_parent_on_create_class(self):
        with patch("app.main.create_class", side_effect=ValueError("Parent class not found")):
            response = client.post(
                "/api/standards/standard-1/classes",
                json={
                    "code": "PUMP",
                    "name": "泵设备",
                    "parent_id": "missing-parent",
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Parent class not found"})

    def test_returns_409_for_duplicate_class_code_on_create(self):
        with patch("app.main.create_class", side_effect=IntegrityError("duplicate key")):
            response = client.post(
                "/api/standards/standard-1/classes",
                json={
                    "code": "PUMP",
                    "name": "泵设备",
                },
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "Class code already exists in this standard"})

    def test_updates_standard_class(self):
        updated_class = {
            "id": "class-10",
            "code": "PUMP",
            "name": "泵设备",
            "parent_id": None,
            "level_no": 1,
            "description": "旋转设备下的泵类。",
            "status": "active",
        }

        with patch("app.main.update_class", return_value=updated_class) as update_class:
            response = client.patch(
                "/api/classes/class-10",
                json={
                    "code": "  PUMP  ",
                    "name": "  泵设备  ",
                    "parent_id": None,
                    "description": "  旋转设备下的泵类。  ",
                    "status": "active",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": updated_class})
        update_class.assert_called_once_with(
            "class-10",
            {
                "code": "PUMP",
                "name": "泵设备",
                "parent_id": None,
                "description": "旋转设备下的泵类。",
                "status": "active",
            },
        )

    def test_returns_404_for_missing_class_on_update(self):
        with patch("app.main.update_class", return_value=None):
            response = client.patch(
                "/api/classes/missing",
                json={
                    "code": "PUMP",
                    "name": "泵设备",
                },
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Class not found"})

    def test_returns_400_for_invalid_parent_on_update_class(self):
        with patch("app.main.update_class", side_effect=ValueError("Cannot move a class under its descendant")):
            response = client.patch(
                "/api/classes/class-10",
                json={
                    "code": "PUMP",
                    "name": "泵设备",
                    "parent_id": "child-class",
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Cannot move a class under its descendant"})

    def test_returns_409_for_duplicate_class_code_on_update(self):
        with patch("app.main.update_class", side_effect=IntegrityError("duplicate key")):
            response = client.patch(
                "/api/classes/class-10",
                json={
                    "code": "PUMP",
                    "name": "泵设备",
                },
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "Class code already exists in this standard"})

    def test_creates_attribute(self):
        attribute = {
            "id": "attribute-1",
            "class_id": "class-1",
            "code": "power_rating",
            "name": "功率",
            "value_type": "number",
            "is_required": False,
            "unit_family": "power",
            "enum_options": [],
            "description": "电机额定功率。",
            "sort_order": 3,
            "status": "active",
        }

        with patch("app.main.create_attribute", return_value=attribute) as create_attribute:
            response = client.post(
                "/api/classes/class-1/attributes",
                json={
                    "code": "power_rating",
                    "name": "功率",
                    "value_type": "number",
                    "is_required": False,
                    "unit_family": "power",
                    "enum_options": [],
                    "description": "电机额定功率。",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": attribute})
        create_attribute.assert_called_once_with(
            {
                "group_name": None,
                "code": "power_rating",
                "name": "功率",
                "value_type": "number",
                "is_required": False,
                "unit_family": "power",
                "enum_options": [],
                "description": "电机额定功率。",
                "applies_to": "tag",
            },
            class_id="class-1",
        )

    def test_creates_equipment_attribute(self):
        attribute = {
            "id": "attribute-2",
            "class_id": "equipment-class-1",
            "code": "manufacturer",
            "name": "制造商",
            "value_type": "string",
            "is_required": False,
            "unit_family": None,
            "enum_options": [],
            "description": None,
            "sort_order": 0,
            "status": "active",
            "applies_to": "equipment",
        }

        with patch("app.main.create_attribute", return_value=attribute) as create_attribute:
            response = client.post(
                "/api/classes/equipment-class-1/attributes",
                json={
                    "code": "manufacturer",
                    "name": "制造商",
                    "value_type": "string",
                    "is_required": False,
                    "unit_family": None,
                    "enum_options": [],
                    "description": None,
                    "applies_to": "equipment",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": attribute})
        create_attribute.assert_called_once_with(
            {
                "group_name": None,
                "code": "manufacturer",
                "name": "制造商",
                "value_type": "string",
                "is_required": False,
                "unit_family": None,
                "enum_options": [],
                "description": None,
                "applies_to": "equipment",
            },
            class_id="equipment-class-1",
        )

    def test_returns_404_for_missing_attribute_parent_class(self):
        with patch("app.main.create_attribute", return_value=None):
            response = client.post(
                "/api/classes/missing/attributes",
                json={
                    "code": "power_rating",
                    "name": "功率",
                    "value_type": "number",
                    "is_required": False,
                    "unit_family": None,
                    "enum_options": [],
                    "description": None,
                },
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Class not found"})

    def test_returns_409_for_duplicate_attribute_code_on_create(self):
        with patch("app.main.create_attribute", side_effect=IntegrityError("duplicate key")):
            response = client.post(
                "/api/classes/class-1/attributes",
                json={
                    "code": "power_rating",
                    "name": "功率",
                    "value_type": "number",
                    "is_required": False,
                    "unit_family": None,
                    "enum_options": [],
                    "description": None,
                },
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "Attribute code already exists in this class"})

    def test_returns_409_for_duplicate_attribute_code_on_update(self):
        with patch("app.main.update_attribute", side_effect=IntegrityError("duplicate key")):
            response = client.patch(
                "/api/attributes/attribute-1",
                json={
                    "code": "power_rating",
                    "name": "功率",
                    "value_type": "number",
                    "is_required": False,
                    "unit_family": None,
                    "enum_options": [],
                    "description": None,
                },
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "Attribute code already exists in this class"})

    def test_soft_deletes_attribute(self):
        deleted_attribute = {
            "id": "attribute-1",
            "class_id": "class-1",
            "code": "power_rating",
            "name": "功率",
            "value_type": "number",
            "is_required": False,
            "unit_family": "power",
            "enum_options": [],
            "description": "电机额定功率。",
            "sort_order": 3,
            "status": "archived",
        }

        with patch("app.main.soft_delete_attribute", return_value=deleted_attribute) as soft_delete_attribute:
            response = client.delete("/api/attributes/attribute-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": deleted_attribute})
        soft_delete_attribute.assert_called_once_with("attribute-1")

    def test_returns_404_for_missing_attribute_soft_delete(self):
        with patch("app.main.soft_delete_attribute", return_value=None):
            response = client.delete("/api/attributes/missing")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Attribute not found"})

    def test_reorders_attributes(self):
        reordered_attributes = [
            {
                "id": "attribute-2",
                "class_id": "class-1",
                "code": "flow_rate",
                "name": "流量",
                "value_type": "number",
                "is_required": False,
                "unit_family": "flow",
                "enum_options": [],
                "description": "设计名义流量。",
                "sort_order": 0,
                "status": "active",
            },
            {
                "id": "attribute-1",
                "class_id": "class-1",
                "code": "tag_no",
                "name": "位号",
                "value_type": "string",
                "is_required": True,
                "unit_family": None,
                "enum_options": [],
                "description": "设备或对象的主位号。",
                "sort_order": 1,
                "status": "active",
            },
        ]

        with patch("app.main.reorder_attributes", return_value=reordered_attributes) as reorder_attributes:
            response = client.patch(
                "/api/classes/class-1/attributes/order",
                json={"attribute_ids": ["attribute-2", "attribute-1"]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": reordered_attributes})
        reorder_attributes.assert_called_once_with("class-1", ["attribute-2", "attribute-1"])

    def test_returns_404_for_reordering_missing_attribute_parent_class(self):
        with patch("app.main.reorder_attributes", return_value=None):
            response = client.patch(
                "/api/classes/missing/attributes/order",
                json={"attribute_ids": ["attribute-2", "attribute-1"]},
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Class not found"})

    def test_returns_400_for_invalid_attribute_order(self):
        with patch("app.main.reorder_attributes", side_effect=ValueError("Attribute ids must be unique")):
            response = client.patch(
                "/api/classes/class-1/attributes/order",
                json={"attribute_ids": ["attribute-1", "attribute-1"]},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Attribute ids must be unique"})


if __name__ == "__main__":
    unittest.main()
