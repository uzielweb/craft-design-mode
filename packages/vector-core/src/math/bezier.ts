import type {
  AxisLock,
  BezierPoint,
  HandleMode,
  ParametricData,
  VectorPath,
} from '../ast/types.js';

export interface Vec2 {
  x: number;
  y: number;
}

export interface CubicSegment {
  p0: Vec2;
  c1: Vec2;
  c2: Vec2;
  p1: Vec2;
}

export interface PointHandles {
  inHandle: Vec2;
  outHandle: Vec2;
}

export interface SlideDragState {
  pointId: string;
  initialX: number;
  initialY: number;
  initialAngle: number;
  fixedInWorld: Vec2;
  fixedOutWorld: Vec2;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function applyAxisLock(
  deltaX: number,
  deltaY: number,
  lockAxis: AxisLock,
): { deltaX: number; deltaY: number } {
  if (lockAxis === 'x') return { deltaX, deltaY: 0 };
  if (lockAxis === 'y') return { deltaX: 0, deltaY };
  return { deltaX, deltaY };
}

export function getPointHandles(pt: BezierPoint): PointHandles {
  const inAngle = pt.angle;
  const outAngle =
    pt.handleMode === 'broken' && pt.outAngle !== undefined
      ? pt.outAngle
      : pt.angle;

  return {
    inHandle: {
      x: pt.x - Math.cos(inAngle) * pt.inLength,
      y: pt.y - Math.sin(inAngle) * pt.inLength,
    },
    outHandle: {
      x: pt.x + Math.cos(outAngle) * pt.outLength,
      y: pt.y + Math.sin(outAngle) * pt.outLength,
    },
  };
}

/**
 * Updates a point's handle based on a dragged handle tip position,
 * enforcing the active HandleMode ('symmetric' | 'angle' | 'broken').
 */
export function updateHandleFromTip(
  pt: BezierPoint,
  which: 'in' | 'out',
  tipX: number,
  tipY: number,
): BezierPoint {
  const dx = tipX - pt.x;
  const dy = tipY - pt.y;
  const len = Math.hypot(dx, dy);
  const next = { ...pt };

  if (pt.handleMode === 'broken') {
    if (which === 'in') {
      next.angle = Math.atan2(-dy, -dx);
      next.inLength = len;
    } else {
      next.outAngle = Math.atan2(dy, dx);
      next.outLength = len;
    }
    return next;
  }

  // Shared tangent angle for 'symmetric' and 'angle'
  const sharedAngle =
    which === 'in' ? Math.atan2(-dy, -dx) : Math.atan2(dy, dx);
  next.angle = sharedAngle;
  next.outAngle = undefined;

  if (pt.handleMode === 'symmetric') {
    next.inLength = len;
    next.outLength = len;
  } else {
    if (which === 'in') next.inLength = len;
    else next.outLength = len;
  }
  return next;
}

export function setPointHandleMode(
  pt: BezierPoint,
  mode: HandleMode,
): BezierPoint {
  const next: BezierPoint = { ...pt, handleMode: mode };
  if (mode === 'symmetric') {
    const avg = (pt.inLength + pt.outLength) / 2;
    next.inLength = avg;
    next.outLength = avg;
    next.outAngle = undefined;
  } else if (mode === 'angle') {
    next.outAngle = undefined;
  } else if (mode === 'broken' && next.outAngle === undefined) {
    next.outAngle = pt.angle;
  }
  return next;
}

/**
 * Captures absolute handle tip positions at the start of Ctrl+Slide.
 */
export function beginSlideDrag(
  pt: BezierPoint,
  localToWorld: (p: Vec2) => Vec2 = (p) => p,
): SlideDragState {
  const handles = getPointHandles(pt);
  return {
    pointId: pt.id,
    initialX: pt.x,
    initialY: pt.y,
    initialAngle: pt.angle,
    fixedInWorld: localToWorld(handles.inHandle),
    fixedOutWorld: localToWorld(handles.outHandle),
  };
}

/**
 * Slides point P along its tangent vector while keeping handle tips fixed in canvas space,
 * recalculating inLength, outLength, and angle.
 */
export function applySlideDrag(
  pt: BezierPoint,
  pointerDeltaLocalX: number,
  pointerDeltaLocalY: number,
  state: SlideDragState,
  worldToLocal: (p: Vec2) => Vec2 = (p) => p,
): BezierPoint {
  const tx = Math.cos(state.initialAngle);
  const ty = Math.sin(state.initialAngle);
  const projection = pointerDeltaLocalX * tx + pointerDeltaLocalY * ty;

  const newX = state.initialX + tx * projection;
  const newY = state.initialY + ty * projection;

  const inLocal = worldToLocal(state.fixedInWorld);
  const outLocal = worldToLocal(state.fixedOutWorld);

  const newP: Vec2 = { x: newX, y: newY };
  const inLength = distance(newP, inLocal);
  const outLength = distance(newP, outLocal);

  let angle = state.initialAngle;
  if (outLength > 1e-4) {
    angle = Math.atan2(outLocal.y - newY, outLocal.x - newX);
  } else if (inLength > 1e-4) {
    angle = Math.atan2(newY - inLocal.y, newX - inLocal.x);
  }

  return {
    ...pt,
    x: newX,
    y: newY,
    angle,
    inLength,
    outLength,
    outAngle: pt.handleMode === 'broken' ? angle : undefined,
  };
}

/**
 * Relative offset update for multi-point handle editing in PropertiesPanel.
 */
export function applyHandleLengthDelta(
  points: BezierPoint[],
  field: 'inLength' | 'outLength',
  delta: number,
): BezierPoint[] {
  return points.map((pt) => {
    const nextVal = Math.max(0, pt[field] + delta);
    if (pt.handleMode === 'symmetric') {
      return { ...pt, inLength: nextVal, outLength: nextVal };
    }
    return { ...pt, [field]: nextVal };
  });
}

/**
 * Generates an arc approximation as BezierPoints for parametric ellipses.
 * Supports holeRatio (0..1) and sweep (0..360).
 */
export function buildParametricEllipseContours(
  data: ParametricData = {},
): BezierPoint[][] {
  const cx = data.cx ?? 0;
  const cy = data.cy ?? 0;
  const rx = Math.max(1, data.rx ?? 100);
  const ry = Math.max(1, data.ry ?? 100);
  const holeRatio = Math.max(0, Math.min(0.98, data.holeRatio ?? 0));
  const sweepDeg = Math.max(1, Math.min(360, data.sweep ?? 360));

  const outer = buildEllipseArc(cx, cy, rx, ry, -90, -90 + sweepDeg, sweepDeg >= 359.99, false);
  if (holeRatio <= 0.001) {
    return [outer];
  }

  const irx = rx * holeRatio;
  const iry = ry * holeRatio;
  if (sweepDeg >= 359.99) {
    // Full donut: outer CW, inner CCW so even-odd fill cuts out the hole cleanly
    const inner = buildEllipseArc(cx, cy, irx, iry, -90, -90 + 360, true, true);
    return [outer, inner];
  }

  // Partial sector ring: outer forward + inner backward into one closed contour
  const innerRev = buildEllipseArc(cx, cy, irx, iry, -90 + sweepDeg, -90, false, false);
  return [[...outer, ...innerRev]];
}

function buildEllipseArc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startDeg: number,
  endDeg: number,
  closed: boolean,
  reverse: boolean,
): BezierPoint[] {
  const totalRad = ((endDeg - startDeg) * Math.PI) / 180;
  const segments = Math.max(1, Math.ceil(Math.abs(totalRad) / (Math.PI / 2)));
  const stepRad = totalRad / segments;
  const startRad = (startDeg * Math.PI) / 180;

  const pts: BezierPoint[] = [];
  const count = closed ? segments : segments + 1;

  for (let i = 0; i < count; i++) {
    const idx = reverse ? (count - 1 - i) : i;
    const theta = startRad + idx * stepRad;
    const x = cx + Math.cos(theta) * rx;
    const y = cy + Math.sin(theta) * ry;

    // Tangent vector of ellipse (dx/dtheta, dy/dtheta)
    const tx = -Math.sin(theta) * rx;
    const ty = Math.cos(theta) * ry;
    const tangentLen = Math.hypot(tx, ty) || 1;
    const dir = reverse ? -1 : 1;
    const angle = Math.atan2(ty * dir, tx * dir);

    const k = (4 / 3) * Math.tan(Math.abs(stepRad) / 4);
    const handleLen = tangentLen * k;

    const isFirst = i === 0 && !closed;
    const isLast = i === count - 1 && !closed;

    pts.push({
      id: `ell_${i}_${reverse ? 'r' : 'f'}`,
      x,
      y,
      angle,
      inLength: isFirst ? 0 : handleLen,
      outLength: isLast ? 0 : handleLen,
      handleMode: 'angle',
    });
  }

  return pts;
}

