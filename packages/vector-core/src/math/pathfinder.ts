import type { BezierPoint, VectorPath } from '../ast/types.js';
import { createId } from '../ast/utils.js';
import {
  getEffectiveContours,
  isPointInPolygon,
  sampleContourPoints,
  type Vec2,
} from './bezier.js';

export type PathfinderOp = 'unite' | 'subtract' | 'intersect' | 'exclude';

interface DirectedSeg {
  a: Vec2;
  b: Vec2;
}

const EPS = 1e-4;

function samePt(p: Vec2, q: Vec2): boolean {
  return Math.hypot(p.x - q.x, p.y - q.y) < EPS;
}

function normalizeCCW(poly: Vec2[]): Vec2[] {
  const clean: Vec2[] = [];
  for (const p of poly) {
    if (clean.length === 0 || !samePt(clean[clean.length - 1]!, p)) {
      clean.push({ x: p.x, y: p.y });
    }
  }
  if (clean.length > 1 && samePt(clean[0]!, clean[clean.length - 1]!)) {
    clean.pop();
  }
  if (clean.length < 3) return clean;
  let area = 0;
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i]!;
    const b = clean[(i + 1) % clean.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area >= 0 ? clean : [...clean].reverse();
}

function segmentIntersectionT(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): { ta: number; tb: number; pt: Vec2 } | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-9) return null;

  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const ta = (dx * dby - dy * dbx) / denom;
  const tb = (dx * day - dy * dax) / denom;
  if (ta < -1e-6 || ta > 1 + 1e-6 || tb < -1e-6 || tb > 1 + 1e-6) {
    return null;
  }
  const cta = Math.max(0, Math.min(1, ta));
  const ctb = Math.max(0, Math.min(1, tb));
  return {
    ta: cta,
    tb: ctb,
    pt: { x: a1.x + cta * dax, y: a1.y + cta * day },
  };
}

function splitPolygonEdges(poly: Vec2[], other: Vec2[]): DirectedSeg[] {
  const n = poly.length;
  const m = other.length;
  const out: DirectedSeg[] = [];

  for (let i = 0; i < n; i++) {
    const a1 = poly[i]!;
    const a2 = poly[(i + 1) % n]!;
    const ts: number[] = [0, 1];

    for (let j = 0; j < m; j++) {
      const b1 = other[j]!;
      const b2 = other[(j + 1) % m]!;
      const hit = segmentIntersectionT(a1, a2, b1, b2);
      if (hit) ts.push(hit.ta);
    }

    ts.sort((x, y) => x - y);
    const uniqueTs: number[] = [ts[0]!];
    for (let k = 1; k < ts.length; k++) {
      if (ts[k]! - uniqueTs[uniqueTs.length - 1]! > 1e-5) {
        uniqueTs.push(ts[k]!);
      }
    }

    for (let k = 0; k < uniqueTs.length - 1; k++) {
      const t0 = uniqueTs[k]!;
      const t1 = uniqueTs[k + 1]!;
      const p0 = { x: a1.x + (a2.x - a1.x) * t0, y: a1.y + (a2.y - a1.y) * t0 };
      const p1 = { x: a1.x + (a2.x - a1.x) * t1, y: a1.y + (a2.y - a1.y) * t1 };
      if (!samePt(p0, p1)) {
        out.push({ a: p0, b: p1 });
      }
    }
  }
  return out;
}

function findMatchingSharedSeg(
  seg: DirectedSeg,
  candidates: DirectedSeg[],
): 'same' | 'opposite' | null {
  for (const c of candidates) {
    if (samePt(seg.a, c.a) && samePt(seg.b, c.b)) return 'same';
    if (samePt(seg.a, c.b) && samePt(seg.b, c.a)) return 'opposite';
  }
  return null;
}

