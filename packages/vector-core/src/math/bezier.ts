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
  const startDeg = data.startAngle ?? -90;

  const outer = buildEllipseArc(cx, cy, rx, ry, startDeg, startDeg + sweepDeg, sweepDeg >= 359.99, false);
  if (holeRatio <= 0.001) {
    return [outer];
  }

  const irx = rx * holeRatio;
  const iry = ry * holeRatio;
  if (sweepDeg >= 359.99) {
    // Full donut: outer CW, inner CCW so even-odd fill cuts out the hole cleanly
    const inner = buildEllipseArc(cx, cy, irx, iry, startDeg, startDeg + 360, true, true);
    return [outer, inner];
  }

  // Partial sector ring: outer forward + inner backward into one closed contour
  const innerRev = buildEllipseArc(cx, cy, irx, iry, startDeg + sweepDeg, startDeg, false, false);
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

export function buildParametricRectPoints(data: ParametricData = {}): BezierPoint[] {
  const cx = data.cx ?? 0;
  const cy = data.cy ?? 0;
  const w = Math.max(2, data.width ?? 160);
  const h = Math.max(2, data.height ?? 120);
  const r = Math.max(0, Math.min(Math.min(w, h) / 2, data.roundness ?? 0));
  const hw = w / 2;
  const hh = h / 2;

  return [
    { id: 'rect_tl', x: cx - hw, y: cy - hh, angle: 0, inLength: 0, outLength: 0, handleMode: 'broken', cornerRadius: r },
    { id: 'rect_tr', x: cx + hw, y: cy - hh, angle: 0, inLength: 0, outLength: 0, handleMode: 'broken', cornerRadius: r },
    { id: 'rect_br', x: cx + hw, y: cy + hh, angle: 0, inLength: 0, outLength: 0, handleMode: 'broken', cornerRadius: r },
    { id: 'rect_bl', x: cx - hw, y: cy + hh, angle: 0, inLength: 0, outLength: 0, handleMode: 'broken', cornerRadius: r },
  ];
}

