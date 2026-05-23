import * as THREE from 'three';

export type SparkNavigationMode = 'fly' | 'walk';
export type SparkNavigationUpAxis = 'x' | 'y' | 'z';

export interface SparkNavigationConfig {
  mode: SparkNavigationMode;
  upAxis: SparkNavigationUpAxis;
  eyeHeight: number;
  floorOffset: number;
  targetStandOff: number;
  probeStart: number;
  probeDistance: number;
  probeRadius: number;
  maxStepUp: number;
  maxDrop: number;
}

export interface SparkNavigationState {
  groundLevel: number | null;
}

export interface SparkNavigationProbeSummary {
  groundLevel: number | null;
  hitCount: number;
  selectedLevel: number | null;
  levels: number[];
  eyeDeltas: number[];
  rejectedEyeDeltas: number[];
}

export interface SparkNavigationMoveResult {
  moved: boolean;
  reason: 'not_walk' | 'no_ground' | 'unreachable_ground' | 'moved';
  previousGroundLevel: number | null;
  referenceGroundLevel: number | null;
  targetEyeLevel: number | null;
  finalEyeLevel: number | null;
  currentProbe: SparkNavigationProbeSummary | null;
  initialProbe: SparkNavigationProbeSummary | null;
  fallbackProbe: SparkNavigationProbeSummary | null;
  horizontalDirection: THREE.Vector3 | null;
  standPoint: THREE.Vector3 | null;
  lookAt: THREE.Vector3 | null;
}

export interface SparkNavigationTargetPreview {
  position: THREE.Vector3;
}

const DEFAULT_NAVIGATION_CONFIG: SparkNavigationConfig = {
  mode: 'fly',
  upAxis: 'y',
  eyeHeight: 1.6,
  floorOffset: 0.05,
  targetStandOff: 0.65,
  probeStart: 0.35,
  probeDistance: 3.5,
  probeRadius: 0.28,
  maxStepUp: 0.55,
  maxDrop: 1.2,
};

const AXIS_INDEX: Record<SparkNavigationUpAxis, 0 | 1 | 2> = {
  x: 0,
  y: 1,
  z: 2,
};

const AXIS_VECTOR: Record<SparkNavigationUpAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

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

function finiteNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeMode(value: unknown): SparkNavigationMode {
  if (typeof value !== 'string') return DEFAULT_NAVIGATION_CONFIG.mode;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'walk' || normalized === 'gravity') return 'walk';
  if (normalized === 'fly' || normalized === 'free' || normalized === 'free_fly') return 'fly';
  return DEFAULT_NAVIGATION_CONFIG.mode;
}

function normalizeUpAxis(value: unknown): SparkNavigationUpAxis {
  if (value === 'x' || value === 'y' || value === 'z') return value;
  return DEFAULT_NAVIGATION_CONFIG.upAxis;
}

function normalizeNavigationRecord(record: Record<string, unknown> | null): Partial<SparkNavigationConfig> {
  if (!record) return {};
  const result: Partial<SparkNavigationConfig> = {};
  const mode = valueByAliases(record, ['mode', 'navigation_mode', 'control_mode']);
  const upAxis = valueByAliases(record, ['up_axis', 'upAxis', 'vertical_axis', 'verticalAxis']);
  const eyeHeight = valueByAliases(record, ['eye_height', 'eyeHeight', 'player_height', 'playerHeight']);
  const floorOffset = valueByAliases(record, ['floor_offset', 'floorOffset', 'hover_height', 'hoverHeight']);
  const targetStandOff = valueByAliases(record, ['target_stand_off', 'targetStandOff', 'stand_off', 'standOff']);
  const probeStart = valueByAliases(record, ['probe_start', 'probeStart']);
  const probeDistance = valueByAliases(record, ['probe_distance', 'probeDistance']);
  const probeRadius = valueByAliases(record, ['probe_radius', 'probeRadius']);
  const maxStepUp = valueByAliases(record, ['max_step_up', 'maxStepUp']);
  const maxDrop = valueByAliases(record, ['max_drop', 'maxDrop']);

  if (mode !== undefined) result.mode = normalizeMode(mode);
  if (upAxis !== undefined) result.upAxis = normalizeUpAxis(upAxis);
  if (eyeHeight !== undefined) result.eyeHeight = finiteNumber(eyeHeight, DEFAULT_NAVIGATION_CONFIG.eyeHeight, 0.2, 4);
  if (floorOffset !== undefined) result.floorOffset = finiteNumber(floorOffset, DEFAULT_NAVIGATION_CONFIG.floorOffset, 0, 1);
  if (targetStandOff !== undefined) result.targetStandOff = finiteNumber(targetStandOff, DEFAULT_NAVIGATION_CONFIG.targetStandOff, 0, 4);
  if (probeStart !== undefined) result.probeStart = finiteNumber(probeStart, DEFAULT_NAVIGATION_CONFIG.probeStart, 0.05, 3);
  if (probeDistance !== undefined) result.probeDistance = finiteNumber(probeDistance, DEFAULT_NAVIGATION_CONFIG.probeDistance, 0.5, 20);
  if (probeRadius !== undefined) result.probeRadius = finiteNumber(probeRadius, DEFAULT_NAVIGATION_CONFIG.probeRadius, 0, 2);
  if (maxStepUp !== undefined) result.maxStepUp = finiteNumber(maxStepUp, DEFAULT_NAVIGATION_CONFIG.maxStepUp, 0, 5);
  if (maxDrop !== undefined) result.maxDrop = finiteNumber(maxDrop, DEFAULT_NAVIGATION_CONFIG.maxDrop, 0, 10);
  return result;
}

