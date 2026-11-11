import type {
  BBoxMode,
  NodeTransform,
  VectorNode,
} from '../ast/types.js';
import { findNodeLookup } from '../ast/utils.js';
import { getPathSamplePoints, type Vec2 } from './bezier.js';

/**
 * 2D affine matrix stored as [a, b, c, d, tx, ty]
 * | a  c  tx |
 * | b  d  ty |
 * | 0  0  1  |
 */
export type Mat2D = [number, number, number, number, number, number];

export function identityMatrix(): Mat2D {
  return [1, 0, 0, 1, 0, 0];
}

export function multiplyMatrices(m1: Mat2D, m2: Mat2D): Mat2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function composeTransformMatrix(t: NodeTransform): Mat2D {
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // T(x, y) * R(rot) * S(sx, sy) * T(-anchorX, -anchorY)
  const a = cos * t.scaleX;
  const b = sin * t.scaleX;
  const c = -sin * t.scaleY;
  const d = cos * t.scaleY;
  const tx = t.x - (a * t.anchorX + c * t.anchorY);
  const ty = t.y - (b * t.anchorX + d * t.anchorY);

  return [a, b, c, d, tx, ty];
}

export function applyMatrix(m: Mat2D, x: number, y: number): Vec2 {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

export function invertMatrix(m: Mat2D): Mat2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-8) return identityMatrix();
  const invDet = 1 / det;
  return [
    m[3] * invDet,
    -m[1] * invDet,
    -m[2] * invDet,
    m[0] * invDet,
    (m[2] * m[5] - m[3] * m[4]) * invDet,
    (m[1] * m[4] - m[0] * m[5]) * invDet,
  ];
}

export function getWorldMatrixForNode(
  nodes: VectorNode[],
  nodeId: string,
): Mat2D {
  const lookup = findNodeLookup(nodes, nodeId);
  if (!lookup) return identityMatrix();
  let mat = identityMatrix();
  for (const anc of lookup.ancestors) {
    mat = multiplyMatrices(mat, composeTransformMatrix(anc.transform));
  }
  return multiplyMatrices(mat, composeTransformMatrix(lookup.node.transform));
}

export interface BoundingBoxResult {
  id: string;
  mode: BBoxMode;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  center: Vec2;
  /** Clockwise corners in canvas world space (TL, TR, BR, BL) */
  corners: [Vec2, Vec2, Vec2, Vec2];
  rotationDeg: number;
}

function collectNodeLocalSamples(
  node: VectorNode,
  localPrefix: Mat2D,
): Vec2[] {
  const pts: Vec2[] = [];
  if (node.paths) {
    for (const path of node.paths) {
      for (const p of getPathSamplePoints(path, 12)) {
        pts.push(applyMatrix(localPrefix, p.x, p.y));
      }
    }
  }
  if (node.children) {
    for (const child of node.children) {
      const childMat = multiplyMatrices(
        localPrefix,
        composeTransformMatrix(child.transform),
      );
      pts.push(...collectNodeLocalSamples(child, childMat));
    }
  }
  return pts;
}

function aabbFromPoints(
  id: string,
  mode: BBoxMode,
  pts: Vec2[],
): BoundingBoxResult | null {
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    id,
    mode,
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    corners: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
    rotationDeg: 0,
  };
}

/**
 * Computes the 3 Bounding Box modes defined in the specification:
 * 1. combined: global AABB across all selected vertices in canvas space.
 * 2. individual_comp: canvas-aligned AABB per selected object.
 * 3. individual_object: local-space min/max transformed by object matrix (OBB).
 */
