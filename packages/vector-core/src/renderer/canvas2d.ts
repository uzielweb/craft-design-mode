import type {
  AxisLock,
  BBoxMode,
  OffsetPathsOperator,
  RepeaterOperator,
  SelectionMode,
  TrimPathsOperator,
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
  offsetPolygon,
  sampleContourPoints,
  trimPolyline,
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
  keyObjectId?: string | null;
  selectionMode: SelectionMode;
  bboxMode: BBoxMode;
  isolationStack: string[];
  outlineView: boolean;
  transparencyGrid: boolean;
  showBounds?: boolean;
  showPixelGrid?: boolean;
  lockAxis: AxisLock;
  activeTool?: string;
  customPivot?: { x: number; y: number } | null;
  penDraftPoints?: Array<{ x: number; y: number }>;
  cornerPreview?: { worldX: number; worldY: number; radiusPx: number } | null;
  widthPreview?: { worldX: number; worldY: number; widthPx: number } | null;
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

  // Pixel Grid overlay (when toggled on)
  if (overlay.showPixelGrid) {
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 0.75 / overlay.viewport.zoom;
    const step = overlay.viewport.zoom >= 3 ? 10 : 40;
    ctx.beginPath();
    for (let gx = step; gx < doc.width; gx += step) {
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, doc.height);
    }
    for (let gy = step; gy < doc.height; gy += step) {
      ctx.moveTo(0, gy);
      ctx.lineTo(doc.width, gy);
    }
    ctx.stroke();
    ctx.restore();
  }

  const isolationTopId =
    overlay.isolationStack[overlay.isolationStack.length - 1] ?? null;

  const mapBlendMode = (bm?: string): GlobalCompositeOperation => {
    switch (bm) {
      case 'multiply':
      case 'screen':
      case 'overlay':
      case 'darken':
      case 'lighten':
      case 'color-dodge':
      case 'difference':
        return bm;
      default:
        return 'source-over';
    }
  };

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
    const nodeOpacity = (node.transform.opacity ?? 100) / 100;
    const nodeAlpha = (isDimmed ? 0.16 : 1) * nodeOpacity;
    const nodeComposite = mapBlendMode(node.blendMode);

    if (node.type === 'text' && node.textContent !== undefined) {
      ctx.save();
      ctx.transform(
        worldMat[0],
        worldMat[1],
        worldMat[2],
        worldMat[3],
        worldMat[4],
        worldMat[5],
      );
      if (node.textScaleX || node.textScaleY) {
        ctx.scale((node.textScaleX ?? 100) / 100, (node.textScaleY ?? 100) / 100);
      }
      ctx.globalAlpha = nodeAlpha;
      ctx.globalCompositeOperation = nodeComposite;
      const fontPx = node.fontSize ?? 48;
      const italic = node.fauxItalic ? 'italic ' : '';
      const weight =
        node.fauxBold || node.fontStyle?.toLowerCase().includes('bold')
          ? '700 '
          : node.fontStyle?.toLowerCase().includes('medium')
            ? '500 '
            : '400 ';
      ctx.font = `${italic}${weight}${fontPx}px "${node.fontFamily ?? 'Inter'}", sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = node.textAlign ?? 'center';
      const displayText = node.allCaps
        ? node.textContent.toUpperCase()
        : node.textContent;
      const yShift = -(node.baselineShift ?? 0);

      if (overlay.outlineView) {
        ctx.strokeStyle = isDimmed ? '#475569' : '#38bdf8';
        ctx.lineWidth = 1.25 / overlay.viewport.zoom;
        ctx.strokeText(displayText, 0, yShift);
      } else {
        if (node.textFillEnabled !== false) {
          const fillPaint = resolveCanvasFill(ctx, activeStyle) ?? '#f8fafc';
          ctx.fillStyle = fillPaint;
          ctx.fillText(displayText, 0, yShift);
        }
        if (
          (node.textStrokeEnabled ?? Boolean(activeStyle?.stroke)) &&
          activeStyle?.stroke &&
          activeStyle.stroke.width > 0
        ) {
          ctx.strokeStyle = activeStyle.stroke.color;
          ctx.lineWidth = activeStyle.stroke.width;
          ctx.strokeText(displayText, 0, yShift);
        }
      }
      ctx.restore();
    }

    if (node.paths && node.paths.length > 0) {
      const trimOp = node.operators?.find(
        (o): o is TrimPathsOperator => o.enabled && o.type === 'trim_paths',
      );
      const offsetOp = node.operators?.find(
        (o): o is OffsetPathsOperator => o.enabled && o.type === 'offset_paths',
      );
      const repeaterOp = node.operators?.find(
        (o): o is RepeaterOperator => o.enabled && o.type === 'repeater',
      );
      const copies = repeaterOp ? Math.max(1, Math.min(24, Math.round(repeaterOp.copies))) : 1;

      for (let rep = 0; rep < copies; rep++) {
        ctx.save();
        ctx.transform(
          worldMat[0],
          worldMat[1],
          worldMat[2],
          worldMat[3],
          worldMat[4],
          worldMat[5],
        );
        if (repeaterOp && rep > 0) {
          ctx.translate(repeaterOp.offsetX * rep, repeaterOp.offsetY * rep);
          ctx.rotate(((repeaterOp.rotation * rep) * Math.PI) / 180);
          const s = Math.pow(repeaterOp.scale || 1, rep);
          ctx.scale(s, s);
        }
        ctx.globalAlpha = nodeAlpha;
        ctx.globalCompositeOperation = nodeComposite;

        for (const path of node.paths) {
          if (offsetOp && Math.abs(offsetOp.amount) > 0.01) {
            const { contours, closed } = getEffectiveContours(path);
            ctx.beginPath();
            for (const c of contours) {
              const poly = offsetPolygon(sampleContourPoints(c, closed, 14), offsetOp.amount);
              if (poly.length > 0) {
                ctx.moveTo(poly[0]!.x, poly[0]!.y);
                for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k]!.x, poly[k]!.y);
                if (closed) ctx.closePath();
              }
            }
          } else {
            tracePathContours(ctx, path);
          }

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
              const stroke = activeStyle.stroke;
              const hasTaper =
                (stroke.taperStart ?? 0) > 0.005 || (stroke.taperEnd ?? 0) > 0.005;

              if (trimOp && trimOp.type === 'trim_paths') {
                const { contours, closed } = getEffectiveContours(path);
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = stroke.width;
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                for (const c of contours) {
                  const trimmed = trimPolyline(
                    sampleContourPoints(c, closed, 16),
                    trimOp.start,
                    trimOp.end,
                    trimOp.offset,
                  );
                  if (trimmed.length >= 2) {
                    ctx.beginPath();
                    ctx.moveTo(trimmed[0]!.x, trimmed[0]!.y);
                    for (let k = 1; k < trimmed.length; k++) {
                      ctx.lineTo(trimmed[k]!.x, trimmed[k]!.y);
                    }
                    ctx.stroke();
                  }
                }
              } else if (hasTaper) {
                const { contours, closed } = getEffectiveContours(path);
                ctx.strokeStyle = stroke.color;
                ctx.lineCap = 'round';
                for (const c of contours) {
                  const pts = sampleContourPoints(c, closed, 18);
                  const totalSegs = Math.max(1, pts.length - 1);
                  const tStart = stroke.taperStart ?? 0;
                  const tEnd = stroke.taperEnd ?? 0;
                  const wStart = stroke.taperStartWidth ?? 0.1;
                  const wEnd = stroke.taperEndWidth ?? 0.1;
                  for (let k = 0; k < totalSegs; k++) {
                    const u = k / totalSegs;
                    let mult = 1;
                    if (tStart > 0 && u < tStart) {
                      mult = wStart + (1 - wStart) * (u / tStart);
                    } else if (tEnd > 0 && u > 1 - tEnd) {
                      mult = wEnd + (1 - wEnd) * ((1 - u) / tEnd);
                    }
                    ctx.beginPath();
                    ctx.lineWidth = Math.max(0.5, stroke.width * mult);
                    ctx.moveTo(pts[k]!.x, pts[k]!.y);
                    ctx.lineTo(pts[k + 1]!.x, pts[k + 1]!.y);
                    ctx.stroke();
                  }
                }
              } else {
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = stroke.width;
                ctx.lineJoin = stroke.lineJoin ?? 'round';
                ctx.lineCap = stroke.lineCap ?? 'round';
                ctx.stroke();
              }
            }
          }
        }
        ctx.restore();
      }
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

  // Bounding Boxes Overlay (3 modes + midpoint handles + center anchor)
  const bboxes =
    overlay.showBounds === false
      ? []
      : computeBoundingBoxes(doc.nodes, overlay.selectedNodeIds, overlay.bboxMode);
  const invZ = 1 / overlay.viewport.zoom;
  for (const box of bboxes) {
    ctx.save();
    const isKeyObj = overlay.keyObjectId && box.id === overlay.keyObjectId;
    ctx.strokeStyle = isKeyObj
      ? '#10b981'
      : overlay.bboxMode === 'individual_object'
        ? '#f59e0b'
        : '#38bdf8';
    ctx.lineWidth = (isKeyObj ? 2.5 : 1.5) * invZ;
    ctx.beginPath();
    ctx.moveTo(box.corners[0].x, box.corners[0].y);
    ctx.lineTo(box.corners[1].x, box.corners[1].y);
    ctx.lineTo(box.corners[2].x, box.corners[2].y);
    ctx.lineTo(box.corners[3].x, box.corners[3].y);
    ctx.closePath();
    ctx.stroke();

    // 8 handles: 4 corners + 4 edge midpoints
    const hs = 3.5 * invZ;
    ctx.fillStyle = '#ffffff';
    const edgeMids = [0, 1, 2, 3].map((i) => {
      const a = box.corners[i]!;
      const b = box.corners[(i + 1) % 4]!;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    });
    for (const c of [...box.corners, ...edgeMids]) {
      ctx.fillRect(c.x - hs, c.y - hs, hs * 2, hs * 2);
      ctx.strokeRect(c.x - hs, c.y - hs, hs * 2, hs * 2);
    }
    // Center Anchor crosshair
    const cr = 4 * invZ;
    ctx.beginPath();
    ctx.arc(box.center.x, box.center.y, cr, 0, Math.PI * 2);
    ctx.moveTo(box.center.x - cr * 1.4, box.center.y);
    ctx.lineTo(box.center.x + cr * 1.4, box.center.y);
    ctx.moveTo(box.center.x, box.center.y - cr * 1.4);
    ctx.lineTo(box.center.x, box.center.y + cr * 1.4);
    ctx.stroke();
    ctx.restore();
  }

  // On-Canvas Parametric Handles (Rect Corner Widgets, DM Ellipse Arc/Ratio, Path Corner Widgets)
  if (overlay.showBounds !== false && overlay.selectedNodeIds.length > 0) {
    const selectedNodeSet = new Set(overlay.selectedNodeIds);
    const drawParametricWidgets = (node: VectorNode, parentMat: Mat2D) => {
      const worldMat = multiplyMatrices(parentMat, composeTransformMatrix(node.transform));
      if (selectedNodeSet.has(node.id) && node.paths) {
        for (const p of node.paths) {
          if (p.type === 'parametric_rect' && p.parametricData) {
            const w = p.parametricData.width ?? 160;
            const h = p.parametricData.height ?? 120;
            const inset = Math.min(Math.min(w, h) * 0.42, Math.max(12, p.parametricData.roundness ?? 12));
            const corners = [
              { x: -w / 2 + inset, y: -h / 2 + inset },
              { x: w / 2 - inset, y: -h / 2 + inset },
              { x: w / 2 - inset, y: h / 2 - inset },
              { x: -w / 2 + inset, y: h / 2 - inset },
            ];
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.5 * invZ;
            for (const c of corners) {
              const wc = applyMatrix(worldMat, c.x, c.y);
              ctx.beginPath();
              ctx.arc(wc.x, wc.y, 4.5 * invZ, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
            ctx.restore();
          } else if (p.type === 'parametric_ellipse' && p.parametricData) {
            const rx = p.parametricData.rx ?? 100;
            const ry = p.parametricData.ry ?? 100;
            const startRad = ((p.parametricData.startAngle ?? -90) * Math.PI) / 180;
            const sweepRad = ((p.parametricData.sweep ?? 360) * Math.PI) / 180;
            const holeRatio = p.parametricData.holeRatio ?? 0;

            const startPt = applyMatrix(worldMat, Math.cos(startRad) * rx * 0.82, Math.sin(startRad) * ry * 0.82);
            const sweepPt = applyMatrix(worldMat, Math.cos(startRad + sweepRad) * rx * 0.82, Math.sin(startRad + sweepRad) * ry * 0.82);
            const ratioRad = startRad + sweepRad / 2;
            const ratioPt = applyMatrix(worldMat, Math.cos(ratioRad) * rx * Math.max(0.15, holeRatio), Math.sin(ratioRad) * ry * Math.max(0.15, holeRatio));

            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.5 * invZ;
            for (const hp of [startPt, sweepPt, ratioPt]) {
              ctx.beginPath();
              ctx.arc(hp.x, hp.y, 4.5 * invZ, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
            ctx.restore();
          }
        }
      }
      if (node.children) {
        for (const ch of node.children) drawParametricWidgets(ch, worldMat);
      }
    };
    for (const root of doc.nodes) drawParametricWidgets(root, identityMatrix());
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

            ctx.strokeStyle = '#ec4899';
            ctx.lineWidth = 1.2 * invZ;
            if (pt.inLength > 0.5) {
              ctx.beginPath();
              ctx.moveTo(pWorld.x, pWorld.y);
              ctx.lineTo(inWorld.x, inWorld.y);
              ctx.stroke();
              ctx.fillStyle = '#ec4899';
              ctx.beginPath();
              ctx.arc(inWorld.x, inWorld.y, 3.5 * invZ, 0, Math.PI * 2);
              ctx.fill();
            }
            if (pt.outLength > 0.5) {
              ctx.beginPath();
              ctx.moveTo(pWorld.x, pWorld.y);
              ctx.lineTo(outWorld.x, outWorld.y);
              ctx.stroke();
              ctx.fillStyle = '#ec4899';
              ctx.beginPath();
              ctx.arc(outWorld.x, outWorld.y, 3.5 * invZ, 0, Math.PI * 2);
              ctx.fill();
            }

            const isPtSelected = selectedPointSet.has(pt.id);
            const ps = 4.5 * invZ;
            ctx.fillStyle = isPtSelected ? '#ec4899' : '#ffffff';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.5 * invZ;
            ctx.fillRect(pWorld.x - ps, pWorld.y - ps, ps * 2, ps * 2);
            ctx.strokeRect(pWorld.x - ps, pWorld.y - ps, ps * 2, ps * 2);

            // Inner circular Corner Radius widget for selected sharp point
            if (isPtSelected && pt.inLength < 0.5 && pt.outLength < 0.5) {
              ctx.fillStyle = '#e0f2fe';
              ctx.strokeStyle = '#38bdf8';
              ctx.lineWidth = 1.5 * invZ;
              ctx.beginPath();
              ctx.arc(pWorld.x + 12 * invZ, pWorld.y + 12 * invZ, 4 * invZ, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
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

  // Round Corners curvature preview ring (screenshot b0ea9ff1)
  if (overlay.cornerPreview) {
    ctx.save();
    const { worldX, worldY, radiusPx } = overlay.cornerPreview;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.lineWidth = 2 * invZ;
    ctx.beginPath();
    ctx.arc(worldX, worldY, Math.max(12 * invZ, radiusPx * 2.2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Width Tool diamond node & inline badge preview (screenshot 480fc370)
  if (overlay.widthPreview) {
    ctx.save();
    const { worldX, worldY, widthPx } = overlay.widthPreview;
    const d = 6 * invZ;
    ctx.fillStyle = '#e0f2fe';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2 * invZ;
    ctx.beginPath();
    ctx.moveTo(worldX, worldY - d);
    ctx.lineTo(worldX + d, worldY);
    ctx.lineTo(worldX, worldY + d);
    ctx.lineTo(worldX - d, worldY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Pill label
    const text = `${widthPx.toFixed(1)} px`;
    ctx.font = `600 ${11 * invZ}px Inter, sans-serif`;
    const metrics = ctx.measureText(text);
    const pw = metrics.width + 10 * invZ;
    const ph = 18 * invZ;
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(worldX + 10 * invZ, worldY - ph / 2, pw, ph);
    ctx.fillStyle = '#0f172a';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, worldX + 15 * invZ, worldY);
    ctx.restore();
  }

  // Custom Pivot crosshair (Rotate/Scale tools)
  if (overlay.customPivot) {
    ctx.save();
    const px = overlay.customPivot.x;
    const py = overlay.customPivot.y;
    const r = 7 * invZ;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5 * invZ;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.moveTo(px - r * 1.6, py);
    ctx.lineTo(px + r * 1.6, py);
    ctx.moveTo(px, py - r * 1.6);
    ctx.lineTo(px, py + r * 1.6);
    ctx.stroke();
    ctx.restore();
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