export function resolveSparkNavigationConfig(metadata?: Record<string, unknown>): SparkNavigationConfig {
  if (!metadata) return DEFAULT_NAVIGATION_CONFIG;
  const nestedViewer = firstRecord(metadata.spark_viewer, metadata.sparkViewer, metadata.streaming_lod, metadata.streamingLod, metadata.viewer);
  const rootNavigation = firstRecord(metadata.navigation);
  const nestedNavigation = nestedViewer ? firstRecord(nestedViewer.navigation) : null;
  const rootConfig = normalizeNavigationRecord(rootNavigation);
  const nestedConfig = normalizeNavigationRecord(nestedNavigation);

  return {
    ...DEFAULT_NAVIGATION_CONFIG,
    ...rootConfig,
    ...nestedConfig,
  };
}

export function createSparkNavigationState(): SparkNavigationState {
  return { groundLevel: null };
}

export function resetSparkNavigationState(state: SparkNavigationState) {
  state.groundLevel = null;
}

function axisValue(vector: THREE.Vector3, upAxis: SparkNavigationUpAxis) {
  const index = AXIS_INDEX[upAxis];
  return index === 0 ? vector.x : index === 1 ? vector.y : vector.z;
}

function inferGroundLevelFromEye(cameraPosition: THREE.Vector3, config: SparkNavigationConfig) {
  if (config.mode !== 'walk') return null;
  const groundLevel = axisValue(cameraPosition, config.upAxis) - config.eyeHeight - config.floorOffset;
  return Number.isFinite(groundLevel) ? groundLevel : null;
}

export function seedSparkNavigationStateFromCamera(
  camera: THREE.PerspectiveCamera,
  state: SparkNavigationState,
  config: SparkNavigationConfig,
) {
  state.groundLevel = inferGroundLevelFromEye(camera.position, config);
}

function setAxisValue(vector: THREE.Vector3, upAxis: SparkNavigationUpAxis, value: number) {
  const index = AXIS_INDEX[upAxis];
  if (index === 0) {
    vector.x = value;
  } else if (index === 1) {
    vector.y = value;
  } else {
    vector.z = value;
  }
}

function horizontalBasis(upAxis: SparkNavigationUpAxis): [THREE.Vector3, THREE.Vector3] {
  if (upAxis === 'x') {
    return [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  }
  if (upAxis === 'y') {
    return [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)];
  }
  return [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)];
}

function summarizeProbe(levels: number[], eyeDeltas: number[], rejectedEyeDeltas: number[]): SparkNavigationProbeSummary {
  if (levels.length === 0) {
    return {
      groundLevel: null,
      hitCount: 0,
      selectedLevel: null,
      levels: [],
      eyeDeltas,
      rejectedEyeDeltas,
    };
  }
  const sortedLevels = [...levels].sort((left, right) => left - right);
  const selectedLevel = sortedLevels[Math.floor(sortedLevels.length / 2)];
  return {
    groundLevel: selectedLevel,
    hitCount: levels.length,
    selectedLevel,
    levels: sortedLevels,
    eyeDeltas,
    rejectedEyeDeltas,
  };
}

