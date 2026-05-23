from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from math import isfinite
from typing import Any

from .db import fetch_all, fetch_one
from .relation_repository import DOCUMENT_LINKS_TAG_CODE


QUALITY_DIMENSIONS = (
    ("completeness", "完整性"),
    ("accuracy", "准确性"),
    ("consistency", "一致性"),
    ("document_readiness", "文档齐套性"),
)

MATRIX_OK_STATUSES = {"ok"}


def get_project_data_quality_summary(project_id: str) -> dict:
    return _load_project_data_quality(project_id)["summary"]


def get_project_data_quality_issues(project_id: str) -> list[dict]:
    return _load_project_data_quality(project_id)["issues"]


def get_project_data_quality_document_matrix(project_id: str) -> list[dict]:
    return _load_project_data_quality(project_id)["document_matrix"]


def get_project_data_quality(project_id: str) -> dict:
    return _load_project_data_quality(project_id)


def _load_project_data_quality(project_id: str) -> dict:
    project = _load_project(project_id)
    if project is None:
        raise ValueError("Project not found")

    standard_id = _text(project.get("standard_id"))
    return build_project_data_quality(
        project=project,
        tags=_load_tags(project_id),
        equipment=_load_equipment(project_id),
        documents=_load_documents(project_id),
        document_tag_links=_load_document_tag_links(project_id),
        required_attributes=_load_required_attributes(standard_id) if standard_id else [],
        document_requirements=_load_document_requirements(standard_id) if standard_id else [],
    )


def build_project_data_quality(
    *,
    project: dict,
    tags: list[dict],
    equipment: list[dict],
    documents: list[dict],
    document_tag_links: list[dict],
    required_attributes: list[dict],
    document_requirements: list[dict],
) -> dict:
    issues: list[dict] = []
    check_totals: Counter[str] = Counter()
    check_failures: Counter[str] = Counter()

    tags_by_id = {str(tag["id"]): tag for tag in tags}
    documents_by_id = {str(document["id"]): document for document in documents}
    linked_document_ids_by_tag_id = _group_linked_document_ids_by_tag_id(document_tag_links)
    required_attributes_by_class_id = _group_required_attributes(required_attributes, owner_kind="class")
    common_required_tag_attributes = [
        attribute
        for attribute in required_attributes
        if _text(attribute.get("owner_kind")) == "standard" and _applies_to_asset(attribute, "tag")
    ]
    required_attributes_by_equipment_class_id = _group_required_attributes(
        [attribute for attribute in required_attributes if _applies_to_asset(attribute, "equipment")],
        owner_kind="class",
    )
    document_requirements_by_class_id = _group_requirements_by_class(document_requirements)

    for tag in tags:
        _validate_tag_class_and_pbs(tag, issues, check_totals, check_failures)
        _validate_asset_required_attributes(
            asset=tag,
            asset_kind="tag",
            attributes=[
                *common_required_tag_attributes,
                *required_attributes_by_class_id.get(_text(tag.get("class_id")) or "", []),
            ],
            issues=issues,
            check_totals=check_totals,
            check_failures=check_failures,
        )

    for equipment_item in equipment:
        _validate_asset_required_attributes(
            asset=equipment_item,
            asset_kind="equipment",
            attributes=required_attributes_by_equipment_class_id.get(_text(equipment_item.get("class_id")) or "", []),
            issues=issues,
            check_totals=check_totals,
            check_failures=check_failures,
        )

    for document in documents:
        _validate_document(document, issues, check_totals, check_failures)

    document_matrix = _build_document_matrix(
        tags=tags,
        equipment=equipment,
        documents_by_id=documents_by_id,
        linked_document_ids_by_tag_id=linked_document_ids_by_tag_id,
        document_requirements_by_class_id=document_requirements_by_class_id,
        issues=issues,
        check_totals=check_totals,
        check_failures=check_failures,
    )

    dimension_cards = _build_dimension_cards(issues, check_totals, check_failures)
    scores = {card["dimension"]: int(card["score"]) for card in dimension_cards}
    summary = {
        "project_id": _text(project.get("id")),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "standard": _standard_payload(project),
        "scope": {
            "tag_count": len(tags),
            "equipment_count": len(equipment),
            "document_count": len(documents),
            "pbs_node_count": int(project.get("pbs_node_count") or 0),
            "requirement_count": len(document_requirements),
        },
        "overall_score": _weighted_overall_score(scores),
        "completeness_score": scores["completeness"],
        "accuracy_score": scores["accuracy"],
        "consistency_score": scores["consistency"],
        "document_readiness_score": scores["document_readiness"],
        "critical_issue_count": sum(1 for issue in issues if issue["severity"] == "critical"),
        "issue_count": len(issues),
        "matrix_row_count": len(document_matrix),
        "dimension_cards": dimension_cards,
    }
    return {"summary": summary, "issues": issues, "document_matrix": document_matrix}


