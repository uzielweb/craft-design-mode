import type {
  SelectionMode,
  VectorDocument,
  VectorNode,
  VectorPath,
} from '../ast/types.js';
import {
  findPathLookup,
  isDescendantOrSelf,
} from '../ast/utils.js';
import {
  distance,
  distancePointToSegment,
  getEffectiveContours,
  getPointHandles,
  isPointInPolygon,
  sampleContourPoints,
} from '../math/bezier.js';
import {
  applyMatrix,
  composeTransformMatrix,
  identityMatrix,
  invertMatrix,
  multiplyMatrices,
  type Mat2D,
} from '../math/transform.js';

export interface HitTestOptions {
  mode: SelectionMode;
  isolationStack: string[];
  tolerance?: number;
  selectedPathIds?: string[];
  checkHandles?: boolean;
}

export interface HitTestResult {
  kind: 'handle' | 'point' | 'path' | 'group' | 'layer';
  nodeId: string;
  pathId: string;
  pointId?: string;
  handleEnd?: 'in' | 'out';
  /** ID resolved according to SelectionMode ('path' -> pathId, 'group'/'layer' -> nodeId) */
  resolvedId: string;
  resolvedMode: SelectionMode;
}

export function cycleSelectionMode(current: SelectionMode): SelectionMode {
  if (current === 'layer') return 'group';
  if (current === 'group') return 'path';
  return 'layer';
}

export function pushIsolation(stack: string[], nodeId: string): string[] {
  if (stack[stack.length - 1] === nodeId) return stack;
  return [...stack, nodeId];
}

export function popIsolation(stack: string[]): string[] {
  return stack.slice(0, -1);
}

interface PaintPathEntry {
  path: VectorPath;
  ownerNode: VectorNode;
  parentGroup: VectorNode | null;
  rootLayer: VectorNode;
  worldMatrix: Mat2D;
}

function collectPaintPaths(
  nodes: VectorNode[],
  isolationTopId: string | null,
  allRoots: VectorNode[],
): PaintPathEntry[] {
  const entries: PaintPathEntry[] = [];

  const visit = (
    node: VectorNode,
    parentMatrix: Mat2D,
    rootLayer: VectorNode,
    parentGroup: VectorNode | null,
  ) => {
    if (!node.visible || node.locked) return;
    const worldMatrix = multiplyMatrices(
      parentMatrix,
      composeTransformMatrix(node.transform),
    );
    const activeGroup = node.type === 'group' ? node : parentGroup;

    const allowedByIsolation =
      !isolationTopId || isDescendantOrSelf(allRoots, isolationTopId, node.id);

    if (allowedByIsolation && node.paths) {
      for (const path of node.paths) {
        entries.push({
          path,
          ownerNode: node,
          parentGroup: activeGroup,
          rootLayer,
          worldMatrix,
        });
      }
    } else if (allowedByIsolation && node.type === 'text') {
      const approxW = Math.max(80, (node.textContent?.length ?? 6) * (node.fontSize ?? 48) * 0.55);
      const approxH = (node.fontSize ?? 48) * 1.1;
      entries.push({
        path: {
          id: `${node.id}_text_box`,
          name: node.name,
          type: 'parametric_rect',
          closed: true,
          points: [],
          parametricData: { cx: 0, cy: 0, width: approxW, height: approxH },
        },
        ownerNode: node,
        parentGroup: activeGroup,
        rootLayer,
        worldMatrix,
      });
    }

    if (node.children) {
      for (const child of node.children) {
        visit(child, worldMatrix, rootLayer, activeGroup);
      }
    }
  };

  for (const root of nodes) {
    visit(root, identityMatrix(), root, root.type === 'group' ? root : null);
  }

  return entries;
}