function probeGround(cameraPosition: THREE.Vector3, groundObject: THREE.Object3D, config: SparkNavigationConfig) {
  const up = AXIS_VECTOR[config.upAxis];
  const down = up.clone().multiplyScalar(-1);
  const [basisA, basisB] = horizontalBasis(config.upAxis);
  const offsets = [
    new THREE.Vector3(),
    basisA.clone().multiplyScalar(config.probeRadius),
    basisA.clone().multiplyScalar(-config.probeRadius),
    basisB.clone().multiplyScalar(config.probeRadius),
    basisB.clone().multiplyScalar(-config.probeRadius),
  ];
  const levels: number[] = [];
  const eyeDeltas: number[] = [];
  const rejectedEyeDeltas: number[] = [];
  const raycaster = new THREE.Raycaster();
  raycaster.near = 0;
  raycaster.far = config.eyeHeight + config.probeStart + config.probeDistance;

  for (const offset of offsets) {
    const origin = cameraPosition.clone().add(offset).addScaledVector(up, config.probeStart);
    raycaster.set(origin, down);
    const hit = raycaster.intersectObject(groundObject, false)[0];
    if (!hit) continue;
    const level = axisValue(hit.point, config.upAxis);
    const eyeDelta = axisValue(cameraPosition, config.upAxis) - level;
    if (eyeDelta < 0 || eyeDelta > config.eyeHeight + config.probeDistance) {
      rejectedEyeDeltas.push(eyeDelta);
      continue;
    }
    levels.push(level);
    eyeDeltas.push(eyeDelta);
  }

  return summarizeProbe(levels, eyeDeltas, rejectedEyeDeltas);
}

function probeGroundLevel(cameraPosition: THREE.Vector3, groundObject: THREE.Object3D, config: SparkNavigationConfig) {
  return probeGround(cameraPosition, groundObject, config).groundLevel;
}

function isReachableGround(nextGround: number, previousGround: number | null, config: SparkNavigationConfig) {
  if (previousGround === null) return true;
  const delta = nextGround - previousGround;
  if (delta >= 0) return delta <= config.maxStepUp;
  return Math.abs(delta) <= config.maxDrop;
}

function horizontalDirectionFromTo(from: THREE.Vector3, to: THREE.Vector3, upAxis: SparkNavigationUpAxis) {
  const up = AXIS_VECTOR[upAxis];
  const direction = to.clone().sub(from);
  direction.addScaledVector(up, -direction.dot(up));
  if (direction.lengthSq() > 0.000001) return direction.normalize();
  const fallback = new THREE.Vector3();
  fallback.subVectors(to, from);
  fallback.addScaledVector(up, -fallback.dot(up));
  return fallback.lengthSq() > 0.000001 ? fallback.normalize() : null;
}

export function previewSparkNavigationTarget(
  camera: THREE.PerspectiveCamera,
  groundObject: THREE.Object3D,
  state: SparkNavigationState,
  config: SparkNavigationConfig,
  targetPoint: THREE.Vector3,
) : SparkNavigationTargetPreview | null {
  if (config.mode !== 'walk') {
    return { position: targetPoint.clone() };
  }

  const currentProbe = state.groundLevel === null ? probeGround(camera.position, groundObject, config) : null;
  const inferredGroundLevel = inferGroundLevelFromEye(camera.position, config);
  const referenceGroundLevel = state.groundLevel ?? currentProbe?.groundLevel ?? inferredGroundLevel;
  const horizontalDirection = horizontalDirectionFromTo(camera.position, targetPoint, config.upAxis);
  const standPoint = targetPoint.clone();
  if (horizontalDirection) {
    standPoint.addScaledVector(horizontalDirection, -config.targetStandOff);
  }

  const targetEyeLevel = axisValue(targetPoint, config.upAxis) + config.eyeHeight + config.floorOffset;
  setAxisValue(standPoint, config.upAxis, targetEyeLevel);
  const initialProbe = probeGround(standPoint, groundObject, config);
  let groundLevel = initialProbe.groundLevel;

  if (groundLevel === null) {
    const sameLevelStandPoint = standPoint.clone();
    setAxisValue(sameLevelStandPoint, config.upAxis, axisValue(camera.position, config.upAxis));
    groundLevel = probeGround(sameLevelStandPoint, groundObject, config).groundLevel;
  }

  if (groundLevel === null || !isReachableGround(groundLevel, referenceGroundLevel, config)) {
    return null;
  }

  setAxisValue(standPoint, config.upAxis, groundLevel);
  return { position: standPoint };
}