def _load_project(project_id: str) -> dict | None:
    return fetch_one(
        """
        SELECT
            p.id::text AS id,
            p.code,
            p.name,
            p.reference_attributes,
            s.id::text AS standard_id,
            s.code AS standard_code,
            s.name AS standard_name,
            s.version_label AS standard_version_label,
            COALESCE(pbs_stats.pbs_node_count, 0)::int AS pbs_node_count
        FROM project p
        LEFT JOIN standard s ON s.id::text = p.reference_attributes ->> 'standard_id'
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS pbs_node_count
            FROM pbs_node pn
            WHERE pn.project_id = p.id
              AND pn.status <> 'archived'
        ) pbs_stats ON TRUE
        WHERE p.id = %s
          AND p.status <> 'archived'
        """,
        (project_id,),
    )


def _load_tags(project_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT
            t.id::text AS id,
            t.tag_no,
            t.name,
            t.class_id::text AS class_id,
            c.code AS class_code,
            c.name AS class_name,
            t.pbs_node_id::text AS pbs_node_id,
            pn.code AS pbs_node_code,
            pn.name AS pbs_node_name,
            t.attribute_values,
            t.status
        FROM tag t
        LEFT JOIN class c ON c.id = t.class_id
        LEFT JOIN pbs_node pn ON pn.id = t.pbs_node_id
        WHERE t.project_id = %s
          AND t.status <> 'archived'
        ORDER BY t.tag_no, t.name
        """,
        (project_id,),
    )


def _load_equipment(project_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT
            e.id::text AS id,
            e.equipment_no,
            e.name,
            e.class_id::text AS class_id,
            ec.code AS class_code,
            ec.name AS class_name,
            e.manufacturer,
            e.model,
            e.serial_no,
            e.purchase_order_no,
            e.asset_status,
            COALESCE(e.attribute_values, '{}'::jsonb) AS attribute_values,
            e.metadata,
            current_assignment.tag_id::text AS tag_id,
            current_assignment.tag_no,
            current_assignment.tag_name,
            current_assignment.pbs_node_id::text AS pbs_node_id,
            current_assignment.pbs_node_code,
            current_assignment.pbs_node_name
        FROM equipment e
        LEFT JOIN class ec ON ec.id = e.class_id
        LEFT JOIN LATERAL (
            SELECT
                tea.tag_id,
                t.tag_no,
                t.name AS tag_name,
                t.pbs_node_id,
                pn.code AS pbs_node_code,
                pn.name AS pbs_node_name
            FROM tag_equipment_assignment tea
            JOIN tag t ON t.id = tea.tag_id
            LEFT JOIN pbs_node pn ON pn.id = t.pbs_node_id
            WHERE tea.equipment_id = e.id
              AND tea.is_current = true
              AND tea.status = 'active'
              AND t.status <> 'archived'
            ORDER BY tea.installed_from DESC, tea.created_at DESC
            LIMIT 1
        ) current_assignment ON TRUE
        WHERE e.project_id = %s
          AND e.asset_status <> 'archived'
        ORDER BY e.equipment_no, e.name
        """,
        (project_id,),
    )


