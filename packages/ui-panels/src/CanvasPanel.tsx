import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import {
  AddNodeCommand,
  applyAxisLock,
  applyMatrix,
  applySlideDrag,
  beginSlideDrag,
  cloneValue,
  createDefaultTransform,
  createId,
  createNumericInputState,
  findNodeById,
  findPathLookup,
  fitViewportToDocument,
  getWorldMatrixForNode,
  GroupNodesCommand,
  hitTestDocument,
  invertMatrix,
  MoveNodesCommand,
  renderCanvas2D,
  screenToWorld,
  stepNumericInputMachine,
  TransformNodesCommand,
  updateHandleFromTip,
  UpdatePathPointsCommand,
  type BBoxMode,
  type BezierPoint,
  type DesignStore,
  type SlideDragState,
  type ToolType,
  type VectorNode,
} from '@design-mode/vector-core';

export interface CanvasPanelProps {
  store: DesignStore;
}

type DragSession =
  | {
      kind: 'pan';
      startScreenX: number;
      startScreenY: number;
      origPanX: number;
      origPanY: number;
    }
  | {
      kind: 'nodes';
      nodeIds: string[];
      startWorldX: number;
      startWorldY: number;
      origTransforms: Map<string, { x: number; y: number }>;
    }
  | {
      kind: 'point';
      nodeId: string;
      pathId: string;
      pointId: string;
      startWorldX: number;
      startWorldY: number;
      origPoints: BezierPoint[];
      slideState: SlideDragState | null;
    }
  | {
      kind: 'handle';
      nodeId: string;
      pathId: string;
      pointId: string;
      handleEnd: 'in' | 'out';
      origPoints: BezierPoint[];
    }
  | {
      kind: 'shape';
      tool: 'ellipse' | 'line';
      startWorldX: number;
      startWorldY: number;
      previewNodeId: string;
    };

const TOOLS: Array<{ id: ToolType; label: string; keyHint: string }> = [
  { id: 'select', label: 'Select', keyHint: 'V' },
  { id: 'pen', label: 'Pen', keyHint: 'P' },
  { id: 'ellipse', label: 'Ellipse', keyHint: 'O' },
  { id: 'line', label: 'Line', keyHint: 'L' },
  { id: 'zoom', label: 'Zoom', keyHint: 'Z' },
  { id: 'pan', label: 'Pan', keyHint: 'Space' },
];