export function moveCameraToSparkNavigationTarget(
  camera: THREE.PerspectiveCamera,
  groundObject: THREE.Object3D,
  state: SparkNavigationState,
  config: SparkNavigationConfig,
  targetPoint: THREE.Vector3,
) : SparkNavigationMoveResult {
  const previousGroundLevel = state.groundLevel;
  if (config.mode !== 'walk') {
    return {
      moved: false,
      reason: 'not_walk',
      previousGroundLevel,
      referenceGroundLevel: previousGroundLevel,
      targetEyeLevel: null,
      finalEyeLevel: null,
      currentProbe: null,
      initialProbe: null,
      fallbackProbe: null,
      horizontalDirection: null,
      standPoint: null,
      lookAt: null,
    };
  }
  const currentProbe = previousGroundLevel === null ? probeGround(camera.position, groundObject, config) : null;
  const inferredGroundLevel = inferGroundLevelFromEye(camera.position, config);
  const referenceGroundLevel = previousGroundLevel ?? currentProbe?.groundLevel ?? inferredGroundLevel;
  const horizontalDirection = horizontalDirectionFromTo(camera.position, targetPoint, config.upAxis);
  const standPoint = targetPoint.clone();
  if (horizontalDirection) {
    standPoint.addScaledVector(horizontalDirection, -config.targetStandOff);
  }

  const targetEyeLevel = axisValue(targetPoint, config.upAxis) + config.eyeHeight + config.floorOffset;
  setAxisValue(standPoint, config.upAxis, targetEyeLevel);
  const initialProbe = probeGround(standPoint, groundObject, config);
  let groundLevel = initialProbe.groundLevel;
  let fallbackProbe: SparkNavigationProbeSummary | null = null;

  if (groundLevel === null) {
    const sameLevelStandPoint = standPoint.clone();
    setAxisValue(sameLevelStandPoint, config.upAxis, axisValue(camera.position, config.upAxis));
    fallbackProbe = probeGround(sameLevelStandPoint, groundObject, config);
    groundLevel = fallbackProbe.groundLevel;
  }

  if (groundLevel === null) {
    return {
      moved: false,
      reason: 'no_ground',
      previousGroundLevel,
      referenceGroundLevel,
      targetEyeLevel,
      finalEyeLevel: null,
      currentProbe,
      initialProbe,
      fallbackProbe,
      horizontalDirection,
      standPoint,
      lookAt: null,
    };
  }
  if (!isReachableGround(groundLevel, referenceGroundLevel, config)) {
    return {
      moved: false,
      reason: 'unreachable_ground',
      previousGroundLevel,
      referenceGroundLevel,
      targetEyeLevel,
      finalEyeLevel: null,
      currentProbe,
      initialProbe,
      fallbackProbe,
      horizontalDirection,
      standPoint,
      lookAt: null,
    };
  }
  state.groundLevel = groundLevel;
  setAxisValue(standPoint, config.upAxis, groundLevel + config.eyeHeight + config.floorOffset);
  camera.position.copy(standPoint);

  const lookAt = targetPoint.clone();
  setAxisValue(lookAt, config.upAxis, axisValue(camera.position, config.upAxis));
  camera.lookAt(lookAt);
  camera.updateMatrixWorld();
  return {
    moved: true,
    reason: 'moved',
    previousGroundLevel,
    referenceGroundLevel,
    targetEyeLevel,
    finalEyeLevel: axisValue(camera.position, config.upAxis),
    currentProbe,
    initialProbe,
    fallbackProbe,
    horizontalDirection,
    standPoint: standPoint.clone(),
    lookAt,
  };
}

export function applySparkNavigationConstraint(
  camera: THREE.PerspectiveCamera,
  groundObject: THREE.Object3D,
  state: SparkNavigationState,
  config: SparkNavigationConfig,
) {
  if (config.mode !== 'walk') return false;
  const probedGround = probeGroundLevel(camera.position, groundObject, config);
  const referenceGroundLevel = state.groundLevel ?? inferGroundLevelFromEye(camera.position, config);
  if (probedGround !== null && isReachableGround(probedGround, referenceGroundLevel, config)) {
    state.groundLevel = probedGround;
  }

  if (state.groundLevel === null) {
    state.groundLevel = referenceGroundLevel;
  }
  if (state.groundLevel === null) return false;
  const targetEyeLevel = state.groundLevel + config.eyeHeight + config.floorOffset;
  const currentEyeLevel = axisValue(camera.position, config.upAxis);
  if (Math.abs(currentEyeLevel - targetEyeLevel) < 0.001) return false;
  setAxisValue(camera.position, config.upAxis, targetEyeLevel);
  camera.updateMatrixWorld();
  return true;
}