def _load_documents(project_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT
            d.id::text AS id,
            d.document_no,
            d.title,
            d.class_id::text AS document_type_id,
            dc.code AS document_type_code,
            dc.name AS document_type_name,
            d.discipline,
            d.status,
            d.current_revision_id::text AS current_revision_id,
            dr.revision_no AS current_revision_no,
            dr.state AS current_revision_state,
            COALESCE(file_stats.ready_file_count, 0)::int AS ready_file_count,
            COALESCE(file_stats.primary_ready_file_count, 0)::int AS primary_ready_file_count,
            COALESCE(tag_stats.linked_tag_count, 0)::int AS linked_tag_count,
            COALESCE(pbs_stats.linked_pbs_count, 0)::int AS linked_pbs_count
        FROM document d
        LEFT JOIN class dc ON dc.id = d.class_id
        LEFT JOIN document_revision dr ON dr.id = d.current_revision_id
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE df.status = 'ready')::int AS ready_file_count,
                COUNT(*) FILTER (WHERE df.status = 'ready' AND df.file_role = 'primary')::int AS primary_ready_file_count
            FROM document_file df
            WHERE df.revision_id = d.current_revision_id
              AND df.status <> 'deleted'
        ) file_stats ON TRUE
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS linked_tag_count
            FROM project_relation pr
            JOIN relation_type rt ON rt.id = pr.relation_type_id
            WHERE pr.project_id = d.project_id
              AND pr.source_kind = 'document'
              AND pr.source_id = d.id
              AND pr.target_kind = 'tag'
              AND lower(rt.code) = lower(%s)
        ) tag_stats ON TRUE
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS linked_pbs_count
            FROM project_relation pr
            JOIN relation_type rt ON rt.id = pr.relation_type_id
            WHERE pr.project_id = d.project_id
              AND pr.source_kind = 'document'
              AND pr.source_id = d.id
              AND pr.target_kind = 'pbs_node'
              AND lower(rt.code) = lower('document_links_pbs')
        ) pbs_stats ON TRUE
        WHERE d.project_id = %s
          AND d.status <> 'archived'
        ORDER BY d.document_no, d.title
        """,
        (DOCUMENT_LINKS_TAG_CODE, project_id),
    )


def _load_document_tag_links(project_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT
            pr.source_id::text AS document_id,
            pr.target_id::text AS tag_id
        FROM project_relation pr
        JOIN relation_type rt ON rt.id = pr.relation_type_id
        WHERE pr.project_id = %s
          AND pr.source_kind = 'document'
          AND pr.target_kind = 'tag'
          AND lower(rt.code) = lower(%s)
        """,
        (project_id, DOCUMENT_LINKS_TAG_CODE),
    )


def _load_required_attributes(standard_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT
            ad.id::text AS id,
            CASE WHEN ad.class_id IS NULL THEN 'standard' ELSE 'class' END AS owner_kind,
            ad.standard_id::text AS standard_id,
            ad.class_id::text AS class_id,
            ad.code,
            ad.name,
            ad.value_type,
            ad.enum_options,
            ad.applies_to
        FROM attribute_definition ad
        LEFT JOIN class c ON c.id = ad.class_id
        WHERE ad.is_required = true
          AND ad.status = 'active'
          AND (
            ad.standard_id = %s
            OR c.standard_id = %s
          )
        ORDER BY ad.sort_order, ad.code
        """,
        (standard_id, standard_id),
    )


def _load_document_requirements(standard_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT
            cdr.id::text AS id,
            cdr.class_id::text AS class_id,
            asset_class.code AS class_code,
            asset_class.name AS class_name,
            asset_class.applies_to AS class_applies_to,
            cdr.document_type_id::text AS document_type_id,
            document_type.code AS document_type_code,
            document_type.name AS document_type_name,
            cdr.asset_scope,
            cdr.perspective,
            cdr.lifecycle_phase,
            cdr.status
        FROM class_document_requirement cdr
        JOIN class asset_class ON asset_class.id = cdr.class_id
        JOIN class document_type ON document_type.id = cdr.document_type_id
        WHERE cdr.standard_id = %s
          AND cdr.status = 'active'
        ORDER BY asset_class.code, document_type.code, cdr.lifecycle_phase
        """,
        (standard_id,),
    )


