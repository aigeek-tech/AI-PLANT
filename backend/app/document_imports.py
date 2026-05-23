from __future__ import annotations

import json
import os
import re
from difflib import SequenceMatcher
from pathlib import PurePosixPath
from typing import Any

from .ai_client import complete_chat_text
from .db import fetch_all
from .repository import get_ai_settings_secret


REVISION_PATTERNS = [
    re.compile(r"(?i)(?:^|[_\-\s])rev(?:ision)?[_\-\s]*([A-Z0-9]{1,8})(?:$|[_\-\s])"),
    re.compile(r"(?i)(?:^|[_\-\s])r([A-Z0-9]{1,4})(?:$|[_\-\s])"),
]
DOCUMENT_NO_PATTERN = re.compile(r"\b[A-Z0-9]+(?:[-_][A-Z0-9]+){1,6}\b")
MAX_LLM_FILES = 50


def analyze_document_import_files(project_id: str, payload: dict) -> dict:
    files = [item for item in (payload.get("files") or []) if isinstance(item, dict)]
    existing_documents = _load_existing_documents(project_id)

    candidates = [
        _analyze_file_candidate(project_id, item, existing_documents)
        for item in files
    ]

    if bool(payload.get("use_llm", True)):
        _apply_llm_analysis(candidates, existing_documents)

    summary = {
        "total_files": len(candidates),
        "rule_auto_count": sum(1 for item in candidates if item["decision_source"] == "rule"),
        "ai_suggested_count": sum(1 for item in candidates if item["decision_source"] == "llm"),
        "manual_review_count": sum(1 for item in candidates if item["decision_source"] == "manual"),
        "needs_confirmation_count": sum(1 for item in candidates if item["needs_confirmation"]),
    }
    return {
        "items": candidates,
        "summary": summary,
    }


def _load_existing_documents(project_id: str) -> list[dict]:
    rows = fetch_all(
        """
        SELECT
            pd.id,
            pd.document_no,
            pd.title,
            pdr.id AS revision_id,
            pdr.revision_no
        FROM document pd
        LEFT JOIN document_revision pdr ON pdr.document_id = pd.id
        WHERE pd.project_id = %s
        ORDER BY pd.created_at DESC, pdr.created_at DESC NULLS LAST
        """,
        (project_id,),
    )
    by_id: dict[str, dict] = {}
    for row in rows:
        document_id = str(row["id"])
        document = by_id.setdefault(
            document_id,
            {
                "id": document_id,
                "document_no": row["document_no"],
                "title": row["title"],
                "revisions": [],
            },
        )
        if row.get("revision_id"):
            document["revisions"].append(
                {
                    "id": str(row["revision_id"]),
                    "revision_no": row["revision_no"],
                }
            )
    return list(by_id.values())


def _analyze_file_candidate(project_id: str, item: dict, existing_documents: list[dict]) -> dict:
    filename = str(item.get("filename") or "").strip()
    relative_path = str(item.get("relative_path") or "").strip()
    basename = os.path.splitext(os.path.basename(filename))[0]
    parts = _extract_path_parts(relative_path, filename)
    guessed_revision_no = _guess_revision_no(parts, basename)
    explicit_document_no = _guess_document_no(parts, basename)
    matched_document = _match_existing_document(filename, relative_path, existing_documents, explicit_document_no)
    guessed_document_no = matched_document["document_no"] if matched_document else explicit_document_no
    guessed_title = matched_document["title"] if matched_document else _guess_title(basename, guessed_document_no, guessed_revision_no)
    guessed_file_role = _guess_file_role(filename, relative_path)
    matched_revision = _match_revision(matched_document, guessed_revision_no) if matched_document else None

    reasons: list[str] = []
    confidence = 0.25
    decision_source = "manual"
    needs_confirmation = True

    if matched_document:
        reasons.append(f"文件名或路径命中项目内文档编号 {matched_document['document_no']}")
        confidence = 0.9 if guessed_revision_no else 0.78
        decision_source = "rule"
        needs_confirmation = False
    elif guessed_document_no and guessed_revision_no:
        reasons.append("从文件名/路径中同时识别出文档编号和修订号")
        confidence = 0.8
        decision_source = "rule"
        needs_confirmation = False
    elif guessed_document_no:
        reasons.append("从文件名/路径中识别出文档编号，但修订号不明确")
        confidence = 0.55
        decision_source = "manual"
        needs_confirmation = True
    else:
        reasons.append("强规则无法稳定识别文档编号")

    return {
        "client_id": str(item.get("client_id") or "").strip() or filename,
        "project_id": project_id,
        "filename": filename,
        "relative_path": relative_path or None,
        "size_bytes": int(item.get("size_bytes") or 0),
        "content_type": str(item.get("content_type") or "").strip() or None,
        "suggested_document_no": guessed_document_no,
        "suggested_title": guessed_title,
        "suggested_revision_no": guessed_revision_no,
        "suggested_file_role": guessed_file_role,
        "matched_document_id": matched_document["id"] if matched_document else None,
        "matched_document_title": matched_document["title"] if matched_document else None,
        "matched_revision_id": matched_revision["id"] if matched_revision else None,
        "confidence": round(confidence, 2),
        "decision_source": decision_source,
        "needs_confirmation": needs_confirmation,
        "match_reasons": reasons,
    }