export function hitTestDocument(
  doc: VectorDocument,
  worldX: number,
  worldY: number,
  options: HitTestOptions,
): HitTestResult | null {
  const tolerance = options.tolerance ?? 8;
  const isolationTopId =
    options.isolationStack[options.isolationStack.length - 1] ?? null;
  const entries = collectPaintPaths(doc.nodes, isolationTopId, doc.nodes);

  // 1. Check Bezier handles and anchor points on currently selected paths first
  if (options.checkHandles && options.selectedPathIds?.length) {
    const selectedSet = new Set(options.selectedPathIds);
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!;
      if (!selectedSet.has(entry.path.id) || entry.path.type !== 'path') {
        continue;
      }
      const worldPt = { x: worldX, y: worldY };
      for (const pt of entry.path.points) {
        const anchorWorld = applyMatrix(entry.worldMatrix, pt.x, pt.y);
        const handles = getPointHandles(pt);
        if (pt.inLength > 0.5) {
          const inWorld = applyMatrix(
            entry.worldMatrix,
            handles.inHandle.x,
            handles.inHandle.y,
          );
          if (distance(worldPt, inWorld) <= tolerance) {
            return {
              kind: 'handle',
              nodeId: entry.ownerNode.id,
              pathId: entry.path.id,
              pointId: pt.id,
              handleEnd: 'in',
              resolvedId: entry.path.id,
              resolvedMode: 'path',
            };
          }
        }
        if (pt.outLength > 0.5) {
          const outWorld = applyMatrix(
            entry.worldMatrix,
            handles.outHandle.x,
            handles.outHandle.y,
          );
          if (distance(worldPt, outWorld) <= tolerance) {
            return {
              kind: 'handle',
              nodeId: entry.ownerNode.id,
              pathId: entry.path.id,
              pointId: pt.id,
              handleEnd: 'out',
              resolvedId: entry.path.id,
              resolvedMode: 'path',
            };
          }
        }
        if (distance(worldPt, anchorWorld) <= tolerance) {
          return {
            kind: 'point',
            nodeId: entry.ownerNode.id,
            pathId: entry.path.id,
            pointId: pt.id,
            resolvedId: entry.path.id,
            resolvedMode: 'path',
          };
        }
      }
    }
  }

  // 2. Test paths top-to-bottom (reverse paint order)
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const inv = invertMatrix(entry.worldMatrix);
    const localClick = applyMatrix(inv, worldX, worldY);
    const { contours, closed } = getEffectiveContours(entry.path);

    let hit = false;
    let insideCount = 0;

    for (const contour of contours) {
      const poly = sampleContourPoints(contour, closed, 14);
      if (poly.length === 1) {
        if (distance(localClick, poly[0]!) <= tolerance) {
          hit = true;
          break;
        }
      } else {
        for (let j = 0; j < poly.length - 1; j++) {
          if (
            distancePointToSegment(localClick, poly[j]!, poly[j + 1]!) <=
            tolerance
          ) {
            hit = true;
            break;
          }
        }
        if (hit) break;
        if (closed && entry.ownerNode.style?.fill && isPointInPolygon(localClick, poly)) {
          insideCount++;
        }
      }
    }

    // Even-odd fill hit check (donut holes remain hollow!)
    if (!hit && insideCount % 2 === 1) {
      hit = true;
    }

    if (hit) {
      return resolveHitForMode(entry, options.mode);
    }
  }

  return null;
}

function resolveHitForMode(
  entry: PaintPathEntry,
  mode: SelectionMode,
): HitTestResult {
  if (mode === 'path') {
    return {
      kind: 'path',
      nodeId: entry.ownerNode.id,
      pathId: entry.path.id,
      resolvedId: entry.path.id,
      resolvedMode: 'path',
    };
  }

  if (mode === 'group') {
    const lookup = findPathLookup([entry.rootLayer], entry.path.id);
    const targetGroup =
      lookup?.parentGroup ?? entry.parentGroup ?? entry.ownerNode;
    return {
      kind: 'group',
      nodeId: targetGroup.id,
      pathId: entry.path.id,
      resolvedId: targetGroup.id,
      resolvedMode: 'group',
    };
  }

  return {
    kind: 'layer',
    nodeId: entry.rootLayer.id,
    pathId: entry.path.id,
    resolvedId: entry.rootLayer.id,
    resolvedMode: 'layer',
  };
}
