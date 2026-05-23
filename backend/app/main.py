import base64
import binascii
import re
from datetime import date, datetime, timezone
from contextlib import asynccontextmanager
from typing import Any, Literal
from urllib.parse import quote as url_quote

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator
from psycopg import IntegrityError
from starlette.responses import Response

from .ai_client import list_available_ai_models, test_ai_endpoint_connection
from .agent_api import router as agent_router
from .auth_api import project_members_router, router as auth_router
from .auth_repository import assign_project_role, ensure_bootstrap_admin
from .authorization import (
    AuthenticatedUser,
    can_read_standard,
    require_any_standard_permission,
    require_attribute_standard_permission,
    require_class_standard_permission,
    require_authenticated_user,
    require_document_type_attribute_standard_permission,
    require_document_type_standard_permission,
    require_pbs_node_permission,
    require_pbs_level_standard_permission,
    require_permission,
    require_project_permission,
    require_tag_permission,
    require_standard_permission,
)
from .db import fetch_one
from .data_quality_repository import (
    get_project_data_quality_document_matrix,
    get_project_data_quality_issues,
    get_project_data_quality_summary,
)
from .document_imports import analyze_document_import_files
from .document_repository import (
    archive_document_type_attribute,
    create_document_type,
    create_document_type_attribute,
    create_project_document,
    create_project_document_revision,
    get_document_type_detail,
    get_project_document_detail,
    list_common_document_type_attributes,
    list_document_types,
    list_project_document_revisions,
    list_project_documents,
    reorder_document_type_attributes,
    update_document_type,
    update_document_type_attribute,
    update_project_document,
    update_project_document_revision,
)
from .document_conversion_service import (
    create_conversion_job_for_file,
    list_conversion_jobs_for_revision,
    retry_conversion_job_for_revision,
)
from .document_service import (
    complete_document_file_upload,
    delete_project_document,
    delete_project_document_revision,
    get_document_file_access,
    get_document_visualization_access,
    get_document_visualization_spark_asset,
    initiate_document_file_upload,
)
from .document_storage import describe_document_storage, get_document_storage
from .document_visualization_repository import (
    create_document_visualization,
    list_document_visualizations,
)
from .document_visualization_object_repository import (
    create_document_visualization_object,
    delete_document_visualization_object,
    list_document_visualization_objects,
    update_document_visualization_object,
)
from .equipment_repository import (
    assign_equipment_to_tag,
    create_project_equipment,
    get_tag_equipment_implementation,
    list_project_equipment,
    list_project_equipment_classes,
)
from .plugin_api import router as plugin_router
from .plugin_runtime import load_enabled_plugins
from .project_service import delete_project
from .repository import (
    create_class,
    create_attribute,
    create_project,
    create_standard,
    delete_standard_record,
    get_ai_settings,
    get_branding_login_background_storage_object,
    get_branding_settings,
    get_projects,
    get_projects_by_ids,
    get_project_standard_ids,
    get_project_detail,
    list_class_attributes,
    list_standard_common_attributes,
    get_standards_by_ids,
    get_standard_detail,
    get_standards,
    move_class,
    reorder_attributes,
    resolve_ai_runtime_settings,
    soft_delete_attribute,
    clear_branding_login_background,
    upsert_ai_settings,
    upsert_branding_login_background,
    upsert_branding_settings,
    update_attribute,
    update_class,
    update_standard_icon,
    get_project_tags,
    get_project_tag_detail,
    search_project_tags,
    create_project_tag,
    update_project_tag,
    delete_project_tag,
    get_pbs_nodes,
    create_pbs_node,
    update_pbs_node,
    get_pbs_level_templates,
    create_pbs_level,
    update_pbs_level,
    delete_pbs_level,
    get_pbs_node_by_id,
    update_project,
)
from .relation_repository import (
    create_project_relation,
    delete_project_relation,
    list_project_relations,
)
from .settings.config import get_settings
from .tag_imports import (
    build_tag_import_template,
    commit_tag_import_job,
    create_tag_import_job_from_upload,
    get_tag_import_job_detail,
    patch_tag_import_row,
)
from .standard_imports import (
    build_standard_export_workbook,
    build_standard_import_template,
    commit_standard_import_job,
    create_standard_import_job_from_upload,
    get_standard_import_job_detail,
    patch_standard_import_item,
    patch_standard_import_job,
)
from .standard_rules_repository import (
    archive_standard_class_document_requirement,
    archive_standard_discipline,
    archive_standard_discipline_document_type,
    create_standard_class_document_requirement,
    create_standard_discipline,
    create_standard_discipline_document_type,
    list_standard_class_document_requirements,
    list_standard_discipline_document_types,
    list_standard_disciplines,
    update_standard_class_document_requirement,
    update_standard_discipline,
    update_standard_discipline_document_type,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_bootstrap_admin()
    load_enabled_plugins(_app)
    yield


app = FastAPI(title="Smart Design API", version="0.1.0", lifespan=lifespan)


def _allowed_origins() -> list[str]:
    return get_settings().allowed_origins


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(project_members_router)
app.include_router(agent_router)
app.include_router(plugin_router)

def _visible_standard_ids_for_user(current_user: AuthenticatedUser) -> list[str]:
    standard_ids = set(current_user.standard_permissions.keys())
    standard_ids.update(get_project_standard_ids(current_user.project_ids_with_permission("standard.read")))
    return sorted(standard_ids)


PROJECT_THUMBNAIL_ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}
PROJECT_THUMBNAIL_MAX_BYTES = 256 * 1024
LOGIN_BACKGROUND_ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}
LOGIN_BACKGROUND_MAX_BYTES = 450 * 1024
LOGIN_BACKGROUND_MIN_WIDTH = 640
LOGIN_BACKGROUND_MIN_HEIGHT = 360
LOGIN_BACKGROUND_MAX_WIDTH = 4096
LOGIN_BACKGROUND_MAX_HEIGHT = 2304
PROJECT_THUMBNAIL_DATA_URL_PATTERN = re.compile(
    r"^data:(?P<mime>image\/[a-z0-9.+-]+);base64,(?P<data>[A-Za-z0-9+/=\s]+)$",
    re.IGNORECASE,
)


