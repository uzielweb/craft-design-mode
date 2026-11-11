import type {
  AxisLock,
  BBoxMode,
  SelectionMode,
  VectorDocument,
  VectorNode,
  VectorPath,
  VectorStyle,
} from '../ast/types.js';
import { isDescendantOrSelf } from '../ast/utils.js';
import {
  contourToSegments,
  getEffectiveContours,
  getPointHandles,
} from '../math/bezier.js';
import {
  applyMatrix,
  composeTransformMatrix,
  computeBoundingBoxes,
  identityMatrix,
  multiplyMatrices,
  type Mat2D,
} from '../math/transform.js';

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface RenderOverlayState {
  viewport: ViewportState;
  selectedNodeIds: string[];
  selectedPathIds: string[];
  selectedPointIds: string[];
  selectionMode: SelectionMode;
  bboxMode: BBoxMode;
  isolationStack: string[];
  outlineView: boolean;
  transparencyGrid: boolean;
  lockAxis: AxisLock;
  penDraftPoints?: Array<{ x: number; y: number }>;
}

export function fitViewportToDocument(
  doc: VectorDocument,
  canvasWidth: number,
  canvasHeight: number,
  padding = 48,
): ViewportState {
  const availW = Math.max(64, canvasWidth - padding * 2);
  const availH = Math.max(64, canvasHeight - padding * 2);
  const zoom = Math.min(availW / doc.width, availH / doc.height, 2);
  const panX = (canvasWidth - doc.width * zoom) / 2;
  const panY = (canvasHeight - doc.height * zoom) / 2;
  return { zoom, panX, panY };
}

export function screenToWorld(
  viewport: ViewportState,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: (screenX - viewport.panX) / viewport.zoom,
    y: (screenY - viewport.panY) / viewport.zoom,
  };
}

export function worldToScreen(
  viewport: ViewportState,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  return {
    x: worldX * viewport.zoom + viewport.panX,
    y: worldY * viewport.zoom + viewport.panY,
  };
}

function drawTransparencyGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cellSize = 16,
): void {
  ctx.fillStyle = '#1f232b';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#2a2f3a';
  for (let y = 0; y < height; y += cellSize) {
    for (let x = 0; x < width; x += cellSize) {
      if (((x / cellSize + y / cellSize) | 0) % 2 === 0) {
        ctx.fillRect(x, y, Math.min(cellSize, width - x), Math.min(cellSize, height - y));
      }
    }
  }
}

function tracePathContours(
  ctx: CanvasRenderingContext2D,
  path: VectorPath,
): void {
  const { contours, closed } = getEffectiveContours(path);
  ctx.beginPath();
  for (const contour of contours) {
    if (contour.length === 0) continue;
    const first = contour[0]!;
    ctx.moveTo(first.x, first.y);
    const segs = contourToSegments(contour, closed);
    for (const seg of segs) {
      ctx.bezierCurveTo(seg.c1.x, seg.c1.y, seg.c2.x, seg.c2.y, seg.p1.x, seg.p1.y);
    }
    if (closed) ctx.closePath();
  }
}

function resolveCanvasFill(
  ctx: CanvasRenderingContext2D,
  style: VectorStyle | undefined,
): string | CanvasGradient | null {
  const fill = style?.fill;
  if (!fill) return null;
  if (fill.gradient) {
    const g =
      fill.gradient.type === 'radial'
        ? ctx.createRadialGradient(
            fill.gradient.x1,
            fill.gradient.y1,
            0,
            fill.gradient.x2,
            fill.gradient.y2,
            Math.hypot(fill.gradient.x2 - fill.gradient.x1, fill.gradient.y2 - fill.gradient.y1) || 100,
          )
        : ctx.createLinearGradient(
            fill.gradient.x1,
            fill.gradient.y1,
            fill.gradient.x2,
            fill.gradient.y2,
          );
    for (const stop of fill.gradient.stops) {
      g.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color);
    }
    return g;
  }
  return fill.color;
}