export function buildParametricLinePoints(data: ParametricData = {}): BezierPoint[] {
  const cx = data.cx ?? 0;
  const cy = data.cy ?? 0;
  const length = data.length ?? 160;
  const rad = ((data.angle ?? 0) * Math.PI) / 180;
  const half = length / 2;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;

  return [
    {
      id: 'line_start',
      x: cx - dx,
      y: cy - dy,
      angle: rad,
      inLength: 0,
      outLength: 0,
      handleMode: 'broken',
    },
    {
      id: 'line_end',
      x: cx + dx,
      y: cy + dy,
      angle: rad,
      inLength: 0,
      outLength: 0,
      handleMode: 'broken',
    },
  ];
}

/**
 * Expands sharp corners with cornerRadius > 0 into smooth rounded Bezier points.
 */
export function expandCornerRadius(
  points: BezierPoint[],
  closed: boolean,
): BezierPoint[] {
  if (points.length < 3) return points;
  const hasRadius = points.some((p) => (p.cornerRadius ?? 0) > 0);
  if (!hasRadius) return points;

  const out: BezierPoint[] = [];
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const curr = points[i]!;
    const r = curr.cornerRadius ?? 0;
    const isEnd = !closed && (i === 0 || i === n - 1);
    if (r <= 0 || isEnd || (curr.inLength > 0 && curr.outLength > 0)) {
      out.push(curr);
      continue;
    }

    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;

    const vx1 = prev.x - curr.x;
    const vy1 = prev.y - curr.y;
    const vx2 = next.x - curr.x;
    const vy2 = next.y - curr.y;

    const len1 = Math.hypot(vx1, vy1);
    const len2 = Math.hypot(vx2, vy2);
    if (len1 < 1e-4 || len2 < 1e-4) {
      out.push(curr);
      continue;
    }

    const u1x = vx1 / len1;
    const u1y = vy1 / len1;
    const u2x = vx2 / len2;
    const u2y = vy2 / len2;

    const dot = Math.max(-0.999, Math.min(0.999, u1x * u2x + u1y * u2y));
    const angle = Math.acos(dot);
    if (angle < 1e-3 || Math.abs(Math.PI - angle) < 1e-3) {
      out.push(curr);
      continue;
    }

    const maxTrim = Math.min(len1 * 0.45, len2 * 0.45);
    const trim = Math.min(maxTrim, r / Math.tan(angle / 2));
    const effR = trim * Math.tan(angle / 2);
    const k = (4 / 3) * Math.tan((Math.PI - angle) / 4) * effR;

    const pInX = curr.x + u1x * trim;
    const pInY = curr.y + u1y * trim;
    const pOutX = curr.x + u2x * trim;
    const pOutY = curr.y + u2y * trim;

    out.push({
      id: `${curr.id}_r1`,
      x: pInX,
      y: pInY,
      angle: Math.atan2(-u1y, -u1x),
      inLength: 0,
      outLength: k,
      handleMode: 'broken',
      outAngle: Math.atan2(-u1y, -u1x),
    });
    out.push({
      id: `${curr.id}_r2`,
      x: pOutX,
      y: pOutY,
      angle: Math.atan2(u2y, u2x),
      inLength: k,
      outLength: 0,
      handleMode: 'broken',
      outAngle: Math.atan2(u2y, u2x),
    });
  }

  return out;
}

