import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Expand, ExternalLink, Eye, EyeOff, Gauge, Loader2, LocateFixed, RefreshCw, X } from 'lucide-react';
import * as THREE from 'three';
import { isMobile, SparkControls, SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import {
  applySparkNavigationConstraint,
  createSparkNavigationState,
  moveCameraToSparkNavigationTarget,
  previewSparkNavigationTarget,
  resetSparkNavigationState,
  resolveSparkNavigationConfig,
  seedSparkNavigationStateFromCamera,
  type SparkNavigationConfig,
  type SparkNavigationState,
} from './sparkNavigation';
import type { DocumentVisualizationObject, DocumentVisualizationPrimitive } from '../../lib/api';

type AnnotationTargetKind = 'document' | 'tag' | 'pbs_node';

export interface SparkAnnotation {
  id: string;
  label: string;
  position: [number, number, number];
  target_kind?: AnnotationTargetKind;
  target_id?: string;
  source_object_id?: string | null;
}

interface SparkDocumentViewerProps {
  previewUrl: string;
  sourceUrl: string;
  sourceFileName: string;
  previewFileName: string;
  externalUrl?: string;
  annotationManifestUrl?: string | null;
  metadata?: Record<string, unknown>;
  assetMode?: 'spark_native' | 'rad_single' | 'rad_chunked';
  semanticObjects?: DocumentVisualizationObject[];
  onRefresh: () => void;
  onClose?: () => void;
  onAnnotationSelect?: (annotation: SparkAnnotation) => void;
}

type QualityPreset = 'smooth' | 'balanced' | 'detailed';

interface MarkerPosition {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

interface DefaultCamera {
  position: [number, number, number];
  target: [number, number, number];
}

type VectorTuple = [number, number, number];
type QuaternionTuple = [number, number, number, number];

interface SparkViewerConfig {
  cameraPosition?: VectorTuple;
  cameraQuaternion?: QuaternionTuple;
  cameraTarget?: VectorTuple;
  splatPosition?: VectorTuple;
  splatQuaternion?: QuaternionTuple;
  splatScale?: number;
  background?: string;
  lodSplatScale?: number;
  highDpi?: boolean | 'non_mobile';
  navigation: SparkNavigationConfig;
}

type SparkViewerConfigOverrides = Partial<Omit<SparkViewerConfig, 'navigation'>>;

interface RuntimeViewer {
  camera: THREE.PerspectiveCamera;
  controls: SparkControls;
  splat: SplatMesh;
  renderer: SparkRenderer;
  navigationState: SparkNavigationState;
}

interface WalkTargetIndicator {
  root: THREE.Group;
  rings: THREE.Group;
  materials: THREE.MeshBasicMaterial[];
  geometries: THREE.BufferGeometry[];
  activatedAt: number;
}

interface SemanticPickResult {
  object: DocumentVisualizationObject;
  distance: number;
  score: number;
}

const SPARK_VIEWER_LOG_PREFIX = '[SparkViewer]';
const DEFAULT_SPARK_BACKGROUND = '#f8fafc';
const DEFAULT_SPARK_MESH_QUATERNION: QuaternionTuple = [1, 0, 0, 0];
const MIN_FOCUS_DISTANCE = 0.35;
const WALK_TARGET_PREVIEW_INTERVAL_MS = 45;
const WALK_TARGET_Z_AXIS = new THREE.Vector3(0, 0, 1);
const WALK_TARGET_UP_VECTORS: Record<SparkNavigationConfig['upAxis'], THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const SPARK_FLOATING_BUTTON_CLASS =
  'inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-slate-950/55 text-white/85 shadow-lg shadow-slate-950/25 backdrop-blur-md ring-1 ring-white/5 transition hover:-translate-y-0.5 hover:border-cyan-200/35 hover:bg-white/15 hover:text-white active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-cyan-200/70';
const SPARK_TOOLBAR_CLASS =
  'pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-full border border-white/10 bg-slate-950/35 p-1.5 shadow-2xl shadow-slate-950/25 backdrop-blur-xl ring-1 ring-white/5';

const QUALITY_PRESETS: Record<QualityPreset, {
  label: string;
  lodSplatScale: number;
  lodRenderScale: number;
  pixelRatioScale: number;
  minSortIntervalMs: number;
}> = {
  smooth: {
    label: '流畅',
    lodSplatScale: 0.65,
    lodRenderScale: 1.8,
    pixelRatioScale: 0.75,
    minSortIntervalMs: 80,
  },
  balanced: {
    label: '均衡',
    lodSplatScale: 1,
    lodRenderScale: 1,
    pixelRatioScale: 1,
    minSortIntervalMs: 32,
  },
  detailed: {
    label: '精细',
    lodSplatScale: 1.6,
    lodRenderScale: 0.75,
    pixelRatioScale: 1,
    minSortIntervalMs: 0,
  },
};

const OFFICIAL_STREAMING_LOD_PRESETS: Record<string, SparkViewerConfigOverrides> = {
  'tijerin_w6_hobbiton-lod.rad': {
    splatQuaternion: [1, 0, 0, 0],
    background: '#cafefe',
  },
  'cozy-spaceship_2-lod.rad': {
    splatPosition: [0, -6.5, 0],
    background: '#000000',
  },
  'coit-40m-sh1-lod.rad': {
    splatQuaternion: [1, 0, 0, 0],
    splatScale: 10,
    cameraPosition: [-0.858, 2.203, -1.128],
    cameraQuaternion: [-0.043, -0.909, -0.097, 0.402],
    background: '#cafefe',
    lodSplatScale: 1.5,
    highDpi: 'non_mobile',
  },
  'poland-lod.rad': {
    splatQuaternion: [1, 0, 0, 0],
    splatScale: 0.05,
    cameraPosition: [43.7, -3.5, -1.7],
    cameraQuaternion: [-0.23, 0.241, 0.006, 0.943],
    background: '#cafefe',
    highDpi: 'non_mobile',
  },
};

function roundNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : value;
}

function vectorToTuple(vector: THREE.Vector3): [number, number, number] {
  return [roundNumber(vector.x), roundNumber(vector.y), roundNumber(vector.z)];
}

function normalizePosition(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const coords = value.slice(0, 3).map((item) => Number(item));
  if (coords.some((item) => !Number.isFinite(item))) return null;
  return [coords[0], coords[1], coords[2]];
}

function normalizeQuaternion(value: unknown): QuaternionTuple | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const coords = value.slice(0, 4).map((item) => Number(item));
  if (coords.some((item) => !Number.isFinite(item))) return null;
  return [coords[0], coords[1], coords[2], coords[3]];
}

function normalizeFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAnnotation(value: unknown, index: number): SparkAnnotation | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const position = normalizePosition(record.position ?? record.world_position ?? record.xyz);
  if (!position) return null;
  const targetKind = typeof record.target_kind === 'string' ? record.target_kind : undefined;
  const normalizedTargetKind =
    targetKind === 'document' || targetKind === 'tag' || targetKind === 'pbs_node' ? targetKind : undefined;
  const targetId = typeof record.target_id === 'string' && record.target_id.trim() ? record.target_id.trim() : undefined;
  const label =
    typeof record.label === 'string' && record.label.trim()
      ? record.label.trim()
      : typeof record.name === 'string' && record.name.trim()
        ? record.name.trim()
        : targetId ?? `标注 ${index + 1}`;

  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `${index}`,
    label,
    position,
    target_kind: normalizedTargetKind,
    target_id: targetId,
    source_object_id: typeof record.source_object_id === 'string' ? record.source_object_id : null,
  };
}

function extractAnnotations(payload: unknown) {
  const rawItems = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { annotations?: unknown[] }).annotations)
      ? (payload as { annotations: unknown[] }).annotations
      : [];
  return rawItems
    .map((item, index) => normalizeAnnotation(item, index))
    .filter((item): item is SparkAnnotation => item !== null);
}

function resolveDefaultCamera(metadata?: Record<string, unknown>): DefaultCamera | null {
  const camera = metadata?.default_camera;
  if (!camera || typeof camera !== 'object') return null;
  const record = camera as Record<string, unknown>;
  const position = normalizePosition(record.position);
  const target = normalizePosition(record.target);
  if (!position || !target) return null;
  return { position, target };
}

function basename(value: string) {
  const withoutQuery = value.split('?')[0] ?? value;
  const parts = withoutQuery.replace(/\\/g, '/').split('/');
  return (parts[parts.length - 1] ?? withoutQuery).toLowerCase();
}

function firstRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

function valueByAliases(record: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    if (record[alias] !== undefined) return record[alias];
  }
  return undefined;
}

function resolveOfficialStreamingLodPreset(...candidates: string[]): SparkViewerConfigOverrides {
  for (const candidate of candidates) {
    const preset = OFFICIAL_STREAMING_LOD_PRESETS[basename(candidate)];
    if (preset) return preset;
  }
  return {};
}

function normalizeViewerConfigRecord(record: Record<string, unknown>): SparkViewerConfigOverrides {
  const cameraPosition = normalizePosition(valueByAliases(record, ['cameraPosition', 'camera_position']));
  const cameraQuaternion = normalizeQuaternion(valueByAliases(record, ['cameraQuaternion', 'camera_quaternion']));
  const cameraTarget = normalizePosition(valueByAliases(record, ['cameraTarget', 'camera_target', 'target']));
  const splatPosition = normalizePosition(valueByAliases(record, ['splatPosition', 'splat_position', 'meshPosition', 'mesh_position', 'position']));
  const splatQuaternion = normalizeQuaternion(valueByAliases(record, ['splatQuaternion', 'splat_quaternion', 'meshQuaternion', 'mesh_quaternion', 'quaternion']));
  const splatScale = normalizeFiniteNumber(valueByAliases(record, ['splatScale', 'splat_scale', 'meshScale', 'mesh_scale', 'scale']));
  const lodSplatScale = normalizeFiniteNumber(valueByAliases(record, ['lodSplatScale', 'lod_splat_scale']));
  const backgroundValue = valueByAliases(record, ['background', 'backgroundColor', 'background_color']);
  const highDpiValue = valueByAliases(record, ['highDpi', 'high_dpi']);
  const highDpi =
    highDpiValue === 'non_mobile' || highDpiValue === 'non-mobile'
      ? 'non_mobile'
      : typeof highDpiValue === 'boolean'
        ? highDpiValue
        : undefined;

  return {
    ...(cameraPosition ? { cameraPosition } : {}),
    ...(cameraQuaternion ? { cameraQuaternion } : {}),
    ...(cameraTarget ? { cameraTarget } : {}),
    ...(splatPosition ? { splatPosition } : {}),
    ...(splatQuaternion ? { splatQuaternion } : {}),
    ...(splatScale !== null ? { splatScale } : {}),
    ...(lodSplatScale !== null ? { lodSplatScale } : {}),
    ...(typeof backgroundValue === 'string' && backgroundValue.trim() ? { background: backgroundValue.trim() } : {}),
    ...(highDpi !== undefined ? { highDpi } : {}),
  };
}