export function buildParametricStarPoints(data: ParametricData = {}): BezierPoint[] {
  const cx = data.cx ?? 0;
  const cy = data.cy ?? 0;
  const count = Math.max(3, Math.min(32, Math.round(data.pointsCount ?? 5)));
  const outerR = Math.max(4, data.outerRadius ?? 100);
  const innerR = Math.max(2, data.innerRadius ?? 45);
  const isPoly = Boolean(data.isPolygon);

  const pts: BezierPoint[] = [];
  const totalVerts = isPoly ? count : count * 2;
  const step = (Math.PI * 2) / totalVerts;

  for (let i = 0; i < totalVerts; i++) {
    const theta = -Math.PI / 2 + i * step;
    const rad = isPoly || i % 2 === 0 ? outerR : innerR;
    pts.push({
      id: `star_${i}`,
      x: cx + Math.cos(theta) * rad,
      y: cy + Math.sin(theta) * rad,
      angle: theta + Math.PI / 2,
      inLength: 0,
      outLength: 0,
      handleMode: 'broken',
      cornerRadius: data.roundness ?? 0,
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

    const smoothness = Math.max(0, Math.min(100, curr.cornerSmoothness ?? 0)) / 100;
    const maxTrim = Math.min(len1 * 0.48, len2 * 0.48);
    const baseTrim = Math.min(maxTrim, r / Math.tan(angle / 2));
    const trim = Math.min(maxTrim, baseTrim * (1 + 0.32 * smoothness));
    const effR = baseTrim * Math.tan(angle / 2);
    const k = (4 / 3) * Math.tan((Math.PI - angle) / 4) * effR * (1 + 0.25 * smoothness);

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

/**
 * Automatically computes smooth Catmull-Rom / RotoBezier handles from neighboring vertices.
 */
export function applyRotoBezier(
  points: BezierPoint[],
  closed: boolean,
  tension = 0.28,
): BezierPoint[] {
  const n = points.length;
  if (n < 2) return points;
  return points.map((pt, i) => {
    const isEndpoint = !closed && (i === 0 || i === n - 1);
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    if (isEndpoint) {
      const target = i === 0 ? next : prev;
      const dx = target.x - pt.x;
      const dy = target.y - pt.y;
      const len = Math.hypot(dx, dy) * tension;
      return {
        ...pt,
        angle: Math.atan2(dy, dx) + (i === n - 1 ? Math.PI : 0),
        inLength: i === n - 1 ? len : 0,
        outLength: i === 0 ? len : 0,
        handleMode: 'angle',
        outAngle: undefined,
      };
    }
    const vx = next.x - prev.x;
    const vy = next.y - prev.y;
    const angle = Math.atan2(vy, vx);
    const dIn = distance(prev, pt) * tension;
    const dOut = distance(pt, next) * tension;
    return {
      ...pt,
      angle,
      inLength: dIn,
      outLength: dOut,
      handleMode: 'angle',
      outAngle: undefined,
    };
  });
}

/**
 * Splits a path contour at the nearest point/segment to a click position (Scissors tool).
 * Closed paths become a single open path starting/ending at the split point;
 * open paths are split into two separate BezierPoint arrays.
 */
export function splitPathAtPosition(
  points: BezierPoint[],
  closed: boolean,
  localClick: Vec2,
): { first: BezierPoint[]; second: BezierPoint[] | null; closed: boolean } {
  if (points.length < 2) {
    return { first: points, second: null, closed };
  }

  // Find closest vertex or segment midpoint
  let bestIdx = 0;
  let bestDist = Infinity;
  let insertPt: Vec2 | null = null;
  let segIndex = -1;

  for (let i = 0; i < points.length; i++) {
    const d = distance(localClick, points[i]!);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  if (bestDist > 12) {
    const limit = closed ? points.length : points.length - 1;
    let bestSegDist = Infinity;
    for (let i = 0; i < limit; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const d = distancePointToSegment(localClick, a, b);
      if (d < bestSegDist) {
        bestSegDist = d;
        segIndex = i;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy || 1;
        const t = Math.max(0.05, Math.min(0.95, ((localClick.x - a.x) * dx + (localClick.y - a.y) * dy) / lenSq));
        insertPt = { x: a.x + dx * t, y: a.y + dy * t };
      }
    }
  }

  if (insertPt && segIndex >= 0) {
    const a = points[segIndex]!;
    const b = points[(segIndex + 1) % points.length]!;
    const cutPoint: BezierPoint = {
      id: `cut_${Date.now().toString(36)}_${segIndex}`,
      x: insertPt.x,
      y: insertPt.y,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      inLength: 0,
      outLength: 0,
      handleMode: 'broken',
    };
    if (closed) {
      const reordered: BezierPoint[] = [
        cutPoint,
        ...points.slice(segIndex + 1),
        ...points.slice(0, segIndex + 1),
        { ...cutPoint, id: `${cutPoint.id}_end` },
      ];
      return { first: reordered, second: null, closed: false };
    }
    const first = [...points.slice(0, segIndex + 1), cutPoint];
    const second = [{ ...cutPoint, id: `${cutPoint.id}_2` }, ...points.slice(segIndex + 1)];
    return { first, second, closed: false };
  }

  if (closed) {
    const head = points[bestIdx]!;
    const rotated = [
      ...points.slice(bestIdx),
      ...points.slice(0, bestIdx),
      { ...head, id: `${head.id}_cut_end`, outLength: 0 },
    ];
    return { first: rotated, second: null, closed: false };
  }

  if (bestIdx <= 0 || bestIdx >= points.length - 1) {
    return { first: points, second: null, closed: false };
  }
  const splitVert = points[bestIdx]!;
  return {
    first: points.slice(0, bestIdx + 1),
    second: [{ ...splitVert, id: `${splitVert.id}_2`, inLength: 0 }, ...points.slice(bestIdx + 1)],
    closed: false,
  };
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
  if (path.type === 'parametric_rect') {
    const rectPts = buildParametricRectPoints(path.parametricData);
    return {
      contours: [expandCornerRadius(rectPts, true)],
      closed: true,
    };
  }
  if (path.type === 'parametric_star') {
    const starPts = buildParametricStarPoints(path.parametricData);
    return {
      contours: [expandCornerRadius(starPts, true)],
      closed: true,
    };
  }
  const basePts = path.rotoBezier
    ? applyRotoBezier(path.points, path.closed)
    : path.points;
  return {
    contours: [expandCornerRadius(basePts, path.closed)],
    closed: path.closed,
  };
}

/**
 * Slides a point along its tangent by a normalized slide factor (-1..+1)
 * without moving the tips of its incoming/outgoing handles.
 */
export function slidePointByFactor(
  pt: BezierPoint,
  factor: number,
): BezierPoint {
  const clamped = Math.max(-0.98, Math.min(0.98, factor));
  const handles = getPointHandles(pt);
  const deltaDist =
    clamped >= 0
      ? clamped * pt.outLength
      : clamped * pt.inLength;

  const state = beginSlideDrag(pt);
  return applySlideDrag(
    pt,
    Math.cos(pt.angle) * deltaDist,
    Math.sin(pt.angle) * deltaDist,
    state,
    (p) => p,
  );
  // Note: handles variable kept for clarity; slideState already preserves fixed world handle tips
  void handles;
}

/**
 * Trims a sampled polyline between normalized [startPct, endPct] (0..100) + offsetDeg.
 */
export function trimPolyline(
  poly: Vec2[],
  startPct: number,
  endPct: number,
  offsetDeg = 0,
): Vec2[] {
  if (poly.length < 2) return poly;
  const s = Math.max(0, Math.min(1, Math.min(startPct, endPct) / 100));
  const e = Math.max(0, Math.min(1, Math.max(startPct, endPct) / 100));
  if (s <= 0.001 && e >= 0.999) return poly;
  if (e - s < 0.001) return [];

  const cumLen: number[] = [0];
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
    total += distance(poly[i - 1]!, poly[i]!);
    cumLen.push(total);
  }
  if (total < 1e-4) return poly;

  const shift = (((offsetDeg % 360) + 360) % 360) / 360;
  const startD = ((s + shift) % 1) * total;
  const endD = startD + (e - s) * total;

  const sampleAt = (distTarget: number): Vec2 => {
    const wrapped = ((distTarget % total) + total) % total;
    for (let i = 1; i < cumLen.length; i++) {
      const d0 = cumLen[i - 1]!;
      const d1 = cumLen[i]!;
      if (wrapped >= d0 && wrapped <= d1) {
        const span = d1 - d0 || 1;
        const t = (wrapped - d0) / span;
        const a = poly[i - 1]!;
        const b = poly[i]!;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    return poly[poly.length - 1]!;
  };

  const out: Vec2[] = [];
  const steps = Math.max(12, Math.round((e - s) * poly.length));
  for (let i = 0; i <= steps; i++) {
    const d = startD + ((endD - startD) * i) / steps;
    out.push(sampleAt(d));
  }
  return out;
}

/**
 * Offsets a closed polygon outward (amount > 0) or inward (amount < 0)
 * using averaged edge normals at each vertex.
 */
export function offsetPolygon(poly: Vec2[], amount: number): Vec2[] {
  if (poly.length < 3 || Math.abs(amount) < 0.01) return poly;
  const n = poly.length;
  // Ensure consistent signed area orientation
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1;

  const result: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n]!;
    const curr = poly[i]!;
    const next = poly[(i + 1) % n]!;

    const e1x = curr.x - prev.x;
    const e1y = curr.y - prev.y;
    const l1 = Math.hypot(e1x, e1y) || 1;
    const n1x = (e1y / l1) * sign;
    const n1y = (-e1x / l1) * sign;

    const e2x = next.x - curr.x;
    const e2y = next.y - curr.y;
    const l2 = Math.hypot(e2x, e2y) || 1;
    const n2x = (e2y / l2) * sign;
    const n2y = (-e2x / l2) * sign;

    let nx = n1x + n2x;
    let ny = n1y + n2y;
    const nl = Math.hypot(nx, ny);
    if (nl > 1e-4) {
      nx /= nl;
      ny /= nl;
      const cosHalf = Math.max(0.35, (n1x * nx + n1y * ny));
      const dist = amount / cosHalf;
      result.push({ x: curr.x + nx * dist, y: curr.y + ny * dist });
    } else {
      result.push({ x: curr.x + n1x * amount, y: curr.y + n1y * amount });
    }
  }
  return result;
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