export const CanvasPanel: React.FC<CanvasPanelProps> = ({ store }) => {
  const state = useStore(store);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const topRulerRef = useRef<HTMLCanvasElement | null>(null);
  const leftRulerRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const spaceDownRef = useRef(false);

  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 520 });
  const [penDraft, setPenDraft] = useState<Array<{ x: number; y: number }>>([]);
  const [numericState, setNumericState] = useState(createNumericInputState);

  // Measure viewport container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setCanvasSize({
        width: Math.max(100, Math.floor(rect.width)),
        height: Math.max(100, Math.floor(rect.height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render Canvas 2D + synchronized rulers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderCanvas2D(ctx, canvasSize.width, canvasSize.height, state.doc, {
      viewport: state.viewport,
      selectedNodeIds: state.selectedNodeIds,
      selectedPathIds: state.selectedPathIds,
      selectedPointIds: state.selectedPointIds,
      selectionMode: state.selectionMode,
      bboxMode: state.bboxMode,
      isolationStack: state.isolationStack,
      outlineView: state.outlineView,
      transparencyGrid: state.transparencyGrid,
      lockAxis: state.lockAxis,
      penDraftPoints: penDraft,
    });

    drawRulers(
      topRulerRef.current,
      leftRulerRef.current,
      canvasSize.width,
      canvasSize.height,
      state.viewport,
    );
  }, [
    canvasSize,
    state.doc,
    state.revision,
    state.viewport,
    state.selectedNodeIds,
    state.selectedPathIds,
    state.selectedPointIds,
    state.selectionMode,
    state.bboxMode,
    state.isolationStack,
    state.outlineView,
    state.transparencyGrid,
    state.lockAxis,
    penDraft,
  ]);

  const handleFit = () => {
    const fitted = fitViewportToDocument(
      state.doc,
      canvasSize.width,
      canvasSize.height,
    );
    state.setViewport(fitted);
  };

  // Global keyboard shortcuts & numeric double-key machine (V+V, R+R, S+S)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      if (e.code === 'Space') {
        spaceDownRef.current = true;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) state.redo();
          else state.undo();
          return;
        }
        if (e.key.toLowerCase() === 'g') {
          e.preventDefault();
          if (state.selectedNodeIds.length > 0) {
            state.executeCommand(
              new GroupNodesCommand(
                () => store.getState().doc,
                state.selectedNodeIds,
                (gid) => state.selectNodes([gid]),
              ),
            );
          }
          return;
        }
        if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          state.toggleOutlineView();
          return;
        }
      }

      // Numeric double-tap state machine (V+V, R+R, S+S < 400ms)
      const action = stepNumericInputMachine(
        numericState,
        e.key,
        performance.now(),
      );
      if (action.type !== 'none' || action.state !== numericState) {
        setNumericState(action.state);
      }
      if (action.type === 'commit') {
        e.preventDefault();
        if (state.selectedNodeIds.length > 0) {
          const deltaParams = {
            dx: action.target === 'position' ? action.value : 0,
            dy: 0,
            dRotation: action.target === 'rotation' ? action.value : 0,
            scaleFactor: action.target === 'scale' ? action.value : 1,
          };
          state.executeCommand(
            new TransformNodesCommand(
              () => store.getState().doc,
              state.selectedNodeIds,
              deltaParams,
            ),
          );
        }
        return;
      }
      if (action.state.active) {
        e.preventDefault();
        return;
      }

      if (e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        state.cycleSelectionMode();
        return;
      }

      const lower = e.key.toLowerCase();
      if (lower === 'v') state.setTool('select');
      else if (lower === 'p') state.setTool('pen');
      else if (lower === 'o') state.setTool('ellipse');
      else if (lower === 'l') state.setTool('line');
      else if (lower === 'z') state.setTool('zoom');
      else if (lower === 'f') handleFit();
      else if (lower === 'x') state.toggleLockAxis('x');
      else if (lower === 'y') state.toggleLockAxis('y');
      else if (e.key === 'Escape') {
        if (penDraft.length > 0) {
          setPenDraft([]);
        } else if (state.isolationStack.length > 0) {
          state.exitIsolationStep();
        }
      } else if (e.key === 'Enter' && penDraft.length >= 2) {
        commitPenPath(penDraft, false);
        setPenDraft([]);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  const commitPenPath = (pts: Array<{ x: number; y: number }>, closed: boolean) => {
    if (pts.length < 2) return;
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const node: VectorNode = {
      id: createId('pen_layer'),
      name: 'Pen Path Layer',
      type: 'layer',
      visible: true,
      locked: false,
      hasKeyframes: false,
      transform: createDefaultTransform({ x: cx, y: cy }),
      style: {
        fill: closed ? { color: '#3b82f6', opacity: 0.75 } : undefined,
        stroke: { color: '#e2e8f0', width: 3 },
      },
      paths: [
        {
          id: createId('path'),
          name: 'Pen Path',
          type: 'path',
          closed,
          points: pts.map((p, idx) => ({
            id: createId(`pt_${idx}`),
            x: p.x - cx,
            y: p.y - cy,
            angle: 0,
            inLength: 0,
            outLength: 0,
            handleMode: 'symmetric',
            cornerRadius: 0,
          })),
        },
      ],
    };
    state.executeCommand(new AddNodeCommand(() => store.getState().doc, node));
    state.selectNodes([node.id]);
    state.selectPath(node.paths![0]!.id, node.id);
  };

  const getPointerWorld = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return {
      screenX: sx,
      screenY: sy,
      ...screenToWorld(state.viewport, sx, sy),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getPointerWorld(e);

    // Spacebar pan, Pan tool, or middle mouse button
    if (spaceDownRef.current || state.activeTool === 'pan' || e.button === 1) {
      dragRef.current = {
        kind: 'pan',
        startScreenX: pt.screenX,
        startScreenY: pt.screenY,
        origPanX: state.viewport.panX,
        origPanY: state.viewport.panY,
      };
      return;
    }

    if (state.activeTool === 'zoom') {
      const factor = e.altKey ? 0.8 : 1.25;
      const nextZoom = Math.max(0.1, Math.min(8, state.viewport.zoom * factor));
      state.setViewport({
        zoom: nextZoom,
        panX: pt.screenX - pt.x * nextZoom,
        panY: pt.screenY - pt.y * nextZoom,
      });
      return;
    }

    if (state.activeTool === 'pen') {
      const first = penDraft[0];
      if (first && penDraft.length >= 3 && Math.hypot(pt.x - first.x, pt.y - first.y) < 12) {
        commitPenPath(penDraft, true);
        setPenDraft([]);
        return;
      }
      setPenDraft((prev) => [...prev, { x: pt.x, y: pt.y }]);
      return;
    }

    if (state.activeTool === 'ellipse' || state.activeTool === 'line') {
      const nodeId = createId('shape');
      const isEllipse = state.activeTool === 'ellipse';
      const newNode: VectorNode = {
        id: nodeId,
        name: isEllipse ? 'Parametric Ellipse' : 'Parametric Line',
        type: 'layer',
        visible: true,
        locked: false,
        hasKeyframes: false,
        transform: createDefaultTransform({ x: pt.x, y: pt.y }),
        style: {
          fill: isEllipse ? { color: '#4f8cff', opacity: 0.85 } : undefined,
          stroke: { color: '#e2e8f0', width: 3 },
        },
        paths: [
          isEllipse
            ? {
                id: createId('ell'),
                name: 'Ellipse',
                type: 'parametric_ellipse',
                closed: true,
                points: [],
                parametricData: { cx: 0, cy: 0, rx: 10, ry: 10, holeRatio: 0, sweep: 360 },
              }
            : {
                id: createId('line'),
                name: 'Line',
                type: 'parametric_line',
                closed: false,
                points: [],
                parametricData: { cx: 0, cy: 0, length: 20, angle: 0 },
              },
        ],
      };
      state.executeCommand(new AddNodeCommand(() => store.getState().doc, newNode));
      state.selectNodes([nodeId]);
      dragRef.current = {
        kind: 'shape',
        tool: state.activeTool,
        startWorldX: pt.x,
        startWorldY: pt.y,
        previewNodeId: nodeId,
      };
      return;
    }

    // Select tool: 3-level Hit-Testing
    const hit = hitTestDocument(state.doc, pt.x, pt.y, {
      mode: state.selectionMode,
      isolationStack: state.isolationStack,
      tolerance: 9 / state.viewport.zoom,
      selectedPathIds: state.selectedPathIds,
      checkHandles: true,
    });

    if (!hit) {
      state.clearSelection();
      return;
    }

    if (hit.kind === 'handle' && hit.pointId && hit.handleEnd) {
      const path = findPathLookup(state.doc.nodes, hit.pathId)?.path;
      if (!path) return;
      state.selectPoints([hit.pointId]);
      dragRef.current = {
        kind: 'handle',
        nodeId: hit.nodeId,
        pathId: hit.pathId,
        pointId: hit.pointId,
        handleEnd: hit.handleEnd,
        origPoints: cloneValue(path.points),
      };
      return;
    }

    if (hit.kind === 'point' && hit.pointId) {
      const path = findPathLookup(state.doc.nodes, hit.pathId)?.path;
      const point = path?.points.find((p) => p.id === hit.pointId);
      if (!path || !point) return;
      state.selectPoints([hit.pointId], e.shiftKey);
      const worldMat = getWorldMatrixForNode(state.doc.nodes, hit.nodeId);
      const slideState =
        e.ctrlKey || e.metaKey
          ? beginSlideDrag(point, (p) => applyMatrix(worldMat, p.x, p.y))
          : null;
      dragRef.current = {
        kind: 'point',
        nodeId: hit.nodeId,
        pathId: hit.pathId,
        pointId: hit.pointId,
        startWorldX: pt.x,
        startWorldY: pt.y,
        origPoints: cloneValue(path.points),
        slideState,
      };
      return;
    }

    if (hit.resolvedMode === 'path') {
      state.selectPath(hit.pathId, hit.nodeId);
    } else {
      state.selectNodes([hit.resolvedId], e.shiftKey);
    }

    const activeNodeIds =
      hit.resolvedMode === 'path' ? [hit.nodeId] : store.getState().selectedNodeIds;
    const origTransforms = new Map<string, { x: number; y: number }>();
    for (const id of activeNodeIds) {
      const node = findNodeById(state.doc.nodes, id);
      if (node) {
        origTransforms.set(id, { x: node.transform.x, y: node.transform.y });
      }
    }

    dragRef.current = {
      kind: 'nodes',
      nodeIds: activeNodeIds,
      startWorldX: pt.x,
      startWorldY: pt.y,
      origTransforms,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const pt = getPointerWorld(e);

    if (drag.kind === 'pan') {
      state.setViewport({
        panX: drag.origPanX + (pt.screenX - drag.startScreenX),
        panY: drag.origPanY + (pt.screenY - drag.startScreenY),
      });
      return;
    }

    if (drag.kind === 'nodes') {
      const locked = applyAxisLock(
        pt.x - drag.startWorldX,
        pt.y - drag.startWorldY,
        state.lockAxis,
      );
      for (const [id, orig] of drag.origTransforms) {
        const node = findNodeById(state.doc.nodes, id);
        if (node) {
          node.transform.x = orig.x + locked.deltaX;
          node.transform.y = orig.y + locked.deltaY;
        }
      }
      state.bumpRevision();
      return;
    }

    if (drag.kind === 'point') {
      const path = findPathLookup(state.doc.nodes, drag.pathId)?.path;
      if (!path) return;
      const worldMat = getWorldMatrixForNode(state.doc.nodes, drag.nodeId);
      const invMat = invertMatrix(worldMat);
      const pStartLocal = applyMatrix(invMat, drag.startWorldX, drag.startWorldY);
      const pCurrLocal = applyMatrix(invMat, pt.x, pt.y);
      const locked = applyAxisLock(
        pCurrLocal.x - pStartLocal.x,
        pCurrLocal.y - pStartLocal.y,
        state.lockAxis,
      );

      path.points = drag.origPoints.map((orig) => {
        if (orig.id !== drag.pointId) return cloneValue(orig);
        if (drag.slideState) {
          return applySlideDrag(
            orig,
            locked.deltaX,
            locked.deltaY,
            drag.slideState,
            (w) => applyMatrix(invMat, w.x, w.y),
          );
        }
        return {
          ...orig,
          x: orig.x + locked.deltaX,
          y: orig.y + locked.deltaY,
        };
      });
      state.bumpRevision();
      return;
    }

    if (drag.kind === 'handle') {
      const path = findPathLookup(state.doc.nodes, drag.pathId)?.path;
      if (!path) return;
      const worldMat = getWorldMatrixForNode(state.doc.nodes, drag.nodeId);
      const invMat = invertMatrix(worldMat);
      const tipLocal = applyMatrix(invMat, pt.x, pt.y);

      path.points = drag.origPoints.map((orig) => {
        if (orig.id !== drag.pointId) return cloneValue(orig);
        return updateHandleFromTip(orig, drag.handleEnd, tipLocal.x, tipLocal.y);
      });
      state.bumpRevision();
      return;
    }

    if (drag.kind === 'shape') {
      const node = findNodeById(state.doc.nodes, drag.previewNodeId);
      const p = node?.paths?.[0];
      if (!node || !p) return;
      const dx = pt.x - drag.startWorldX;
      const dy = pt.y - drag.startWorldY;
      if (drag.tool === 'ellipse' && p.parametricData) {
        p.parametricData.rx = Math.max(8, Math.abs(dx));
        p.parametricData.ry = Math.max(8, Math.abs(dy));
      } else if (drag.tool === 'line' && p.parametricData) {
        p.parametricData.length = Math.max(10, Math.hypot(dx, dy) * 2);
        p.parametricData.angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      }
      state.bumpRevision();
    }
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    if (drag.kind === 'nodes') {
      const firstId = drag.nodeIds[0];
      const firstNode = firstId ? findNodeById(state.doc.nodes, firstId) : null;
      const firstOrig = firstId ? drag.origTransforms.get(firstId) : null;
      if (!firstNode || !firstOrig) return;

      const dx = firstNode.transform.x - firstOrig.x;
      const dy = firstNode.transform.y - firstOrig.y;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;

      // Restore originals then run through CommandManager for Undo & Last Action
      for (const [id, orig] of drag.origTransforms) {
        const n = findNodeById(state.doc.nodes, id);
        if (n) {
          n.transform.x = orig.x;
          n.transform.y = orig.y;
        }
      }
      state.executeCommand(
        new MoveNodesCommand(() => store.getState().doc, drag.nodeIds, {
          dx: Math.round(dx * 100) / 100,
          dy: Math.round(dy * 100) / 100,
        }),
      );
    } else if (drag.kind === 'point' || drag.kind === 'handle') {
      const path = findPathLookup(state.doc.nodes, drag.pathId)?.path;
      if (!path) return;
      const modified = cloneValue(path.points);
      path.points = cloneValue(drag.origPoints);
      state.executeCommand(
        new UpdatePathPointsCommand(
          () => store.getState().doc,
          drag.pathId,
          modified,
          drag.kind === 'point'
            ? drag.slideState
              ? 'Slide Bezier Point'
              : 'Move Bezier Point'
            : 'Adjust Bezier Handle',
        ),
      );
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const world = screenToWorld(
      state.viewport,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    const hit = hitTestDocument(state.doc, world.x, world.y, {
      mode: 'group',
      isolationStack: state.isolationStack,
      tolerance: 10 / state.viewport.zoom,
    });
    if (hit) {
      state.enterIsolation(hit.nodeId);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(state.viewport, sx, sy);
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = Math.max(0.15, Math.min(8, state.viewport.zoom * factor));
    state.setViewport({
      zoom: nextZoom,
      panX: sx - world.x * nextZoom,
      panY: sy - world.y * nextZoom,
    });
  };

  return (
    <div className="dm-panel" style={{ flex: 1 }}>
      <div className="dm-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>Canvas Viewport</span>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`dm-btn ${state.activeTool === t.id ? 'active' : ''}`}
              onClick={() => state.setTool(t.id)}
              title={`${t.label} (${t.keyHint})`}
            >
              {t.label} <span style={{ opacity: 0.7 }}>({t.keyHint})</span>
            </button>
          ))}
          <button
            type="button"
            className="dm-btn"
            onClick={handleFit}
            title="Fit to Canvas (F)"
          >
            Fit (F)
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="dm-btn"
            onClick={() => state.cycleSelectionMode()}
            title="Hit-test level (Shift+V)"
          >
            Mode: <strong>{state.selectionMode}</strong> (Shift+V)
          </button>

          <select
            className="dm-select"
            style={{ width: 130 }}
            value={state.bboxMode}
            onChange={(e) => state.setBBoxMode(e.target.value as BBoxMode)}
            title="Bounding Box Mode"
          >
            <option value="combined">BBox: Combined</option>
            <option value="individual_comp">BBox: Comp AABB</option>
            <option value="individual_object">BBox: Object OBB</option>
          </select>

          <button
            type="button"
            className={`dm-btn ${state.lockAxis === 'x' ? 'warn' : ''}`}
            onClick={() => state.toggleLockAxis('x')}
            title="Lock X Axis (X)"
          >
            X
          </button>
          <button
            type="button"
            className={`dm-btn ${state.lockAxis === 'y' ? 'warn' : ''}`}
            onClick={() => state.toggleLockAxis('y')}
            title="Lock Y Axis (Y)"
          >
            Y
          </button>

          <button
            type="button"
            className={`dm-btn ${state.outlineView ? 'active' : ''}`}
            onClick={() => state.toggleOutlineView()}
          >
            Outline
          </button>
          <button
            type="button"
            className={`dm-btn ${state.transparencyGrid ? 'active' : ''}`}
            onClick={() => state.toggleTransparencyGrid()}
          >
            Alpha Grid
          </button>
        </div>
      </div>

      {/* Isolation Mode Breadcrumb */}
      {state.isolationStack.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px',
            background: '#272013',
            borderBottom: '1px solid #92400e',
            color: '#fbbf24',
            fontSize: 11,
          }}
        >
          <span>Isolation Mode:</span>
          {state.isolationStack.map((id, idx) => (
            <span key={id}>
              {idx > 0 ? ' › ' : ''}
              <strong>{findNodeById(state.doc.nodes, id)?.name ?? id}</strong>
            </span>
          ))}
          <button
            type="button"
            className="dm-btn"
            onClick={() => state.exitIsolationStep()}
          >
            Up (Esc)
          </button>
          <button
            type="button"
            className="dm-btn"
            onClick={() => state.clearIsolation()}
          >
            Exit All
          </button>
        </div>
      )}

      <div className="dm-canvas-shell">
        <div className="dm-ruler-corner" />
        <div className="dm-ruler-top">
          <canvas ref={topRulerRef} style={{ width: '100%', height: 22, display: 'block' }} />
        </div>
        <div className="dm-ruler-left">
          <canvas ref={leftRulerRef} style={{ width: 22, height: '100%', display: 'block' }} />
        </div>

        <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              cursor:
                state.activeTool === 'pan'
                  ? 'grab'
                  : state.activeTool === 'zoom'
                    ? 'zoom-in'
                    : 'crosshair',
            }}
          />

          {/* Numeric Double-Key HUD (V+V, R+R, S+S) */}
          {numericState.active && (
            <div
              className="dm-hud-chip"
              style={{ position: 'absolute', top: 12, left: 12 }}
            >
              Numeric <strong>{numericState.target?.toUpperCase()}</strong>:{' '}
              <code>{numericState.buffer || '0'}</code>{' '}
              <span style={{ color: '#94a3b8' }}>(Enter to apply, Esc cancel)</span>
            </div>
          )}

          {/* Pen Tool Hint */}
          {state.activeTool === 'pen' && (
            <div
              className="dm-hud-chip"
              style={{ position: 'absolute', top: 12, right: 12 }}
            >
              Pen: click to place points ({penDraft.length}), click start to close or Enter
            </div>
          )}

          {/* Last Action Floating Panel */}
          {state.lastAction && (
            <div
              className="dm-hud-chip"
              style={{
                position: 'absolute',
                bottom: 12,
                right: 12,
                minWidth: 230,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                  fontWeight: 600,
                  color: '#38bdf8',
                }}
              >
                <span>Last Action: {state.lastAction.label}</span>
              </div>
              {state.lastAction.schema.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: 10 }}>
                  {JSON.stringify(state.lastAction.params)}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {state.lastAction.schema.map((field) => {
                    const val = state.lastAction?.params[field.key];
                    return (
                      <label key={field.key} className="dm-field">
                        <span className="dm-field-label">{field.label}</span>
                        {field.type === 'color' ? (
                          <input
                            type="color"
                            value={String(val ?? '#ffffff')}
                            onChange={(e) =>
                              state.updateLastAction({ [field.key]: e.target.value })
                            }
                          />
                        ) : (
                          <input
                            type="number"
                            className="dm-input"
                            min={field.min}
                            max={field.max}
                            step={field.step ?? 1}
                            value={typeof val === 'number' ? val : 0}
                            onChange={(e) => {
                              const parsed = Number.parseFloat(e.target.value);
                              if (Number.isFinite(parsed)) {
                                state.updateLastAction({ [field.key]: parsed });
                              }
                            }}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Status Footer */}
          <div
            className="dm-hud-chip"
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              fontSize: 10,
              color: '#94a3b8',
            }}
          >
            Zoom: {Math.round(state.viewport.zoom * 100)}% • Ctrl+Drag Point: Slide • Double-Click: Isolate
          </div>
        </div>
      </div>
    </div>
  );
};

function drawRulers(
  topCanvas: HTMLCanvasElement | null,
  leftCanvas: HTMLCanvasElement | null,
  width: number,
  height: number,
  viewport: { zoom: number; panX: number; panY: number },
) {
  const stepWorld = viewport.zoom < 0.5 ? 100 : viewport.zoom > 1.5 ? 25 : 50;

  if (topCanvas) {
    topCanvas.width = width;
    topCanvas.height = 22;
    const ctx = topCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, width, 22);
      ctx.fillStyle = '#64748b';
      ctx.strokeStyle = '#334155';
      ctx.font = '9px monospace';
      const startW = Math.floor(-viewport.panX / viewport.zoom / stepWorld) * stepWorld;
      const endW = Math.ceil((width - viewport.panX) / viewport.zoom);
      for (let w = startW; w <= endW; w += stepWorld) {
        const sx = w * viewport.zoom + viewport.panX;
        ctx.beginPath();
        ctx.moveTo(sx, 12);
        ctx.lineTo(sx, 22);
        ctx.stroke();
        ctx.fillText(String(w), sx + 2, 10);
      }
    }
  }

  if (leftCanvas) {
    leftCanvas.width = 22;
    leftCanvas.height = height;
    const ctx = leftCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 22, height);
      ctx.fillStyle = '#64748b';
      ctx.strokeStyle = '#334155';
      ctx.font = '9px monospace';
      const startW = Math.floor(-viewport.panY / viewport.zoom / stepWorld) * stepWorld;
      const endW = Math.ceil((height - viewport.panY) / viewport.zoom);
      for (let w = startW; w <= endW; w += stepWorld) {
        const sy = w * viewport.zoom + viewport.panY;
        ctx.beginPath();
        ctx.moveTo(12, sy);
        ctx.lineTo(22, sy);
        ctx.stroke();
        ctx.save();
        ctx.translate(10, sy - 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(w), 0, 0);
        ctx.restore();
      }
    }
  }
}