function resolveMetadataViewerConfig(metadata?: Record<string, unknown>): SparkViewerConfigOverrides {
  if (!metadata) return {};
  const defaultCamera = resolveDefaultCamera(metadata);
  const nestedRecord = firstRecord(metadata.spark_viewer, metadata.sparkViewer, metadata.streaming_lod, metadata.streamingLod, metadata.viewer);
  const nestedConfig = nestedRecord ? normalizeViewerConfigRecord(nestedRecord) : {};
  const rootConfig = normalizeViewerConfigRecord(metadata);

  return {
    ...(defaultCamera ? { cameraPosition: defaultCamera.position, cameraTarget: defaultCamera.target } : {}),
    ...rootConfig,
    ...nestedConfig,
  };
}

function resolveViewerConfig(
  previewFileName: string,
  sourceFileName: string,
  previewUrl: string,
  metadata?: Record<string, unknown>,
): SparkViewerConfig {
  return {
    ...resolveOfficialStreamingLodPreset(previewFileName, sourceFileName, previewUrl),
    ...resolveMetadataViewerConfig(metadata),
    navigation: resolveSparkNavigationConfig(metadata),
  };
}

function isRadAsset(fileName: string, assetMode: SparkDocumentViewerProps['assetMode']) {
  return fileName.toLowerCase().endsWith('.rad') || assetMode === 'rad_single' || assetMode === 'rad_chunked';
}

function applyCamera(camera: THREE.PerspectiveCamera, viewerConfig: SparkViewerConfig) {
  if (viewerConfig.cameraPosition && viewerConfig.cameraQuaternion) {
    camera.position.set(...viewerConfig.cameraPosition);
    camera.quaternion.set(...viewerConfig.cameraQuaternion).normalize();
    camera.updateProjectionMatrix();
    return;
  }

  if (viewerConfig.cameraPosition && viewerConfig.cameraTarget) {
    camera.position.set(...viewerConfig.cameraPosition);
    camera.lookAt(new THREE.Vector3(...viewerConfig.cameraTarget));
    camera.updateProjectionMatrix();
    return;
  }

  camera.position.set(0, 0, 1);
  camera.quaternion.set(0, 0, 0, 1);
  camera.updateProjectionMatrix();
}

function applySplatTransform(splat: SplatMesh, viewerConfig: SparkViewerConfig) {
  const splatQuaternion = viewerConfig.splatQuaternion ?? DEFAULT_SPARK_MESH_QUATERNION;
  splat.quaternion.set(...splatQuaternion).normalize();
  splat.position.set(...(viewerConfig.splatPosition ?? [0, 0, 0]));
  splat.scale.setScalar(viewerConfig.splatScale ?? 1);
}

function applySceneBackground(scene: THREE.Scene, viewerConfig: SparkViewerConfig) {
  try {
    scene.background = new THREE.Color(viewerConfig.background ?? DEFAULT_SPARK_BACKGROUND);
  } catch (error) {
    console.warn(`${SPARK_VIEWER_LOG_PREFIX} invalid background color`, error);
    scene.background = new THREE.Color(DEFAULT_SPARK_BACKGROUND);
  }
}

function resolvePixelRatio(viewerConfig: SparkViewerConfig, qualityPreset: QualityPreset) {
  const quality = QUALITY_PRESETS[qualityPreset];
  const maxRatio = Math.max(1, window.devicePixelRatio * quality.pixelRatioScale);
  if (viewerConfig.highDpi === 'non_mobile') {
    return isMobile() ? 1 : maxRatio;
  }
  return viewerConfig.highDpi ? maxRatio : Math.min(1, maxRatio);
}

function createWalkTargetIndicator(upAxis: SparkNavigationConfig['upAxis']): WalkTargetIndicator {
  const root = new THREE.Group();
  const rings = new THREE.Group();
  const materials: THREE.MeshBasicMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const up = WALK_TARGET_UP_VECTORS[upAxis];
  root.visible = false;
  root.renderOrder = 999;
  root.quaternion.setFromUnitVectors(WALK_TARGET_Z_AXIS, up);
  root.add(rings);

  const ringSpecs = [
    { innerRadius: 0.055, outerRadius: 0.07, opacity: 0.9, color: 0xffffff },
    { innerRadius: 0.16, outerRadius: 0.19, opacity: 0.58, color: 0xffffff },
    { innerRadius: 0.245, outerRadius: 0.31, opacity: 0.22, color: 0x7dd3fc },
  ];

  for (const spec of ringSpecs) {
    const geometry = new THREE.RingGeometry(spec.innerRadius, spec.outerRadius, 128);
    const material = new THREE.MeshBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: spec.opacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 999;
    rings.add(mesh);
    geometries.push(geometry);
    materials.push(material);
  }

  const tickGeometry = new THREE.PlaneGeometry(0.09, 0.018);
  const tickMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const tickRadius = 0.34;
  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI * 0.5;
    const tick = new THREE.Mesh(tickGeometry, tickMaterial);
    tick.position.set(Math.cos(angle) * tickRadius, Math.sin(angle) * tickRadius, 0.001);
    tick.rotation.z = angle;
    tick.renderOrder = 999;
    rings.add(tick);
  }
  geometries.push(tickGeometry);
  materials.push(tickMaterial);

  return { root, rings, materials, geometries, activatedAt: 0 };
}

function showWalkTargetIndicator(
  indicator: WalkTargetIndicator,
  position: THREE.Vector3,
  upAxis: SparkNavigationConfig['upAxis'],
) {
  const up = WALK_TARGET_UP_VECTORS[upAxis];
  indicator.root.position.copy(position).addScaledVector(up, 0.035);
  indicator.root.quaternion.setFromUnitVectors(WALK_TARGET_Z_AXIS, up);
  if (!indicator.root.visible) {
    indicator.root.scale.setScalar(1);
    indicator.rings.rotation.z = 0;
    indicator.activatedAt = performance.now();
  }
  indicator.root.visible = true;
}