export function getEffectiveContours(path: VectorPath): {
  contours: BezierPoint[][];
  closed: boolean;
} {
  if (path.type === 'parametric_ellipse') {
    const contours = buildParametricEllipseContours(path.parametricData);
    return { contours, closed: true };
  }
  if (path.type === 'parametric_line') {
    return {
      contours: [buildParametricLinePoints(path.parametricData)],
      closed: false,
    };
  }
  return {
    contours: [expandCornerRadius(path.points, path.closed)],
    closed: path.closed,
  };
}

export function contourToSegments(
  points: BezierPoint[],
  closed: boolean,
): CubicSegment[] {
  if (points.length < 2) return [];
  const segs: CubicSegment[] = [];
  const limit = closed ? points.length : points.length - 1;

  for (let i = 0; i < limit; i++) {
    const p0 = points[i]!;
    const p1 = points[(i + 1) % points.length]!;
    const h0 = getPointHandles(p0);
    const h1 = getPointHandles(p1);
    segs.push({
      p0: { x: p0.x, y: p0.y },
      c1: h0.outHandle,
      c2: h1.inHandle,
      p1: { x: p1.x, y: p1.y },
    });
  }
  return segs;
}

export function evaluateCubic(seg: CubicSegment, t: number): Vec2 {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x:
      mt2 * mt * seg.p0.x +
      3 * mt2 * t * seg.c1.x +
      3 * mt * t2 * seg.c2.x +
      t2 * t * seg.p1.x,
    y:
      mt2 * mt * seg.p0.y +
      3 * mt2 * t * seg.c1.y +
      3 * mt * t2 * seg.c2.y +
      t2 * t * seg.p1.y,
  };
}

export function sampleContourPoints(
  points: BezierPoint[],
  closed: boolean,
  stepsPerSegment = 16,
): Vec2[] {
  const segs = contourToSegments(points, closed);
  if (segs.length === 0) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }
  const sampled: Vec2[] = [];
  for (const seg of segs) {
    for (let i = 0; i < stepsPerSegment; i++) {
      sampled.push(evaluateCubic(seg, i / stepsPerSegment));
    }
  }
  const lastSeg = segs[segs.length - 1]!;
  sampled.push({ ...lastSeg.p1 });
  return sampled;
}

export function getPathSamplePoints(path: VectorPath, stepsPerSegment = 14): Vec2[] {
  const { contours, closed } = getEffectiveContours(path);
  const all: Vec2[] = [];
  for (const contour of contours) {
    all.push(...sampleContourPoints(contour, closed, stepsPerSegment));
  }
  return all;
}

export function distancePointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function isPointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