def _validate_tag_class_and_pbs(tag: dict, issues: list[dict], check_totals: Counter[str], check_failures: Counter[str]) -> None:
    check_totals["completeness"] += 1
    if not _text(tag.get("class_id")):
        check_failures["completeness"] += 1
        issues.append(
            _issue(
                severity="high",
                dimension="completeness",
                object_kind="tag",
                asset=tag,
                field="class",
                rule="required_class",
                current_value="-",
                expected_value="必须关联对象类别",
                suggestion="为 TAG 关联标准 Class，以便套用属性和交付文档规则。",
            )
        )

    check_totals["consistency"] += 1
    if not _text(tag.get("pbs_node_id")):
        check_failures["consistency"] += 1
        issues.append(
            _issue(
                severity="medium",
                dimension="consistency",
                object_kind="tag",
                asset=tag,
                field="pbs_node",
                rule="required_pbs_binding",
                current_value="-",
                expected_value="必须关联 PBS 节点",
                suggestion="将 TAG 归属到正确的 PBS 节点，避免交付范围无法定位。",
            )
        )


def _validate_asset_required_attributes(
    *,
    asset: dict,
    asset_kind: str,
    attributes: list[dict],
    issues: list[dict],
    check_totals: Counter[str],
    check_failures: Counter[str],
) -> None:
    for attribute in attributes:
        code = _text(attribute.get("code")) or ""
        if not code:
            continue
        value = _asset_attribute_value(asset, asset_kind, code)
        check_totals["completeness"] += 1
        if _is_missing(value):
            check_failures["completeness"] += 1
            issues.append(
                _issue(
                    severity="high",
                    dimension="completeness",
                    object_kind=asset_kind,
                    asset=asset,
                    field=code,
                    rule="required_attribute",
                    current_value="-",
                    expected_value=f"必填: {_text(attribute.get('name')) or code}",
                    suggestion="补充标准要求的必填属性后重新检查。",
                )
            )
            continue

        check_totals["accuracy"] += 1
        validation_error = _validate_attribute_value(attribute, value)
        if validation_error is not None:
            check_failures["accuracy"] += 1
            issues.append(
                _issue(
                    severity="medium",
                    dimension="accuracy",
                    object_kind=asset_kind,
                    asset=asset,
                    field=code,
                    rule="attribute_value_type",
                    current_value=_format_value(value),
                    expected_value=validation_error,
                    suggestion="按标准字段类型或枚举范围修正属性值。",
                )
            )