function hideWalkTargetIndicator(indicator: WalkTargetIndicator | null) {
  if (indicator) indicator.root.visible = false;
}

function updateWalkTargetIndicator(indicator: WalkTargetIndicator) {
  if (!indicator.root.visible) return;
  const ageSeconds = (performance.now() - indicator.activatedAt) / 1000;
  const pulse = 0.5 + Math.sin(ageSeconds * 8) * 0.5;
  indicator.root.scale.setScalar(1 + pulse * 0.055);
  indicator.rings.rotation.z = ageSeconds * 0.72;
  if (indicator.materials[0]) indicator.materials[0].opacity = 0.78 + pulse * 0.2;
  if (indicator.materials[1]) indicator.materials[1].opacity = 0.46 + pulse * 0.16;
  if (indicator.materials[2]) indicator.materials[2].opacity = 0.14 + pulse * 0.14;
  if (indicator.materials[3]) indicator.materials[3].opacity = 0.56 + pulse * 0.22;
}

function disposeWalkTargetIndicator(indicator: WalkTargetIndicator) {
  indicator.geometries.forEach((geometry) => geometry.dispose());
  indicator.materials.forEach((material) => material.dispose());
}

function formatCoordinate(position: THREE.Vector3 | VectorTuple) {
  const tuple = Array.isArray(position) ? position : vectorToTuple(position);
  return tuple.map((value) => value.toFixed(3)).join(', ');
}

