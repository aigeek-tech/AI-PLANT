import i18n from '../i18n';
import { readStoredLocale } from '../i18n/locales';

interface StandardBase {
  id: string;
  code: string;
  name: string;
  version_label: string | null;
  thumbnail_url: string | null;
  status: string;
  metadata: Record<string, unknown>;
}

export interface Standard extends StandardBase {
  class_count: number;
  attribute_count: number;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  overview: string | null;
  reference_attributes: Record<string, unknown>;
  thumbnail_url: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreatePayload {
  code: string;
  name: string;
  overview?: string | null;
  reference_attributes?: Record<string, unknown>;
  thumbnail_url?: string | null;
  status?: string;
}

export type AttributeValueType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'enum' | 'json';
export type EntityKind = 'document' | 'tag' | 'pbs_node';
export type ClassDefinitionDomain = 'tag' | 'equipment';

export interface AttributeDefinition {
  id: string;
  class_id?: string;
  standard_id?: string;
  group_name?: string;
  code: string;
  name: string;
  value_type: AttributeValueType;
  is_required: boolean;
  unit_family: string | null;
  enum_options: unknown[];
  description: string | null;
  sort_order: number;
  status: string;
  applies_to?: ClassDefinitionDomain | 'document' | 'both';
}

export interface ClassDefinition {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level_no: number;
  description: string | null;
  status: string;
  applies_to?: ClassDefinitionDomain | 'document' | 'both';
  attribute_count?: number;
  attributes: AttributeDefinition[];
}

export interface PbsLevelTemplate {
  id: string;
  standard_id: string;
  level_no: number;
  code: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface StandardDetail extends StandardBase {
  classes: ClassDefinition[];
  common_attributes?: AttributeDefinition[];
  common_attribute_count?: number;
  equipment_classes?: ClassDefinition[];
  equipment_common_attributes?: AttributeDefinition[];
  equipment_common_attribute_count?: number;
  pbs_levels?: PbsLevelTemplate[];
}

export interface Discipline {
  id: string;
  standard_id: string;
  cfihos_unique_code: string | null;
  code: string;
  name: string;
  description: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DisciplineDocumentType {
  id: string;
  standard_id: string;
  discipline_id: string;
  discipline_code: string;
  discipline_name: string;
  document_type_id: string;
  document_type_code: string;
  document_type_name: string;
  cfihos_unique_code: string | null;
  short_code: string | null;
  asset_scope: string | null;
  representation_type: string | null;
  native_file_delivery_timing: string | null;
  perspective: string;
  lifecycle_phase: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ClassDocumentRequirement {
  id: string;
  standard_id: string;
  class_id: string;
  class_code: string;
  class_name: string;
  class_applies_to: ClassDefinitionDomain | 'document' | 'both';
  document_type_id: string;
  document_type_code: string;
  document_type_name: string;
  cfihos_unique_code: string | null;
  asset_scope: string | null;
  source_standard_cfihos_code: string | null;
  source_standard_code: string | null;
  perspective: string;
  lifecycle_phase: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DeliveryRuleFilters {
  discipline_id?: string;
  class_id?: string;
  document_type_id?: string;
  asset_scope?: string;
  perspective?: string;
  lifecycle_phase?: string;
  page?: number;
  page_size?: number;
}

export interface PaginatedDeliveryRules<TItem> {
  items: TItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface DisciplinePayload {
  cfihos_unique_code?: string | null;
  code: string;
  name: string;
  description?: string | null;
  status?: 'active' | 'deprecated' | 'archived';
  metadata?: Record<string, unknown>;
}

export interface DisciplineDocumentTypePayload {
  discipline_id: string;
  document_type_id: string;
  cfihos_unique_code?: string | null;
  short_code?: string | null;
  asset_scope?: string | null;
  representation_type?: string | null;
  native_file_delivery_timing?: string | null;
  perspective?: string;
  lifecycle_phase?: string;
  status?: 'active' | 'deprecated' | 'archived';
  metadata?: Record<string, unknown>;
}

export interface ClassDocumentRequirementPayload {
  class_id: string;
  document_type_id: string;
  cfihos_unique_code?: string | null;
  asset_scope?: string | null;
  source_standard_cfihos_code?: string | null;
  source_standard_code?: string | null;
  perspective?: string;
  lifecycle_phase?: string;
  status?: 'active' | 'deprecated' | 'archived';
  metadata?: Record<string, unknown>;
}

export interface PaginatedAttributes {
  items: AttributeDefinition[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface AttributeUpdatePayload {
  group_name?: string;
  code: string;
  name: string;
  value_type: AttributeValueType;
  is_required: boolean;
  unit_family: string | null;
  enum_options: string[];
  description: string | null;
  applies_to?: ClassDefinitionDomain;
}

export interface ClassMoveResult {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level_no: number;
  description: string | null;
  status: string;
}

export interface ClassCreatePayload {
  code: string;
  name: string;
  parent_id?: string | null;
  description?: string | null;
  status?: string;
  applies_to?: ClassDefinitionDomain;
}

export interface AiEndpointSettings {
  name: string;
  provider: string;
  base_url: string;
  endpoint_path: string;
  model: string;
  temperature: number;
  max_tokens: number | null;
  timeout_seconds: number;
  is_enabled: boolean;
  has_api_key: boolean;
  updated_at: string | null;
}

export interface BrandingSettings {
  system_name: string;
  sidebar_title: string;
  logo_data_url: string | null;
  login_background_image_url: string | null;
  login_background_image_meta: LoginBackgroundImageMeta | null;
  updated_at: string | null;
}

export interface LoginBackgroundImageMeta {
  file_name: string;
  mime_type: string;
  size_bytes: number;
  width: number;
  height: number;
  updated_at: string | null;
}

export interface PbsNode {
  id: string;
  project_id: string;
  parent_id?: string;
  code: string;
  name: string;
  description?: string;
  node_type: string;
  level_template_id?: string;
  level_no?: number;
  level_code?: string;
  level_name?: string;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface DocumentTypeAttribute {
  id: string;
  document_type_id?: string | null;
  standard_id?: string | null;
  group_name?: string | null;
  unit_family?: string | null;
  code: string;
  name: string;
  value_type: AttributeValueType;
  is_required: boolean;
  enum_options: string[];
  description: string | null;
  sort_order: number;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface DocumentType {
  id: string;
  standard_id: string | null;
  code: string;
  name: string;
  parent_id: string | null;
  level_no: number;
  description: string | null;
  status: 'active' | 'archived';
  allowed_extensions: string[];
  metadata: Record<string, unknown>;
  attribute_count?: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentTypeDetail extends DocumentType {
  common_attributes: DocumentTypeAttribute[];
  attributes: DocumentTypeAttribute[];
}

export interface ProjectDocumentFile {
  id: string;
  revision_id: string;
  file_role: 'primary' | 'source' | 'attachment' | 'reference';
  original_filename: string;
  relative_path: string | null;
  storage_provider: 's3';
  bucket: string;
  object_key: string;
  mime_type: string;
  size_bytes: number;
  checksum_sha256: string | null;
  etag: string | null;
  preview_mode: 'inline' | 'download';
  status: 'pending_upload' | 'ready' | 'upload_failed' | 'deleted';
  created_at: string;
  updated_at: string;
}

export interface ProjectDocumentRevision {
  id: string;
  document_id: string;
  revision_no: string;
  state: 'draft' | 'issued' | 'void';
  is_current: boolean;
  issued_at: string | null;
  change_summary: string | null;
  files: ProjectDocumentFile[];
  created_at: string;
  updated_at: string;
}

export interface LinkedPbsNodeSummary {
  id: string;
  code: string;
  name: string;
}

export interface LinkedTagSummary {
  id: string;
  tag_no: string;
  name: string;
}

export interface RelationType {
  id: string;
  code: string;
  name: string;
  source_kind: EntityKind;
  target_kind: EntityKind;
  is_symmetric: boolean;
  status: 'active' | 'archived';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectRelation {
  id: string;
  project_id: string;
  relation_type_id: string;
  relation_type_code: string;
  relation_type_name: string;
  is_symmetric: boolean;
  source_kind: EntityKind;
  source_id: string;
  target_kind: EntityKind;
  target_id: string;
  sort_order: number;
  note: string | null;
  source_system: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectDocumentListItem {
  id: string;
  project_id: string;
  document_no: string;
  title: string;
  document_type_id: string | null;
  document_type_code: string | null;
  document_type_name: string | null;
  discipline: string | null;
  attributes: Record<string, unknown>;
  current_revision_id: string | null;
  status: 'active' | 'archived';
  metadata: Record<string, unknown>;
  current_revision_no: string | null;
  current_revision_state: 'draft' | 'issued' | 'void' | null;
  file_count: number;
  primary_file_name: string | null;
  linked_pbs_count: number;
  linked_tag_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectDocumentListResult {
  items: ProjectDocumentListItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface ProjectDocumentDetail {
  id: string;
  project_id: string;
  document_no: string;
  title: string;
  document_type_id: string | null;
  document_type_code: string | null;
  document_type_name: string | null;
  discipline: string | null;
  attributes: Record<string, unknown>;
  current_revision_id: string | null;
  status: 'active' | 'archived';
  metadata: Record<string, unknown>;
  pbs_nodes: LinkedPbsNodeSummary[];
  pbs_node_ids: string[];
  tags: LinkedTagSummary[];
  tag_ids: string[];
  revisions: ProjectDocumentRevision[];
  created_at: string;
  updated_at: string;
}

export interface ProjectDocumentFileUploadInit {
  file_id: string;
  upload_url: string;
  upload_headers: Record<string, string>;
  expires_at: string;
  bucket: string;
  object_key: string;
  preview_mode: 'inline' | 'download';
  file: ProjectDocumentFile;
}

export interface ProjectDocumentFileAccess {
  file_id: string;
  preview_mode: 'inline' | 'download';
  preview_engine: 'browser' | 'kkfileview';
  preview_url: string;
  url: string;
  expires_at: string;
  disposition: 'inline' | 'attachment';
}

export interface DocumentVisualization {
  id: string;
  project_id: string;
  document_id: string;
  revision_id: string;
  source_file_id: string;
  source_file_name: string;
  preview_file_id: string;
  preview_file_name: string;
  annotation_manifest_file_id: string | null;
  annotation_manifest_file_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DocumentVisualizationAccess {
  visualization_id: string;
  viewer_url: string;
  source_url: string;
  annotation_manifest_url: string | null;
  asset_mode: 'spark_native' | 'rad_single' | 'rad_chunked';
  expires_at: string;
  metadata: Record<string, unknown>;
  preview_file_name: string;
  source_file_name: string;
}

export interface DocumentVisualizationCreatePayload {
  source_file_id: string;
  preview_file_id: string;
  annotation_manifest_file_id?: string | null;
  metadata?: Record<string, unknown>;
}

export type DocumentVisualizationObjectTargetKind = 'tag' | 'equipment' | 'document' | 'pbs_node' | 'custom';
export type DocumentVisualizationObjectResolverType = 'mesh' | 'primitive' | 'bbox' | 'anchor';
export type DocumentVisualizationObjectCoordinateSpace = 'splat_local' | 'world';

export interface DocumentVisualizationPrimitive {
  type: 'box' | 'sphere' | 'capsule' | 'cylinder';
  center: [number, number, number];
  size?: [number, number, number] | null;
  radius?: number | null;
  height?: number | null;
  quaternion?: [number, number, number, number] | null;
}

export interface DocumentVisualizationObjectTargetSummary {
  id: string;
  kind: DocumentVisualizationObjectTargetKind;
  code?: string | null;
  name?: string | null;
  status?: string | null;
  class_code?: string | null;
  class_name?: string | null;
  pbs_node_code?: string | null;
  pbs_node_name?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serial_no?: string | null;
  node_type?: string | null;
  attribute_values?: Record<string, unknown>;
  attribute_items?: Array<{
    code: string;
    name: string;
    value: unknown;
    group_name?: string | null;
    value_type?: string | null;
    unit_family?: string | null;
    sort_order?: number;
  }>;
}

export interface DocumentVisualizationObject {
  id: string;
  visualization_id: string;
  target_kind: DocumentVisualizationObjectTargetKind;
  target_id: string;
  label: string;
  resolver_type: DocumentVisualizationObjectResolverType;
  coordinate_space: DocumentVisualizationObjectCoordinateSpace;
  anchor_position: [number, number, number] | null;
  primitive: DocumentVisualizationPrimitive | Record<string, unknown>;
  geometry_asset_id: string | null;
  priority: number;
  visible: boolean;
  selectable: boolean;
  highlightable: boolean;
  metadata: Record<string, unknown>;
  target_summary: DocumentVisualizationObjectTargetSummary | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentConversionJob {
  id: string;
  project_id: string;
  document_id: string;
  revision_id: string;
  source_file_id: string;
  source_file_name: string;
  output_file_id: string | null;
  output_file_name: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  input_format: string;
  output_format: string;
  error: string | null;
  metadata: Record<string, unknown>;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}


export interface DocumentImportAnalyzeItem {
  client_id: string;
  filename: string;
  relative_path?: string | null;
  size_bytes: number;
  content_type?: string | null;
}

export interface DocumentImportCandidate {
  client_id: string;
  project_id: string;
  filename: string;
  relative_path: string | null;
  size_bytes: number;
  content_type: string | null;
  suggested_document_no: string | null;
  suggested_title: string | null;
  suggested_revision_no: string | null;
  suggested_file_role: 'primary' | 'source' | 'attachment' | 'reference';
  matched_document_id: string | null;
  matched_document_title: string | null;
  matched_revision_id: string | null;
  confidence: number;
  decision_source: 'rule' | 'llm' | 'manual';
  needs_confirmation: boolean;
  match_reasons: string[];
}

export interface DocumentImportAnalyzeResult {
  items: DocumentImportCandidate[];
  summary: {
    total_files: number;
    rule_auto_count: number;
    ai_suggested_count: number;
    manual_review_count: number;
    needs_confirmation_count: number;
  };
}

export interface ProjectTag {
  id: string;
  project_id: string;
  tag_no: string;
  name: string;
  pbs_node_id?: string | null;
  class_id?: string | null;
  parent_tag_id?: string | null;
  class_name?: string;
  attribute_values: Record<string, unknown>;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface ProjectTagAttributeFilter {
  code: string;
  operator: 'contains' | 'equals' | 'gte' | 'lte';
  value: unknown;
}

export interface ProjectTagSearchItem extends ProjectTag {
  pbs_node_code?: string | null;
  pbs_node_name?: string | null;
  parent_tag_no?: string | null;
  parent_tag_name?: string | null;
  matched_attribute_codes: string[];
}

export interface ProjectTagBrowseItem extends ProjectTagSearchItem {
  children: ProjectTagSearchItem[];
}

export interface ProjectTagDetail extends ProjectTagSearchItem {
  common_attributes?: AttributeDefinition[];
  class_attributes?: AttributeDefinition[];
  children: ProjectTagSearchItem[];
  linked_documents: ProjectDocumentListItem[];
  relations: ProjectRelation[];
  equipment_implementation?: TagEquipmentImplementation | null;
}

export type EquipmentAssetStatus =
  | 'planned'
  | 'ordered'
  | 'in_service'
  | 'spare'
  | 'removed'
  | 'scrapped'
  | 'archived';

export interface EquipmentClass {
  id: string;
  standard_id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level_no: number;
  description: string | null;
  status: string;
  metadata: Record<string, unknown>;
  reason?: string | null;
  is_mapped?: boolean;
}

export interface ProjectEquipment {
  id: string;
  project_id: string;
  equipment_no: string;
  name: string;
  class_id: string | null;
  class_code?: string | null;
  class_name?: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_no: string | null;
  purchase_order_no: string | null;
  asset_status: EquipmentAssetStatus;
  attribute_values: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TagEquipmentAssignment {
  id: string;
  tag_id: string;
  equipment_id: string;
  installed_from: string;
  installed_to: string | null;
  is_current: boolean;
  status: 'active' | 'archived';
  notes: string | null;
  created_at?: string;
  updated_at?: string;
  equipment?: ProjectEquipment;
}

export interface TagEquipmentImplementation {
  tag_id: string;
  tag_class: { id: string; code: string | null; name: string | null } | null;
  compatible_equipment_classes: EquipmentClass[];
  equipment_common_attributes?: AttributeDefinition[];
  equipment_class_attributes?: AttributeDefinition[];
  current_assignment: TagEquipmentAssignment | null;
  assignment_history: TagEquipmentAssignment[];
}

export type DataQualitySeverity = 'critical' | 'high' | 'medium' | 'low';
export type DataQualityDimension = 'completeness' | 'accuracy' | 'consistency' | 'document_readiness';
export type DataQualityObjectKind = 'tag' | 'equipment' | 'document' | 'pbs_node' | 'project';
export type DataQualityMatrixCellStatus = 'ok' | 'missing' | 'draft' | 'no_file' | 'linked_error';

export interface DataQualityDimensionCard {
  dimension: DataQualityDimension;
  label: string;
  score: number;
  issue_count: number;
  critical_issue_count: number;
  checks_passed: number;
  checks_total: number;
}

export interface DataQualitySummary {
  project_id: string;
  generated_at: string;
  standard: {
    id: string;
    code: string | null;
    name: string | null;
    version_label: string | null;
  } | null;
  scope: {
    tag_count: number;
    equipment_count: number;
    document_count: number;
    pbs_node_count: number;
    requirement_count: number;
  };
  overall_score: number;
  completeness_score: number;
  accuracy_score: number;
  consistency_score: number;
  document_readiness_score: number;
  critical_issue_count: number;
  issue_count: number;
  matrix_row_count: number;
  dimension_cards: DataQualityDimensionCard[];
}

export interface DataQualityIssue {
  id: string;
  severity: DataQualitySeverity;
  dimension: DataQualityDimension;
  object_kind: DataQualityObjectKind;
  object_id: string;
  object_code: string;
  object_name: string;
  field: string;
  rule: string;
  current_value: string;
  expected_value: string;
  linked_document_no: string | null;
  suggestion: string;
}

export interface DataQualityDocumentMatrixCell {
  requirement_id: string;
  document_type_id: string;
  document_type_code: string | null;
  document_type_name: string | null;
  asset_scope: string | null;
  lifecycle_phase: string | null;
  status: DataQualityMatrixCellStatus;
  document_id: string | null;
  document_no: string | null;
  document_title: string | null;
  revision_no: string | null;
  revision_state: string | null;
  file_count: number;
}

export interface DataQualityDocumentMatrixRow {
  row_id: string;
  asset_kind: 'tag' | 'equipment';
  asset_id: string;
  asset_no: string;
  asset_name: string;
  class_id: string | null;
  class_code: string | null;
  class_name: string | null;
  pbs_node_id: string | null;
  pbs_node_code: string | null;
  pbs_node_name: string | null;
  equipment_id: string | null;
  equipment_no: string | null;
  equipment_name: string | null;
  required_count: number;
  satisfied_count: number;
  missing_count: number;
  completeness_percent: number;
  cells: DataQualityDocumentMatrixCell[];
}

export interface ProjectEquipmentCreatePayload {
  equipment_no: string;
  name: string;
  class_id?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serial_no?: string | null;
  purchase_order_no?: string | null;
  asset_status?: EquipmentAssetStatus;
  attribute_values?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface TagEquipmentAssignmentPayload {
  equipment_id: string;
  installed_from: string;
  installed_to?: string | null;
  is_current?: boolean;
  status?: 'active' | 'archived';
  notes?: string | null;
}

export interface ProjectTagSearchRequest {
  mode?: 'browse' | 'structured' | 'ai';
  pbs_node_id?: string;
  include_descendants?: boolean;
  include_children?: boolean;
  keyword?: string;
  class_id?: string;
  status?: 'active' | 'archived';
  attribute_filters?: ProjectTagAttributeFilter[];
  page?: number;
  page_size?: number;
}

export interface ProjectTagSearchResult {
  items: Array<ProjectTagBrowseItem | ProjectTagSearchItem>;
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_more: boolean;
  mode: 'browse' | 'structured' | 'ai';
}

export interface TagImportIssue {
  code: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface TagImportConflictAction {
  row_id: string;
  action: 'update' | 'skip';
}

export interface TagImportRow {
  id: string;
  row_number: number;
  values: Record<string, unknown>;
  normalized_values: {
    tag_no: string;
    name: string;
    pbs_code: string;
    pbs_node_id: string | null;
    class_code: string | null;
    class_id: string | null;
    attribute_values: Record<string, unknown>;
  };
  issues: TagImportIssue[];
  status: 'ready' | 'error' | 'warning' | 'conflict';
  existing_tag: {
    id: string;
    tag_no: string;
    name: string;
    pbs_node_id: string | null;
    class_id: string | null;
    attribute_values: Record<string, unknown>;
  } | null;
  conflict_action?: 'update' | 'skip' | null;
}

export interface TagImportSummary {
  total_rows: number;
  ready_rows: number;
  error_rows: number;
  warning_rows: number;
  conflict_rows: number;
  resolved_conflict_rows: number;
  can_commit: boolean;
}

export interface TagImportJob {
  job_id: string;
  filename: string;
  summary: TagImportSummary;
  rows: TagImportRow[];
  page: number;
  page_size: number;
  total_pages: number;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  committed_at: string | null;
}

export interface TagImportCommitResult {
  job_id: string;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  failures: Array<{ row_id?: string; message: string }>;
}

export interface StandardImportIssue {
  code: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface StandardImportTableEvidence {
  filename: string;
  sheet_name: string | null;
  page_no: number | null;
  table_index: number | null;
  row_number: number | null;
  column_name: string | null;
  source_text: string;
}

export interface StandardImportItem {
  id: string | null;
  row_number: number;
  source_kind: 'table' | 'text' | 'template' | 'manual';
  sheet_name: string | null;
  page_no: number | null;
  table_index: number | null;
  source_row_number: number;
  entity_kind:
    | 'standard'
    | 'pbs_level'
    | 'tag_class'
    | 'tag_attribute'
    | 'equipment_class'
    | 'equipment_attribute'
    | 'tag_equipment_class_relationship'
    | 'document_type'
    | 'document_attribute'
    | 'discipline'
    | 'discipline_document_type'
    | 'class_document_requirement';
  values: Record<string, unknown>;
  normalized_values: Record<string, unknown>;
  issues: StandardImportIssue[];
  status: 'ready' | 'error' | 'warning' | 'conflict';
  action: 'create' | 'update' | 'skip' | null;
  confidence: number;
  evidence: StandardImportTableEvidence[];
}

export type StandardImportRow = StandardImportItem;

export interface StandardImportSummary {
  total_rows: number;
  ready_rows: number;
  error_rows: number;
  warning_rows: number;
  conflict_rows: number;
  can_commit: boolean;
}

export interface StandardImportJob {
  job_id: string;
  filename: string;
  file_ext: string;
  file_size: number;
  checksum_sha256: string | null;
  target_mode: 'new' | 'merge';
  summary: StandardImportSummary;
  items: StandardImportItem[];
  rows: StandardImportItem[];
  page: number;
  page_size: number;
  total_pages: number;
  status: string;
  target_standard_id: string | null;
  source_standard_code: string | null;
  created_at: string | null;
  updated_at: string | null;
  committed_at: string | null;
}

export interface StandardImportCommitResult {
  job_id: string;
  standard_id: string | null;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  failures: Array<{ row_id?: string; message: string }>;
}

export interface AiEndpointSettingsPayload {
  provider: string;
  base_url: string;
  endpoint_path: string;
  model: string;
  api_key?: string | null;
  clear_api_key?: boolean;
  temperature: number;
  max_tokens: number | null;
  timeout_seconds: number;
  is_enabled: boolean;
}

export interface BrandingSettingsPayload {
  system_name: string;
  sidebar_title: string;
  logo_data_url: string | null;
}

export interface AiModelOption {
  id: string;
  owned_by: string | null;
}

export interface AiModelDiscoveryResult {
  provider: string;
  models: AiModelOption[];
  count: number;
}

export interface AiEndpointTestResult {
  success: boolean;
  provider: string;
  base_url: string;
  endpoint_path: string;
  requested_model: string;
  response_model: string | null;
  model_found: boolean | null;
  available_model_count: number | null;
  discovery_error?: string | null;
  sample_text: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  raw_id: string | null;
}

export type AgentTaskType =
  | 'project_qa'
  | 'standard_import_assist'
  | 'document_archive_assist'
  | 'tag_search_assist'
  | 'drawing_analysis_assist';

export type AgentJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentContextScope = 'none' | 'current_page' | 'project' | 'database' | 'workspace';
export type AgentCapabilityProfile = 'full_access';

export interface AgentJob {
  id: string;
  project_id: string;
  created_by: string;
  task_type: AgentTaskType;
  prompt: string;
  status: AgentJobStatus;
  runner: string;
  session_dir: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  cancel_requested: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface AgentJobEvent {
  id: string | null;
  job_id: string | null;
  seq: number;
  event_type: string;
  message: string | null;
  payload: Record<string, unknown>;
  created_at: string | null;
}

export interface AgentJobCreatePayload {
  task_type: AgentTaskType;
  prompt: string;
}

export interface AgentSession {
  id: string;
  created_by: string;
  title: string;
  context_scope: AgentContextScope;
  context_ref: Record<string, unknown>;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface AgentMessage {
  id: string;
  session_id: string;
  run_id: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  structured_content: Record<string, unknown>;
  created_at: string;
}

export interface AgentRun {
  id: string;
  session_id: string;
  created_by: string;
  prompt: string;
  status: AgentJobStatus;
  runner: string;
  capability_profile: AgentCapabilityProfile;
  context_scope: AgentContextScope;
  context_ref: Record<string, unknown>;
  session_dir: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  cancel_requested: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface AgentRunEvent {
  id: string | null;
  run_id: string | null;
  seq: number;
  event_type: string;
  message: string | null;
  payload: Record<string, unknown>;
  created_at: string | null;
}

export interface AgentBackend {
  id: string;
  label: string;
  kind: string;
  status: 'available' | 'missing_config' | 'unavailable' | string;
  execution_model: 'one_shot_cli' | 'persistent_session' | 'unknown' | string;
  is_default: boolean;
  capabilities: string[];
  health_message: string | null;
  command_path: string | null;
}

export interface AgentSessionCreatePayload {
  title?: string | null;
  context_scope?: AgentContextScope;
  context_ref?: Record<string, unknown>;
}

export interface AgentMessageCreatePayload {
  prompt: string;
  context_scope?: AgentContextScope;
  context_ref?: Record<string, unknown>;
  capability_profile?: AgentCapabilityProfile;
  backend_id?: string | null;
}

export interface AgentSessionDetail {
  session: AgentSession;
  messages: AgentMessage[];
}

export interface AgentMessageCreateResult {
  session: AgentSession;
  user_message: AgentMessage;
  assistant_message: AgentMessage;
  run: AgentRun;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export const AUTH_REQUIRED_EVENT = 'smart-design-auth-required';

export function buildApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function buildApiAssetUrl(path: string | null | undefined) {
  if (!path) {
    return null;
  }
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return buildApiUrl(normalizedPath);
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function readErrorMessage(response: Response) {
  const text = await response.text();
  if (!text) {
    return i18n.t('api.requestFailedWithStatus', { status: response.status });
  }

  try {
    const parsed = JSON.parse(text) as {
      detail?: string | { code?: string; message?: string; params?: Record<string, unknown> };
      code?: string;
      message?: string;
      params?: Record<string, unknown>;
    };
    const structured = typeof parsed.detail === 'object' && parsed.detail !== null ? parsed.detail : parsed;
    if (structured.code) {
      const translationKey = `errors.${structured.code}`;
      const translated = i18n.t(translationKey, structured.params ?? {});
      if (translated !== translationKey) {
        return translated;
      }
    }
    if (structured.message) {
      return structured.message;
    }
    if (typeof parsed.detail === 'string') {
      return parsed.detail;
    }
    if (parsed.message) {
      return parsed.message;
    }
  } catch {
    // Fall through to raw text.
  }

  return text;
}

function localeHeaders() {
  const locale = readStoredLocale();
  return {
    'Accept-Language': locale,
    'X-Locale': locale,
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: localeHeaders(),
  });

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json() as Promise<T>;
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...localeHeaders(),
      ...(init.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json() as Promise<T>;
}

async function requestFormData<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      ...localeHeaders(),
      ...(init.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.json() as Promise<T>;
}

async function fetchBlob(path: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: localeHeaders(),
  });

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  return response.blob();
}

export async function getStandards() {
  const response = await fetchJson<{ data: Standard[] }>('/api/standards');
  return response.data;
}

export async function getProjects() {
  const response = await fetchJson<{ data: Project[] }>('/api/projects');
  return response.data;
}

export async function getProjectDetail(projectId: string) {
  const response = await fetchJson<{ data: Project }>(`/api/projects/${projectId}`);
  return response.data;
}

export async function getProjectDataQualitySummary(projectId: string) {
  const response = await fetchJson<{ data: DataQualitySummary }>(`/api/projects/${projectId}/data-quality/summary`);
  return response.data;
}

export async function getProjectDataQualityIssues(projectId: string) {
  const response = await fetchJson<{ data: DataQualityIssue[] }>(`/api/projects/${projectId}/data-quality/issues`);
  return response.data;
}

export async function getProjectDataQualityDocumentMatrix(projectId: string) {
  const response = await fetchJson<{ data: DataQualityDocumentMatrixRow[] }>(
    `/api/projects/${projectId}/data-quality/document-matrix`,
  );
  return response.data;
}

export async function createProject(payload: ProjectCreatePayload) {
  const response = await requestJson<{ data: Project }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateProject(projectId: string, payload: ProjectCreatePayload) {
  const response = await requestJson<{ data: Project }>(`/api/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function deleteProject(projectId: string) {
  await requestJson(`/api/projects/${projectId}`, {
    method: 'DELETE',
  });
}

export async function createProjectAgentJob(projectId: string, payload: AgentJobCreatePayload) {
  const response = await requestJson<{ data: AgentJob }>(`/api/projects/${projectId}/agent-jobs`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function getProjectAgentJob(projectId: string, jobId: string) {
  const response = await fetchJson<{ data: AgentJob }>(`/api/projects/${projectId}/agent-jobs/${jobId}`);
  return response.data;
}

export async function cancelProjectAgentJob(projectId: string, jobId: string) {
  const response = await requestJson<{ data: AgentJob }>(`/api/projects/${projectId}/agent-jobs/${jobId}/cancel`, {
    method: 'POST',
  });
  return response.data;
}

export function buildProjectAgentJobEventsUrl(projectId: string, jobId: string, afterSeq = 0) {
  return buildApiUrl(`/api/projects/${projectId}/agent-jobs/${jobId}/events?after_seq=${afterSeq}`);
}

export async function createAgentSession(payload: AgentSessionCreatePayload = {}) {
  const response = await requestJson<{ data: AgentSession }>('/api/agent/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function listAgentSessions() {
  const response = await fetchJson<{ data: AgentSession[] }>('/api/agent/sessions');
  return response.data;
}

export async function listAgentBackends() {
  const response = await fetchJson<{ data: AgentBackend[] }>('/api/agent/backends');
  return response.data;
}

export async function getAgentSession(sessionId: string) {
  const response = await fetchJson<{ data: AgentSessionDetail }>(`/api/agent/sessions/${sessionId}`);
  return response.data;
}

export async function createAgentMessage(sessionId: string, payload: AgentMessageCreatePayload) {
  const response = await requestJson<{ data: AgentMessageCreateResult }>(`/api/agent/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function getAgentRun(runId: string) {
  const response = await fetchJson<{ data: AgentRun }>(`/api/agent/runs/${runId}`);
  return response.data;
}

export async function cancelAgentRun(runId: string) {
  const response = await requestJson<{ data: AgentRun }>(`/api/agent/runs/${runId}/cancel`, {
    method: 'POST',
  });
  return response.data;
}

export function buildAgentRunEventsUrl(runId: string, afterSeq = 0) {
  return buildApiUrl(`/api/agent/runs/${runId}/events?after_seq=${afterSeq}`);
}

export async function getAiSettings() {
  const response = await fetchJson<{ data: AiEndpointSettings }>('/api/settings/ai');
  return response.data;
}

export async function getPublicBrandingSettings() {
  const response = await fetchJson<{ data: BrandingSettings }>('/api/settings/branding/public');
  return response.data;
}

export async function getBrandingSettings() {
  const response = await fetchJson<{ data: BrandingSettings }>('/api/settings/branding');
  return response.data;
}

export async function updateAiSettings(payload: AiEndpointSettingsPayload) {
  const response = await requestJson<{ data: AiEndpointSettings }>('/api/settings/ai', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateBrandingSettings(payload: BrandingSettingsPayload) {
  const response = await requestJson<{ data: BrandingSettings }>('/api/settings/branding', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function uploadLoginBackgroundImage(
  image: Blob,
  payload: {
    source_file_name: string;
    width: number;
    height: number;
  },
) {
  const formData = new FormData();
  formData.append('file', image, 'login-background.webp');
  formData.append('source_file_name', payload.source_file_name);
  formData.append('width', String(payload.width));
  formData.append('height', String(payload.height));

  const response = await requestFormData<{ data: BrandingSettings }>('/api/settings/branding/login-background', {
    method: 'PUT',
    body: formData,
  });
  return response.data;
}

export async function deleteLoginBackgroundImage() {
  const response = await requestJson<{ data: BrandingSettings }>('/api/settings/branding/login-background', {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
  return response.data;
}

export async function discoverAiModels(payload: AiEndpointSettingsPayload) {
  const response = await requestJson<{ data: AiModelDiscoveryResult }>('/api/settings/ai/models', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function testAiSettings(payload: AiEndpointSettingsPayload) {
  const response = await requestJson<{ data: AiEndpointTestResult }>('/api/settings/ai/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function createStandard(payload: {
  code: string;
  name: string;
  version_label?: string;
  thumbnail_url?: string;
  status?: string;
}) {
  const response = await requestJson<{ data: Standard }>('/api/standards', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function deleteStandard(standardId: string) {
  await requestJson(`/api/standards/${standardId}`, {
    method: 'DELETE',
  });
}

export async function getStandardDetail(standardId: string) {
  const response = await fetchJson<{ data: StandardDetail }>(`/api/standards/${standardId}`);
  return response.data;
}

function deliveryRuleQuery(params?: DeliveryRuleFilters, fields: Array<keyof DeliveryRuleFilters> = []) {
  const query = new URLSearchParams();
  fields.forEach((field) => {
    const value = params?.[field];
    if (value) {
      query.set(field, String(value));
    }
  });
  return query.size > 0 ? `?${query.toString()}` : '';
}

export async function getStandardDisciplines(standardId: string) {
  const response = await fetchJson<{ data: Discipline[] }>(`/api/standards/${standardId}/disciplines`);
  return response.data;
}

export async function createStandardDiscipline(standardId: string, payload: DisciplinePayload) {
  const response = await requestJson<{ data: Discipline }>(`/api/standards/${standardId}/disciplines`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateStandardDiscipline(standardId: string, disciplineId: string, payload: DisciplinePayload) {
  const response = await requestJson<{ data: Discipline }>(`/api/standards/${standardId}/disciplines/${disciplineId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function archiveStandardDiscipline(standardId: string, disciplineId: string) {
  const response = await requestJson<{ data: Discipline }>(`/api/standards/${standardId}/disciplines/${disciplineId}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
  return response.data;
}

export async function getStandardDisciplineDocumentTypes(standardId: string, params?: DeliveryRuleFilters) {
  const suffix = deliveryRuleQuery(params, ['discipline_id', 'document_type_id', 'asset_scope', 'perspective', 'lifecycle_phase', 'page', 'page_size']);
  const response = await fetchJson<{ data: PaginatedDeliveryRules<DisciplineDocumentType> }>(`/api/standards/${standardId}/discipline-document-types${suffix}`);
  return response.data;
}

export async function createStandardDisciplineDocumentType(standardId: string, payload: DisciplineDocumentTypePayload) {
  const response = await requestJson<{ data: DisciplineDocumentType }>(`/api/standards/${standardId}/discipline-document-types`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateStandardDisciplineDocumentType(standardId: string, ruleId: string, payload: DisciplineDocumentTypePayload) {
  const response = await requestJson<{ data: DisciplineDocumentType }>(`/api/standards/${standardId}/discipline-document-types/${ruleId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function archiveStandardDisciplineDocumentType(standardId: string, ruleId: string) {
  const response = await requestJson<{ data: DisciplineDocumentType }>(`/api/standards/${standardId}/discipline-document-types/${ruleId}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
  return response.data;
}

export async function getStandardClassDocumentRequirements(standardId: string, params?: DeliveryRuleFilters) {
  const suffix = deliveryRuleQuery(params, ['class_id', 'document_type_id', 'asset_scope', 'perspective', 'lifecycle_phase', 'page', 'page_size']);
  const response = await fetchJson<{ data: PaginatedDeliveryRules<ClassDocumentRequirement> }>(`/api/standards/${standardId}/class-document-requirements${suffix}`);
  return response.data;
}

export async function createStandardClassDocumentRequirement(standardId: string, payload: ClassDocumentRequirementPayload) {
  const response = await requestJson<{ data: ClassDocumentRequirement }>(`/api/standards/${standardId}/class-document-requirements`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateStandardClassDocumentRequirement(standardId: string, requirementId: string, payload: ClassDocumentRequirementPayload) {
  const response = await requestJson<{ data: ClassDocumentRequirement }>(`/api/standards/${standardId}/class-document-requirements/${requirementId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function archiveStandardClassDocumentRequirement(standardId: string, requirementId: string) {
  const response = await requestJson<{ data: ClassDocumentRequirement }>(`/api/standards/${standardId}/class-document-requirements/${requirementId}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
  return response.data;
}

export async function getStandardCommonAttributes(standardId: string, page = 1, pageSize = 50, appliesTo: ClassDefinitionDomain = 'tag') {
  const response = await fetchJson<{ data: PaginatedAttributes }>(
    `/api/standards/${standardId}/attributes?page=${page}&page_size=${pageSize}&applies_to=${appliesTo}`,
  );
  return response.data;
}

export async function getClassAttributes(classId: string, page = 1, pageSize = 50) {
  const response = await fetchJson<{ data: PaginatedAttributes }>(
    `/api/classes/${classId}/attributes?page=${page}&page_size=${pageSize}`,
  );
  return response.data;
}

const ATTRIBUTE_PAGE_SIZE = 200;

async function getAllAttributePages(loadPage: (page: number) => Promise<PaginatedAttributes>) {
  const firstPage = await loadPage(1);
  if (firstPage.total_pages <= 1) {
    return firstPage.items;
  }

  const remainingPages = await Promise.all(
    Array.from({ length: firstPage.total_pages - 1 }, (_, index) => loadPage(index + 2)),
  );
  return [firstPage, ...remainingPages].flatMap((page) => page.items);
}

export async function getAllClassAttributes(classId: string) {
  return getAllAttributePages((page) => getClassAttributes(classId, page, ATTRIBUTE_PAGE_SIZE));
}

export async function getAllStandardCommonAttributes(
  standardId: string,
  appliesTo: ClassDefinitionDomain = 'tag',
) {
  return getAllAttributePages((page) =>
    getStandardCommonAttributes(standardId, page, ATTRIBUTE_PAGE_SIZE, appliesTo),
  );
}

export async function createStandardClass(standardId: string, payload: ClassCreatePayload) {
  const response = await requestJson<{ data: Omit<ClassDefinition, 'attributes'> & { attributes?: AttributeDefinition[] } }>(
    `/api/standards/${standardId}/classes`,
    {
    method: 'POST',
    body: JSON.stringify(payload),
    },
  );
  return {
    ...response.data,
    attributes: response.data.attributes ?? [],
  };
}

export async function updateStandardClass(classId: string, payload: ClassCreatePayload) {
  const response = await requestJson<{ data: Omit<ClassDefinition, 'attributes'> & { attributes?: AttributeDefinition[] } }>(
    `/api/classes/${classId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
  return {
    ...response.data,
    attributes: response.data.attributes ?? [],
  };
}

export async function moveClassParent(classId: string, parentId: string | null) {
  const response = await requestJson<{ data: ClassMoveResult }>(`/api/classes/${classId}/parent`, {
    method: 'PATCH',
    body: JSON.stringify({ parent_id: parentId }),
  });
  return response.data;
}

export async function createStandardAttribute(standardId: string, payload: AttributeUpdatePayload) {
  const response = await requestJson<{ data: AttributeDefinition }>(`/api/standards/${standardId}/attributes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function createAttribute(classId: string, payload: AttributeUpdatePayload) {
  const response = await requestJson<{ data: AttributeDefinition }>(`/api/classes/${classId}/attributes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateAttribute(attributeId: string, payload: AttributeUpdatePayload) {
  const response = await requestJson<{ data: AttributeDefinition }>(`/api/attributes/${attributeId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function deleteAttribute(attributeId: string) {
  const response = await requestJson<{ data: AttributeDefinition }>(`/api/attributes/${attributeId}`, {
    method: 'DELETE',
  });
  return response.data;
}

export async function reorderAttributes(classId: string, attributeIds: string[]) {
  const response = await requestJson<{ data: AttributeDefinition[] }>(`/api/classes/${classId}/attributes/order`, {
    method: 'PATCH',
    body: JSON.stringify({ attribute_ids: attributeIds }),
  });
  return response.data;
}

export async function updateStandardIcon(standardId: string, iconDataUrl: string) {
  const response = await requestJson<{ data: { id: string; thumbnail_url: string | null } }>(
    `/api/standards/${standardId}/icon`,
    {
      method: 'PATCH',
      body: JSON.stringify({ icon_data_url: iconDataUrl }),
    },
  );
  return response.data;
}

export async function downloadStandardImportTemplate() {
  return fetchBlob('/api/standards/import-template');
}

export async function downloadStandardExport(standardId: string) {
  return fetchBlob(`/api/standards/${standardId}/export`);
}

export async function validateStandardImport(
  file: File,
  options: { target_mode?: 'new' | 'merge'; target_standard_id?: string | null } = {},
) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('target_mode', options.target_mode ?? 'new');
  if (options.target_standard_id) {
    formData.append('target_standard_id', options.target_standard_id);
  }
  const response = await requestFormData<{ data: StandardImportJob }>(
    '/api/standard-imports',
    {
      method: 'POST',
      body: formData,
    },
  );
  return response.data;
}

export async function getStandardImportJob(
  jobId: string,
  params?: {
    status?: 'ready' | 'error' | 'warning' | 'conflict';
    item_type?: StandardImportItem['entity_kind'];
    source_table?: string;
    page?: number;
    page_size?: number;
  },
) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.item_type) query.set('item_type', params.item_type);
  if (params?.source_table) query.set('source_table', params.source_table);
  if (params?.page) query.set('page', String(params.page));
  if (params?.page_size) query.set('page_size', String(params.page_size));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await fetchJson<{ data: StandardImportJob }>(`/api/standard-imports/${jobId}/items${suffix}`);
  return response.data;
}

export async function patchStandardImportItem(
  jobId: string,
  itemId: string,
  payload: { values?: Record<string, unknown>; action?: 'create' | 'update' | 'skip' | null },
) {
  const response = await requestJson<{ data: StandardImportJob & { item?: StandardImportItem | null } }>(`/api/standard-imports/${jobId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function patchStandardImportJob(
  jobId: string,
  payload: { conflict_action: 'create_copy' | 'merge_update' | 'skip'; code_override?: string | null },
) {
  const response = await requestJson<{ data: StandardImportJob }>(`/api/standards/imports/${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function commitStandardImportJob(jobId: string) {
  const response = await requestJson<{ data: StandardImportCommitResult }>(`/api/standard-imports/${jobId}/commit`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return response.data;
}

export async function getProjectTags(projectId: string) {
  const response = await fetchJson<{ data: ProjectTag[] }>(`/api/projects/${projectId}/tags`);
  return response.data;
}

export async function searchProjectTags(projectId: string, payload: ProjectTagSearchRequest) {
  const response = await requestJson<{ data: ProjectTagSearchResult }>(
    `/api/projects/${projectId}/tags/search`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return response.data;
}

export async function getProjectTagDetail(projectId: string, tagId: string) {
  const response = await fetchJson<{ data: ProjectTagDetail }>(`/api/projects/${projectId}/tags/${tagId}`);
  return response.data;
}

export async function downloadProjectTagImportTemplate(projectId: string) {
  return fetchBlob(`/api/projects/${projectId}/tag-import-template`);
}

export async function validateProjectTagImport(projectId: string, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await requestFormData<{ data: TagImportJob }>(
    `/api/projects/${projectId}/tag-imports/validate`,
    {
      method: 'POST',
      body: formData,
    },
  );
  return response.data;
}

export async function getProjectTagImportJob(
  projectId: string,
  jobId: string,
  params?: { status?: 'ready' | 'error' | 'warning' | 'conflict'; page?: number; page_size?: number },
) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.page_size) query.set('page_size', String(params.page_size));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await fetchJson<{ data: TagImportJob }>(
    `/api/projects/${projectId}/tag-imports/${jobId}${suffix}`,
  );
  return response.data;
}

export async function patchProjectTagImportRow(
  projectId: string,
  jobId: string,
  rowId: string,
  payload: {
    values?: Record<string, unknown>;
    conflict_action?: 'update' | 'skip' | null;
  },
) {
  const response = await requestJson<{ data: { job_id: string; summary: TagImportSummary; row: TagImportRow } }>(
    `/api/projects/${projectId}/tag-imports/${jobId}/rows/${rowId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
  return response.data;
}

export async function commitProjectTagImport(
  projectId: string,
  jobId: string,
  conflictActions: TagImportConflictAction[],
) {
  const response = await requestJson<{ data: TagImportCommitResult }>(
    `/api/projects/${projectId}/tag-imports/${jobId}/commit`,
    {
      method: 'POST',
      body: JSON.stringify({ conflict_actions: conflictActions }),
    },
  );
  return response.data;
}

export async function createProjectTag(
  projectId: string,
  data: Omit<ProjectTag, 'id' | 'project_id' | 'created_at' | 'updated_at' | 'class_name'>
) {
  const response = await requestJson<{ data: ProjectTag }>(`/api/projects/${projectId}/tags`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return response.data;
}

export async function updateProjectTag(
  tagId: string,
  data: Partial<Omit<ProjectTag, 'id' | 'project_id' | 'created_at' | 'updated_at' | 'class_name'>>
) {
  const response = await requestJson<{ data: ProjectTag }>(`/api/tags/${tagId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return response.data;
}

export async function deleteProjectTag(tagId: string) {
  await requestJson<{ ok: boolean }>(`/api/tags/${tagId}`, {
    method: 'DELETE',
  });
}

export async function getProjectEquipmentClasses(projectId: string, tagId?: string) {
  const query = new URLSearchParams();
  if (tagId) query.set('tag_id', tagId);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await fetchJson<{ data: EquipmentClass[] }>(`/api/projects/${projectId}/equipment-classes${suffix}`);
  return response.data;
}

export async function getProjectEquipment(
  projectId: string,
  params?: { keyword?: string; class_id?: string; asset_status?: EquipmentAssetStatus },
) {
  const query = new URLSearchParams();
  if (params?.keyword) query.set('keyword', params.keyword);
  if (params?.class_id) query.set('class_id', params.class_id);
  if (params?.asset_status) query.set('asset_status', params.asset_status);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await fetchJson<{ data: ProjectEquipment[] }>(`/api/projects/${projectId}/equipment${suffix}`);
  return response.data;
}

export async function createProjectEquipment(projectId: string, payload: ProjectEquipmentCreatePayload) {
  const response = await requestJson<{ data: ProjectEquipment }>(`/api/projects/${projectId}/equipment`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function getTagEquipmentImplementation(projectId: string, tagId: string) {
  const response = await fetchJson<{ data: TagEquipmentImplementation }>(
    `/api/projects/${projectId}/tags/${tagId}/equipment-implementation`,
  );
  return response.data;
}

export async function assignEquipmentToTag(projectId: string, tagId: string, payload: TagEquipmentAssignmentPayload) {
  const response = await requestJson<{ data: TagEquipmentAssignment }>(
    `/api/projects/${projectId}/tags/${tagId}/equipment-assignments`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return response.data;
}

export async function getPbsNodes(projectId: string) {
  const response = await fetchJson<{ data: PbsNode[] }>(`/api/projects/${projectId}/pbs-nodes`);
  return response.data;
}

export async function createPbsNode(
  projectId: string,
  data: Omit<PbsNode, 'id' | 'project_id' | 'created_at' | 'updated_at'>
) {
  const response = await requestJson<{ data: PbsNode }>(`/api/projects/${projectId}/pbs-nodes`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return response.data;
}

export async function updatePbsNode(
  nodeId: string,
  data: Partial<Omit<PbsNode, 'id' | 'project_id' | 'created_at' | 'updated_at'>>
) {
  const response = await requestJson<{ data: PbsNode }>(`/api/pbs-nodes/${nodeId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return response.data;
}

// ── Document Types ──

export async function getDocumentTypes(standardId?: string) {
  const suffix = standardId ? `?${new URLSearchParams({ standard_id: standardId }).toString()}` : '';
  const response = await fetchJson<{ data: DocumentType[] }>(`/api/document-types${suffix}`);
  return response.data;
}

export async function getDocumentTypeDetail(documentTypeId: string) {
  const response = await fetchJson<{ data: DocumentTypeDetail }>(`/api/document-types/${documentTypeId}`);
  return response.data;
}

export async function getCommonDocumentTypeAttributes(standardId: string) {
  const suffix = `?${new URLSearchParams({ standard_id: standardId }).toString()}`;
  const response = await fetchJson<{ data: DocumentTypeAttribute[] }>(`/api/document-type-attributes/common${suffix}`);
  return response.data;
}

export async function createDocumentType(data: {
  standard_id: string;
  code: string;
  name: string;
  parent_id?: string | null;
  description?: string | null;
  status?: 'active' | 'archived';
  allowed_extensions?: string[];
  metadata?: Record<string, unknown>;
}) {
  const response = await requestJson<{ data: DocumentType }>('/api/document-types', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return response.data;
}

export async function updateDocumentType(
  documentTypeId: string,
  data: {
    standard_id: string;
    code: string;
    name: string;
    parent_id?: string | null;
    description?: string | null;
    status?: 'active' | 'archived';
    allowed_extensions?: string[];
    metadata?: Record<string, unknown>;
  },
) {
  const response = await requestJson<{ data: DocumentType }>(`/api/document-types/${documentTypeId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return response.data;
}

export async function createDocumentTypeAttribute(
  documentTypeId: string | null,
  data: {
    standard_id?: string;
    code: string;
    name: string;
    group_name?: string | null;
    value_type: AttributeValueType;
    is_required: boolean;
    unit_family?: string | null;
    enum_options?: string[];
    description?: string | null;
    status?: 'active' | 'archived';
  },
) {
  const path = documentTypeId
    ? `/api/document-types/${documentTypeId}/attributes`
    : '/api/document-type-attributes/common';
  const response = await requestJson<{ data: DocumentTypeAttribute }>(
    path,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
  return response.data;
}

export async function updateDocumentTypeAttribute(
  attributeId: string,
  data: {
    code: string;
    name: string;
    group_name?: string | null;
    value_type: AttributeValueType;
    is_required: boolean;
    unit_family?: string | null;
    enum_options?: string[];
    description?: string | null;
    status?: 'active' | 'archived';
  },
) {
  const response = await requestJson<{ data: DocumentTypeAttribute }>(`/api/document-type-attributes/${attributeId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return response.data;
}

export async function deleteDocumentTypeAttribute(attributeId: string) {
  const response = await requestJson<{ data: DocumentTypeAttribute }>(`/api/document-type-attributes/${attributeId}`, {
    method: 'DELETE',
  });
  return response.data;
}

export async function reorderDocumentTypeAttributes(documentTypeId: string, attributeIds: string[]) {
  const response = await requestJson<{ data: DocumentTypeAttribute[] }>(
    `/api/document-types/${documentTypeId}/attributes/order`,
    {
      method: 'PATCH',
      body: JSON.stringify({ attribute_ids: attributeIds }),
    },
  );
  return response.data;
}

export async function reorderCommonDocumentTypeAttributes(standardId: string, attributeIds: string[]) {
  const response = await requestJson<{ data: DocumentTypeAttribute[] }>(
    '/api/document-type-attributes/common/order',
    {
      method: 'PATCH',
      body: JSON.stringify({ standard_id: standardId, attribute_ids: attributeIds }),
    },
  );
  return response.data;
}

// ── Project Relations ──

export async function getProjectRelations(
  projectId: string,
  params?: {
    entity_kind?: EntityKind;
    entity_id?: string;
    relation_type?: string;
    source_kind?: EntityKind;
    target_kind?: EntityKind;
    direction?: 'outbound' | 'inbound' | 'both';
  },
) {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      query.set(key, String(value));
    }
  });
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await fetchJson<{ data: ProjectRelation[] }>(`/api/projects/${projectId}/relations${suffix}`);
  return response.data;
}

export async function createProjectRelation(
  projectId: string,
  data: {
    relation_type_code: string;
    source_kind: EntityKind;
    source_id: string;
    target_kind: EntityKind;
    target_id: string;
    sort_order?: number;
    note?: string | null;
    source_system?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const response = await requestJson<{ data: ProjectRelation }>(`/api/projects/${projectId}/relations`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return response.data;
}

export async function deleteProjectRelation(projectId: string, relationId: string) {
  await requestJson(`/api/projects/${projectId}/relations/${relationId}`, {
    method: 'DELETE',
  });
}

// ── Project Documents ──

export async function getProjectDocuments(
  projectId: string,
  params?: {
    keyword?: string;
    document_type_id?: string;
    discipline?: string;
    pbs_node_id?: string;
    tag_id?: string;
    status?: 'active' | 'archived';
    page?: number;
    page_size?: number;
  },
) {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      query.set(key, String(value));
    }
  });
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await fetchJson<{ data: ProjectDocumentListResult }>(`/api/projects/${projectId}/documents${suffix}`);
  return response.data;
}

export async function getProjectDocumentDetail(projectId: string, documentId: string) {
  const response = await fetchJson<{ data: ProjectDocumentDetail }>(`/api/projects/${projectId}/documents/${documentId}`);
  return response.data;
}

export async function createProjectDocument(
  projectId: string,
  data: {
    document_no: string;
    title: string;
    document_type_id?: string | null;
    discipline?: string | null;
    attributes?: Record<string, unknown>;
    pbs_node_ids?: string[];
    tag_ids?: string[];
    status?: 'active' | 'archived';
    metadata?: Record<string, unknown>;
  },
) {
  const response = await requestJson<{ data: ProjectDocumentDetail }>(`/api/projects/${projectId}/documents`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return response.data;
}

export async function updateProjectDocument(
  projectId: string,
  documentId: string,
  data: {
    document_no: string;
    title: string;
    document_type_id?: string | null;
    discipline?: string | null;
    attributes?: Record<string, unknown>;
    pbs_node_ids?: string[];
    tag_ids?: string[];
    status?: 'active' | 'archived';
    metadata?: Record<string, unknown>;
  },
) {
  const response = await requestJson<{ data: ProjectDocumentDetail }>(
    `/api/projects/${projectId}/documents/${documentId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
  );
  return response.data;
}

export async function deleteProjectDocument(projectId: string, documentId: string) {
  const response = await requestJson<{ data: ProjectDocumentListItem }>(
    `/api/projects/${projectId}/documents/${documentId}`,
    {
      method: 'DELETE',
    },
  );
  return response.data;
}

export async function createProjectDocumentRevision(
  projectId: string,
  documentId: string,
  data: {
    revision_no: string;
    state: 'draft' | 'issued' | 'void';
    issued_at?: string | null;
    change_summary?: string | null;
    set_as_current?: boolean;
  },
) {
  const response = await requestJson<{ data: ProjectDocumentRevision }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
  return response.data;
}

export async function updateProjectDocumentRevision(
  projectId: string,
  documentId: string,
  revisionId: string,
  data: {
    revision_no: string;
    state: 'draft' | 'issued' | 'void';
    issued_at?: string | null;
    change_summary?: string | null;
    set_as_current?: boolean;
  },
) {
  const response = await requestJson<{ data: ProjectDocumentRevision }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
  );
  return response.data;
}

export async function deleteProjectDocumentRevision(projectId: string, documentId: string, revisionId: string) {
  const response = await requestJson<{ data: ProjectDocumentRevision }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}`,
    {
      method: 'DELETE',
    },
  );
  return response.data;
}

export async function initiateProjectDocumentUpload(
  projectId: string,
  documentId: string,
  revisionId: string,
  data: {
    filename: string;
    file_role: 'primary' | 'source' | 'attachment' | 'reference';
    relative_path?: string | null;
    content_type?: string | null;
    size_bytes: number;
    checksum_sha256?: string | null;
  },
) {
  const response = await requestJson<{ data: ProjectDocumentFileUploadInit }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}/files/initiate`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
  return response.data;
}

export async function completeProjectDocumentUpload(
  projectId: string,
  documentId: string,
  revisionId: string,
  fileId: string,
  data: { etag?: string | null } = {},
) {
  const response = await requestJson<{ data: ProjectDocumentFile }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}/files/${fileId}/complete`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
  return response.data;
}

export async function getProjectDocumentFileAccessUrl(
  projectId: string,
  documentId: string,
  revisionId: string,
  fileId: string,
) {
  const response = await fetchJson<{ data: ProjectDocumentFileAccess }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}/files/${fileId}/access-url`,
  );
  return response.data;
}

export async function getDocumentVisualizations(projectId: string, documentId: string, revisionId: string) {
  const response = await fetchJson<{ data: DocumentVisualization[] }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}/visualizations`,
  );
  return response.data;
}

export async function createDocumentVisualization(
  projectId: string,
  documentId: string,
  revisionId: string,
  data: DocumentVisualizationCreatePayload,
) {
  const response = await requestJson<{ data: DocumentVisualization }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}/visualizations`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
  return response.data;
}

export async function getDocumentVisualizationAccess(
  projectId: string,
  documentId: string,
  revisionId: string,
  visualizationId: string,
) {
  const response = await fetchJson<{ data: DocumentVisualizationAccess }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}/visualizations/${visualizationId}/access`,
  );
  return response.data;
}

export async function getDocumentVisualizationObjects(
  projectId: string,
  documentId: string,
  revisionId: string,
  visualizationId: string,
) {
  const response = await fetchJson<{ data: DocumentVisualizationObject[] }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}/visualizations/${visualizationId}/objects`,
  );
  return response.data;
}

export async function getDocumentConversionJobs(projectId: string, documentId: string, revisionId: string) {
  const response = await fetchJson<{ data: DocumentConversionJob[] }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}/conversion-jobs`,
  );
  return response.data;
}

export async function createDocumentConversionJob(
  projectId: string,
  documentId: string,
  revisionId: string,
  fileId: string,
) {
  const response = await requestJson<{ data: DocumentConversionJob }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}/files/${fileId}/conversion-jobs`,
    {
      method: 'POST',
    },
  );
  return response.data;
}

export async function retryDocumentConversionJob(
  projectId: string,
  documentId: string,
  revisionId: string,
  jobId: string,
) {
  const response = await requestJson<{ data: DocumentConversionJob }>(
    `/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}/conversion-jobs/${jobId}/retry`,
    {
      method: 'POST',
    },
  );
  return response.data;
}

export async function analyzeProjectDocumentImport(
  projectId: string,
  data: {
    files: DocumentImportAnalyzeItem[];
    use_llm?: boolean;
  },
) {
  const response = await requestJson<{ data: DocumentImportAnalyzeResult }>(
    `/api/projects/${projectId}/document-imports/analyze`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
  return response.data;
}

// ── PBS Level Template ──

export async function getPbsLevels(standardId: string) {
  const response = await fetchJson<{ data: PbsLevelTemplate[] }>(`/api/standards/${standardId}/pbs-levels`);
  return response.data;
}

export async function createPbsLevel(
  standardId: string,
  data: { level_no: number; code: string; name: string; description?: string }
) {
  const response = await requestJson<{ data: PbsLevelTemplate }>(`/api/standards/${standardId}/pbs-levels`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return response.data;
}

export async function updatePbsLevel(
  levelId: string,
  data: { code: string; name: string; description?: string }
) {
  const response = await requestJson<{ data: PbsLevelTemplate }>(`/api/pbs-levels/${levelId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return response.data;
}

export async function deletePbsLevel(levelId: string) {
  await requestJson(`/api/pbs-levels/${levelId}`, { method: 'DELETE' });
}

export type PermissionCode = string;

export interface AuthRoleSummary {
  id: string;
  code: string;
  name: string;
  scope_kind: 'system' | 'standard' | 'project';
  is_builtin: boolean;
  status: 'active' | 'archived';
  permissions: PermissionCode[];
}

export interface AuthUserSummary {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  status: 'active' | 'disabled';
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  role_codes?: string[];
  role_names?: string[];
}

export interface AuthMeResult {
  user: AuthUserSummary;
  system_permissions: PermissionCode[];
  project_permissions: Record<string, PermissionCode[]>;
  standard_permissions: Record<string, PermissionCode[]>;
  roles: AuthRoleSummary[];
}

export interface PluginRouteContribution {
  path: string;
  element: string;
  permissions?: PermissionCode[];
  requireAny?: boolean;
}

export interface PluginNavigationContribution {
  sectionLabelKey: string;
  icon?: string;
  labelKey: string;
  to: string;
  permissions?: PermissionCode[];
  requireAny?: boolean;
}

export interface PluginSlotContribution {
  slot: string;
  icon?: string;
  label: string;
  title?: string;
  to: string;
  permissions?: PermissionCode[];
  requireAny?: boolean;
}

export interface PluginPermissionContribution {
  code: PermissionCode;
  scope_kind: 'system' | 'standard' | 'project';
  resource: string;
  action: string;
  description?: string;
}

export interface PluginDatabaseContribution {
  schemas?: string[];
}

export interface PluginModuleMetadata {
  type?: string;
  purpose?: string;
}

export interface EnabledPluginManifest {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  version: string;
  entry: string;
  routes: PluginRouteContribution[];
  navigation: PluginNavigationContribution[];
  slots: PluginSlotContribution[];
}

export interface PluginManifestMetadata {
  id?: string;
  name?: string;
  description?: string;
  icon?: string;
  version?: string;
  module?: PluginModuleMetadata;
  frontend?: {
    entry?: string;
    routes?: PluginRouteContribution[];
    navigation?: PluginNavigationContribution[];
    slots?: PluginSlotContribution[];
  };
  backend?: {
    entry?: string;
    api_prefix?: string;
  };
  permissions?: PluginPermissionContribution[];
  database?: PluginDatabaseContribution;
  dependencies?: Array<{ plugin?: string; version?: string }>;
  default_role_grants?: Record<string, PermissionCode[]>;
}

export interface EnabledPluginManifestResult {
  plugins: EnabledPluginManifest[];
}

export interface PluginSummary {
  plugin_id: string;
  package_version: string;
  filename: string;
  checksum: string;
  uploaded_at: string;
  installed_version: string | null;
  status: 'uploaded' | 'disabled' | 'enabled' | 'failed' | 'uninstalled' | 'purged';
  enabled_at: string | null;
  disabled_at: string | null;
  error_message: string | null;
  manifest: PluginManifestMetadata & Record<string, unknown>;
  capabilities: Array<Record<string, unknown>>;
}

export interface BootstrapStatusResult {
  needs_bootstrap: boolean;
}

export interface UserCreatePayload {
  username: string;
  email?: string | null;
  display_name: string;
  password: string;
  status?: 'active' | 'disabled';
}

export interface UserUpdatePayload {
  email?: string | null;
  display_name?: string | null;
  password?: string | null;
  status?: 'active' | 'disabled';
}

export interface UserImportIssue {
  code: string;
  field: 'username' | 'display_name' | 'email' | 'status' | 'password' | 'system_role_codes' | 'row' | string;
  message: string;
  severity: 'error' | 'warning';
}

export interface UserImportRow {
  id: string;
  row_number: number;
  action: 'create' | 'update' | 'skip';
  status: 'ready' | 'error' | 'warning';
  values: {
    username: string;
    display_name: string;
    email: string | null;
    status: 'active' | 'disabled' | string;
    password: string;
    system_role_codes: string;
  };
  normalized_values: {
    username: string;
    display_name: string;
    email: string | null;
    status: 'active' | 'disabled' | string;
    password_supplied: boolean;
    system_role_codes: string[];
  };
  issues: UserImportIssue[];
  existing_user: {
    id: string;
    username: string;
    email: string | null;
    display_name: string;
    status: 'active' | 'disabled';
    role_codes?: string[];
    role_names?: string[];
  } | null;
}

export interface UserImportSummary {
  total_rows: number;
  create_rows: number;
  update_rows: number;
  skip_rows: number;
  ready_rows: number;
  error_rows: number;
  warning_rows: number;
  can_commit: boolean;
}

export interface UserImportJob {
  job_id: string;
  filename: string;
  summary: UserImportSummary;
  rows: UserImportRow[];
  page: number;
  page_size: number;
  total_pages: number;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  committed_at: string | null;
}

export interface UserImportCommitResult {
  job_id: string;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  failures: Array<{ row_id?: string; message: string }>;
  password_change_count?: number;
  disabled_count?: number;
}

export interface ProjectMemberSummary {
  user: AuthUserSummary;
  project_id: string;
  role_codes: string[];
  role_names: string[];
}

export async function getBootstrapStatus() {
  const response = await fetchJson<{ data: BootstrapStatusResult }>('/api/auth/bootstrap/status');
  return response.data;
}

export async function bootstrapAdmin(payload: UserCreatePayload) {
  const response = await requestJson<{ data: AuthUserSummary }>('/api/auth/bootstrap/admin', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function login(payload: { username: string; password: string }) {
  const response = await requestJson<{ data: AuthMeResult }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function logout() {
  await requestJson('/api/auth/logout', {
    method: 'POST',
  });
}

export async function getCurrentUser() {
  const response = await fetchJson<{ data: AuthMeResult }>('/api/auth/me');
  return response.data;
}

export async function getEnabledPluginManifest() {
  const response = await fetchJson<{ data: EnabledPluginManifestResult }>('/api/plugins/enabled-manifest');
  return response.data;
}

export async function listPlugins() {
  const response = await fetchJson<{ data: PluginSummary[] }>('/api/plugins');
  return response.data;
}

export async function uploadPluginPackage(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_BASE_URL}/api/plugins/packages`, {
    method: 'POST',
    credentials: 'include',
    headers: localeHeaders(),
    body: formData,
  });
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return (await response.json() as { data: Record<string, unknown> }).data;
}

export async function installPlugin(pluginId: string) {
  const response = await requestJson<{ data: Record<string, unknown> }>(`/api/plugins/${pluginId}/install`, { method: 'POST' });
  return response.data;
}

export async function enablePlugin(pluginId: string) {
  const response = await requestJson<{ data: Record<string, unknown> }>(`/api/plugins/${pluginId}/enable`, { method: 'POST' });
  return response.data;
}

export async function disablePlugin(pluginId: string) {
  const response = await requestJson<{ data: Record<string, unknown> }>(`/api/plugins/${pluginId}/disable`, { method: 'POST' });
  return response.data;
}

export async function uninstallPlugin(pluginId: string) {
  const response = await requestJson<{ data: Record<string, unknown> }>(`/api/plugins/${pluginId}/uninstall`, { method: 'POST' });
  return response.data;
}

export async function purgePlugin(pluginId: string) {
  const response = await requestJson<{ data: Record<string, unknown> }>(`/api/plugins/${pluginId}/purge`, { method: 'POST' });
  return response.data;
}

export async function listUsers() {
  const response = await fetchJson<{ data: AuthUserSummary[] }>('/api/auth/users');
  return response.data;
}

export async function createUser(payload: UserCreatePayload) {
  const response = await requestJson<{ data: AuthUserSummary }>('/api/auth/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateUser(userId: string, payload: UserUpdatePayload) {
  const response = await requestJson<{ data: AuthUserSummary }>(`/api/auth/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateUserSystemRoles(userId: string, roleCodes: string[]) {
  const response = await requestJson<{ data: { user_id: string; role_codes: string[] } }>(
    `/api/auth/users/${userId}/system-roles`,
    {
      method: 'PUT',
      body: JSON.stringify({ role_codes: roleCodes }),
    },
  );
  return response.data;
}

export async function downloadUserImportTemplate() {
  return fetchBlob('/api/auth/users/import-template');
}

export async function downloadUsersExport() {
  return fetchBlob('/api/auth/users/export');
}

export async function validateUserImport(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await requestFormData<{ data: UserImportJob }>('/api/auth/users/imports/validate', {
    method: 'POST',
    body: formData,
  });
  return response.data;
}

export async function getUserImportJob(
  jobId: string,
  params?: { status?: 'ready' | 'error' | 'warning' | 'create' | 'update' | 'skip'; page?: number; page_size?: number },
) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.page_size) query.set('page_size', String(params.page_size));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await fetchJson<{ data: UserImportJob }>(`/api/auth/users/imports/${jobId}${suffix}`);
  return response.data;
}

export async function patchUserImportRow(
  jobId: string,
  rowId: string,
  payload: { values: Partial<UserImportRow['values']> },
) {
  const response = await requestJson<{ data: { job_id: string; summary: UserImportSummary; row: UserImportRow } }>(
    `/api/auth/users/imports/${jobId}/rows/${rowId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
  return response.data;
}

export async function commitUserImport(jobId: string) {
  const response = await requestJson<{ data: UserImportCommitResult }>(
    `/api/auth/users/imports/${jobId}/commit`,
    {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    },
  );
  return response.data;
}

export async function listRoles() {
  const response = await fetchJson<{ data: AuthRoleSummary[] }>('/api/auth/roles');
  return response.data;
}

export async function listProjectMembers(projectId: string) {
  const response = await fetchJson<{ data: ProjectMemberSummary[] }>(`/api/projects/${projectId}/members`);
  return response.data;
}

export async function listProjectMemberCandidates(projectId: string) {
  const response = await fetchJson<{ data: AuthUserSummary[] }>(`/api/projects/${projectId}/members/candidates`);
  return response.data;
}

export async function listProjectMemberRoles(projectId: string) {
  const response = await fetchJson<{ data: AuthRoleSummary[] }>(`/api/projects/${projectId}/members/roles`);
  return response.data;
}

export async function updateProjectMemberRoles(projectId: string, userId: string, roleCodes: string[]) {
  const response = await requestJson<{ data: ProjectMemberSummary[] }>(
    `/api/projects/${projectId}/members/${userId}`,
    {
      method: 'PUT',
      body: JSON.stringify({ role_codes: roleCodes }),
    },
  );
  return response.data;
}

export async function removeProjectMember(projectId: string, userId: string) {
  await requestJson(`/api/projects/${projectId}/members/${userId}`, {
    method: 'DELETE',
  });
}

