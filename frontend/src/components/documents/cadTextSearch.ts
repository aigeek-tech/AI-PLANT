import type { AcApDocManager } from '@mlightcad/cad-simple-viewer';
import {
  AcDbAttribute,
  AcDbBlockReference,
  type AcDbEntity,
  AcDbMText,
  AcDbText,
  AcGeBox2d,
  AcGeBox3d,
} from '@mlightcad/data-model';

type CadTextKind = 'TEXT' | 'MTEXT' | 'ATTRIB';
type CadTextHitSource = 'single' | 'cluster';

interface CadTextToken {
  objectId: string;
  rawText: string;
  normalizedText: string;
  kind: CadTextKind;
  layer: string;
  ownerId: string;
  box: AcGeBox3d;
  center: { x: number; y: number };
  width: number;
  height: number;
}

export interface CadTextHit {
  id: string;
  displayText: string;
  normalizedText: string;
  objectIds: string[];
  box: AcGeBox3d;
  source: CadTextHitSource;
  tokenCount: number;
}

const MAX_VERTICAL_CLUSTER_SIZE = 4;
const MAX_SEARCH_RESULTS = 200;
const FOCUS_BOX_PADDING_RATIO = 0.75;

export function normalizeCadSearchText(value: string) {
  return value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function buildCadTextIndex(manager: AcApDocManager) {
  const tokens = collectCadTextTokens(manager);
  return dedupeHits([...tokens.map(tokenToHit), ...buildVerticalClusterHits(tokens)]).sort(compareHits);
}

export function searchCadTextIndex(index: CadTextHit[], query: string) {
  const normalizedQuery = normalizeCadSearchText(query);
  if (!normalizedQuery) return [];

  return index
    .filter((hit) => hit.normalizedText.includes(normalizedQuery))
    .sort((a, b) => compareSearchHits(a, b, normalizedQuery))
    .slice(0, MAX_SEARCH_RESULTS);
}

export function cadTextHitToBox2d(hit: CadTextHit) {
  const box = new AcGeBox2d(
    { x: hit.box.min.x, y: hit.box.min.y },
    { x: hit.box.max.x, y: hit.box.max.y },
  );

  if (box.isEmpty()) {
    const center = hit.box.center;
    return new AcGeBox2d().setFromCenterAndSize(
      { x: center.x, y: center.y },
      { x: 1, y: 1 },
    );
  }

  const size = box.size;
  const padding = Math.max(size.x, size.y, 1) * FOCUS_BOX_PADDING_RATIO;
  return box.expandByScalar(padding);
}

export function findCadTextHitAtPoint(
  index: CadTextHit[],
  point: { x: number; y: number },
  tolerance: number,
) {
  const finiteTolerance = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 0;

  return (
    index
      .filter((hit) => hit.source === 'single' && isPointNearBox(point, hit.box, finiteTolerance))
      .sort((a, b) => comparePointHits(a, b, point))[0] ?? null
  );
}

function collectCadTextTokens(manager: AcApDocManager) {
  const modelSpace = manager.curDocument.database.tables.blockTable.modelSpace;
  const tokens: CadTextToken[] = [];
  const seenIds = new Set<string>();

  for (const entity of modelSpace.newIterator()) {
    collectEntityTextTokens(entity, tokens, seenIds);
  }

  return tokens;
}

function collectEntityTextTokens(entity: AcDbEntity, tokens: CadTextToken[], seenIds: Set<string>) {
  if (entity instanceof AcDbBlockReference) {
    for (const attribute of entity.attributeIterator()) {
      collectTextEntityToken(attribute, tokens, seenIds);
    }
  }

  collectTextEntityToken(entity, tokens, seenIds);
}

function collectTextEntityToken(entity: AcDbEntity, tokens: CadTextToken[], seenIds: Set<string>) {
  const content = getEntityTextContent(entity);
  if (!content || seenIds.has(entity.objectId)) return;

  const normalizedText = normalizeCadSearchText(content);
  if (!normalizedText) return;

  const box = getEntityTextBox(entity);
  if (!box || box.isEmpty()) return;

  seenIds.add(entity.objectId);
  tokens.push({
    objectId: entity.objectId,
    rawText: content,
    normalizedText,
    kind: getEntityTextKind(entity),
    layer: entity.layer || '',
    ownerId: entity.ownerId || '',
    box,
    center: { x: box.center.x, y: box.center.y },
    width: Math.max(0, box.max.x - box.min.x),
    height: Math.max(0, box.max.y - box.min.y),
  });
}

function getEntityTextContent(entity: AcDbEntity) {
  if (entity instanceof AcDbAttribute) {
    return cleanCadText(entity.mtext?.contents || entity.textString);
  }
  if (entity instanceof AcDbMText) {
    return cleanCadText(entity.contents);
  }
  if (entity instanceof AcDbText) {
    return cleanCadText(entity.textString);
  }
  return '';
}

function getEntityTextKind(entity: AcDbEntity): CadTextKind {
  if (entity instanceof AcDbAttribute) return 'ATTRIB';
  if (entity instanceof AcDbMText) return 'MTEXT';
  return 'TEXT';
}

function cleanCadText(value: string) {
  return value
    .replace(/\\P/gi, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getEntityTextBox(entity: AcDbEntity) {
  const geometricBox = cloneFiniteBox(entity.geometricExtents);
  if (geometricBox && !geometricBox.isEmpty()) return geometricBox;

  if (entity instanceof AcDbMText) {
    return boxAroundPoint(entity.location, Math.max(entity.width, entity.height, 1));
  }
  if (entity instanceof AcDbText) {
    return boxAroundPoint(entity.position, Math.max(entity.height, 1));
  }

  return null;
}

function cloneFiniteBox(box: AcGeBox3d) {
  if (!isFinitePoint(box.min) || !isFinitePoint(box.max)) return null;
  return new AcGeBox3d(box.min, box.max);
}

function boxAroundPoint(point: { x: number; y: number; z?: number }, size: number) {
  const half = Math.max(size, 1) / 2;
  return new AcGeBox3d(
    { x: point.x - half, y: point.y - half, z: point.z ?? 0 },
    { x: point.x + half, y: point.y + half, z: point.z ?? 0 },
  );
}

function isFinitePoint(point: { x: number; y: number; z?: number }) {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z ?? 0);
}

function isPointNearBox(point: { x: number; y: number }, box: AcGeBox3d, tolerance: number) {
  if (!isFinitePoint(point) || !isFinitePoint(box.min) || !isFinitePoint(box.max)) return false;

  return (
    point.x >= box.min.x - tolerance &&
    point.x <= box.max.x + tolerance &&
    point.y >= box.min.y - tolerance &&
    point.y <= box.max.y + tolerance
  );
}

function comparePointHits(a: CadTextHit, b: CadTextHit, point: { x: number; y: number }) {
  const distanceDifference = pointDistanceToBoxSquared(point, a.box) - pointDistanceToBoxSquared(point, b.box);
  if (distanceDifference !== 0) return distanceDifference;

  const areaDifference = boxArea(a.box) - boxArea(b.box);
  if (areaDifference !== 0) return areaDifference;

  return a.displayText.localeCompare(b.displayText, 'zh-CN');
}

function pointDistanceToBoxSquared(point: { x: number; y: number }, box: AcGeBox3d) {
  const dx = point.x < box.min.x ? box.min.x - point.x : point.x > box.max.x ? point.x - box.max.x : 0;
  const dy = point.y < box.min.y ? box.min.y - point.y : point.y > box.max.y ? point.y - box.max.y : 0;
  return dx * dx + dy * dy;
}

function boxArea(box: AcGeBox3d) {
  const width = Math.max(0, box.max.x - box.min.x);
  const height = Math.max(0, box.max.y - box.min.y);
  return width * height;
}

function tokenToHit(token: CadTextToken): CadTextHit {
  return {
    id: `single:${token.objectId}`,
    displayText: token.rawText,
    normalizedText: token.normalizedText,
    objectIds: [token.objectId],
    box: token.box.clone(),
    source: 'single',
    tokenCount: 1,
  };
}

function buildVerticalClusterHits(tokens: CadTextToken[]) {
  const sortedTokens = [...tokens].sort((a, b) => b.center.y - a.center.y || a.center.x - b.center.x);
  const hits: CadTextHit[] = [];

  sortedTokens.forEach((topToken, topIndex) => {
    const cluster = [topToken];

    for (let index = topIndex + 1; index < sortedTokens.length; index += 1) {
      const nextToken = sortedTokens[index];
      const previousToken = cluster[cluster.length - 1];

      if (!isVerticalNeighbor(previousToken, nextToken)) continue;

      cluster.push(nextToken);
      if (cluster.length >= 2) {
        hits.push(tokensToClusterHit(cluster));
      }
      if (cluster.length >= MAX_VERTICAL_CLUSTER_SIZE) break;
    }
  });

  return hits;
}

function isVerticalNeighbor(upper: CadTextToken, lower: CadTextToken) {
  const upperHeight = normalizedDimension(upper.height, upper.width);
  const lowerHeight = normalizedDimension(lower.height, lower.width);
  const averageHeight = (upperHeight + lowerHeight) / 2;
  const yGap = upper.center.y - lower.center.y;

  if (yGap <= averageHeight * 0.2) return false;
  if (yGap > Math.max(averageHeight * 3.8, 1)) return false;

  const xCenterGap = Math.abs(upper.center.x - lower.center.x);
  const maxWidth = Math.max(upper.width, lower.width, averageHeight);
  if (xCenterGap > Math.max(maxWidth * 0.65, averageHeight * 3.5, 1)) return false;

  const xOverlap =
    Math.min(upper.box.max.x, lower.box.max.x) - Math.max(upper.box.min.x, lower.box.min.x);
  const hasHorizontalRelation = xOverlap >= 0 || xCenterGap <= Math.max(averageHeight * 2.5, 1);
  if (!hasHorizontalRelation) return false;

  if (upper.layer && lower.layer && upper.layer !== lower.layer && xCenterGap > averageHeight) return false;

  return true;
}

function normalizedDimension(primary: number, fallback: number) {
  if (Number.isFinite(primary) && primary > 0) return primary;
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return 1;
}

function tokensToClusterHit(tokens: CadTextToken[]): CadTextHit {
  const objectIds = Array.from(new Set(tokens.map((token) => token.objectId)));
  const displayText = tokens.map((token) => token.rawText).join('-');
  const box = tokens.reduce((acc, token) => acc.union(token.box), tokens[0].box.clone());

  return {
    id: `cluster:${objectIds.join('+')}`,
    displayText,
    normalizedText: normalizeCadSearchText(displayText),
    objectIds,
    box,
    source: 'cluster',
    tokenCount: tokens.length,
  };
}

function dedupeHits(hits: CadTextHit[]) {
  const seen = new Set<string>();
  const deduped: CadTextHit[] = [];

  hits.forEach((hit) => {
    const key = `${hit.source}:${hit.normalizedText}:${hit.objectIds.join('+')}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(hit);
  });

  return deduped;
}

function compareHits(a: CadTextHit, b: CadTextHit) {
  return a.displayText.localeCompare(b.displayText, 'zh-CN') || b.tokenCount - a.tokenCount;
}

function compareSearchHits(a: CadTextHit, b: CadTextHit, normalizedQuery: string) {
  const aExact = a.normalizedText === normalizedQuery ? 1 : 0;
  const bExact = b.normalizedText === normalizedQuery ? 1 : 0;
  if (aExact !== bExact) return bExact - aExact;

  const aStartsWith = a.normalizedText.startsWith(normalizedQuery) ? 1 : 0;
  const bStartsWith = b.normalizedText.startsWith(normalizedQuery) ? 1 : 0;
  if (aStartsWith !== bStartsWith) return bStartsWith - aStartsWith;

  if (a.tokenCount !== b.tokenCount) return b.tokenCount - a.tokenCount;
  return a.displayText.localeCompare(b.displayText, 'zh-CN');
}