def _extract_path_parts(relative_path: str, filename: str) -> list[str]:
    if not relative_path:
        return [os.path.splitext(filename)[0]]
    path = PurePosixPath(relative_path.replace("\\", "/"))
    return [part for part in path.parts if part not in {"."}]


def _guess_revision_no(parts: list[str], basename: str) -> str | None:
    for value in [*reversed(parts), basename]:
        normalized = value.upper()
        for pattern in REVISION_PATTERNS:
            match = pattern.search(normalized)
            if match:
                return match.group(1).strip()
        if normalized in {"A", "B", "C", "0", "1", "2", "3"}:
            return normalized
    return None


def _guess_document_no(parts: list[str], basename: str) -> str | None:
    for value in [basename, *reversed(parts)]:
        matches = DOCUMENT_NO_PATTERN.findall(value.upper())
        if matches:
            return matches[0].replace("_", "-")
    return None


def _guess_title(basename: str, document_no: str | None, revision_no: str | None) -> str | None:
    title = basename
    if document_no:
        title = re.sub(re.escape(document_no), "", title, flags=re.IGNORECASE)
    if revision_no:
        title = re.sub(rf"(?i)(?:^|[_\-\s])rev(?:ision)?[_\-\s]*{re.escape(revision_no)}(?:$|[_\-\s])", " ", title)
        title = re.sub(rf"(?i)(?:^|[_\-\s])r{re.escape(revision_no)}(?:$|[_\-\s])", " ", title)
    normalized = re.sub(r"[_\-]+", " ", title).strip()
    return normalized or None


def _guess_file_role(filename: str, relative_path: str) -> str:
    combined = f"{relative_path} {filename}".lower()
    if any(token in combined for token in ["attachment", "附件", "annex"]):
        return "attachment"
    if any(token in combined for token in ["reference", "参考"]):
        return "reference"
    if any(token in combined for token in ["source", "native", ".dwg", ".rvt", ".nwd", ".ifc"]):
        return "source"
    return "primary"


def _match_existing_document(
    filename: str,
    relative_path: str,
    existing_documents: list[dict],
    explicit_document_no: str | None = None,
) -> dict | None:
    normalized_explicit = str(explicit_document_no or "").strip().upper()
    if normalized_explicit:
        for document in existing_documents:
            if str(document["document_no"] or "").upper() == normalized_explicit:
                return document
        return None

    haystack = f"{filename} {relative_path}".upper()
    exact_matches = [
        document
        for document in existing_documents
        if document["document_no"] and _contains_document_no(haystack, str(document["document_no"]))
    ]
    if exact_matches:
        return exact_matches[0]

    basename = os.path.splitext(os.path.basename(filename))[0].upper()
    scored_matches = []
    for document in existing_documents:
        document_no = str(document["document_no"] or "").upper()
        title = str(document["title"] or "").upper()
        ratio = max(
            SequenceMatcher(None, basename, document_no).ratio(),
            SequenceMatcher(None, basename, title).ratio() if title else 0,
        )
        if ratio >= 0.72:
            scored_matches.append((ratio, document))
    scored_matches.sort(key=lambda item: item[0], reverse=True)
    return scored_matches[0][1] if scored_matches else None


def _contains_document_no(haystack: str, document_no: str) -> bool:
    normalized_document_no = document_no.strip().upper()
    if not normalized_document_no:
        return False
    pattern = re.escape(normalized_document_no).replace(r"\-", r"[-_]")
    return re.search(rf"(?<![A-Z0-9]){pattern}(?![A-Z0-9])", haystack) is not None