export function computeBoundingBoxes(
  nodes: VectorNode[],
  selectedNodeIds: string[],
  mode: BBoxMode,
): BoundingBoxResult[] {
  if (selectedNodeIds.length === 0) return [];

  if (mode === 'combined') {
    const allWorldPts: Vec2[] = [];
    for (const id of selectedNodeIds) {
      const node = findNodeLookup(nodes, id)?.node;
      if (!node) continue;
      const worldMat = getWorldMatrixForNode(nodes, id);
      const localPts = collectNodeLocalSamples(node, identityMatrix());
      for (const p of localPts) {
        allWorldPts.push(applyMatrix(worldMat, p.x, p.y));
      }
    }
    const box = aabbFromPoints('combined', mode, allWorldPts);
    return box ? [box] : [];
  }

  const results: BoundingBoxResult[] = [];
  for (const id of selectedNodeIds) {
    const lookup = findNodeLookup(nodes, id);
    if (!lookup) continue;
    const worldMat = getWorldMatrixForNode(nodes, id);
    const localPts = collectNodeLocalSamples(lookup.node, identityMatrix());
    if (localPts.length === 0) continue;

    if (mode === 'individual_comp') {
      const worldPts = localPts.map((p) => applyMatrix(worldMat, p.x, p.y));
      const box = aabbFromPoints(id, mode, worldPts);
      if (box) results.push(box);
    } else {
      // individual_object (OBB): compute local bounds pre-rotation, then transform corners
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of localPts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }

      const tl = applyMatrix(worldMat, minX, minY);
      const tr = applyMatrix(worldMat, maxX, minY);
      const br = applyMatrix(worldMat, maxX, maxY);
      const bl = applyMatrix(worldMat, minX, maxY);
      const center = applyMatrix(
        worldMat,
        (minX + maxX) / 2,
        (minY + maxY) / 2,
      );

      let totalRot = lookup.node.transform.rotation;
      for (const anc of lookup.ancestors) {
        totalRot += anc.transform.rotation;
      }

      results.push({
        id,
        mode,
        minX,
        minY,
        maxX,
        maxY,
        width: Math.hypot(tr.x - tl.x, tr.y - tl.y),
        height: Math.hypot(bl.x - tl.x, bl.y - tl.y),
        center,
        corners: [tl, tr, br, bl],
        rotationDeg: totalRot,
      });
    }
  }

  return results;
}

export type NumericTransformTarget = 'position' | 'rotation' | 'scale';

export interface NumericInputState {
  active: boolean;
  target: NumericTransformTarget | null;
  buffer: string;
  lastKey: string | null;
  lastKeyTime: number;
}

export type NumericKeyAction =
  | { type: 'none'; state: NumericInputState }
  | { type: 'opened'; state: NumericInputState }
  | { type: 'updated'; state: NumericInputState }
  | { type: 'cancelled'; state: NumericInputState }
  | {
      type: 'commit';
      target: NumericTransformTarget;
      value: number;
      state: NumericInputState;
    };

export function createNumericInputState(): NumericInputState {
  return {
    active: false,
    target: null,
    buffer: '',
    lastKey: null,
    lastKeyTime: 0,
  };
}

const KEY_TO_TARGET: Record<string, NumericTransformTarget> = {
  v: 'position',
  r: 'rotation',
  s: 'scale',
};

/**
 * Double-key state machine (V+V, R+R, S+S within < 400ms).
 * Captures digits (0-9, ., -) and commits on Enter.
 */
export function stepNumericInputMachine(
  state: NumericInputState,
  key: string,
  nowMs: number,
  thresholdMs = 400,
): NumericKeyAction {
  const lower = key.toLowerCase();

  if (state.active) {
    if (key === 'Enter') {
      const parsed = Number.parseFloat(state.buffer);
      const target = state.target;
      const reset = createNumericInputState();
      if (target && Number.isFinite(parsed)) {
        return { type: 'commit', target, value: parsed, state: reset };
      }
      return { type: 'cancelled', state: reset };
    }

    if (key === 'Escape') {
      return { type: 'cancelled', state: createNumericInputState() };
    }

    if (key === 'Backspace') {
      return {
        type: 'updated',
        state: { ...state, buffer: state.buffer.slice(0, -1) },
      };
    }

    if (/^[0-9.-]$/.test(key)) {
      if (key === '.' && state.buffer.includes('.')) {
        return { type: 'none', state };
      }
      if (key === '-' && state.buffer.length > 0) {
        return { type: 'none', state };
      }
      return {
        type: 'updated',
        state: { ...state, buffer: state.buffer + key },
      };
    }

    return { type: 'none', state };
  }

  const target = KEY_TO_TARGET[lower];
  if (!target) {
    return {
      type: 'none',
      state: { ...state, lastKey: null, lastKeyTime: 0 },
    };
  }

  if (state.lastKey === lower && nowMs - state.lastKeyTime < thresholdMs) {
    return {
      type: 'opened',
      state: {
        active: true,
        target,
        buffer: '',
        lastKey: null,
        lastKeyTime: 0,
      },
    };
  }

  return {
    type: 'none',
    state: {
      ...state,
      lastKey: lower,
      lastKeyTime: nowMs,
    },
  };
}