def _validate_document(document: dict, issues: list[dict], check_totals: Counter[str], check_failures: Counter[str]) -> None:
    has_current_revision = bool(_text(document.get("current_revision_id")))
    has_primary_ready_file = int(document.get("primary_ready_file_count") or 0) > 0

    check_totals["completeness"] += 1
    if not has_current_revision:
        check_failures["completeness"] += 1
        issues.append(
            _issue(
                severity="high",
                dimension="completeness",
                object_kind="document",
                asset=document,
                field="current_revision",
                rule="current_revision_required",
                current_value="-",
                expected_value="必须存在当前版本",
                suggestion="为文档创建并设置当前版本。",
                linked_document_no=_text(document.get("document_no")),
            )
        )

    check_totals["completeness"] += 1
    if has_current_revision and not has_primary_ready_file:
        check_failures["completeness"] += 1
        issues.append(
            _issue(
                severity="high",
                dimension="completeness",
                object_kind="document",
                asset=document,
                field="primary_file",
                rule="current_revision_primary_file_required",
                current_value="-",
                expected_value="当前版本必须有可用主文件",
                suggestion="上传当前版本主文件并完成归档。",
                linked_document_no=_text(document.get("document_no")),
            )
        )

    check_totals["document_readiness"] += 1
    revision_state = _text(document.get("current_revision_state"))
    if has_current_revision and revision_state != "issued":
        check_failures["document_readiness"] += 1
        issues.append(
            _issue(
                severity="medium" if revision_state == "draft" else "high",
                dimension="document_readiness",
                object_kind="document",
                asset=document,
                field="current_revision_state",
                rule="current_revision_should_be_issued",
                current_value=revision_state or "-",
                expected_value="issued",
                suggestion="确认当前版本状态，交付前应发放为 issued。",
                linked_document_no=_text(document.get("document_no")),
            )
        )
    elif has_current_revision and not has_primary_ready_file:
        check_failures["document_readiness"] += 1

    check_totals["consistency"] += 1
    if int(document.get("linked_tag_count") or 0) == 0 and int(document.get("linked_pbs_count") or 0) == 0:
        check_failures["consistency"] += 1
        issues.append(
            _issue(
                severity="low",
                dimension="consistency",
                object_kind="document",
                asset=document,
                field="relations",
                rule="document_should_link_business_object",
                current_value="-",
                expected_value="至少关联 TAG 或 PBS",
                suggestion="将文档关联到适用的 TAG 或 PBS 节点，便于交付追溯。",
                linked_document_no=_text(document.get("document_no")),
            )
        )


def _build_document_matrix(
    *,
    tags: list[dict],
    equipment: list[dict],
    documents_by_id: dict[str, dict],
    linked_document_ids_by_tag_id: dict[str, list[str]],
    document_requirements_by_class_id: dict[str, list[dict]],
    issues: list[dict],
    check_totals: Counter[str],
    check_failures: Counter[str],
) -> list[dict]:
    tag_rows = [
        _build_asset_matrix_row(
            asset=tag,
            asset_kind="tag",
            requirements=document_requirements_by_class_id.get(_text(tag.get("class_id")) or "", []),
            linked_documents=[
                documents_by_id[document_id]
                for document_id in linked_document_ids_by_tag_id.get(str(tag["id"]), [])
                if document_id in documents_by_id
            ],
            issues=issues,
            check_totals=check_totals,
            check_failures=check_failures,
        )
        for tag in tags
        if _text(tag.get("class_id")) in document_requirements_by_class_id
    ]
    equipment_rows = [
        _build_asset_matrix_row(
            asset=equipment_item,
            asset_kind="equipment",
            requirements=document_requirements_by_class_id.get(_text(equipment_item.get("class_id")) or "", []),
            linked_documents=[
                documents_by_id[document_id]
                for document_id in linked_document_ids_by_tag_id.get(_text(equipment_item.get("tag_id")) or "", [])
                if document_id in documents_by_id
            ],
            issues=issues,
            check_totals=check_totals,
            check_failures=check_failures,
        )
        for equipment_item in equipment
        if _text(equipment_item.get("class_id")) in document_requirements_by_class_id
    ]
    return [row for row in [*tag_rows, *equipment_rows] if row["required_count"] > 0]