def _normalize_inline_image_data_url(value: str | None, *, field_label: str) -> str | None:
    if value is None:
        return None

    stripped = value.strip()
    if not stripped:
        return None

    matched = PROJECT_THUMBNAIL_DATA_URL_PATTERN.fullmatch(stripped)
    if matched is None:
        raise ValueError(f"{field_label} must be a base64-encoded image data URL")

    mime = matched.group("mime").lower()
    if mime not in PROJECT_THUMBNAIL_ALLOWED_MIME_TYPES:
        raise ValueError(f"{field_label} must be a JPEG, PNG, or WebP image")

    encoded_data = re.sub(r"\s+", "", matched.group("data"))
    try:
        decoded = base64.b64decode(encoded_data, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError(f"{field_label} image data is invalid") from error

    if len(decoded) > PROJECT_THUMBNAIL_MAX_BYTES:
        raise ValueError(f"{field_label} image must be 256 KB or smaller")

    return f"data:{mime};base64,{encoded_data}"


def _normalize_project_thumbnail_url(value: str | None) -> str | None:
    return _normalize_inline_image_data_url(value, field_label="Thumbnail")


def _detect_image_mime_type(content: bytes) -> str | None:
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def _validate_login_background_upload(
    *,
    filename: str | None,
    declared_content_type: str | None,
    content: bytes,
    width: int,
    height: int,
) -> str:
    if not filename or not filename.strip():
        raise HTTPException(status_code=400, detail="Uploaded file must have a filename")
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Login background image cannot be empty")
    if len(content) > LOGIN_BACKGROUND_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Login background image must be 450 KB or smaller")
    if width < LOGIN_BACKGROUND_MIN_WIDTH or height < LOGIN_BACKGROUND_MIN_HEIGHT:
        raise HTTPException(status_code=400, detail="Login background image is too small")
    if width > LOGIN_BACKGROUND_MAX_WIDTH or height > LOGIN_BACKGROUND_MAX_HEIGHT:
        raise HTTPException(status_code=400, detail="Login background image dimensions are too large")

    detected_content_type = _detect_image_mime_type(content)
    if detected_content_type not in LOGIN_BACKGROUND_ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Login background must be a JPEG, PNG, or WebP image")

    normalized_declared = (declared_content_type or "").split(";", 1)[0].strip().lower()
    if normalized_declared and normalized_declared not in {"application/octet-stream", detected_content_type}:
        raise HTTPException(status_code=400, detail="Login background content type does not match the image data")

    return detected_content_type


class StandardIconUpdate(BaseModel):
    icon_data_url: str = Field(min_length=1)


class StandardCreate(BaseModel):
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    version_label: str | None = None
    thumbnail_url: str | None = None
    status: Literal["draft", "active", "archived"] = "active"


class ProjectCreate(BaseModel):
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    overview: str | None = None
    reference_attributes: dict = Field(default_factory=dict)
    thumbnail_url: str | None = None
    status: Literal["draft", "active", "archived"] = "active"

    @field_validator("code", "name")
    @classmethod
    def strip_required_project_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("overview")
    @classmethod
    def normalize_project_overview(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("thumbnail_url")
    @classmethod
    def normalize_project_thumbnail(cls, value: str | None) -> str | None:
        return _normalize_project_thumbnail_url(value)


class ProjectUpdate(ProjectCreate):
    pass


class DocumentTypeCreate(BaseModel):
    standard_id: str = Field(min_length=1)
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    parent_id: str | None = None
    description: str | None = None
    status: Literal["active", "archived"] = "active"
    allowed_extensions: list[str] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)

    @field_validator("code", "name")
    @classmethod
    def strip_document_type_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("allowed_extensions")
    @classmethod
    def normalize_allowed_extensions(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            extension = item.strip().lower().lstrip(".")
            if extension and extension not in seen:
                normalized.append(extension)
                seen.add(extension)
        return normalized


class DocumentTypeUpdate(DocumentTypeCreate):
    pass


class DocumentTypeAttributePayload(BaseModel):
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    group_name: str | None = None
    value_type: Literal["string", "number", "integer", "boolean", "date", "enum", "json"]
    is_required: bool = False
    unit_family: str | None = None
    enum_options: list[str] = Field(default_factory=list)
    description: str | None = None
    status: Literal["active", "archived"] = "active"

    @field_validator("code", "name")
    @classmethod
    def strip_document_attribute_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("enum_options")
    @classmethod
    def normalize_document_attribute_options(cls, value: list[str]) -> list[str]:
        return [item.strip() for item in value if item.strip()]

    @field_validator("group_name", "unit_family", "description")
    @classmethod
    def normalize_optional_document_attribute_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class CommonDocumentTypeAttributePayload(DocumentTypeAttributePayload):
    standard_id: str = Field(min_length=1)


class ProjectDocumentCreate(BaseModel):
    document_no: str = Field(min_length=1)
    title: str = Field(min_length=1)
    document_type_id: str | None = None
    discipline: str | None = None
    attributes: dict = Field(default_factory=dict)
    pbs_node_ids: list[str] = Field(default_factory=list)
    tag_ids: list[str] = Field(default_factory=list)
    status: Literal["active", "archived"] = "active"
    metadata: dict = Field(default_factory=dict)

    @field_validator("document_no", "title")
    @classmethod
    def strip_project_document_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("discipline")
    @classmethod
    def normalize_discipline(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class ProjectDocumentUpdate(ProjectDocumentCreate):
    pass


class ProjectDocumentRevisionCreate(BaseModel):
    revision_no: str = Field(min_length=1)
    state: Literal["draft", "issued", "void"] = "draft"
    issued_at: datetime | None = None
    change_summary: str | None = None
    set_as_current: bool = False

    @field_validator("revision_no")
    @classmethod
    def strip_revision_no(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("change_summary")
    @classmethod
    def normalize_change_summary(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class ProjectDocumentRevisionUpdate(ProjectDocumentRevisionCreate):
    pass


class ProjectDocumentFileInitiate(BaseModel):
    filename: str = Field(min_length=1)
    file_role: Literal["primary", "source", "attachment", "reference"]
    relative_path: str | None = None
    content_type: str | None = None
    size_bytes: int = Field(ge=0)
    checksum_sha256: str | None = None

    @field_validator("filename")
    @classmethod
    def strip_filename(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("relative_path", "content_type", "checksum_sha256")
    @classmethod
    def normalize_optional_file_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class ProjectDocumentFileComplete(BaseModel):
    etag: str | None = None


class DocumentVisualizationCreate(BaseModel):
    source_file_id: str = Field(min_length=1)
    preview_file_id: str = Field(min_length=1)
    annotation_manifest_file_id: str | None = None
    metadata: dict = Field(default_factory=dict)

    @field_validator("source_file_id", "preview_file_id")
    @classmethod
    def strip_visualization_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("annotation_manifest_file_id")
    @classmethod
    def normalize_visualization_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class DocumentVisualizationPrimitive(BaseModel):
    type: Literal["box", "sphere", "capsule", "cylinder"]
    center: list[float] = Field(min_length=3, max_length=3)
    size: list[float] | None = Field(default=None, min_length=3, max_length=3)
    radius: float | None = Field(default=None, gt=0)
    height: float | None = Field(default=None, gt=0)
    quaternion: list[float] | None = Field(default=None, min_length=4, max_length=4)

    @model_validator(mode="after")
    def validate_shape_requirements(self):
        if self.type == "box":
            if self.size is None or any(value <= 0 for value in self.size):
                raise ValueError("Box primitive requires positive size")
        elif self.type == "sphere":
            if self.radius is None:
                raise ValueError("Sphere primitive requires radius")
        elif self.type in {"capsule", "cylinder"}:
            if self.radius is None or self.height is None:
                raise ValueError("Capsule and cylinder primitives require radius and height")
        return self


class DocumentVisualizationObjectCreate(BaseModel):
    target_kind: Literal["tag", "equipment", "document", "pbs_node", "custom"]
    target_id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    resolver_type: Literal["mesh", "primitive", "bbox", "anchor"] = "anchor"
    coordinate_space: Literal["splat_local", "world"] = "splat_local"
    anchor_position: list[float] | None = Field(default=None, min_length=3, max_length=3)
    primitive: DocumentVisualizationPrimitive | None = None
    geometry_asset_id: str | None = None
    priority: int = 0
    visible: bool = True
    selectable: bool = True
    highlightable: bool = True
    metadata: dict = Field(default_factory=dict)

    @field_validator("target_id", "label")
    @classmethod
    def strip_visualization_object_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("geometry_asset_id")
    @classmethod
    def normalize_visualization_object_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def validate_resolver_payload(self):
        if self.resolver_type == "anchor" and self.anchor_position is None:
            raise ValueError("Anchor resolver requires anchor_position")
        if self.resolver_type in {"primitive", "bbox"} and self.primitive is None:
            raise ValueError("Primitive and bbox resolvers require primitive")
        return self


class DocumentVisualizationObjectUpdate(BaseModel):
    target_kind: Literal["tag", "equipment", "document", "pbs_node", "custom"] | None = None
    target_id: str | None = Field(default=None, min_length=1)
    label: str | None = Field(default=None, min_length=1)
    resolver_type: Literal["mesh", "primitive", "bbox", "anchor"] | None = None
    coordinate_space: Literal["splat_local", "world"] | None = None
    anchor_position: list[float] | None = Field(default=None, min_length=3, max_length=3)
    primitive: DocumentVisualizationPrimitive | None = None
    geometry_asset_id: str | None = None
    priority: int | None = None
    visible: bool | None = None
    selectable: bool | None = None
    highlightable: bool | None = None
    metadata: dict | None = None

    @field_validator("target_id", "label")
    @classmethod
    def strip_visualization_object_update_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("geometry_asset_id")
    @classmethod
    def normalize_visualization_object_update_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class DocumentImportAnalyzeItem(BaseModel):
    client_id: str = Field(min_length=1)
    filename: str = Field(min_length=1)
    relative_path: str | None = None
    size_bytes: int = Field(default=0, ge=0)
    content_type: str | None = None

    @field_validator("client_id", "filename")
    @classmethod
    def strip_document_import_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("relative_path", "content_type")
    @classmethod
    def normalize_document_import_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class DocumentImportAnalyzeRequest(BaseModel):
    files: list[DocumentImportAnalyzeItem] = Field(default_factory=list)
    use_llm: bool = True


EntityKind = Literal["document", "tag", "pbs_node"]
RelationDirection = Literal["outbound", "inbound", "both"]


class ProjectRelationCreate(BaseModel):
    relation_type_code: str = Field(min_length=1)
    source_kind: EntityKind
    source_id: str = Field(min_length=1)
    target_kind: EntityKind
    target_id: str = Field(min_length=1)
    sort_order: int = 0
    note: str | None = None
    source_system: str | None = None
    metadata: dict = Field(default_factory=dict)

    @field_validator("relation_type_code", "source_id", "target_id")
    @classmethod
    def strip_relation_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("note", "source_system")
    @classmethod
    def normalize_relation_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class PbsNodeCreate(BaseModel):
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    parent_id: str | None = None
    description: str | None = None
    node_type: str = "folder"
    level_template_id: str | None = None
    status: Literal["active", "archived"] = "active"


class PbsNodeUpdate(BaseModel):
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    parent_id: str | None = None
    description: str | None = None
    node_type: str = "folder"
    level_template_id: str | None = None
    status: Literal["active", "archived"] = "active"


class ProjectTagCreate(BaseModel):
    tag_no: str = Field(min_length=1)
    name: str = Field(min_length=1)
    pbs_node_id: str | None = None
    class_id: str | None = None
    parent_tag_id: str | None = None
    attribute_values: dict = Field(default_factory=dict)
    status: Literal["active", "archived"] = "active"


class ProjectTagUpdate(ProjectTagCreate):
    pass


class ProjectEquipmentCreate(BaseModel):
    equipment_no: str = Field(min_length=1)
    name: str = Field(min_length=1)
    class_id: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    serial_no: str | None = None
    purchase_order_no: str | None = None
    asset_status: Literal["planned", "ordered", "in_service", "spare", "removed", "scrapped", "archived"] = "planned"
    attribute_values: dict = Field(default_factory=dict)
    metadata: dict = Field(default_factory=dict)

    @field_validator("equipment_no", "name")
    @classmethod
    def strip_equipment_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("class_id", "manufacturer", "model", "serial_no", "purchase_order_no")
    @classmethod
    def normalize_equipment_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class TagEquipmentAssignmentCreate(BaseModel):
    equipment_id: str = Field(min_length=1)
    installed_from: date
    installed_to: date | None = None
    is_current: bool = True
    status: Literal["active", "archived"] = "active"
    notes: str | None = None

    @field_validator("equipment_id")
    @classmethod
    def strip_assignment_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("notes")
    @classmethod
    def normalize_assignment_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def validate_assignment_dates(self):
        if self.installed_to is not None and self.installed_to < self.installed_from:
            raise ValueError("installed_to cannot be earlier than installed_from")
        return self


class ProjectTagAttributeFilter(BaseModel):
    code: str = Field(min_length=1)
    operator: str = Field(default="equals", min_length=1)
    value: Any

    @field_validator("code", "operator")
    @classmethod
    def strip_tag_search_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped


class ProjectTagSearchRequest(BaseModel):
    mode: Literal["browse", "structured", "ai"] = "browse"
    pbs_node_id: str | None = None
    include_descendants: bool = True
    include_children: bool | None = None
    keyword: str | None = None
    class_id: str | None = None
    status: Literal["active", "archived"] | None = None
    attribute_filters: list[ProjectTagAttributeFilter] = Field(default_factory=list)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)

    @field_validator("pbs_node_id", "keyword", "class_id")
    @classmethod
    def normalize_optional_tag_search_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class TagImportRowPatch(BaseModel):
    values: dict = Field(default_factory=dict)
    conflict_action: Literal["update", "skip"] | None = None


class TagImportConflictAction(BaseModel):
    row_id: str = Field(min_length=1)
    action: Literal["update", "skip"]


class TagImportCommitRequest(BaseModel):
    conflict_actions: list[TagImportConflictAction] = Field(default_factory=list)


class StandardImportPatch(BaseModel):
    conflict_action: Literal["create_copy", "merge_update", "skip"]
    code_override: str | None = None

    @field_validator("code_override")
    @classmethod
    def strip_code_override(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class StandardImportItemPatch(BaseModel):
    values: dict = Field(default_factory=dict)
    action: Literal["create", "update", "skip"] | None = None


class StandardRuleTextModel(BaseModel):
    @field_validator("*", mode="before")
    @classmethod
    def strip_rule_text(cls, value):
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value


class DisciplinePayload(StandardRuleTextModel):
    cfihos_unique_code: str | None = None
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str | None = None
    status: Literal["active", "deprecated", "archived"] = "active"
    metadata: dict = Field(default_factory=dict)


class DisciplineDocumentTypePayload(StandardRuleTextModel):
    discipline_id: str = Field(min_length=1)
    document_type_id: str = Field(min_length=1)
    cfihos_unique_code: str | None = None
    short_code: str | None = None
    asset_scope: str | None = None
    representation_type: str | None = None
    native_file_delivery_timing: str | None = None
    perspective: str = "standard"
    lifecycle_phase: str = "unspecified"
    status: Literal["active", "deprecated", "archived"] = "active"
    metadata: dict = Field(default_factory=dict)


class ClassDocumentRequirementPayload(StandardRuleTextModel):
    class_id: str = Field(min_length=1)
    document_type_id: str = Field(min_length=1)
    cfihos_unique_code: str | None = None
    asset_scope: str | None = None
    source_standard_cfihos_code: str | None = None
    source_standard_code: str | None = None
    perspective: str = "standard"
    lifecycle_phase: str = "unspecified"
    status: Literal["active", "deprecated", "archived"] = "active"
    metadata: dict = Field(default_factory=dict)


class PbsLevelCreate(BaseModel):
    level_no: int = Field(ge=1)
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str | None = None


class PbsLevelUpdate(BaseModel):
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str | None = None


class ClassParentUpdate(BaseModel):
    parent_id: str | None = None


ClassDefinitionDomain = Literal["tag", "equipment"]


class ClassBase(BaseModel):
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    parent_id: str | None = None
    description: str | None = None
    status: Literal["draft", "active", "deprecated", "archived"] = "active"

    @field_validator("code", "name")
    @classmethod
    def strip_required_class_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("description")
    @classmethod
    def normalize_optional_class_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class ClassCreate(ClassBase):
    applies_to: ClassDefinitionDomain = "tag"


class ClassUpdate(ClassBase):
    pass


class AttributeUpdate(BaseModel):
    group_name: str | None = None
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    value_type: Literal["string", "number", "integer", "boolean", "date", "enum", "json"]
    is_required: bool
    unit_family: str | None = None
    enum_options: list[str] = Field(default_factory=list)
    description: str | None = None

    @field_validator("code", "name")
    @classmethod
    def strip_required_attribute_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped


class AttributeCreate(AttributeUpdate):
    applies_to: ClassDefinitionDomain = "tag"


class AttributeOrderUpdate(BaseModel):
    attribute_ids: list[str] = Field(min_length=1)


class CommonDocumentAttributeOrderUpdate(BaseModel):
    standard_id: str = Field(min_length=1)
    attribute_ids: list[str] = Field(min_length=1)


class AiEndpointSettingsUpdate(BaseModel):
    provider: str = Field(default="openai-compatible", min_length=1, max_length=64)
    base_url: str = Field(min_length=1, max_length=2048)
    endpoint_path: str = Field(default="/v1/chat/completions", min_length=1, max_length=512)
    model: str = Field(min_length=1, max_length=256)
    api_key: str | None = Field(default=None, max_length=4096)
    clear_api_key: bool = False
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=200000)
    timeout_seconds: int = Field(default=60, ge=1, le=600)
    is_enabled: bool = True

    @field_validator("provider", "base_url", "endpoint_path", "model")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        if not (value.startswith("http://") or value.startswith("https://")):
            raise ValueError("Base URL must start with http:// or https://")
        return value.rstrip("/")

    @field_validator("endpoint_path")
    @classmethod
    def validate_endpoint_path(cls, value: str) -> str:
        if not value.startswith("/"):
            raise ValueError("Endpoint path must start with /")
        return value

    @field_validator("api_key")
    @classmethod
    def normalize_api_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class BrandingSettingsUpdate(BaseModel):
    system_name: str = Field(min_length=1, max_length=128)
    sidebar_title: str = Field(min_length=1, max_length=128)
    logo_data_url: str | None = Field(default=None)

    @field_validator("system_name", "sidebar_title")
    @classmethod
    def strip_branding_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("logo_data_url")
    @classmethod
    def normalize_branding_logo(cls, value: str | None) -> str | None:
        return _normalize_inline_image_data_url(value, field_label="Brand icon")

class AiEndpointProbe(BaseModel):
    provider: str = Field(default="openai-compatible", min_length=1, max_length=64)
    base_url: str = Field(min_length=1, max_length=2048)
    endpoint_path: str = Field(default="/v1/chat/completions", min_length=1, max_length=512)
    model: str | None = Field(default=None, max_length=256)
    api_key: str | None = Field(default=None, max_length=4096)
    clear_api_key: bool = False
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=200000)
    timeout_seconds: int = Field(default=60, ge=1, le=600)
    is_enabled: bool = True

    @field_validator("provider", "base_url", "endpoint_path")
    @classmethod
    def strip_probe_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("model")
    @classmethod
    def normalize_probe_model(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("base_url")
    @classmethod
    def validate_probe_base_url(cls, value: str) -> str:
        if not (value.startswith("http://") or value.startswith("https://")):
            raise ValueError("Base URL must start with http:// or https://")
        return value.rstrip("/")

    @field_validator("endpoint_path")
    @classmethod
    def validate_probe_endpoint_path(cls, value: str) -> str:
        if not value.startswith("/"):
            raise ValueError("Endpoint path must start with /")
        return value

    @field_validator("api_key")
    @classmethod
    def normalize_probe_api_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


@app.get("/health")
def health() -> dict:
    fetch_one("SELECT 1 AS ok")
    return {"status": "ok"}


@app.get("/health/storage")
def storage_health() -> dict:
    storage = get_document_storage()
    return {
        "status": "ok",
        "storage": {
            **describe_document_storage(),
            **storage.check_bucket_access(),
        },
    }


@app.get("/api/standards")
def standards_list(current_user: AuthenticatedUser = Depends(require_any_standard_permission("standard.read"))) -> dict:
    if current_user.has_permission("standard.read"):
        return {"data": get_standards()}
    return {"data": get_standards_by_ids(_visible_standard_ids_for_user(current_user))}


@app.get("/api/projects")
def projects_list(current_user: AuthenticatedUser = Depends(require_authenticated_user)) -> dict:
    if current_user.has_permission("project.read"):
        return {"data": get_projects()}
    return {"data": get_projects_by_ids(current_user.visible_project_ids())}


@app.post("/api/projects")
def create_new_project(
    payload: ProjectCreate,
    current_user: AuthenticatedUser = Depends(require_permission("project.create")),
) -> dict:
    try:
        result = create_project(payload.model_dump())
        if result is not None:
            assign_project_role(str(result["id"]), current_user.id, "project_owner", granted_by=current_user.id)
        return {"data": result}
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Project code already exists") from error


@app.get("/api/projects/{project_id}")
def project_detail(
    project_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.read")),
) -> dict:
    detail = get_project_detail(project_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"data": detail}


@app.get("/api/document-types")
def document_types_list(
    standard_id: str | None = Query(default=None),
    current_user: AuthenticatedUser = Depends(require_any_standard_permission("standard.read")),
) -> dict:
    if standard_id:
        if not can_read_standard(current_user, standard_id):
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return {"data": list_document_types(standard_id)}
    if not current_user.has_permission("standard.read"):
        document_types: list[dict] = []
        for visible_standard_id in _visible_standard_ids_for_user(current_user):
            document_types.extend(list_document_types(visible_standard_id))
        return {"data": document_types}
    return {"data": list_document_types()}


@app.get("/api/document-type-attributes/common")
def common_document_type_attributes_list(
    standard_id: str = Query(..., min_length=1),
    current_user: AuthenticatedUser = Depends(require_any_standard_permission("standard.read")),
) -> dict:
    if not can_read_standard(current_user, standard_id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return {"data": list_common_document_type_attributes(standard_id)}


@app.post("/api/document-types")
def create_new_document_type(
    payload: DocumentTypeCreate,
    current_user: AuthenticatedUser = Depends(require_any_standard_permission("standard.write")),
) -> dict:
    if not current_user.has_permission("standard.write", standard_id=payload.standard_id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    try:
        result = create_document_type(payload.model_dump())
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Document type code already exists") from error
    return {"data": result}


@app.get("/api/document-types/{document_type_id}", dependencies=[Depends(require_document_type_standard_permission("standard.read"))])
def document_type_detail(document_type_id: str) -> dict:
    detail = get_document_type_detail(document_type_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Document type not found")
    return {"data": detail}


@app.patch("/api/document-types/{document_type_id}", dependencies=[Depends(require_document_type_standard_permission("standard.write"))])
def update_existing_document_type(document_type_id: str, payload: DocumentTypeUpdate) -> dict:
    try:
        result = update_document_type(document_type_id, payload.model_dump())
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Document type code already exists") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Document type not found")
    return {"data": result}


@app.post("/api/document-types/{document_type_id}/attributes", dependencies=[Depends(require_document_type_standard_permission("standard.write"))])
def create_new_document_type_attribute(document_type_id: str, payload: DocumentTypeAttributePayload) -> dict:
    try:
        result = create_document_type_attribute(document_type_id, payload.model_dump())
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Document type attribute code already exists") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Document type not found")
    return {"data": result}


@app.post("/api/document-type-attributes/common")
def create_new_common_document_type_attribute(
    payload: CommonDocumentTypeAttributePayload,
    current_user: AuthenticatedUser = Depends(require_any_standard_permission("standard.write")),
) -> dict:
    if not current_user.has_permission("standard.write", standard_id=payload.standard_id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    try:
        result = create_document_type_attribute(None, payload.model_dump(exclude={"standard_id"}), standard_id=payload.standard_id)
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Common document attribute code already exists") from error
    return {"data": result}


@app.patch("/api/document-type-attributes/{attribute_id}", dependencies=[Depends(require_document_type_attribute_standard_permission("standard.write"))])
def update_existing_document_type_attribute(attribute_id: str, payload: DocumentTypeAttributePayload) -> dict:
    try:
        result = update_document_type_attribute(attribute_id, payload.model_dump())
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Document type attribute code already exists") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Document type attribute not found")
    return {"data": result}


@app.patch("/api/document-types/{document_type_id}/attributes/order", dependencies=[Depends(require_document_type_standard_permission("standard.write"))])
def update_document_type_attribute_order(document_type_id: str, payload: AttributeOrderUpdate) -> dict:
    try:
        result = reorder_document_type_attributes(document_type_id, payload.attribute_ids)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if result is None:
        raise HTTPException(status_code=404, detail="Document type not found")
    return {"data": result}


@app.patch("/api/document-type-attributes/common/order")
def update_common_document_type_attribute_order(
    payload: CommonDocumentAttributeOrderUpdate,
    current_user: AuthenticatedUser = Depends(require_any_standard_permission("standard.write")),
) -> dict:
    if not current_user.has_permission("standard.write", standard_id=payload.standard_id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    try:
        result = reorder_document_type_attributes(None, payload.attribute_ids, standard_id=payload.standard_id)
    except ValueError as error:
        message = str(error)
        status_code = 404 if message == "Standard not found" else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    return {"data": result}


@app.delete("/api/document-type-attributes/{attribute_id}", dependencies=[Depends(require_document_type_attribute_standard_permission("standard.write"))])
def delete_existing_document_type_attribute(attribute_id: str) -> dict:
    result = archive_document_type_attribute(attribute_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Document type attribute not found")
    return {"data": result}


@app.get("/api/projects/{project_id}/documents")
def project_documents_list(
    project_id: str,
    keyword: str | None = Query(default=None),
    document_type_id: str | None = Query(default=None),
    discipline: str | None = Query(default=None),
    pbs_node_id: str | None = Query(default=None),
    tag_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.read")),
) -> dict:
    return {
        "data": list_project_documents(
            project_id,
            {
                "keyword": keyword,
                "document_type_id": document_type_id,
                "discipline": discipline,
                "pbs_node_id": pbs_node_id,
                "tag_id": tag_id,
                "status": status,
                "page": page,
                "page_size": page_size,
            },
        )
    }


@app.get("/api/projects/{project_id}/data-quality/summary")
def project_data_quality_summary(
    project_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.read")),
) -> dict:
    try:
        return {"data": get_project_data_quality_summary(project_id)}
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/projects/{project_id}/data-quality/issues")
def project_data_quality_issues(
    project_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.read")),
) -> dict:
    try:
        return {"data": get_project_data_quality_issues(project_id)}
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/projects/{project_id}/data-quality/document-matrix")
def project_data_quality_document_matrix(
    project_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.read")),
) -> dict:
    try:
        return {"data": get_project_data_quality_document_matrix(project_id)}
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/projects/{project_id}/documents")
def create_new_project_document(
    project_id: str,
    payload: ProjectDocumentCreate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.write")),
) -> dict:
    try:
        result = create_project_document(project_id, payload.model_dump())
    except ValueError as error:
        message = str(error)
        status_code = 404 if message in {"Project not found", "Document type not found"} else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Document number already exists in this project") from error
    return {"data": result}


@app.get("/api/projects/{project_id}/documents/{document_id}")
def project_document_detail(
    project_id: str,
    document_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.read")),
) -> dict:
    detail = get_project_document_detail(project_id, document_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"data": detail}


@app.patch("/api/projects/{project_id}/documents/{document_id}")
def update_existing_project_document(
    project_id: str,
    document_id: str,
    payload: ProjectDocumentUpdate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.write")),
) -> dict:
    try:
        result = update_project_document(project_id, document_id, payload.model_dump())
    except ValueError as error:
        message = str(error)
        status_code = 404 if message == "Document type not found" else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Document number already exists in this project") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"data": result}


@app.delete("/api/projects/{project_id}/documents/{document_id}")
def delete_existing_project_document(
    project_id: str,
    document_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.write")),
) -> dict:
    result = delete_project_document(project_id, document_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"data": result}


@app.get("/api/projects/{project_id}/relations")
def project_relations_list(
    project_id: str,
    entity_kind: EntityKind | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    relation_type: str | None = Query(default=None),
    source_kind: EntityKind | None = Query(default=None),
    target_kind: EntityKind | None = Query(default=None),
    direction: RelationDirection = Query(default="both"),
    _auth: AuthenticatedUser = Depends(require_project_permission("project.relation.read")),
) -> dict:
    try:
        result = list_project_relations(
            project_id,
            {
                "entity_kind": entity_kind,
                "entity_id": entity_id,
                "relation_type": relation_type,
                "source_kind": source_kind,
                "target_kind": target_kind,
                "direction": direction,
            },
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"data": result}


@app.post("/api/projects/{project_id}/relations")
def create_new_project_relation(
    project_id: str,
    payload: ProjectRelationCreate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.relation.write")),
) -> dict:
    try:
        result = create_project_relation(project_id, payload.model_dump())
    except ValueError as error:
        message = str(error)
        status_code = 404 if message in {"Project not found", "Relation type not found"} else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Relation already exists") from error
    return {"data": result}


@app.delete("/api/projects/{project_id}/relations/{relation_id}")
def delete_existing_project_relation(
    project_id: str,
    relation_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.relation.write")),
) -> dict:
    if not delete_project_relation(project_id, relation_id):
        raise HTTPException(status_code=404, detail="Relation not found")
    return {"ok": True}


@app.get("/api/projects/{project_id}/documents/{document_id}/revisions")
def project_document_revisions(
    project_id: str,
    document_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.read")),
) -> dict:
    revisions = list_project_document_revisions(project_id, document_id)
    if revisions is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"data": revisions}


@app.post("/api/projects/{project_id}/document-imports/analyze")
def analyze_project_document_import(
    project_id: str,
    payload: DocumentImportAnalyzeRequest,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.write")),
) -> dict:
    try:
        return {"data": analyze_document_import_files(project_id, payload.model_dump())}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/projects/{project_id}/documents/{document_id}/revisions")
def create_new_project_document_revision(
    project_id: str,
    document_id: str,
    payload: ProjectDocumentRevisionCreate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.write")),
) -> dict:
    try:
        result = create_project_document_revision(project_id, document_id, payload.model_dump())
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Revision number already exists for this document") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"data": result}


@app.patch("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}")
def update_existing_project_document_revision(
    project_id: str,
    document_id: str,
    revision_id: str,
    payload: ProjectDocumentRevisionUpdate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.write")),
) -> dict:
    try:
        result = update_project_document_revision(project_id, document_id, revision_id, payload.model_dump())
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Revision number already exists for this document") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Revision not found")
    return {"data": result}


@app.delete("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}")
def delete_existing_project_document_revision(
    project_id: str,
    document_id: str,
    revision_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.write")),
) -> dict:
    result = delete_project_document_revision(project_id, document_id, revision_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Revision not found")
    return {"data": result}


@app.get("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/visualizations")
def project_document_visualizations(
    project_id: str,
    document_id: str,
    revision_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.read")),
) -> dict:
    return {"data": list_document_visualizations(project_id, document_id, revision_id)}


@app.post("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/visualizations")
def create_new_document_visualization(
    project_id: str,
    document_id: str,
    revision_id: str,
    payload: DocumentVisualizationCreate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.write")),
) -> dict:
    try:
        result = create_document_visualization(project_id, document_id, revision_id, payload.model_dump())
    except ValueError as error:
        message = str(error)
        status_code = 404 if message in {"Revision not found"} or "not found" in message else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Visualization already exists for this preview file") from error
    return {"data": result}


def _raise_document_visualization_object_error(error: ValueError) -> None:
    message = str(error)
    status_code = 404 if message in {"Visualization not found", "Target not found"} else 400
    raise HTTPException(status_code=status_code, detail=message) from error


@app.get("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/visualizations/{visualization_id}/objects")
def project_document_visualization_objects(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.read")),
) -> dict:
    try:
        result = list_document_visualization_objects(project_id, document_id, revision_id, visualization_id)
    except ValueError as error:
        _raise_document_visualization_object_error(error)
    return {"data": result}


@app.post("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/visualizations/{visualization_id}/objects")
def create_new_document_visualization_object(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    payload: DocumentVisualizationObjectCreate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.write")),
) -> dict:
    try:
        result = create_document_visualization_object(
            project_id,
            document_id,
            revision_id,
            visualization_id,
            payload.model_dump(mode="json"),
        )
    except ValueError as error:
        _raise_document_visualization_object_error(error)
    return {"data": result}


@app.patch("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/visualizations/{visualization_id}/objects/{object_id}")
def update_existing_document_visualization_object(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    object_id: str,
    payload: DocumentVisualizationObjectUpdate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.write")),
) -> dict:
    try:
        result = update_document_visualization_object(
            project_id,
            document_id,
            revision_id,
            visualization_id,
            object_id,
            payload.model_dump(mode="json", exclude_unset=True),
        )
    except ValueError as error:
        _raise_document_visualization_object_error(error)
    if result is None:
        raise HTTPException(status_code=404, detail="Visualization object not found")
    return {"data": result}


@app.delete("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/visualizations/{visualization_id}/objects/{object_id}")
def delete_existing_document_visualization_object(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    object_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.write")),
) -> dict:
    result = delete_document_visualization_object(project_id, document_id, revision_id, visualization_id, object_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Visualization object not found")
    return {"data": result}


@app.get("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/visualizations/{visualization_id}/access")
def get_project_document_visualization_access(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.read")),
) -> dict:
    try:
        result = get_document_visualization_access(project_id, document_id, revision_id, visualization_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    if result is None:
        raise HTTPException(status_code=404, detail="Visualization not found")
    return {"data": result}


@app.get("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/visualizations/{visualization_id}/spark/{filename}")
def get_project_document_visualization_spark_asset(
    request: Request,
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    filename: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.read")),
) -> Response:
    try:
        result = get_document_visualization_spark_asset(project_id, document_id, revision_id, visualization_id, filename)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    if result is None:
        raise HTTPException(status_code=404, detail="Spark asset not found")
    content = result["content"]
    encoded_filename = url_quote(str(result["filename"]), safe="")
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Disposition": f"inline; filename*=UTF-8''{encoded_filename}",
    }
    range_header = request.headers.get("range")
    if range_header:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
        if match is None:
            raise HTTPException(status_code=416, detail="Invalid range")
        start_text, end_text = match.groups()
        if not start_text and not end_text:
            raise HTTPException(status_code=416, detail="Invalid range")
        total_size = len(content)
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else total_size - 1
        else:
            suffix_length = int(end_text)
            if suffix_length <= 0:
                raise HTTPException(status_code=416, detail="Invalid range")
            start = max(total_size - suffix_length, 0)
            end = total_size - 1
        if start >= total_size or end < start:
            raise HTTPException(status_code=416, detail="Requested range is not satisfiable")
        end = min(end, total_size - 1)
        ranged_content = content[start : end + 1]
        return Response(
            content=ranged_content,
            media_type=result["mime_type"],
            status_code=206,
            headers={
                **headers,
                "Content-Range": f"bytes {start}-{end}/{total_size}",
                "Content-Length": str(len(ranged_content)),
            },
        )
    return Response(
        content=content,
        media_type=result["mime_type"],
        headers=headers,
    )


@app.get("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/conversion-jobs")
def project_document_conversion_jobs(
    project_id: str,
    document_id: str,
    revision_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.read")),
) -> dict:
    return {"data": list_conversion_jobs_for_revision(project_id, document_id, revision_id)}


@app.post("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/files/{file_id}/conversion-jobs")
def create_project_document_conversion_job(
    project_id: str,
    document_id: str,
    revision_id: str,
    file_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.upload")),
) -> dict:
    try:
        result = create_conversion_job_for_file(project_id, document_id, revision_id, file_id)
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    return {"data": result}


@app.post("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/conversion-jobs/{job_id}/retry")
def retry_project_document_conversion_job(
    project_id: str,
    document_id: str,
    revision_id: str,
    job_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.upload")),
) -> dict:
    try:
        result = retry_conversion_job_for_revision(project_id, document_id, revision_id, job_id)
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    return {"data": result}


@app.get("/api/projects/{project_id}/tag-import-template")
def download_tag_import_template(
    project_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.import")),
) -> Response:
    project = get_project_detail(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    standard_id = project.get("reference_attributes", {}).get("standard_id")
    if not isinstance(standard_id, str) or not standard_id:
        raise HTTPException(status_code=400, detail="Project is not linked to a standard")

    standard_detail = get_standard_detail(standard_id, include_attributes=True)
    if standard_detail is None:
        raise HTTPException(status_code=404, detail="Standard not found")

    content = build_tag_import_template(project, standard_detail, get_pbs_nodes(project_id))
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{project["code"]}-tag-import-template.xlsx"'
        },
    )


@app.post("/api/projects/{project_id}/tag-imports/validate")
async def validate_tag_import(
    project_id: str,
    file: UploadFile = File(...),
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.import")),
) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Uploaded file must have a filename")

    try:
        payload = create_tag_import_job_from_upload(project_id, file.filename, await file.read())
    except ValueError as error:
        message = str(error)
        if message == "Project not found":
            raise HTTPException(status_code=404, detail=message) from error
        if message == "Standard not found":
            raise HTTPException(status_code=404, detail=message) from error
        raise HTTPException(status_code=400, detail=message) from error

    return {"data": payload}


@app.post("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/files/initiate")
def initiate_project_document_upload(
    project_id: str,
    document_id: str,
    revision_id: str,
    payload: ProjectDocumentFileInitiate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.upload")),
) -> dict:
    try:
        result = initiate_document_file_upload(project_id, document_id, revision_id, payload.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Primary file already exists for this revision") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Revision not found")
    return {"data": result}


@app.post("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/files/{file_id}/complete")
def complete_project_document_upload(
    project_id: str,
    document_id: str,
    revision_id: str,
    file_id: str,
    payload: ProjectDocumentFileComplete,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.upload")),
) -> dict:
    try:
        result = complete_document_file_upload(
            project_id,
            document_id,
            revision_id,
            file_id,
            payload.model_dump(exclude_none=True),
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Primary file already exists for this revision") from error
    if result is None:
        raise HTTPException(status_code=404, detail="File not found")
    return {"data": result}


@app.get("/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}/files/{file_id}/access-url")
def get_project_document_file_access(
    project_id: str,
    document_id: str,
    revision_id: str,
    file_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.document.read")),
) -> dict:
    try:
        result = get_document_file_access(project_id, document_id, revision_id, file_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    if result is None:
        raise HTTPException(status_code=404, detail="File not found")
    return {"data": result}


@app.get("/api/projects/{project_id}/tag-imports/{job_id}")
def get_tag_import_job(
    project_id: str,
    job_id: str,
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.import")),
) -> dict:
    try:
        payload = get_tag_import_job_detail(project_id, job_id, status=status, page=page, page_size=page_size)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"data": payload}


@app.patch("/api/projects/{project_id}/tag-imports/{job_id}/rows/{row_id}")
def update_tag_import_row(
    project_id: str,
    job_id: str,
    row_id: str,
    payload: TagImportRowPatch,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.import")),
) -> dict:
    try:
        result = patch_tag_import_row(project_id, job_id, row_id, payload.model_dump(exclude_none=True))
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    return {"data": result}


@app.post("/api/projects/{project_id}/tag-imports/{job_id}/commit")
def commit_project_tag_import(
    project_id: str,
    job_id: str,
    payload: TagImportCommitRequest,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.import")),
) -> dict:
    try:
        result = commit_tag_import_job(
            project_id,
            job_id,
            [action.model_dump() for action in payload.conflict_actions],
        )
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Tag import commit failed due to a duplicate tag number") from error
    return {"data": result}


@app.patch("/api/projects/{project_id}")
def update_existing_project(
    project_id: str,
    payload: ProjectUpdate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.update")),
) -> dict:
    try:
        result = update_project(project_id, payload.model_dump())
        if result is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"data": result}
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Project code already exists") from error


@app.delete("/api/projects/{project_id}")
def delete_existing_project(
    project_id: str,
    current_user: AuthenticatedUser = Depends(require_authenticated_user),
) -> dict:
    if not (
        current_user.has_permission("project.delete", project_id=project_id)
        or current_user.has_permission("project.update", project_id=project_id)
    ):
        raise HTTPException(status_code=403, detail="Forbidden")
    if delete_project(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"ok": True}


@app.get("/api/projects/{project_id}/tags")
def project_tags_list(
    project_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.read")),
) -> dict:
    return {"data": get_project_tags(project_id)}


@app.get("/api/projects/{project_id}/equipment-classes")
def project_equipment_classes_list(
    project_id: str,
    tag_id: str | None = Query(default=None),
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.read")),
) -> dict:
    try:
        return {"data": list_project_equipment_classes(project_id, tag_id)}
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error


@app.get("/api/projects/{project_id}/equipment")
def project_equipment_list(
    project_id: str,
    keyword: str | None = Query(default=None),
    class_id: str | None = Query(default=None),
    asset_status: Literal["planned", "ordered", "in_service", "spare", "removed", "scrapped", "archived"] | None = Query(default=None),
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.read")),
) -> dict:
    return {
        "data": list_project_equipment(
            project_id,
            {
                "keyword": keyword,
                "class_id": class_id,
                "asset_status": asset_status,
            },
        )
    }


@app.post("/api/projects/{project_id}/equipment")
def create_new_project_equipment(
    project_id: str,
    payload: ProjectEquipmentCreate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.write")),
) -> dict:
    try:
        return {"data": create_project_equipment(project_id, payload.model_dump())}
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Equipment number already exists in this project") from error


@app.post("/api/projects/{project_id}/tags/search")
def project_tags_search(
    project_id: str,
    payload: ProjectTagSearchRequest,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.read")),
) -> dict:
    try:
        return {"data": search_project_tags(project_id, payload.model_dump(exclude_none=True))}
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/projects/{project_id}/tags/{tag_id}")
def project_tag_detail(
    project_id: str,
    tag_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.read")),
) -> dict:
    result = get_project_tag_detail(project_id, tag_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Tag not found")
    return {"data": result}


@app.get("/api/projects/{project_id}/tags/{tag_id}/equipment-implementation")
def project_tag_equipment_implementation(
    project_id: str,
    tag_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.read")),
) -> dict:
    try:
        result = get_tag_equipment_implementation(project_id, tag_id)
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    if result is None:
        raise HTTPException(status_code=404, detail="Tag not found")
    return {"data": result}


@app.post("/api/projects/{project_id}/tags/{tag_id}/equipment-assignments")
def create_new_tag_equipment_assignment(
    project_id: str,
    tag_id: str,
    payload: TagEquipmentAssignmentCreate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.write")),
) -> dict:
    try:
        return {"data": assign_equipment_to_tag(project_id, tag_id, payload.model_dump(mode="json"))}
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Equipment assignment conflicts with an existing current assignment") from error


@app.post("/api/projects/{project_id}/tags")
def create_new_project_tag(
    project_id: str,
    payload: ProjectTagCreate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.tag.write")),
) -> dict:
    try:
        result = create_project_tag(project_id, payload.model_dump())
        return {"data": result}
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Tag number already exists in this project") from error


@app.get("/api/projects/{project_id}/pbs-nodes")
def pbs_nodes_list(
    project_id: str,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.pbs.read")),
) -> dict:
    return {"data": get_pbs_nodes(project_id)}


@app.post("/api/projects/{project_id}/pbs-nodes")
def create_new_pbs_node(
    project_id: str,
    payload: PbsNodeCreate,
    _auth: AuthenticatedUser = Depends(require_project_permission("project.pbs.write")),
) -> dict:
    try:
        result = create_pbs_node(project_id, payload.model_dump())
        return {"data": result}
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="PBS Node code already exists in this project") from error


@app.patch("/api/pbs-nodes/{node_id}")
def update_existing_pbs_node(
    node_id: str,
    payload: PbsNodeUpdate,
    _auth: AuthenticatedUser = Depends(require_pbs_node_permission("project.pbs.write")),
) -> dict:
    # Validate hierarchy constraint on drag/reparent
    if payload.parent_id is not None:
        parent = get_pbs_node_by_id(payload.parent_id)
        if parent and parent.get("level_no") is not None:
            node = get_pbs_node_by_id(node_id)
            if node and node.get("level_no") is not None:
                if node["level_no"] != parent["level_no"] + 1:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Cannot move level {node['level_no']} node under level {parent['level_no']} parent"
                    )
    try:
        result = update_pbs_node(node_id, payload.model_dump())
        if result is None:
            raise HTTPException(status_code=404, detail="PBS Node not found")
        return {"data": result}
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="PBS Node code already exists") from error


# ── PBS Level Template Endpoints ──

@app.get("/api/standards/{standard_id}/pbs-levels", dependencies=[Depends(require_standard_permission("standard.read"))])
def pbs_levels_list(standard_id: str) -> dict:
    return {"data": get_pbs_level_templates(standard_id)}


@app.post("/api/standards/{standard_id}/pbs-levels", dependencies=[Depends(require_standard_permission("standard.write"))])
def create_new_pbs_level(standard_id: str, payload: PbsLevelCreate) -> dict:
    try:
        result = create_pbs_level(standard_id, payload.model_dump())
        return {"data": result}
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Level number or code already exists in this standard") from error


@app.patch("/api/pbs-levels/{level_id}", dependencies=[Depends(require_pbs_level_standard_permission("standard.write"))])
def update_existing_pbs_level(level_id: str, payload: PbsLevelUpdate) -> dict:
    try:
        result = update_pbs_level(level_id, payload.model_dump())
        if result is None:
            raise HTTPException(status_code=404, detail="PBS Level not found")
        return {"data": result}
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Level code already exists") from error


@app.delete("/api/pbs-levels/{level_id}", dependencies=[Depends(require_pbs_level_standard_permission("standard.write"))])
def delete_existing_pbs_level(level_id: str) -> dict:
    if not delete_pbs_level(level_id):
        raise HTTPException(status_code=404, detail="PBS Level not found")
    return {"ok": True}


@app.patch("/api/tags/{tag_id}")
def update_existing_project_tag(
    tag_id: str,
    payload: ProjectTagUpdate,
    _auth: AuthenticatedUser = Depends(require_tag_permission("project.tag.write")),
) -> dict:
    try:
        result = update_project_tag(tag_id, payload.model_dump())
        if result is None:
            raise HTTPException(status_code=404, detail="Tag not found")
        return {"data": result}
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Tag number already exists in this project") from error


@app.delete("/api/tags/{tag_id}")
def delete_existing_project_tag(
    tag_id: str,
    _auth: AuthenticatedUser = Depends(require_tag_permission("project.tag.write")),
) -> dict:
    if not delete_project_tag(tag_id):
        raise HTTPException(status_code=404, detail="Tag not found")
    return {"ok": True}


@app.get("/api/settings/ai")
def get_ai_endpoint_settings(
    _auth: AuthenticatedUser = Depends(require_permission("system.settings.ai.read")),
) -> dict:
    return {"data": get_ai_settings()}


@app.patch("/api/settings/ai")
def update_ai_endpoint_settings(
    payload: AiEndpointSettingsUpdate,
    _auth: AuthenticatedUser = Depends(require_permission("system.settings.ai.write")),
) -> dict:
    return {"data": upsert_ai_settings(payload.model_dump())}


@app.post("/api/settings/ai/models")
def discover_ai_models(
    payload: AiEndpointProbe,
    _auth: AuthenticatedUser = Depends(require_permission("system.settings.ai.write")),
) -> dict:
    try:
        settings = resolve_ai_runtime_settings(payload.model_dump())
        return {"data": list_available_ai_models(settings)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/api/settings/ai/test")
def test_ai_endpoint(
    payload: AiEndpointProbe,
    _auth: AuthenticatedUser = Depends(require_permission("system.settings.ai.write")),
) -> dict:
    try:
        settings = resolve_ai_runtime_settings(payload.model_dump())
        return {"data": test_ai_endpoint_connection(settings)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/settings/branding/public")
def get_public_branding() -> dict:
    return {"data": get_branding_settings()}


@app.get("/api/settings/branding")
def get_system_branding_settings(
    _auth: AuthenticatedUser = Depends(require_permission("system.settings.branding.read")),
) -> dict:
    return {"data": get_branding_settings()}


@app.patch("/api/settings/branding")
def update_system_branding_settings(
    payload: BrandingSettingsUpdate,
    _auth: AuthenticatedUser = Depends(require_permission("system.settings.branding.write")),
) -> dict:
    return {"data": upsert_branding_settings(payload.model_dump())}


@app.get("/api/settings/branding/login-background")
def get_public_branding_login_background() -> Response:
    image = get_branding_login_background_storage_object()
    if image is None:
        raise HTTPException(status_code=404, detail="Login background image is not configured")

    try:
        content = get_document_storage().get_object_bytes(object_key=image["object_key"])
    except Exception as error:
        raise HTTPException(status_code=404, detail="Login background image is unavailable") from error

    return Response(
        content=content,
        media_type=image["mime_type"],
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Disposition": f'inline; filename="{_safe_download_name(image["file_name"], "login-background.webp")}"',
        },
    )


@app.put("/api/settings/branding/login-background")
async def update_system_branding_login_background(
    file: UploadFile = File(...),
    source_file_name: str | None = Form(default=None),
    width: int = Form(...),
    height: int = Form(...),
    _auth: AuthenticatedUser = Depends(require_permission("system.settings.branding.write")),
) -> dict:
    content = await file.read(LOGIN_BACKGROUND_MAX_BYTES + 1)
    content_type = _validate_login_background_upload(
        filename=file.filename,
        declared_content_type=file.content_type,
        content=content,
        width=width,
        height=height,
    )
    storage = get_document_storage()
    object_key = storage.build_settings_object_key("login-background.webp")

    try:
        storage.put_object(object_key=object_key, content=content, content_type=content_type)
    except Exception as error:
        raise HTTPException(status_code=502, detail="Failed to store login background image") from error

    display_name = source_file_name or file.filename or "login-background.webp"
    return {
        "data": upsert_branding_login_background(
            {
                "object_key": object_key,
                "file_name": _safe_download_name(display_name, "login-background.webp"),
                "mime_type": content_type,
                "size_bytes": len(content),
                "width": width,
                "height": height,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    }


@app.delete("/api/settings/branding/login-background")
def delete_system_branding_login_background(
    _auth: AuthenticatedUser = Depends(require_permission("system.settings.branding.write")),
) -> dict:
    image = get_branding_login_background_storage_object()
    if image is not None:
        try:
            get_document_storage().delete_object(object_key=image["object_key"])
        except Exception as error:
            raise HTTPException(status_code=502, detail="Failed to remove login background image") from error

    return {"data": clear_branding_login_background()}


def _safe_download_name(value: str, fallback: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", value.strip()).strip("-")
    return safe or fallback


@app.get("/api/standards/import-template")
def download_standard_import_template(
    _auth: AuthenticatedUser = Depends(require_permission("standard.write")),
) -> Response:
    content = build_standard_import_template()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="standard-import-template.xlsx"'},
    )


@app.get("/api/standards/{standard_id}/export", dependencies=[Depends(require_standard_permission("standard.read"))])
def export_standard_definition(standard_id: str) -> Response:
    result = build_standard_export_workbook(standard_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Standard not found")
    standard, content = result
    filename = _safe_download_name(str(standard.get("code") or "standard"), "standard")
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}-standard-export.xlsx"'},
    )


@app.post("/api/standards")
def create_new_standard(
    payload: StandardCreate,
    _auth: AuthenticatedUser = Depends(require_permission("standard.write")),
) -> dict:
    result = create_standard(payload.model_dump())
    return {"data": result}

@app.post("/api/standard-imports")
async def create_standard_import(
    file: UploadFile = File(...),
    target_mode: str = Form("new"),
    target_standard_id: str | None = Form(default=None),
    current_user: AuthenticatedUser = Depends(require_any_standard_permission("standard.write")),
) -> dict:
    normalized_target_mode = target_mode.strip().lower() if target_mode else "new"
    if normalized_target_mode == "merge":
        if not target_standard_id:
            raise HTTPException(status_code=400, detail="target_standard_id is required when target_mode is merge")
        if not current_user.has_permission("standard.write", standard_id=target_standard_id):
            raise HTTPException(status_code=403, detail="Not enough permissions")
    elif not current_user.has_permission("standard.write"):
        raise HTTPException(status_code=403, detail="Not enough permissions")

    if not file.filename:
        raise HTTPException(status_code=400, detail="Uploaded file must have a filename")
    try:
        payload = create_standard_import_job_from_upload(
            file.filename,
            await file.read(),
            target_mode=normalized_target_mode,
            target_standard_id=target_standard_id,
        )
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    return {"data": payload}


@app.post("/api/standards/imports/validate")
async def validate_standard_import(
    file: UploadFile = File(...),
    _auth: AuthenticatedUser = Depends(require_permission("standard.write")),
) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Uploaded file must have a filename")
    try:
        payload = create_standard_import_job_from_upload(file.filename, await file.read(), target_mode="new")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"data": payload}


@app.get("/api/standard-imports/{job_id}")
def get_standard_import(
    job_id: str,
    _auth: AuthenticatedUser = Depends(require_any_standard_permission("standard.read")),
) -> dict:
    try:
        return {"data": get_standard_import_job_detail(job_id)}
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/standard-imports/{job_id}/items")
def get_standard_import_items(
    job_id: str,
    item_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    source_table: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    _auth: AuthenticatedUser = Depends(require_any_standard_permission("standard.read")),
) -> dict:
    try:
        return {
            "data": get_standard_import_job_detail(
                job_id,
                status=status,
                item_type=item_type,
                source_table=source_table,
                page=page,
                page_size=page_size,
            )
        }
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/standards/imports/{job_id}")
def get_legacy_standard_import_job(
    job_id: str,
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    _auth: AuthenticatedUser = Depends(require_any_standard_permission("standard.read")),
) -> dict:
    try:
        return {"data": get_standard_import_job_detail(job_id, status=status, page=page, page_size=page_size)}
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.patch("/api/standard-imports/{job_id}/items/{item_id}")
def update_standard_import_item(
    job_id: str,
    item_id: str,
    payload: StandardImportItemPatch,
    _auth: AuthenticatedUser = Depends(require_any_standard_permission("standard.write")),
) -> dict:
    try:
        return {"data": patch_standard_import_item(job_id, item_id, payload.model_dump(exclude_none=True))}
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error


@app.patch("/api/standards/imports/{job_id}")
def update_legacy_standard_import_job(
    job_id: str,
    payload: StandardImportPatch,
    _auth: AuthenticatedUser = Depends(require_any_standard_permission("standard.write")),
) -> dict:
    try:
        return {"data": patch_standard_import_job(job_id, payload.model_dump())}
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error


@app.post("/api/standard-imports/{job_id}/commit")
def commit_standard_import(
    job_id: str,
    _auth: AuthenticatedUser = Depends(require_any_standard_permission("standard.write")),
) -> dict:
    try:
        return {"data": commit_standard_import_job(job_id)}
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Standard import commit failed due to duplicate data") from error


@app.post("/api/standards/imports/{job_id}/commit")
def commit_legacy_standard_import_job(
    job_id: str,
    _auth: AuthenticatedUser = Depends(require_any_standard_permission("standard.write")),
) -> dict:
    try:
        return {"data": commit_standard_import_job(job_id)}
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Standard import commit failed due to duplicate data") from error


@app.get("/api/standards/{standard_id}", dependencies=[Depends(require_standard_permission("standard.read"))])
def standards_detail(
    standard_id: str,
    include_attributes: bool = Query(default=False),
) -> dict:
    detail = get_standard_detail(standard_id, include_attributes=include_attributes)
    if detail is None:
        raise HTTPException(status_code=404, detail="Standard not found")
    return {"data": detail}


@app.get("/api/standards/{standard_id}/disciplines", dependencies=[Depends(require_standard_permission("standard.read"))])
def standard_disciplines_list(standard_id: str) -> dict:
    result = list_standard_disciplines(standard_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Standard not found")
    return {"data": result}


@app.post("/api/standards/{standard_id}/disciplines", dependencies=[Depends(require_standard_permission("standard.write"))])
def create_standard_discipline_item(standard_id: str, payload: DisciplinePayload) -> dict:
    try:
        result = create_standard_discipline(standard_id, payload.model_dump())
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Discipline already exists") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Standard not found")
    return {"data": result}


@app.patch("/api/standards/{standard_id}/disciplines/{discipline_id}", dependencies=[Depends(require_standard_permission("standard.write"))])
def update_standard_discipline_item(standard_id: str, discipline_id: str, payload: DisciplinePayload) -> dict:
    try:
        result = update_standard_discipline(standard_id, discipline_id, payload.model_dump())
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Discipline already exists") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Discipline not found")
    return {"data": result}


@app.delete("/api/standards/{standard_id}/disciplines/{discipline_id}", dependencies=[Depends(require_standard_permission("standard.write"))])
def archive_standard_discipline_item(standard_id: str, discipline_id: str) -> dict:
    result = archive_standard_discipline(standard_id, discipline_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Discipline not found")
    return {"data": result}


@app.get("/api/standards/{standard_id}/discipline-document-types", dependencies=[Depends(require_standard_permission("standard.read"))])
def standard_discipline_document_types_list(
    standard_id: str,
    discipline_id: str | None = Query(default=None),
    document_type_id: str | None = Query(default=None),
    asset_scope: str | None = Query(default=None),
    perspective: str | None = Query(default=None),
    lifecycle_phase: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict:
    result = list_standard_discipline_document_types(
        standard_id,
        {
            "discipline_id": discipline_id,
            "document_type_id": document_type_id,
            "asset_scope": asset_scope,
            "perspective": perspective,
            "lifecycle_phase": lifecycle_phase,
        },
        page=page,
        page_size=page_size,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Standard not found")
    return {"data": result}


@app.post("/api/standards/{standard_id}/discipline-document-types", dependencies=[Depends(require_standard_permission("standard.write"))])
def create_standard_discipline_document_type_item(standard_id: str, payload: DisciplineDocumentTypePayload) -> dict:
    try:
        result = create_standard_discipline_document_type(standard_id, payload.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Discipline/document type rule already exists") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Standard not found")
    return {"data": result}


@app.patch("/api/standards/{standard_id}/discipline-document-types/{rule_id}", dependencies=[Depends(require_standard_permission("standard.write"))])
def update_standard_discipline_document_type_item(standard_id: str, rule_id: str, payload: DisciplineDocumentTypePayload) -> dict:
    try:
        result = update_standard_discipline_document_type(standard_id, rule_id, payload.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Discipline/document type rule already exists") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Discipline/document type rule not found")
    return {"data": result}


@app.delete("/api/standards/{standard_id}/discipline-document-types/{rule_id}", dependencies=[Depends(require_standard_permission("standard.write"))])
def archive_standard_discipline_document_type_item(standard_id: str, rule_id: str) -> dict:
    result = archive_standard_discipline_document_type(standard_id, rule_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Discipline/document type rule not found")
    return {"data": result}


@app.get("/api/standards/{standard_id}/class-document-requirements", dependencies=[Depends(require_standard_permission("standard.read"))])
def standard_class_document_requirements_list(
    standard_id: str,
    class_id: str | None = Query(default=None),
    document_type_id: str | None = Query(default=None),
    asset_scope: str | None = Query(default=None),
    perspective: str | None = Query(default=None),
    lifecycle_phase: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict:
    result = list_standard_class_document_requirements(
        standard_id,
        {
            "class_id": class_id,
            "document_type_id": document_type_id,
            "asset_scope": asset_scope,
            "perspective": perspective,
            "lifecycle_phase": lifecycle_phase,
        },
        page=page,
        page_size=page_size,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Standard not found")
    return {"data": result}


@app.post("/api/standards/{standard_id}/class-document-requirements", dependencies=[Depends(require_standard_permission("standard.write"))])
def create_standard_class_document_requirement_item(standard_id: str, payload: ClassDocumentRequirementPayload) -> dict:
    try:
        result = create_standard_class_document_requirement(standard_id, payload.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Class/document requirement already exists") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Standard not found")
    return {"data": result}


@app.patch("/api/standards/{standard_id}/class-document-requirements/{requirement_id}", dependencies=[Depends(require_standard_permission("standard.write"))])
def update_standard_class_document_requirement_item(standard_id: str, requirement_id: str, payload: ClassDocumentRequirementPayload) -> dict:
    try:
        result = update_standard_class_document_requirement(standard_id, requirement_id, payload.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Class/document requirement already exists") from error
    if result is None:
        raise HTTPException(status_code=404, detail="Class/document requirement not found")
    return {"data": result}


@app.delete("/api/standards/{standard_id}/class-document-requirements/{requirement_id}", dependencies=[Depends(require_standard_permission("standard.write"))])
def archive_standard_class_document_requirement_item(standard_id: str, requirement_id: str) -> dict:
    result = archive_standard_class_document_requirement(standard_id, requirement_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Class/document requirement not found")
    return {"data": result}


@app.get("/api/standards/{standard_id}/attributes", dependencies=[Depends(require_standard_permission("standard.read"))])
def standard_common_attributes_list(
    standard_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    applies_to: ClassDefinitionDomain = Query(default="tag"),
) -> dict:
    result = list_standard_common_attributes(standard_id, page=page, page_size=page_size, applies_to=applies_to)
    if result is None:
        raise HTTPException(status_code=404, detail="Standard not found")
    return {"data": result}


def _format_standard_delete_blockers(blockers: dict[str, int]) -> str:
    labels = {
        "project_count": "关联项目",
        "tag_count": "TAG",
        "document_count": "图纸",
        "pbs_node_count": "PBS 节点",
    }
    parts = [f"{labels[key]} {count} 个" for key, count in blockers.items() if count > 0]
    return "标准存在业务关联，不能删除：" + "，".join(parts)


@app.delete("/api/standards/{standard_id}")
def delete_existing_standard(
    standard_id: str,
    _auth: AuthenticatedUser = Depends(require_standard_permission("standard.write")),
) -> dict:
    deleted_standard, blockers = delete_standard_record(standard_id)
    if deleted_standard is None:
        raise HTTPException(status_code=404, detail="Standard not found")
    if any(count > 0 for count in blockers.values()):
        raise HTTPException(status_code=409, detail=_format_standard_delete_blockers(blockers))
    return {"data": deleted_standard}


@app.patch("/api/standards/{standard_id}/icon")
def update_standards_icon(
    standard_id: str,
    payload: StandardIconUpdate,
    _auth: AuthenticatedUser = Depends(require_standard_permission("standard.write")),
) -> dict:
    result = update_standard_icon(standard_id, payload.icon_data_url)
    if result is None:
        raise HTTPException(status_code=404, detail="Standard not found")
    return {"data": result}


@app.patch("/api/classes/{class_id}/parent", dependencies=[Depends(require_class_standard_permission("standard.write"))])
def update_class_parent(class_id: str, payload: ClassParentUpdate) -> dict:
    try:
        result = move_class(class_id, payload.parent_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if result is None:
        raise HTTPException(status_code=404, detail="Class not found")

    return {"data": result}


@app.get("/api/classes/{class_id}/attributes", dependencies=[Depends(require_class_standard_permission("standard.read"))])
def class_attributes_list(
    class_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict:
    result = list_class_attributes(class_id, page=page, page_size=page_size)
    if result is None:
        raise HTTPException(status_code=404, detail="Class not found")
    return {"data": result}


@app.post("/api/standards/{standard_id}/classes")
def create_standard_class_definition(
    standard_id: str,
    payload: ClassCreate,
    _auth: AuthenticatedUser = Depends(require_standard_permission("standard.write")),
) -> dict:
    try:
        result = create_class(payload.model_dump(), standard_id)
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Class code already exists in this standard") from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if result is None:
        raise HTTPException(status_code=404, detail="Standard not found")

    return {"data": result}


@app.patch("/api/classes/{class_id}", dependencies=[Depends(require_class_standard_permission("standard.write"))])
def update_standard_class_definition(class_id: str, payload: ClassUpdate) -> dict:
    try:
        result = update_class(class_id, payload.model_dump())
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Class code already exists in this standard") from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if result is None:
        raise HTTPException(status_code=404, detail="Class not found")

    return {"data": result}


@app.post("/api/standards/{standard_id}/attributes")
def create_standard_attribute_definition(
    standard_id: str,
    payload: AttributeCreate,
    _auth: AuthenticatedUser = Depends(require_standard_permission("standard.write")),
) -> dict:
    try:
        result = create_attribute(payload.model_dump(), standard_id=standard_id)
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Attribute code already exists in this standard") from error
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if result is None:
        raise HTTPException(status_code=404, detail="Standard not found")
    return {"data": result}


@app.post("/api/classes/{class_id}/attributes", dependencies=[Depends(require_class_standard_permission("standard.write"))])
def create_class_attribute_definition(class_id: str, payload: AttributeCreate) -> dict:
    try:
        result = create_attribute(payload.model_dump(), class_id=class_id)
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Attribute code already exists in this class") from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if result is None:
        raise HTTPException(status_code=404, detail="Class not found")
    return {"data": result}


@app.patch("/api/classes/{class_id}/attributes/order", dependencies=[Depends(require_class_standard_permission("standard.write"))])
def update_class_attribute_order(class_id: str, payload: AttributeOrderUpdate) -> dict:
    try:
        result = reorder_attributes(class_id, payload.attribute_ids)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if result is None:
        raise HTTPException(status_code=404, detail="Class not found")
    return {"data": result}


@app.patch("/api/attributes/{attribute_id}", dependencies=[Depends(require_attribute_standard_permission("standard.write"))])
def update_attribute_definition(attribute_id: str, payload: AttributeUpdate) -> dict:
    try:
        result = update_attribute(attribute_id, payload.model_dump())
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Attribute code already exists in this class") from error

    if result is None:
        raise HTTPException(status_code=404, detail="Attribute not found")
    return {"data": result}


@app.delete("/api/attributes/{attribute_id}", dependencies=[Depends(require_attribute_standard_permission("standard.write"))])
def delete_attribute_definition(attribute_id: str) -> dict:
    result = soft_delete_attribute(attribute_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Attribute not found")
    return {"data": result}