function stitchSegmentsToPolygons(segs: DirectedSeg[]): Vec2[][] {
  const remaining = segs.map((s) => ({ ...s, used: false }));
  const loops: Vec2[][] = [];

  for (let i = 0; i < remaining.length; i++) {
    const start = remaining[i]!;
    if (start.used) continue;
    start.used = true;

    const loop: Vec2[] = [start.a, start.b];
    let guard = 0;
    while (!samePt(loop[loop.length - 1]!, loop[0]!) && guard++ < remaining.length + 2) {
      const tail = loop[loop.length - 1]!;
      let foundIdx = -1;
      let bestDist = 0.25;
      for (let j = 0; j < remaining.length; j++) {
        const cand = remaining[j]!;
        if (cand.used) continue;
        const d = Math.hypot(cand.a.x - tail.x, cand.a.y - tail.y);
        if (d < bestDist) {
          bestDist = d;
          foundIdx = j;
        }
      }
      if (foundIdx < 0) break;
      remaining[foundIdx]!.used = true;
      loop.push(remaining[foundIdx]!.b);
    }

    if (loop.length >= 4 && samePt(loop[loop.length - 1]!, loop[0]!)) {
      loop.pop();
      loops.push(loop);
    }
  }

  return loops;
}

/**
 * Computes a 2D boolean operation on two closed polygons (CCW normalized).
 */
export function booleanPolygons(
  polyA: Vec2[],
  polyB: Vec2[],
  op: PathfinderOp,
): Vec2[][] {
  const A = normalizeCCW(polyA);
  const B = normalizeCCW(polyB);
  if (A.length < 3 || B.length < 3) return [];

  const segsA = splitPolygonEdges(A, B);
  const segsB = splitPolygonEdges(B, A);
  const kept: DirectedSeg[] = [];

  for (const s of segsA) {
    const shared = findMatchingSharedSeg(s, segsB);
    const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
    const insideB = shared ? false : isPointInPolygon(mid, B);

    if (op === 'unite') {
      if (shared === 'same' || (!shared && !insideB)) kept.push(s);
    } else if (op === 'intersect') {
      if (shared === 'same' || (!shared && insideB)) kept.push(s);
    } else if (op === 'subtract') {
      if (shared === 'opposite' || (!shared && !insideB)) kept.push(s);
    } else if (op === 'exclude') {
      if (!shared) {
        kept.push(insideB ? { a: s.b, b: s.a } : s);
      }
    }
  }

  for (const s of segsB) {
    const shared = findMatchingSharedSeg(s, segsA);
    if (shared) continue; // Already handled on A's pass
    const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
    const insideA = isPointInPolygon(mid, A);

    if (op === 'unite') {
      if (!insideA) kept.push(s);
    } else if (op === 'intersect') {
      if (insideA) kept.push(s);
    } else if (op === 'subtract') {
      if (insideA) kept.push({ a: s.b, b: s.a });
    } else if (op === 'exclude') {
      kept.push(insideA ? { a: s.b, b: s.a } : s);
    }
  }

  return stitchSegmentsToPolygons(kept);
}

/**
 * Applies a Pathfinder boolean operation between two VectorPaths
 * (in shared world or local space) and returns resulting closed VectorPaths.
 */
export function runPathfinderOnPaths(
  pathA: VectorPath,
  pathB: VectorPath,
  op: PathfinderOp,
  transformA: (p: Vec2) => Vec2 = (p) => p,
  transformB: (p: Vec2) => Vec2 = (p) => p,
): VectorPath[] {
  const cA = getEffectiveContours(pathA);
  const cB = getEffectiveContours(pathB);
  if (!cA.contours[0] || !cB.contours[0]) return [];

  const polyA = sampleContourPoints(cA.contours[0], true, 12).map(transformA);
  const polyB = sampleContourPoints(cB.contours[0], true, 12).map(transformB);
  const loops = booleanPolygons(polyA, polyB, op);

  return loops.map((loop, idx) => ({
    id: createId('pf_path'),
    name: `${op}_${idx + 1}`,
    type: 'path',
    closed: true,
    points: simplifyPolyline(loop, 0.75).map((p, pi) => ({
      id: createId(`pf_pt_${pi}`),
      x: p.x,
      y: p.y,
      angle: 0,
      inLength: 0,
      outLength: 0,
      handleMode: 'broken',
      cornerRadius: 0,
    })),
  }));
}

function simplifyPolyline(pts: Vec2[], collinearEps: number): Vec2[] {
  if (pts.length <= 4) return pts;
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length]!;
    const curr = pts[i]!;
    const next = pts[(i + 1) % pts.length]!;
    const area2 = Math.abs(
      (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x),
    );
    const base = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
    if (area2 / base > collinearEps) {
      out.push(curr);
    }
  }
  return out.length >= 3 ? out : pts;
}