def _match_revision(document: dict | None, revision_no: str | None) -> dict | None:
    if document is None or not revision_no:
        return None
    normalized = revision_no.upper()
    for revision in document.get("revisions", []):
        if str(revision["revision_no"]).upper() == normalized:
            return revision
    return None


def _apply_llm_analysis(candidates: list[dict], existing_documents: list[dict]) -> None:
    ambiguous = [item for item in candidates if _should_request_llm_suggestion(item)][:MAX_LLM_FILES]
    if not ambiguous:
        return

    settings = get_ai_settings_secret()
    if not _llm_enabled(settings):
        return

    for candidate in ambiguous:
        try:
            suggestion = _request_llm_suggestion(candidate, existing_documents, settings)
        except Exception:
            continue
        if not suggestion:
            continue

        candidate["suggested_document_no"] = suggestion.get("document_no") or candidate["suggested_document_no"]
        candidate["suggested_title"] = suggestion.get("title") or candidate["suggested_title"]
        candidate["suggested_revision_no"] = suggestion.get("revision_no") or candidate["suggested_revision_no"]
        candidate["suggested_file_role"] = suggestion.get("file_role") or candidate["suggested_file_role"]
        llm_confidence = float(suggestion.get("confidence") or 0)
        if llm_confidence >= 0.75 and candidate["suggested_document_no"]:
            candidate["decision_source"] = "llm"
            candidate["confidence"] = round(max(candidate["confidence"], llm_confidence), 2)
            candidate["needs_confirmation"] = True
            candidate["match_reasons"].append("LLM 基于文件名与路径给出高置信度建议，需人工确认")
            matched_document = _match_existing_document(
                candidate["suggested_document_no"],
                candidate.get("relative_path") or "",
                existing_documents,
                candidate["suggested_document_no"],
            )
            if matched_document and str(matched_document["document_no"]).upper() == str(candidate["suggested_document_no"]).upper():
                candidate["matched_document_id"] = matched_document["id"]
                candidate["matched_document_title"] = matched_document["title"]
                matched_revision = _match_revision(matched_document, candidate["suggested_revision_no"])
                candidate["matched_revision_id"] = matched_revision["id"] if matched_revision else None
        else:
            candidate["match_reasons"].append("LLM 未给出足够高的置信度，保留人工处理")


def _should_request_llm_suggestion(candidate: dict) -> bool:
    if candidate["decision_source"] != "manual":
        return False
    if candidate.get("suggested_document_no") and not candidate.get("suggested_revision_no"):
        return False
    return True


def _request_llm_suggestion(candidate: dict, existing_documents: list[dict], settings: dict) -> dict | None:
    context_docs = _select_context_documents(candidate, existing_documents)
    prompt = {
        "task": "根据工程文件名和相对路径，推断文档编号、标题、修订号和文件角色。只返回 JSON。",
        "file": {
            "filename": candidate["filename"],
            "relative_path": candidate.get("relative_path"),
        },
        "candidate": {
            "document_no": candidate.get("suggested_document_no"),
            "revision_no": candidate.get("suggested_revision_no"),
            "title": candidate.get("suggested_title"),
            "file_role": candidate.get("suggested_file_role"),
        },
        "existing_documents": context_docs,
        "output_schema": {
            "document_no": "string|null",
            "title": "string|null",
            "revision_no": "string|null",
            "file_role": "primary|source|attachment|reference|null",
            "confidence": "0..1 number",
        },
    }
    text = complete_chat_text(
        settings,
        system_prompt="You are an engineering document import parser. Output valid JSON only.",
        user_prompt=json.dumps(prompt, ensure_ascii=False),
    )
    payload = json.loads(text)
    if not isinstance(payload, dict):
        return None
    return payload


def _select_context_documents(candidate: dict, existing_documents: list[dict]) -> list[dict]:
    filename = candidate["filename"].upper()
    scored = []
    for document in existing_documents:
        ratio = max(
            SequenceMatcher(None, filename, str(document["document_no"]).upper()).ratio(),
            SequenceMatcher(None, filename, str(document["title"] or "").upper()).ratio(),
        )
        if ratio >= 0.15:
            scored.append((ratio, document))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [
        {
            "document_no": item["document_no"],
            "title": item["title"],
            "revisions": [revision["revision_no"] for revision in item.get("revisions", [])[:5]],
        }
        for _, item in scored[:8]
    ]


def _llm_enabled(settings: dict) -> bool:
    return bool(
        settings.get("is_enabled")
        and settings.get("base_url")
        and settings.get("model")
        and settings.get("api_key")
    )