def _build_asset_matrix_row(
    *,
    asset: dict,
    asset_kind: str,
    requirements: list[dict],
    linked_documents: list[dict],
    issues: list[dict],
    check_totals: Counter[str],
    check_failures: Counter[str],
) -> dict:
    cells = [
        _build_matrix_cell(asset, asset_kind, requirement, linked_documents, issues, check_totals, check_failures)
        for requirement in requirements
    ]
    satisfied_count = sum(1 for cell in cells if cell["status"] in MATRIX_OK_STATUSES)
    required_count = len(cells)
    missing_count = required_count - satisfied_count
    return {
        "row_id": f"{asset_kind}:{asset['id']}",
        "asset_kind": asset_kind,
        "asset_id": _text(asset.get("id")),
        "asset_no": _asset_no(asset, asset_kind),
        "asset_name": _asset_name(asset, asset_kind),
        "class_id": _text(asset.get("class_id")),
        "class_code": _text(asset.get("class_code")),
        "class_name": _text(asset.get("class_name")),
        "pbs_node_id": _text(asset.get("pbs_node_id")),
        "pbs_node_code": _text(asset.get("pbs_node_code")),
        "pbs_node_name": _text(asset.get("pbs_node_name")),
        "equipment_id": _text(asset.get("id")) if asset_kind == "equipment" else _text(asset.get("equipment_id")),
        "equipment_no": _text(asset.get("equipment_no")),
        "equipment_name": _text(asset.get("equipment_name")),
        "required_count": required_count,
        "satisfied_count": satisfied_count,
        "missing_count": missing_count,
        "completeness_percent": _percent(satisfied_count, required_count),
        "cells": cells,
    }


def _build_matrix_cell(
    asset: dict,
    asset_kind: str,
    requirement: dict,
    linked_documents: list[dict],
    issues: list[dict],
    check_totals: Counter[str],
    check_failures: Counter[str],
) -> dict:
    matching_documents = [
        document
        for document in linked_documents
        if _text(document.get("document_type_id")) == _text(requirement.get("document_type_id"))
    ]
    document = _best_document_candidate(matching_documents)
    status = _matrix_cell_status(document)
    check_totals["document_readiness"] += 1
    if status not in MATRIX_OK_STATUSES:
        check_failures["document_readiness"] += 1
        issues.append(_document_matrix_issue(asset, asset_kind, requirement, document, status))

    return {
        "requirement_id": _text(requirement.get("id")),
        "document_type_id": _text(requirement.get("document_type_id")),
        "document_type_code": _text(requirement.get("document_type_code")),
        "document_type_name": _text(requirement.get("document_type_name")),
        "asset_scope": _text(requirement.get("asset_scope")),
        "lifecycle_phase": _text(requirement.get("lifecycle_phase")),
        "status": status,
        "document_id": _text(document.get("id")) if document else None,
        "document_no": _text(document.get("document_no")) if document else None,
        "document_title": _text(document.get("title")) if document else None,
        "revision_no": _text(document.get("current_revision_no")) if document else None,
        "revision_state": _text(document.get("current_revision_state")) if document else None,
        "file_count": int(document.get("ready_file_count") or 0) if document else 0,
    }


def _document_matrix_issue(asset: dict, asset_kind: str, requirement: dict, document: dict | None, status: str) -> dict:
    rule_by_status = {
        "missing": "required_document",
        "draft": "required_document_not_issued",
        "no_file": "required_document_file_missing",
        "linked_error": "required_document_link_invalid",
    }
    expected_by_status = {
        "missing": "必须关联该类型文档",
        "draft": "当前版本应为 issued",
        "no_file": "当前版本应有可用主文件",
        "linked_error": "关联文档状态应有效",
    }
    suggestion_by_status = {
        "missing": "补齐该对象类别要求的交付文档，并关联到对应对象。",
        "draft": "确认文档版本并将可交付版本发放为 issued。",
        "no_file": "上传当前版本主文件并完成归档。",
        "linked_error": "检查文档状态、版本状态和关联关系。",
    }
    return _issue(
        severity="medium" if status == "draft" else "high",
        dimension="document_readiness",
        object_kind=asset_kind,
        asset=asset,
        field=_text(requirement.get("document_type_code")) or "document_type",
        rule=rule_by_status.get(status, "required_document"),
        current_value=_text(document.get("document_no")) if document else "-",
        expected_value=expected_by_status.get(status, "必须齐套"),
        suggestion=suggestion_by_status.get(status, "补齐交付文档。"),
        linked_document_no=_text(document.get("document_no")) if document else None,
    )