export function renderCanvas2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  doc: VectorDocument,
  overlay: RenderOverlayState,
): void {
  ctx.save();
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Outer workspace backdrop
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Apply viewport zoom/pan
  ctx.translate(overlay.viewport.panX, overlay.viewport.panY);
  ctx.scale(overlay.viewport.zoom, overlay.viewport.zoom);

  // Composition artboard background or transparency checkerboard
  if (overlay.transparencyGrid) {
    drawTransparencyGrid(ctx, doc.width, doc.height, 20);
  } else {
    ctx.fillStyle = doc.backgroundColor || '#16181d';
    ctx.fillRect(0, 0, doc.width, doc.height);
  }

  // Composition frame border
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1 / overlay.viewport.zoom;
  ctx.strokeRect(0, 0, doc.width, doc.height);

  const isolationTopId =
    overlay.isolationStack[overlay.isolationStack.length - 1] ?? null;

  const drawNode = (
    node: VectorNode,
    parentMatrix: Mat2D,
    inheritedStyle: VectorStyle | undefined,
  ) => {
    if (!node.visible) return;
    const worldMat = multiplyMatrices(
      parentMatrix,
      composeTransformMatrix(node.transform),
    );
    const activeStyle = node.style ?? inheritedStyle;
    const isDimmed =
      isolationTopId !== null &&
      !isDescendantOrSelf(doc.nodes, isolationTopId, node.id);

    if (node.paths && node.paths.length > 0) {
      ctx.save();
      ctx.transform(
        worldMat[0],
        worldMat[1],
        worldMat[2],
        worldMat[3],
        worldMat[4],
        worldMat[5],
      );
      ctx.globalAlpha = isDimmed ? 0.16 : 1;

      for (const path of node.paths) {
        tracePathContours(ctx, path);
        if (overlay.outlineView) {
          ctx.strokeStyle = isDimmed ? '#475569' : '#38bdf8';
          ctx.lineWidth = 1.25 / overlay.viewport.zoom;
          ctx.stroke();
        } else {
          const fillPaint = resolveCanvasFill(ctx, activeStyle);
          if (fillPaint && path.closed) {
            ctx.save();
            ctx.globalAlpha *= activeStyle?.fill?.opacity ?? 1;
            ctx.fillStyle = fillPaint;
            ctx.fill('evenodd');
            ctx.restore();
          }
          if (activeStyle?.stroke && activeStyle.stroke.width > 0) {
            ctx.strokeStyle = activeStyle.stroke.color;
            ctx.lineWidth = activeStyle.stroke.width;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    if (node.children) {
      for (const child of node.children) {
        drawNode(child, worldMat, activeStyle);
      }
    }
  };

  for (const root of doc.nodes) {
    drawNode(root, identityMatrix(), root.style);
  }

  // Axis Lock guides
  if (overlay.lockAxis === 'x') {
    ctx.save();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
    ctx.setLineDash([6 / overlay.viewport.zoom, 4 / overlay.viewport.zoom]);
    ctx.lineWidth = 1.2 / overlay.viewport.zoom;
    ctx.beginPath();
    ctx.moveTo(0, doc.height / 2);
    ctx.lineTo(doc.width, doc.height / 2);
    ctx.stroke();
    ctx.restore();
  } else if (overlay.lockAxis === 'y') {
    ctx.save();
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.7)';
    ctx.setLineDash([6 / overlay.viewport.zoom, 4 / overlay.viewport.zoom]);
    ctx.lineWidth = 1.2 / overlay.viewport.zoom;
    ctx.beginPath();
    ctx.moveTo(doc.width / 2, 0);
    ctx.lineTo(doc.width / 2, doc.height);
    ctx.stroke();
    ctx.restore();
  }

  // Bounding Boxes Overlay (3 modes)
  const bboxes = computeBoundingBoxes(
    doc.nodes,
    overlay.selectedNodeIds,
    overlay.bboxMode,
  );
  const invZ = 1 / overlay.viewport.zoom;
  for (const box of bboxes) {
    ctx.save();
    ctx.strokeStyle =
      overlay.bboxMode === 'individual_object' ? '#f59e0b' : '#38bdf8';
    ctx.lineWidth = 1.5 * invZ;
    ctx.beginPath();
    ctx.moveTo(box.corners[0].x, box.corners[0].y);
    ctx.lineTo(box.corners[1].x, box.corners[1].y);
    ctx.lineTo(box.corners[2].x, box.corners[2].y);
    ctx.lineTo(box.corners[3].x, box.corners[3].y);
    ctx.closePath();
    ctx.stroke();

    // Corner handles
    const hs = 4 * invZ;
    ctx.fillStyle = '#ffffff';
    for (const c of box.corners) {
      ctx.fillRect(c.x - hs, c.y - hs, hs * 2, hs * 2);
      ctx.strokeRect(c.x - hs, c.y - hs, hs * 2, hs * 2);
    }
    ctx.restore();
  }

  // Selected Path Bezier Points & Handles Gizmos
  const selectedPathSet = new Set(overlay.selectedPathIds);
  const selectedPointSet = new Set(overlay.selectedPointIds);
  if (selectedPathSet.size > 0) {
    const drawPathGizmos = (node: VectorNode, parentMat: Mat2D) => {
      const worldMat = multiplyMatrices(
        parentMat,
        composeTransformMatrix(node.transform),
      );
      if (node.paths) {
        for (const path of node.paths) {
          if (!selectedPathSet.has(path.id) || path.type !== 'path') continue;
          ctx.save();
          for (const pt of path.points) {
            const pWorld = applyMatrix(worldMat, pt.x, pt.y);
            const handles = getPointHandles(pt);
            const inWorld = applyMatrix(
              worldMat,
              handles.inHandle.x,
              handles.inHandle.y,
            );
            const outWorld = applyMatrix(
              worldMat,
              handles.outHandle.x,
              handles.outHandle.y,
            );

            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1 * invZ;
            if (pt.inLength > 0.5) {
              ctx.beginPath();
              ctx.moveTo(pWorld.x, pWorld.y);
              ctx.lineTo(inWorld.x, inWorld.y);
              ctx.stroke();
              ctx.fillStyle = '#38bdf8';
              ctx.beginPath();
              ctx.arc(inWorld.x, inWorld.y, 3.5 * invZ, 0, Math.PI * 2);
              ctx.fill();
            }
            if (pt.outLength > 0.5) {
              ctx.beginPath();
              ctx.moveTo(pWorld.x, pWorld.y);
              ctx.lineTo(outWorld.x, outWorld.y);
              ctx.stroke();
              ctx.fillStyle = '#38bdf8';
              ctx.beginPath();
              ctx.arc(outWorld.x, outWorld.y, 3.5 * invZ, 0, Math.PI * 2);
              ctx.fill();
            }

            const isPtSelected = selectedPointSet.has(pt.id);
            const ps = 4.5 * invZ;
            ctx.fillStyle = isPtSelected ? '#f59e0b' : '#ffffff';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.5 * invZ;
            ctx.fillRect(pWorld.x - ps, pWorld.y - ps, ps * 2, ps * 2);
            ctx.strokeRect(pWorld.x - ps, pWorld.y - ps, ps * 2, ps * 2);
          }
          ctx.restore();
        }
      }
      if (node.children) {
        for (const child of node.children) {
          drawPathGizmos(child, worldMat);
        }
      }
    };
    for (const root of doc.nodes) {
      drawPathGizmos(root, identityMatrix());
    }
  }

  // Pen tool live preview
  if (overlay.penDraftPoints && overlay.penDraftPoints.length > 0) {
    ctx.save();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.5 * invZ;
    ctx.beginPath();
    ctx.moveTo(overlay.penDraftPoints[0]!.x, overlay.penDraftPoints[0]!.y);
    for (let i = 1; i < overlay.penDraftPoints.length; i++) {
      ctx.lineTo(overlay.penDraftPoints[i]!.x, overlay.penDraftPoints[i]!.y);
    }
    ctx.stroke();
    for (const p of overlay.penDraftPoints) {
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(p.x - 3 * invZ, p.y - 3 * invZ, 6 * invZ, 6 * invZ);
    }
    ctx.restore();
  }

  ctx.restore();
}