function finiteMetadataNumber(record: Record<string, unknown>, key: string, fallback: number, min: number, max: number) {
  const value = Number(record[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function vectorFromTuple(value: unknown): THREE.Vector3 | null {
  const tuple = normalizePosition(value);
  return tuple ? new THREE.Vector3(...tuple) : null;
}

function quaternionFromTuple(value: unknown): THREE.Quaternion | null {
  const tuple = normalizeQuaternion(value);
  return tuple ? new THREE.Quaternion(...tuple).normalize() : null;
}

function isSemanticPrimitive(value: unknown): value is DocumentVisualizationPrimitive {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string');
}

function pointInSemanticSpace(hitPoint: THREE.Vector3, object: DocumentVisualizationObject, splat: SplatMesh) {
  if (object.coordinate_space === 'splat_local') {
    splat.updateMatrixWorld();
    return splat.worldToLocal(hitPoint.clone());
  }
  return hitPoint.clone();
}

function pointDistanceToBox(point: THREE.Vector3, primitive: DocumentVisualizationPrimitive, margin: number) {
  const center = vectorFromTuple(primitive.center);
  const size = vectorFromTuple(primitive.size);
  if (!center || !size) return null;
  const localPoint = point.clone().sub(center);
  const quaternion = quaternionFromTuple(primitive.quaternion);
  if (quaternion) localPoint.applyQuaternion(quaternion.invert());
  const dx = Math.max(Math.abs(localPoint.x) - size.x / 2, 0);
  const dy = Math.max(Math.abs(localPoint.y) - size.y / 2, 0);
  const dz = Math.max(Math.abs(localPoint.z) - size.z / 2, 0);
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return distance <= margin ? distance : null;
}

function pointDistanceToSphere(point: THREE.Vector3, primitive: DocumentVisualizationPrimitive, margin: number) {
  const center = vectorFromTuple(primitive.center);
  const radius = Number(primitive.radius);
  if (!center || !Number.isFinite(radius) || radius <= 0) return null;
  const distance = Math.max(0, point.distanceTo(center) - radius);
  return distance <= margin ? distance : null;
}

function pointDistanceToVerticalPrimitive(point: THREE.Vector3, primitive: DocumentVisualizationPrimitive, margin: number) {
  const center = vectorFromTuple(primitive.center);
  const radius = Number(primitive.radius);
  const height = Number(primitive.height);
  if (!center || !Number.isFinite(radius) || !Number.isFinite(height) || radius <= 0 || height <= 0) return null;
  const localPoint = point.clone().sub(center);
  const quaternion = quaternionFromTuple(primitive.quaternion);
  if (quaternion) localPoint.applyQuaternion(quaternion.invert());
  const halfHeight = height / 2;
  if (primitive.type === 'capsule') {
    const clampedY = Math.max(-halfHeight, Math.min(halfHeight, localPoint.y));
    const closest = new THREE.Vector3(0, clampedY, 0);
    const distance = Math.max(0, localPoint.distanceTo(closest) - radius);
    return distance <= margin ? distance : null;
  }
  const radialDistance = Math.sqrt(localPoint.x * localPoint.x + localPoint.z * localPoint.z);
  const radialOverflow = Math.max(0, radialDistance - radius);
  const heightOverflow = Math.max(0, Math.abs(localPoint.y) - halfHeight);
  const distance = Math.sqrt(radialOverflow * radialOverflow + heightOverflow * heightOverflow);
  return distance <= margin ? distance : null;
}

function pointDistanceToPrimitive(point: THREE.Vector3, primitive: DocumentVisualizationPrimitive, margin: number) {
  if (primitive.type === 'box') return pointDistanceToBox(point, primitive, margin);
  if (primitive.type === 'sphere') return pointDistanceToSphere(point, primitive, margin);
  if (primitive.type === 'capsule' || primitive.type === 'cylinder') {
    return pointDistanceToVerticalPrimitive(point, primitive, margin);
  }
  return null;
}

function pickSemanticObjectAtPoint(
  hitPoint: THREE.Vector3,
  semanticObjects: DocumentVisualizationObject[],
  splat: SplatMesh,
): SemanticPickResult | null {
  const candidates: SemanticPickResult[] = [];
  for (const object of semanticObjects) {
    if (!object.visible || !object.selectable) continue;
    const localPoint = pointInSemanticSpace(hitPoint, object, splat);
    const margin = finiteMetadataNumber(object.metadata, 'pick_margin', 0.12, 0, 3);
    const primitive = isSemanticPrimitive(object.primitive) ? object.primitive : null;
    const anchor = vectorFromTuple(object.anchor_position);
    let distance: number | null = null;
    let resolverWeight = 1;

    if (primitive && (object.resolver_type === 'primitive' || object.resolver_type === 'bbox' || object.resolver_type === 'mesh')) {
      distance = pointDistanceToPrimitive(localPoint, primitive, margin);
      resolverWeight = 0;
    }
    if (distance === null && anchor) {
      const radius = finiteMetadataNumber(object.metadata, 'pick_radius', 0.65, 0.05, 8);
      const anchorDistance = localPoint.distanceTo(anchor);
      if (anchorDistance <= radius) {
        distance = anchorDistance;
        resolverWeight = 1;
      }
    }
    if (distance === null) continue;

    candidates.push({
      object,
      distance,
      score: distance + resolverWeight * 0.05 - object.priority * 0.001,
    });
  }

  candidates.sort((left, right) => {
    if (right.object.priority !== left.object.priority) return right.object.priority - left.object.priority;
    return left.score - right.score;
  });
  return candidates[0] ?? null;
}

function semanticKindLabel(kind: DocumentVisualizationObject['target_kind']) {
  return {
    tag: 'TAG',
    equipment: '设备',
    document: '文档',
    pbs_node: 'PBS',
    custom: '自定义',
  }[kind];
}

function formatAttributeValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '未填写';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function semanticSummaryRows(object: DocumentVisualizationObject) {
  const summary = object.target_summary;
  const rows: Array<[string, unknown]> = [
    ['类型', semanticKindLabel(object.target_kind)],
    ['编号', summary?.code ?? object.target_id],
    ['名称', summary?.name ?? object.label],
  ];
  if (summary?.class_name || summary?.class_code) rows.push(['分类', [summary.class_code, summary.class_name].filter(Boolean).join(' / ')]);
  if (summary?.pbs_node_name || summary?.pbs_node_code) rows.push(['PBS', [summary.pbs_node_code, summary.pbs_node_name].filter(Boolean).join(' / ')]);
  if (summary?.status) rows.push(['状态', summary.status]);
  if (summary?.manufacturer) rows.push(['制造商', summary.manufacturer]);
  if (summary?.model) rows.push(['型号', summary.model]);
  if (summary?.serial_no) rows.push(['序列号', summary.serial_no]);
  return rows;
}

function semanticAttributeRows(object: DocumentVisualizationObject) {
  const attributeItems = object.target_summary?.attribute_items;
  if (Array.isArray(attributeItems) && attributeItems.length > 0) {
    return attributeItems
      .filter((item) => item.value !== null && item.value !== undefined && item.value !== '')
      .slice(0, 8)
      .map((item) => ({
        key: item.code,
        label: item.name || item.code,
        value: item.value,
        unitFamily: item.unit_family ?? null,
      }));
  }
  const attributes = object.target_summary?.attribute_values;
  if (!attributes || typeof attributes !== 'object') return [];
  return Object.entries(attributes)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 8)
    .map(([key, value]) => ({ key, label: key, value, unitFamily: null }));
}

function stopControlMomentum(controls: SparkControls | null) {
  if (!controls) return;
  controls.fpsMovement.extraMove.set(0, 0, 0);
  const pointerControls = controls.pointerControls;
  pointerControls.moveVelocity.set(0, 0, 0);
  pointerControls.rotateVelocity.set(0, 0, 0);
  pointerControls.scroll.set(0, 0, 0);
  pointerControls.pressHeld = undefined;
  pointerControls.doublePressed = undefined;
  pointerControls.triplePressed = false;
  pointerControls.lastDown = null;
  pointerControls.rotating = null;
  pointerControls.sliding = null;
  pointerControls.dualPress = false;
}

function focusCameraOnPoint(camera: THREE.PerspectiveCamera, controls: SparkControls | null, point: THREE.Vector3) {
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction).normalize();
  const currentDistance = camera.position.distanceTo(point);
  const focusDistance = Math.max(MIN_FOCUS_DISTANCE, Math.min(8, currentDistance * 0.35 || 2));
  camera.position.copy(point).addScaledVector(direction, -focusDistance);
  camera.lookAt(point);
  camera.updateProjectionMatrix();
  stopControlMomentum(controls);
}

export function SparkDocumentViewer({
  previewUrl,
  sourceUrl,
  sourceFileName,
  previewFileName,
  externalUrl,
  annotationManifestUrl,
  metadata,
  assetMode = 'spark_native',
  semanticObjects = [],
  onRefresh,
  onClose,
  onAnnotationSelect,
}: SparkDocumentViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const navigationStateRef = useRef<SparkNavigationState>(createSparkNavigationState());
  const walkTargetIndicatorRef = useRef<WalkTargetIndicator | null>(null);
  const runtimeRef = useRef<RuntimeViewer | null>(null);
  const annotationsRef = useRef<SparkAnnotation[]>([]);
  const semanticObjectsRef = useRef<DocumentVisualizationObject[]>([]);
  const showAnnotationsRef = useRef(true);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('正在加载 3D 预览');
  const [annotations, setAnnotations] = useState<SparkAnnotation[]>([]);
  const [markerPositions, setMarkerPositions] = useState<Record<string, MarkerPosition>>({});
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>('balanced');
  const [selectedAnnotation, setSelectedAnnotation] = useState<SparkAnnotation | null>(null);
  const [hoverSemanticObjectId, setHoverSemanticObjectId] = useState<string | null>(null);
  const [selectedSemanticObjectId, setSelectedSemanticObjectId] = useState<string | null>(null);
  const viewerConfig = useMemo(
    () => resolveViewerConfig(previewFileName, sourceFileName, previewUrl, metadata),
    [metadata, previewFileName, previewUrl, sourceFileName],
  );
  const selectedSemanticObject = useMemo(
    () => (selectedSemanticObjectId ? semanticObjects.find((object) => object.id === selectedSemanticObjectId) ?? null : null),
    [selectedSemanticObjectId, semanticObjects],
  );

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    semanticObjectsRef.current = semanticObjects;
  }, [semanticObjects]);

  useEffect(() => {
    showAnnotationsRef.current = showAnnotations;
  }, [showAnnotations]);

  const resetView = useCallback((reason?: string) => {
    const camera = cameraRef.current;
    if (!camera) return;
    void reason;
    resetSparkNavigationState(navigationStateRef.current);
    applyCamera(camera, viewerConfig);
    seedSparkNavigationStateFromCamera(camera, navigationStateRef.current, viewerConfig.navigation);
    hideWalkTargetIndicator(walkTargetIndicatorRef.current);
  }, [viewerConfig]);

  const focusWorldPoint = useCallback((point: THREE.Vector3, reason: string) => {
    const runtime = runtimeRef.current;
    const camera = cameraRef.current;
    if (!camera) return;
    void reason;
    resetSparkNavigationState(navigationStateRef.current);
    focusCameraOnPoint(camera, runtime?.controls ?? null, point);
    seedSparkNavigationStateFromCamera(camera, navigationStateRef.current, viewerConfig.navigation);
    hideWalkTargetIndicator(walkTargetIndicatorRef.current);
  }, [viewerConfig.navigation]);

  const handleAnnotationClick = useCallback((annotation: SparkAnnotation) => {
    setSelectedAnnotation(annotation);
    setSelectedSemanticObjectId(null);
    focusWorldPoint(new THREE.Vector3(...annotation.position), 'annotation');
  }, [focusWorldPoint]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setAnnotations([]);
    });
    if (!annotationManifestUrl) return;

    fetch(annotationManifestUrl)
      .then((response) => {
        if (!response.ok) throw new Error('标注清单加载失败');
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!cancelled) setAnnotations(extractAnnotations(payload));
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : '标注清单加载失败');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [annotationManifestUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      setLoadState('loading');
      setMessage('正在加载 3D 预览');
      setMarkerPositions({});
    });

    const radAsset = isRadAsset(previewFileName, assetMode);

    const scene = new THREE.Scene();
    applySceneBackground(scene, viewerConfig);
    const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.01, 1000);
    applyCamera(camera, viewerConfig);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas });
    renderer.setPixelRatio(resolvePixelRatio(viewerConfig, qualityPreset));
    const quality = QUALITY_PRESETS[qualityPreset];
    const spark = new SparkRenderer({
      renderer,
      lodSplatScale: (viewerConfig.lodSplatScale ?? 1.0) * quality.lodSplatScale,
      lodRenderScale: quality.lodRenderScale,
      minSortIntervalMs: quality.minSortIntervalMs,
      ...(radAsset
        ? {
            pagedExtSplats: true,
            coneFov0: 70.0,
            coneFov: 120.0,
            behindFoveate: 0.2,
            coneFoveate: 0.4,
          }
        : {}),
    });
    scene.add(spark);

    const controls = new SparkControls({ canvas });
    controls.pointerControls.pointerRollScale = 0.0;
    const navigationState = createSparkNavigationState();
    navigationStateRef.current = navigationState;
    seedSparkNavigationStateFromCamera(camera, navigationState, viewerConfig.navigation);

    const splat = new SplatMesh({
      url: previewUrl,
      ...(radAsset ? { paged: true } : {}),
      onProgress: (event) => {
        if (!event.lengthComputable) {
          setMessage(`已加载 ${event.loaded} bytes`);
          return;
        }
        const percent = Math.round((event.loaded / event.total) * 100);
        setMessage(`正在加载 3D 预览 ${percent}%`);
      },
      raycastable: true,
      minRaycastOpacity: 0.08,
    });
    applySplatTransform(splat, viewerConfig);
    scene.add(splat);
    const walkTargetIndicator = createWalkTargetIndicator(viewerConfig.navigation.upAxis);
    walkTargetIndicatorRef.current = walkTargetIndicator;
    scene.add(walkTargetIndicator.root);
    runtimeRef.current = { camera, controls, splat, renderer: spark, navigationState };

    const renderSize = new THREE.Vector2();
    const resize = () => {
      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      renderer.getSize(renderSize);
      const needResize = Math.floor(renderSize.x) !== width || Math.floor(renderSize.y) !== height;
      if (!needResize) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const updateMarkers = () => {
      const rect = canvas.getBoundingClientRect();
      const next: Record<string, MarkerPosition> = {};
      for (const annotation of annotationsRef.current) {
        const point = new THREE.Vector3(...annotation.position);
        point.project(camera);
        next[annotation.id] = {
          id: annotation.id,
          x: ((point.x + 1) / 2) * rect.width,
          y: ((-point.y + 1) / 2) * rect.height,
          visible: point.z >= -1 && point.z <= 1,
        };
      }
      setMarkerPositions(next);
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let lastPreviewAt = 0;
    const setPointerFromEvent = (event: MouseEvent | PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    };
    const onPointerDown = () => canvas.focus();
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons !== 0) {
        hideWalkTargetIndicator(walkTargetIndicator);
        setHoverSemanticObjectId(null);
        return;
      }
      const now = performance.now();
      if (now - lastPreviewAt < WALK_TARGET_PREVIEW_INTERVAL_MS) return;
      lastPreviewAt = now;
      setPointerFromEvent(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(splat, false)[0];
      if (!hit) {
        hideWalkTargetIndicator(walkTargetIndicator);
        setHoverSemanticObjectId(null);
        return;
      }
      const semanticHit = pickSemanticObjectAtPoint(hit.point, semanticObjectsRef.current, splat);
      if (semanticHit) {
        hideWalkTargetIndicator(walkTargetIndicator);
        setHoverSemanticObjectId((current) => (current === semanticHit.object.id ? current : semanticHit.object.id));
        return;
      }
      setHoverSemanticObjectId(null);
      const preview = previewSparkNavigationTarget(
        camera,
        splat,
        navigationState,
        viewerConfig.navigation,
        hit.point,
      );
      if (!preview) {
        hideWalkTargetIndicator(walkTargetIndicator);
        return;
      }
      showWalkTargetIndicator(walkTargetIndicator, preview.position, viewerConfig.navigation.upAxis);
    };
    const onPointerLeave = () => {
      hideWalkTargetIndicator(walkTargetIndicator);
      setHoverSemanticObjectId(null);
    };
    const onClick = (event: MouseEvent) => {
      setPointerFromEvent(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(splat, false)[0];
      if (!hit) {
        setSelectedSemanticObjectId(null);
        return;
      }
      const semanticHit = pickSemanticObjectAtPoint(hit.point, semanticObjectsRef.current, splat);
      if (!semanticHit) {
        setSelectedSemanticObjectId(null);
        return;
      }
      setSelectedAnnotation(null);
      setSelectedSemanticObjectId(semanticHit.object.id);
      hideWalkTargetIndicator(walkTargetIndicator);
    };
    const onDoubleClick = (event: MouseEvent) => {
      setPointerFromEvent(event);
      raycaster.setFromCamera(pointer, camera);
      const intersections = raycaster.intersectObject(splat, false);
      const hit = intersections[0];
      if (!hit) {
        hideWalkTargetIndicator(walkTargetIndicator);
        return;
      }
      const semanticHit = pickSemanticObjectAtPoint(hit.point, semanticObjectsRef.current, splat);
      if (semanticHit) {
        setSelectedAnnotation(null);
        setSelectedSemanticObjectId(semanticHit.object.id);
        hideWalkTargetIndicator(walkTargetIndicator);
        return;
      }
      const navigationMove = moveCameraToSparkNavigationTarget(
        camera,
        splat,
        navigationState,
        viewerConfig.navigation,
        hit.point,
      );
      const movedToWalkTarget = navigationMove.moved;
      if (!movedToWalkTarget && viewerConfig.navigation.mode !== 'walk') {
        focusCameraOnPoint(camera, controls, hit.point);
      } else if (!movedToWalkTarget) {
        stopControlMomentum(controls);
      } else {
        stopControlMomentum(controls);
      }
      hideWalkTargetIndicator(walkTargetIndicator);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('resize', resize);
    resize();

    renderer.setAnimationLoop(() => {
      if (disposed) return;
      resize();
      controls.update(camera);
      applySparkNavigationConstraint(camera, splat, navigationState, viewerConfig.navigation);
      updateWalkTargetIndicator(walkTargetIndicator);
      renderer.render(scene, camera);
      if (showAnnotationsRef.current) updateMarkers();
    });

    splat.initialized
      .then(() => {
        if (disposed) return;
        setLoadState('ready');
        setMessage('3D 预览已加载');
        canvas.focus();
      })
      .catch((error) => {
        if (!disposed) {
          console.warn(`${SPARK_VIEWER_LOG_PREFIX} splat.initialized.error`, error);
          setLoadState('error');
          setMessage(error instanceof Error ? error.message : '3D 预览加载失败');
        }
      });

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      scene.remove(splat);
      scene.remove(spark);
      scene.remove(walkTargetIndicator.root);
      splat.dispose();
      spark.dispose();
      disposeWalkTargetIndicator(walkTargetIndicator);
      renderer.dispose();
      cameraRef.current = null;
      runtimeRef.current = null;
      if (walkTargetIndicatorRef.current === walkTargetIndicator) {
        walkTargetIndicatorRef.current = null;
      }
      canvas.removeEventListener('dblclick', onDoubleClick);
    };
  }, [assetMode, previewFileName, previewUrl, qualityPreset, viewerConfig]);

  const handleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void container.requestFullscreen();
    }
  };
  const selectedSemanticSummaryRows = selectedSemanticObject ? semanticSummaryRows(selectedSemanticObject) : [];
  const selectedSemanticAttributeRows = selectedSemanticObject ? semanticAttributeRows(selectedSemanticObject) : [];

  return (
    <div ref={containerRef} className="relative flex h-full min-h-[36rem] flex-col overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-20 flex flex-wrap items-start justify-end gap-2">
        {loadState === 'loading' && (
          <div className="pointer-events-auto mr-auto rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs font-medium text-white shadow-lg backdrop-blur">
            <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />
            {message}
          </div>
        )}
        <div className={SPARK_TOOLBAR_CLASS}>
          <button type="button" onClick={() => resetView('button')} className={SPARK_FLOATING_BUTTON_CLASS} title="重置视角">
            <LocateFixed className="h-4 w-4" />
            <span className="sr-only">重置视角</span>
          </button>
          <div className="inline-flex h-9 items-center overflow-hidden rounded-full border border-white/15 bg-slate-950/55 text-xs font-semibold text-white shadow-lg shadow-slate-950/25 backdrop-blur-md ring-1 ring-white/5">
            <span className="inline-flex h-full w-9 items-center justify-center border-r border-white/10 text-white/70" title="质量">
              <Gauge className="h-3.5 w-3.5" />
              <span className="sr-only">质量</span>
            </span>
            {(['smooth', 'balanced', 'detailed'] as const).map((preset) => (
              <button
                type="button"
                key={preset}
                onClick={() => setQualityPreset(preset)}
                className={`h-full px-3 transition ${
                  qualityPreset === preset
                    ? 'bg-cyan-300/90 text-slate-950 shadow-inner shadow-white/30'
                    : 'text-white/65 hover:bg-white/10 hover:text-white'
                }`}
                title={`切换到${QUALITY_PRESETS[preset].label}模式`}
              >
                {QUALITY_PRESETS[preset].label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setShowAnnotations((current) => {
                if (current) setMarkerPositions({});
                return !current;
              });
            }}
            className={SPARK_FLOATING_BUTTON_CLASS}
            title="显示或隐藏标注"
          >
            {showAnnotations ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            <span className="sr-only">显示或隐藏标注</span>
          </button>
          <button type="button" onClick={handleFullscreen} className={SPARK_FLOATING_BUTTON_CLASS} title="全屏">
            <Expand className="h-4 w-4" />
            <span className="sr-only">全屏</span>
          </button>
          <button type="button" onClick={onRefresh} className={SPARK_FLOATING_BUTTON_CLASS} title="刷新链接">
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">刷新链接</span>
          </button>
          {externalUrl && (
            <a href={externalUrl} target="_blank" rel="noreferrer" className={SPARK_FLOATING_BUTTON_CLASS} title="新窗口打开">
              <ExternalLink className="h-4 w-4" />
              <span className="sr-only">新窗口打开</span>
            </a>
          )}
          <a href={sourceUrl} target="_blank" rel="noreferrer" className={SPARK_FLOATING_BUTTON_CLASS} title={`下载 ${sourceFileName}`}>
            <Download className="h-4 w-4" />
            <span className="sr-only">下载源文件</span>
          </a>
          {onClose && (
            <button type="button" onClick={onClose} className={SPARK_FLOATING_BUTTON_CLASS} title="关闭">
              <X className="h-4 w-4" />
              <span className="sr-only">关闭</span>
            </button>
          )}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        tabIndex={0}
        className={`min-h-0 flex-1 outline-none ${hoverSemanticObjectId ? 'cursor-pointer' : ''}`}
      />

      {loadState === 'error' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/80 px-6 text-center text-sm text-white">
          {message}
        </div>
      )}

      {showAnnotations && annotations.map((annotation) => {
        const marker = markerPositions[annotation.id];
        if (!marker?.visible) return null;
        return (
          <button
            type="button"
            key={annotation.id}
            onClick={() => handleAnnotationClick(annotation)}
            className="absolute z-10 max-w-48 -translate-x-1/2 -translate-y-full rounded-xl border border-primary-200 bg-white/95 px-3 py-2 text-left text-xs font-semibold text-slate-800 shadow-lg shadow-slate-900/20 backdrop-blur transition hover:border-primary-400 hover:text-primary-700"
            style={{ left: marker.x, top: marker.y }}
            title={annotation.source_object_id ?? undefined}
          >
            {annotation.label}
          </button>
        );
      })}

      {selectedAnnotation && (
        <div className="absolute bottom-3 right-3 z-20 w-72 rounded-xl border border-white/10 bg-slate-950/80 p-3 text-sm text-white shadow-xl shadow-slate-950/30 backdrop-blur">
          <div className="font-semibold">{selectedAnnotation.label}</div>
          <div className="mt-1 text-xs text-slate-300">坐标 {formatCoordinate(selectedAnnotation.position)}</div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setSelectedAnnotation(null)} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10">
              关闭
            </button>
            {selectedAnnotation.target_kind && selectedAnnotation.target_id && (
              <button
                type="button"
                onClick={() => onAnnotationSelect?.(selectedAnnotation)}
                className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-500"
              >
                打开关联对象
              </button>
            )}
          </div>
        </div>
      )}

      {selectedSemanticObject && (
        <div className="absolute bottom-3 right-3 z-20 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-sm text-white shadow-2xl shadow-slate-950/35 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-cyan-200/80">
                {semanticKindLabel(selectedSemanticObject.target_kind)}
              </div>
              <div className="mt-1 truncate text-base font-semibold">{selectedSemanticObject.label}</div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedSemanticObjectId(null)}
              className="rounded-full p-1.5 text-white/65 transition hover:bg-white/10 hover:text-white"
              title="关闭"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">关闭</span>
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {selectedSemanticSummaryRows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[4.5rem_1fr] gap-3 text-xs">
                <div className="text-slate-400">{label}</div>
                <div className="min-w-0 break-words font-medium text-slate-100">{formatAttributeValue(value)}</div>
              </div>
            ))}
          </div>

          {selectedSemanticAttributeRows.length > 0 && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <div className="mb-2 text-xs font-semibold text-slate-300">属性</div>
              <div className="space-y-2">
                {selectedSemanticAttributeRows.map((attribute) => (
                  <div key={attribute.key} className="grid grid-cols-[5.5rem_1fr] gap-3 text-xs">
                    <div className="truncate text-slate-400" title={attribute.label}>{attribute.label}</div>
                    <div className="min-w-0 break-words text-slate-100">
                      {formatAttributeValue(attribute.value)}
                      {attribute.unitFamily ? <span className="ml-1 text-slate-400">{attribute.unitFamily}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!selectedSemanticObject.target_summary && (
            <div className="mt-4 rounded-xl border border-amber-200/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
              已选中语义对象，但关联对象摘要还没有返回。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