def _matrix_cell_status(document: dict | None) -> str:
    if document is None:
        return "missing"
    if _text(document.get("status")) != "active":
        return "linked_error"
    revision_state = _text(document.get("current_revision_state"))
    if not _text(document.get("current_revision_id")):
        return "no_file"
    if revision_state == "draft":
        return "draft"
    if revision_state != "issued":
        return "linked_error"
    if int(document.get("primary_ready_file_count") or 0) <= 0:
        return "no_file"
    return "ok"


def _best_document_candidate(documents: list[dict]) -> dict | None:
    if not documents:
        return None
    priority = {"ok": 0, "draft": 1, "no_file": 2, "linked_error": 3, "missing": 4}
    return sorted(documents, key=lambda document: priority.get(_matrix_cell_status(document), 9))[0]


def _issue(
    *,
    severity: str,
    dimension: str,
    object_kind: str,
    asset: dict,
    field: str,
    rule: str,
    current_value: str,
    expected_value: str,
    suggestion: str,
    linked_document_no: str | None = None,
) -> dict:
    object_id = _text(asset.get("id")) or ""
    return {
        "id": f"{rule}:{object_kind}:{object_id}:{field}",
        "severity": severity,
        "dimension": dimension,
        "object_kind": object_kind,
        "object_id": object_id,
        "object_code": _asset_no(asset, object_kind),
        "object_name": _asset_name(asset, object_kind),
        "field": field,
        "rule": rule,
        "current_value": current_value,
        "expected_value": expected_value,
        "linked_document_no": linked_document_no,
        "suggestion": suggestion,
    }


def _build_dimension_cards(issues: list[dict], check_totals: Counter[str], check_failures: Counter[str]) -> list[dict]:
    issue_counts = Counter(issue["dimension"] for issue in issues)
    critical_counts = Counter(issue["dimension"] for issue in issues if issue["severity"] == "critical")
    return [
        {
            "dimension": dimension,
            "label": label,
            "score": _score(check_totals[dimension], check_failures[dimension]),
            "issue_count": int(issue_counts[dimension]),
            "critical_issue_count": int(critical_counts[dimension]),
            "checks_passed": max(0, int(check_totals[dimension] - check_failures[dimension])),
            "checks_total": int(check_totals[dimension]),
        }
        for dimension, label in QUALITY_DIMENSIONS
    ]


def _score(total: int, failed: int) -> int:
    if total <= 0:
        return 100
    return round(max(0, min(100, 100 * (total - failed) / total)))


def _weighted_overall_score(scores: dict[str, int]) -> int:
    return round(
        scores["completeness"] * 0.3
        + scores["accuracy"] * 0.2
        + scores["consistency"] * 0.2
        + scores["document_readiness"] * 0.3
    )


def _group_required_attributes(attributes: list[dict], *, owner_kind: str) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for attribute in attributes:
        if _text(attribute.get("owner_kind")) != owner_kind:
            continue
        class_id = _text(attribute.get("class_id"))
        if class_id:
            grouped[class_id] = [*grouped[class_id], attribute]
    return dict(grouped)


def _group_requirements_by_class(requirements: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for requirement in requirements:
        class_id = _text(requirement.get("class_id"))
        if class_id:
            grouped[class_id] = [*grouped[class_id], requirement]
    return dict(grouped)


def _group_linked_document_ids_by_tag_id(links: list[dict]) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = defaultdict(list)
    for link in links:
        tag_id = _text(link.get("tag_id"))
        document_id = _text(link.get("document_id"))
        if tag_id and document_id:
            grouped[tag_id] = [*grouped[tag_id], document_id]
    return dict(grouped)


def _applies_to_asset(attribute: dict, asset_kind: str) -> bool:
    applies_to = _text(attribute.get("applies_to")) or "tag"
    return applies_to == "both" or applies_to == asset_kind


def _asset_attribute_value(asset: dict, asset_kind: str, code: str) -> Any:
    builtins = _tag_builtin_values(asset) if asset_kind == "tag" else _equipment_builtin_values(asset)
    if code in builtins:
        return builtins[code]
    values = asset.get("attribute_values")
    if asset_kind == "equipment" and not isinstance(values, dict):
        values = asset.get("metadata")
    if isinstance(values, dict):
        return values.get(code)
    return None


def _tag_builtin_values(asset: dict) -> dict[str, Any]:
    return {
        "tag_no": asset.get("tag_no"),
        "name": asset.get("name"),
        "class": asset.get("class_id"),
        "class_id": asset.get("class_id"),
        "pbs": asset.get("pbs_node_id"),
        "pbs_node_id": asset.get("pbs_node_id"),
    }


def _equipment_builtin_values(asset: dict) -> dict[str, Any]:
    return {
        "equipment_no": asset.get("equipment_no"),
        "name": asset.get("name"),
        "class": asset.get("class_id"),
        "class_id": asset.get("class_id"),
        "manufacturer": asset.get("manufacturer"),
        "model": asset.get("model"),
        "serial_no": asset.get("serial_no"),
        "purchase_order_no": asset.get("purchase_order_no"),
        "asset_status": asset.get("asset_status"),
    }


def _validate_attribute_value(attribute: dict, value: Any) -> str | None:
    value_type = _text(attribute.get("value_type")) or "string"
    if value_type == "number":
        return None if _is_number(value) else "必须是数字"
    if value_type == "integer":
        return None if _is_integer(value) else "必须是整数"
    if value_type == "boolean":
        return None if isinstance(value, bool) else "必须是布尔值"
    if value_type == "date":
        return None if _is_date(value) else "必须是 ISO 日期"
    if value_type == "enum":
        options = attribute.get("enum_options") if isinstance(attribute.get("enum_options"), list) else []
        if not options:
            return None
        return None if str(value) in {str(option) for option in options} else f"必须在枚举范围内: {', '.join(map(str, options))}"
    return None


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def _is_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return isfinite(float(value))
    if isinstance(value, str):
        try:
            return isfinite(float(value.strip()))
        except ValueError:
            return False
    return False


def _is_integer(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, str):
        try:
            int(value.strip())
            return True
        except ValueError:
            return False
    return False


def _is_date(value: Any) -> bool:
    if isinstance(value, (date, datetime)):
        return True
    if not isinstance(value, str):
        return False
    try:
        date.fromisoformat(value.strip()[:10])
        return True
    except ValueError:
        return False


def _standard_payload(project: dict) -> dict | None:
    standard_id = _text(project.get("standard_id"))
    if not standard_id:
        return None
    return {
        "id": standard_id,
        "code": _text(project.get("standard_code")),
        "name": _text(project.get("standard_name")),
        "version_label": _text(project.get("standard_version_label")),
    }


def _asset_no(asset: dict, asset_kind: str) -> str:
    keys = {
        "tag": ("tag_no",),
        "equipment": ("equipment_no", "tag_no"),
        "document": ("document_no",),
        "pbs_node": ("code",),
    }.get(asset_kind, ("code", "tag_no", "equipment_no", "document_no"))
    for key in keys:
        value = _text(asset.get(key))
        if value:
            return value
    return "-"


def _asset_name(asset: dict, asset_kind: str) -> str:
    if asset_kind == "equipment":
        return _text(asset.get("name")) or _text(asset.get("tag_name")) or "-"
    return _text(asset.get("name")) or _text(asset.get("title")) or "-"


def _percent(part: int, total: int) -> int:
    if total <= 0:
        return 100
    return round(100 * part / total)


def _format_value(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, (dict, list)):
        return str(value)
    text = str(value).strip()
    return text or "-"


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
