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
  RoundCornerCommand,
  screenToWorld,
  SplitPathCommand,
  stepNumericInputMachine,
  TransformNodesCommand,
  UpdateParametricCommand,
  updateHandleFromTip,
  UpdatePathPointsCommand,
  UpdateStyleCommand,
  type BBoxMode,
  type BezierPoint,
  type DesignStore,
  type NodeTransform,
  type ShortcutPreset,
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
      kind: 'rotate' | 'scale';
      nodeIds: string[];
      pivotX: number;
      pivotY: number;
      startAngle: number;
      startDist: number;
      origTransforms: Map<string, NodeTransform>;
      lastDeltaRot: number;
      lastScaleFactor: number;
    }
  | {
      kind: 'gradient';
      nodeId: string;
      startLocalX: number;
      startLocalY: number;
    }
  | {
      kind: 'width';
      nodeId: string;
      startScreenX: number;
      startScreenY: number;
      worldX: number;
      worldY: number;
      origWidth: number;
      origStart: number;
      origEnd: number;
      mode: 'width' | 'taper';
    }
  | {
      kind: 'rect_roundness';
      nodeId: string;
      pathId: string;
      startScreenX: number;
      origRoundness: number;
    }
  | {
      kind: 'ellipse_arc';
      nodeId: string;
      pathId: string;
      handleKind: 'start' | 'sweep' | 'ratio';
      cxWorld: number;
      cyWorld: number;
      rx: number;
      origStartAngle: number;
      origSweep: number;
      origHoleRatio: number;
    }
  | {
      kind: 'corner_widget';
      nodeId: string;
      pathId: string;
      pointId: string;
      worldX: number;
      worldY: number;
      startScreenX: number;
      origRadius: number;
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
      tool: 'rect' | 'ellipse' | 'star' | 'line';
      startWorldX: number;
      startWorldY: number;
      previewNodeId: string;
    };

const TOOLS: Array<{ id: ToolType; label: string; keyHint: string }> = [
  { id: 'select', label: 'Select', keyHint: 'V' },
  { id: 'direct_select', label: 'Direct', keyHint: 'A' },
  { id: 'rotate', label: 'Rotate', keyHint: 'R' },
  { id: 'scale', label: 'Scale', keyHint: 'S' },
  { id: 'pan', label: 'Pan', keyHint: 'H' },
  { id: 'zoom', label: 'Zoom', keyHint: 'Z' },
  { id: 'rect', label: 'Rect', keyHint: 'M' },
  { id: 'ellipse', label: 'Ellipse', keyHint: 'O' },
  { id: 'star', label: 'Star', keyHint: '' },
  { id: 'line', label: 'Line', keyHint: 'L' },
  { id: 'pen', label: 'Pen', keyHint: 'P' },
  { id: 'scissors', label: 'Cut', keyHint: 'C' },
  { id: 'width', label: 'Width', keyHint: 'W' },
  { id: 'text', label: 'Text', keyHint: 'T' },
  { id: 'eyedropper', label: 'Pick', keyHint: 'I' },
  { id: 'gradient', label: 'Grad', keyHint: 'G' },
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
  const [showPrefs, setShowPrefs] = useState(false);
  const [cornerPreview, setCornerPreview] = useState<{
    worldX: number;
    worldY: number;
    radiusPx: number;
  } | null>(null);
  const [widthPreview, setWidthPreview] = useState<{
    worldX: number;
    worldY: number;
    widthPx: number;
  } | null>(null);

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
      keyObjectId: state.keyObjectId,
      selectionMode: state.selectionMode,
      bboxMode: state.bboxMode,
      isolationStack: state.isolationStack,
      outlineView: state.outlineView,
      transparencyGrid: state.transparencyGrid,
      showBounds: state.showBounds,
      showPixelGrid: state.showPixelGrid,
      lockAxis: state.lockAxis,
      activeTool: state.activeTool,
      customPivot: state.customPivot,
      penDraftPoints: penDraft,
      cornerPreview,
      widthPreview,
    });

    if (state.showRulers) {
      drawRulers(
        topRulerRef.current,
        leftRulerRef.current,
        canvasSize.width,
        canvasSize.height,
        state.viewport,
      );
    }
  }, [
    canvasSize,
    state.doc,
    state.revision,
    state.viewport,
    state.selectedNodeIds,
    state.selectedPathIds,
    state.selectedPointIds,
    state.keyObjectId,
    state.selectionMode,
    state.bboxMode,
    state.isolationStack,
    state.outlineView,
    state.transparencyGrid,
    state.showBounds,
    state.showPixelGrid,
    state.showRulers,
    state.lockAxis,
    state.activeTool,
    state.customPivot,
    penDraft,
    cornerPreview,
    widthPreview,
  ]);

  const handleFit = () => {
    const fitted = fitViewportToDocument(
      state.doc,
      canvasSize.width,
      canvasSize.height,
    );
    state.setViewport(fitted);
  };

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

      if (e.code === 'Space') spaceDownRef.current = true;

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
          state.executeCommand(
            new TransformNodesCommand(
              () => store.getState().doc,
              state.selectedNodeIds,
              {
                dx: action.target === 'position' ? action.value : 0,
                dy: 0,
                dRotation: action.target === 'rotation' ? action.value : 0,
                scaleFactor: action.target === 'scale' ? action.value : 1,
              },
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
      const preset = state.preferences.shortcutPreset;
      if (lower === 'v') state.setTool('select');
      else if (lower === 'a') state.setTool('direct_select');
      else if (lower === 'p') state.setTool('pen');
      else if (lower === 'c') state.setTool('scissors');
      else if (lower === 'i') state.setTool('eyedropper');
      else if (lower === 'h') state.setTool('pan');
      else if (lower === 'm' || (preset === 'after_effects' && lower === 'q')) state.setTool('rect');
      else if (lower === 'o') state.setTool('ellipse');
      else if (lower === 'l') state.setTool('line');
      else if (lower === 't') state.setTool('text');
      else if (lower === 'r') state.setTool('rotate');
      else if (lower === 's') state.setTool('scale');
      else if (lower === 'g') state.setTool('gradient');
      else if (lower === 'w') state.setTool('width');
      else if (lower === 'z') state.setTool('zoom');
      else if (lower === 'f') handleFit();
      else if (lower === 'x') state.toggleLockAxis('x');
      else if (lower === 'y') state.toggleLockAxis('y');
      else if (e.key === 'Escape') {
        if (penDraft.length > 0) setPenDraft([]);
        else if (state.isolationStack.length > 0) state.exitIsolationStep();
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

    if (state.activeTool === 'text') {
      const node: VectorNode = {
        id: createId('text'),
        name: 'Text Layer',
        type: 'text',
        visible: true,
        locked: false,
        hasKeyframes: false,
        textContent: 'Design Text',
        fontFamily: state.cachedFonts[0] ?? 'Inter',
        fontSize: 54,
        transform: createDefaultTransform({ x: pt.x, y: pt.y }),
        style: {
          fill: { color: '#f8fafc', opacity: 1 },
        },
      };
      state.executeCommand(new AddNodeCommand(() => store.getState().doc, node));
      state.selectNodes([node.id]);
      state.setTool('select');
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

    if (
      state.activeTool === 'rect' ||
      state.activeTool === 'ellipse' ||
      state.activeTool === 'star' ||
      state.activeTool === 'line'
    ) {
      const nodeId = createId('shape');
      const tool = state.activeTool;
      const pathType =
        tool === 'rect'
          ? 'parametric_rect'
          : tool === 'ellipse'
            ? 'parametric_ellipse'
            : tool === 'star'
              ? 'parametric_star'
              : 'parametric_line';

      const newNode: VectorNode = {
        id: nodeId,
        name:
          tool === 'rect'
            ? 'Parametric Rect'
            : tool === 'ellipse'
              ? 'Parametric Ellipse'
              : tool === 'star'
                ? 'Parametric Star'
                : 'Parametric Line',
        type: 'layer',
        visible: true,
        locked: false,
        hasKeyframes: false,
        transform: createDefaultTransform({ x: pt.x, y: pt.y }),
        style: {
          fill: tool !== 'line' ? { color: '#4f8cff', opacity: 0.85 } : undefined,
          stroke: { color: '#e2e8f0', width: 3 },
        },
        paths: [
          {
            id: createId(tool),
            name: tool,
            type: pathType,
            closed: tool !== 'line',
            points: [],
            parametricData:
              tool === 'rect'
                ? { cx: 0, cy: 0, width: 20, height: 20, roundness: 0 }
                : tool === 'ellipse'
                  ? { cx: 0, cy: 0, rx: 10, ry: 10, holeRatio: 0, sweep: 360 }
                  : tool === 'star'
                    ? { cx: 0, cy: 0, pointsCount: 5, outerRadius: 20, innerRadius: 10, roundness: 0 }
                    : { cx: 0, cy: 0, length: 20, angle: 0 },
          },
        ],
      };
      state.executeCommand(new AddNodeCommand(() => store.getState().doc, newNode));
      state.selectNodes([nodeId]);
      dragRef.current = {
        kind: 'shape',
        tool,
        startWorldX: pt.x,
        startWorldY: pt.y,
        previewNodeId: nodeId,
      };
      return;
    }

    if ((state.activeTool === 'rotate' || state.activeTool === 'scale') && state.selectedNodeIds.length > 0) {
      if (e.altKey) {
        state.setCustomPivot({ x: pt.x, y: pt.y });
        return;
      }
      const firstNode = findNodeById(state.doc.nodes, state.selectedNodeIds[0]!);
      const pivot = state.customPivot ?? {
        x: firstNode?.transform.x ?? pt.x,
        y: firstNode?.transform.y ?? pt.y,
      };
      const origTransforms = new Map<string, NodeTransform>();
      for (const id of state.selectedNodeIds) {
        const n = findNodeById(state.doc.nodes, id);
        if (n) origTransforms.set(id, { ...n.transform });
      }
      dragRef.current = {
        kind: state.activeTool,
        nodeIds: [...state.selectedNodeIds],
        pivotX: pivot.x,
        pivotY: pivot.y,
        startAngle: Math.atan2(pt.y - pivot.y, pt.x - pivot.x),
        startDist: Math.max(10, Math.hypot(pt.x - pivot.x, pt.y - pivot.y)),
        origTransforms,
        lastDeltaRot: 0,
        lastScaleFactor: 1,
      };
      return;
    }

    if (state.activeTool === 'gradient' && state.selectedNodeIds[0]) {
      const nodeId = state.selectedNodeIds[0];
      const inv = invertMatrix(getWorldMatrixForNode(state.doc.nodes, nodeId));
      const local = applyMatrix(inv, pt.x, pt.y);
      dragRef.current = {
        kind: 'gradient',
        nodeId,
        startLocalX: local.x,
        startLocalY: local.y,
      };
      return;
    }

    if (state.activeTool === 'scissors') {
      const hit = hitTestDocument(state.doc, pt.x, pt.y, {
        mode: 'path',
        isolationStack: state.isolationStack,
        tolerance: 12 / state.viewport.zoom,
      });
      if (hit) {
        const inv = invertMatrix(getWorldMatrixForNode(state.doc.nodes, hit.nodeId));
        const localClick = applyMatrix(inv, pt.x, pt.y);
        state.executeCommand(
          new SplitPathCommand(() => store.getState().doc, hit.pathId, localClick),
        );
        state.selectPath(hit.pathId, hit.nodeId);
      }
      return;
    }

    if (state.activeTool === 'eyedropper') {
      const hit = hitTestDocument(state.doc, pt.x, pt.y, {
        mode: 'layer',
        isolationStack: state.isolationStack,
        tolerance: 10 / state.viewport.zoom,
      });
      const pickedNode = hit ? findNodeById(state.doc.nodes, hit.nodeId) : null;
      const pickedColor = e.shiftKey
        ? pickedNode?.style?.stroke?.color
        : pickedNode?.style?.fill?.color ?? pickedNode?.style?.stroke?.color;
      if (pickedColor && state.selectedNodeIds.length > 0) {
        state.executeCommand(
          new UpdateStyleCommand(
            () => store.getState().doc,
            state.selectedNodeIds,
            (prev) =>
              e.shiftKey
                ? {
                    ...prev,
                    stroke: {
                      color: pickedColor,
                      width: prev?.stroke?.width ?? 3,
                      ...prev?.stroke,
                    },
                  }
                : {
                    ...prev,
                    fill: {
                      color: pickedColor,
                      opacity: prev?.fill?.opacity ?? 1,
                    },
                  },
            e.shiftKey ? { strokeColor: pickedColor } : { fillColor: pickedColor },
          ),
        );
      }
      return;
    }

    if (state.activeTool === 'width' && state.selectedNodeIds[0]) {
      const node = findNodeById(state.doc.nodes, state.selectedNodeIds[0]);
      if (!node) return;
      const wPx = node.style?.stroke?.width ?? 4;
      setWidthPreview({ worldX: pt.x, worldY: pt.y, widthPx: wPx });
      dragRef.current = {
        kind: 'width',
        nodeId: node.id,
        startScreenX: pt.screenX,
        startScreenY: pt.screenY,
        worldX: pt.x,
        worldY: pt.y,
        origWidth: wPx,
        origStart: node.style?.stroke?.taperStart ?? 0,
        origEnd: node.style?.stroke?.taperEnd ?? 0,
        mode: e.altKey ? 'taper' : 'width',
      };
      return;
    }

    // Check on-canvas parametric handles & corner widgets before general selection
    const tolWorld = 10 / state.viewport.zoom;
    if (state.showBounds && state.selectedNodeIds.length > 0) {
      for (const nid of state.selectedNodeIds) {
        const node = findNodeById(state.doc.nodes, nid);
        if (!node || !node.paths) continue;
        const worldMat = getWorldMatrixForNode(state.doc.nodes, nid);
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
            for (const c of corners) {
              const wc = applyMatrix(worldMat, c.x, c.y);
              if (Math.hypot(pt.x - wc.x, pt.y - wc.y) <= tolWorld) {
                dragRef.current = {
                  kind: 'rect_roundness',
                  nodeId: nid,
                  pathId: p.id,
                  startScreenX: pt.screenX,
                  origRoundness: p.parametricData.roundness ?? 0,
                };
                return;
              }
            }
          } else if (p.type === 'parametric_ellipse' && p.parametricData) {
            const rx = p.parametricData.rx ?? 100;
            const ry = p.parametricData.ry ?? 100;
            const startAngle = p.parametricData.startAngle ?? -90;
            const sweep = p.parametricData.sweep ?? 360;
            const holeRatio = p.parametricData.holeRatio ?? 0;
            const startRad = (startAngle * Math.PI) / 180;
            const sweepRad = (sweep * Math.PI) / 180;
            const centerW = applyMatrix(worldMat, 0, 0);
            const startW = applyMatrix(worldMat, Math.cos(startRad) * rx * 0.82, Math.sin(startRad) * ry * 0.82);
            const sweepW = applyMatrix(worldMat, Math.cos(startRad + sweepRad) * rx * 0.82, Math.sin(startRad + sweepRad) * ry * 0.82);
            const ratioRad = startRad + sweepRad / 2;
            const ratioW = applyMatrix(worldMat, Math.cos(ratioRad) * rx * Math.max(0.15, holeRatio), Math.sin(ratioRad) * ry * Math.max(0.15, holeRatio));

            let handleKind: 'start' | 'sweep' | 'ratio' | null = null;
            if (Math.hypot(pt.x - startW.x, pt.y - startW.y) <= tolWorld) handleKind = 'start';
            else if (Math.hypot(pt.x - sweepW.x, pt.y - sweepW.y) <= tolWorld) handleKind = 'sweep';
            else if (Math.hypot(pt.x - ratioW.x, pt.y - ratioW.y) <= tolWorld) handleKind = 'ratio';

            if (handleKind) {
              dragRef.current = {
                kind: 'ellipse_arc',
                nodeId: nid,
                pathId: p.id,
                handleKind,
                cxWorld: centerW.x,
                cyWorld: centerW.y,
                rx,
                origStartAngle: startAngle,
                origSweep: sweep,
                origHoleRatio: holeRatio,
              };
              return;
            }
          }
        }
      }
    }

    if (state.selectedPathIds.length > 0 && state.selectedPointIds.length > 0) {
      const pid = state.selectedPathIds[0]!;
      const lookup = findPathLookup(state.doc.nodes, pid);
      if (lookup && lookup.path.type === 'path') {
        const worldMat = getWorldMatrixForNode(state.doc.nodes, lookup.ownerNode.id);
        for (const pointId of state.selectedPointIds) {
          const point = lookup.path.points.find((p) => p.id === pointId);
          if (!point || point.inLength > 0.5 || point.outLength > 0.5) continue;
          const pWorld = applyMatrix(worldMat, point.x, point.y);
          const widgetX = pWorld.x + 12 / state.viewport.zoom;
          const widgetY = pWorld.y + 12 / state.viewport.zoom;
          if (Math.hypot(pt.x - widgetX, pt.y - widgetY) <= tolWorld) {
            setCornerPreview({ worldX: pWorld.x, worldY: pWorld.y, radiusPx: point.cornerRadius ?? 0 });
            dragRef.current = {
              kind: 'corner_widget',
              nodeId: lookup.ownerNode.id,
              pathId: pid,
              pointId,
              worldX: pWorld.x,
              worldY: pWorld.y,
              startScreenX: pt.screenX,
              origRadius: point.cornerRadius ?? 0,
            };
            return;
          }
        }
      }
    }

    // Select / Direct Select Hit-Testing
    const effectiveMode =
      state.activeTool === 'direct_select' ? 'path' : state.selectionMode;
    const hit = hitTestDocument(state.doc, pt.x, pt.y, {
      mode: effectiveMode,
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
      if (node) origTransforms.set(id, { x: node.transform.x, y: node.transform.y });
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

    if (drag.kind === 'rotate') {
      const angle = Math.atan2(pt.y - drag.pivotY, pt.x - drag.pivotX);
      const deg = ((angle - drag.startAngle) * 180) / Math.PI;
      drag.lastDeltaRot = Math.round(deg * 100) / 100;
      for (const [id, orig] of drag.origTransforms) {
        const n = findNodeById(state.doc.nodes, id);
        if (n) n.transform.rotation = orig.rotation + drag.lastDeltaRot;
      }
      state.bumpRevision();
      return;
    }

    if (drag.kind === 'scale') {
      const dist = Math.max(4, Math.hypot(pt.x - drag.pivotX, pt.y - drag.pivotY));
      const factor = Math.max(0.05, Math.round((dist / drag.startDist) * 100) / 100);
      drag.lastScaleFactor = factor;
      for (const [id, orig] of drag.origTransforms) {
        const n = findNodeById(state.doc.nodes, id);
        if (n) {
          n.transform.scaleX = orig.scaleX * factor;
          n.transform.scaleY = orig.scaleY * factor;
        }
      }
      state.bumpRevision();
      return;
    }

    if (drag.kind === 'gradient') {
      const n = findNodeById(state.doc.nodes, drag.nodeId);
      if (!n) return;
      const inv = invertMatrix(getWorldMatrixForNode(state.doc.nodes, drag.nodeId));
      const localEnd = applyMatrix(inv, pt.x, pt.y);
      n.style = {
        ...n.style,
        fill: {
          color: n.style?.fill?.color ?? '#4f8cff',
          opacity: n.style?.fill?.opacity ?? 1,
          gradient: {
            type: n.style?.fill?.gradient?.type ?? 'linear',
            x1: drag.startLocalX,
            y1: drag.startLocalY,
            x2: localEnd.x,
            y2: localEnd.y,
            stops: n.style?.fill?.gradient?.stops ?? [
              { offset: 0, color: '#4f8cff' },
              { offset: 1, color: '#a855f7' },
            ],
          },
        },
      };
      state.bumpRevision();
      return;
    }

    if (drag.kind === 'width') {
      const n = findNodeById(state.doc.nodes, drag.nodeId);
      if (!n) return;
      if (drag.mode === 'taper') {
        const dx = (pt.screenX - drag.startScreenX) / 200;
        const dy = (pt.screenY - drag.startScreenY) / 200;
        n.style = {
          ...n.style,
          stroke: {
            color: n.style?.stroke?.color ?? '#e2e8f0',
            width: Math.max(1, n.style?.stroke?.width ?? 4),
            ...n.style?.stroke,
            taperStart: Math.max(0, Math.min(0.95, drag.origStart + dx)),
            taperEnd: Math.max(0, Math.min(0.95, drag.origEnd + dy)),
          },
        };
      } else {
        const deltaW = (pt.screenX - drag.startScreenX) * 0.25;
        const nextWidth = Math.max(0.5, Math.round((drag.origWidth + deltaW) * 10) / 10);
        n.style = {
          ...n.style,
          stroke: {
            color: n.style?.stroke?.color ?? '#e2e8f0',
            ...n.style?.stroke,
            width: nextWidth,
          },
        };
        setWidthPreview({ worldX: drag.worldX, worldY: drag.worldY, widthPx: nextWidth });
      }
      state.bumpRevision();
      return;
    }

    if (drag.kind === 'rect_roundness') {
      const p = findPathLookup(state.doc.nodes, drag.pathId)?.path;
      if (!p || !p.parametricData) return;
      const delta = (pt.screenX - drag.startScreenX) * 0.5;
      p.parametricData.roundness = Math.max(0, Math.round((drag.origRoundness + delta) * 10) / 10);
      state.bumpRevision();
      return;
    }

    if (drag.kind === 'ellipse_arc') {
      const p = findPathLookup(state.doc.nodes, drag.pathId)?.path;
      if (!p || !p.parametricData) return;
      const angDeg = (Math.atan2(pt.y - drag.cyWorld, pt.x - drag.cxWorld) * 180) / Math.PI;
      if (drag.handleKind === 'start') {
        p.parametricData.startAngle = Math.round(angDeg * 10) / 10;
      } else if (drag.handleKind === 'sweep') {
        const start = p.parametricData.startAngle ?? -90;
        const raw = ((angDeg - start) % 360 + 360) % 360;
        p.parametricData.sweep = Math.max(5, Math.round((raw === 0 ? 360 : raw) * 10) / 10);
      } else {
        const dist = Math.hypot(pt.x - drag.cxWorld, pt.y - drag.cyWorld);
        p.parametricData.holeRatio = Math.max(0, Math.min(0.95, Math.round((dist / Math.max(10, drag.rx)) * 100) / 100));
      }
      state.bumpRevision();
      return;
    }

    if (drag.kind === 'corner_widget') {
      const p = findPathLookup(state.doc.nodes, drag.pathId)?.path;
      if (!p) return;
      const nextR = Math.max(0, Math.round((drag.origRadius + (pt.screenX - drag.startScreenX) * 0.4) * 10) / 10);
      for (const ptItem of p.points) {
        if (state.selectedPointIds.includes(ptItem.id)) {
          ptItem.cornerRadius = nextR;
        }
      }
      setCornerPreview({ worldX: drag.worldX, worldY: drag.worldY, radiusPx: nextR });
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
      if (!node || !p || !p.parametricData) return;
      const dx = pt.x - drag.startWorldX;
      const dy = pt.y - drag.startWorldY;
      if (drag.tool === 'rect') {
        p.parametricData.width = Math.max(8, Math.abs(dx) * 2);
        p.parametricData.height = Math.max(8, Math.abs(dy) * 2);
      } else if (drag.tool === 'ellipse') {
        p.parametricData.rx = Math.max(8, Math.abs(dx));
        p.parametricData.ry = Math.max(8, Math.abs(dy));
      } else if (drag.tool === 'star') {
        const r = Math.max(12, Math.hypot(dx, dy));
        p.parametricData.outerRadius = r;
        p.parametricData.innerRadius = r * 0.45;
      } else if (drag.tool === 'line') {
        p.parametricData.length = Math.max(10, Math.hypot(dx, dy) * 2);
        p.parametricData.angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      }
      state.bumpRevision();
    }
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setCornerPreview(null);
    setWidthPreview(null);
    if (!drag) return;

    if (drag.kind === 'width') {
      const n = findNodeById(state.doc.nodes, drag.nodeId);
      if (!n) return;
      const nextWidth = n.style?.stroke?.width ?? drag.origWidth;
      const nextStart = n.style?.stroke?.taperStart ?? drag.origStart;
      const nextEnd = n.style?.stroke?.taperEnd ?? drag.origEnd;
      if (n.style?.stroke) n.style.stroke.width = drag.origWidth;
      state.executeCommand(
        new UpdateStyleCommand(
          () => store.getState().doc,
          [drag.nodeId],
          (prev) => ({
            ...prev,
            stroke: {
              color: prev?.stroke?.color ?? '#e2e8f0',
              ...prev?.stroke,
              width: nextWidth,
              taperStart: nextStart,
              taperEnd: nextEnd,
            },
          }),
          { strokeWidth: nextWidth },
        ),
      );
      return;
    }

    if (drag.kind === 'rect_roundness') {
      const p = findPathLookup(state.doc.nodes, drag.pathId)?.path;
      const nextR = p?.parametricData?.roundness ?? drag.origRoundness;
      if (p?.parametricData) p.parametricData.roundness = drag.origRoundness;
      state.executeCommand(
        new UpdateParametricCommand(() => store.getState().doc, drag.pathId, {
          roundness: nextR,
        }),
      );
      return;
    }

    if (drag.kind === 'ellipse_arc') {
      const p = findPathLookup(state.doc.nodes, drag.pathId)?.path;
      const nextData = {
        startAngle: p?.parametricData?.startAngle ?? drag.origStartAngle,
        sweep: p?.parametricData?.sweep ?? drag.origSweep,
        holeRatio: p?.parametricData?.holeRatio ?? drag.origHoleRatio,
      };
      if (p?.parametricData) {
        p.parametricData.startAngle = drag.origStartAngle;
        p.parametricData.sweep = drag.origSweep;
        p.parametricData.holeRatio = drag.origHoleRatio;
      }
      state.executeCommand(
        new UpdateParametricCommand(() => store.getState().doc, drag.pathId, nextData),
      );
      return;
    }

    if (drag.kind === 'corner_widget') {
      const p = findPathLookup(state.doc.nodes, drag.pathId)?.path;
      const ptObj = p?.points.find((x) => x.id === drag.pointId);
      const nextR = ptObj?.cornerRadius ?? drag.origRadius;
      if (p) {
        for (const item of p.points) {
          if (state.selectedPointIds.includes(item.id)) item.cornerRadius = drag.origRadius;
        }
      }
      state.executeCommand(
        new RoundCornerCommand(
          () => store.getState().doc,
          drag.pathId,
          state.selectedPointIds,
          { cornerRadius: nextR },
        ),
      );
      return;
    }

    if (drag.kind === 'nodes') {
      const firstId = drag.nodeIds[0];
      const firstNode = firstId ? findNodeById(state.doc.nodes, firstId) : null;
      const firstOrig = firstId ? drag.origTransforms.get(firstId) : null;
      if (!firstNode || !firstOrig) return;

      const dx = firstNode.transform.x - firstOrig.x;
      const dy = firstNode.transform.y - firstOrig.y;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;

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
    } else if (drag.kind === 'rotate' || drag.kind === 'scale') {
      for (const [id, orig] of drag.origTransforms) {
        const n = findNodeById(state.doc.nodes, id);
        if (n) n.transform = { ...orig };
      }
      state.executeCommand(
        new TransformNodesCommand(() => store.getState().doc, drag.nodeIds, {
          dx: 0,
          dy: 0,
          dRotation: drag.kind === 'rotate' ? drag.lastDeltaRot : 0,
          scaleFactor: drag.kind === 'scale' ? drag.lastScaleFactor : 1,
        }),
      );
    } else if (drag.kind === 'gradient') {
      const n = findNodeById(state.doc.nodes, drag.nodeId);
      const grad = cloneValue(n?.style?.fill?.gradient);
      if (n && grad) {
        state.executeCommand(
          new UpdateStyleCommand(
            () => store.getState().doc,
            [drag.nodeId],
            (prev) => ({
              ...prev,
              fill: {
                color: prev?.fill?.color ?? '#4f8cff',
                opacity: prev?.fill?.opacity ?? 1,
                ...prev?.fill,
                gradient: grad,
              },
            }),
          ),
        );
      }
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
    } else if (state.isolationStack.length > 0) {
      state.exitIsolationStep();
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`dm-btn ${state.activeTool === t.id ? 'active' : ''}`}
              style={{ padding: state.preferences.toolbarCompact ? '2px 5px' : '4px 7px' }}
              onClick={() => state.setTool(t.id)}
              title={t.keyHint ? `${t.label} (${t.keyHint})` : t.label}
            >
              {t.label}
              {t.keyHint && <span style={{ opacity: 0.65, fontSize: 10 }}>{t.keyHint}</span>}
            </button>
          ))}
          <button type="button" className="dm-btn" onClick={handleFit} title="Fit (F)">
            Fit
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="dm-btn"
            onClick={() => state.cycleSelectionMode()}
            title="Cycle Hit-Test Mode (Shift+V)"
          >
            <strong>{state.selectionMode}</strong>
          </button>

          <select
            className="dm-select"
            style={{ width: 122 }}
            value={state.bboxMode}
            onChange={(e) => state.setBBoxMode(e.target.value as BBoxMode)}
            title="Transform Mode"
          >
            <option value="combined">Combined</option>
            <option value="individual_comp">Individual: Comp</option>
            <option value="individual_object">Individual: Object</option>
          </select>

          <button
            type="button"
            className={`dm-btn ${state.snapping ? 'active' : ''}`}
            onClick={() => state.toggleSnapping()}
            title="Toggle Snapping"
          >
            🧲
          </button>
          <button
            type="button"
            className={`dm-btn ${state.showBounds ? 'active' : ''}`}
            onClick={() => state.toggleShowBounds()}
            title="Show/Hide Transform Controls"
          >
            ⊡
          </button>
          <button
            type="button"
            className={`dm-btn ${state.showPixelGrid ? 'active' : ''}`}
            onClick={() => state.toggleShowPixelGrid()}
            title="Toggle Pixel Grid"
          >
            ▦
          </button>
          <button
            type="button"
            className={`dm-btn ${state.showRulers ? 'active' : ''}`}
            onClick={() => state.toggleShowRulers()}
            title="Toggle Rulers"
          >
            📏
          </button>
          <button
            type="button"
            className={`dm-btn ${state.lockAxis === 'x' ? 'warn' : ''}`}
            onClick={() => state.toggleLockAxis('x')}
          >
            X
          </button>
          <button
            type="button"
            className={`dm-btn ${state.lockAxis === 'y' ? 'warn' : ''}`}
            onClick={() => state.toggleLockAxis('y')}
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
            Alpha
          </button>
          <button
            type="button"
            className="dm-btn"
            disabled={!state.canUndo}
            onClick={() => state.undo()}
            title="Undo (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className="dm-btn"
            disabled={!state.canRedo}
            onClick={() => state.redo()}
            title="Redo (Ctrl+Shift+Z)"
          >
            ↷
          </button>
          <button
            type="button"
            className={`dm-btn ${showPrefs ? 'active' : ''}`}
            onClick={() => setShowPrefs((v) => !v)}
            title="Preferences & Shortcuts"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Preferences & Shortcuts Drawer */}
      {showPrefs && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '6px 10px',
            background: '#181c24',
            borderBottom: '1px solid #2d3442',
            fontSize: 11,
            flexWrap: 'wrap',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Shortcut Preset:
            <select
              className="dm-select"
              style={{ width: 120 }}
              value={state.preferences.shortcutPreset}
              onChange={(e) =>
                state.updatePreferences({
                  shortcutPreset: e.target.value as ShortcutPreset,
                })
              }
            >
              <option value="illustrator">Illustrator</option>
              <option value="after_effects">After Effects</option>
              <option value="figma">Figma</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={state.preferences.toolbarCompact}
              onChange={(e) =>
                state.updatePreferences({ toolbarCompact: e.target.checked })
              }
            />
            Compact Toolbar
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={state.preferences.autoExpandSelected}
              onChange={(e) =>
                state.updatePreferences({ autoExpandSelected: e.target.checked })
              }
            />
            Auto-Expand Layers
          </label>
          <span style={{ color: '#64748b' }}>
            Tip: Alt+Click with Rotate/Scale moves pivot
          </span>
        </div>
      )}

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

          {numericState.active && (
            <div
              className="dm-hud-chip"
              style={{ position: 'absolute', top: 12, left: 12 }}
            >
              Numeric <strong>{numericState.target?.toUpperCase()}</strong>:{' '}
              <code>{numericState.buffer || '0'}</code>{' '}
              <span style={{ color: '#94a3b8' }}>(Enter apply, Esc cancel)</span>
            </div>
          )}

          {state.activeTool === 'pen' && (
            <div
              className="dm-hud-chip"
              style={{ position: 'absolute', top: 12, right: 12 }}
            >
              Pen: click to place points ({penDraft.length}), click start or Enter
            </div>
          )}

          {/* Last Action Floating Panel (bottom-left like Blender/Design Mode) */}
          {state.lastAction && (
            <div
              className="dm-hud-chip"
              style={{
                position: 'absolute',
                bottom: 36,
                left: 12,
                minWidth: 230,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 6,
                  fontWeight: 600,
                  color: '#38bdf8',
                }}
              >
                <span>{state.lastAction.label}</span>
                <button
                  type="button"
                  className="dm-btn"
                  style={{ padding: '1px 6px', fontSize: 10 }}
                  onClick={() => state.undo()}
                  title="Reset / Undo Last Action"
                >
                  Reset
                </button>
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
              {/* Transform Mode inline in HUD just like screenshots 343f35c0 & 3bb99f0c */}
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #262b36' }}>
                <label className="dm-field">
                  <span className="dm-field-label">Transform mode</span>
                  <select
                    className="dm-select"
                    value={state.bboxMode}
                    onChange={(e) => state.setBBoxMode(e.target.value as BBoxMode)}
                  >
                    <option value="combined">Combined</option>
                    <option value="individual_comp">Individual: Comp</option>
                    <option value="individual_object">Individual: Object</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {/* Bottom Canvas Status Bar */}
          <div
            className="dm-hud-chip"
            style={{
              position: 'absolute',
              bottom: 6,
              left: 12,
              right: 12,
              fontSize: 10,
              color: '#94a3b8',
              padding: '3px 8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                className="dm-select"
                style={{ width: 68, fontSize: 10, padding: '1px 4px' }}
                value={String(Math.round(state.viewport.zoom * 100))}
                onChange={(e) => {
                  if (e.target.value === 'fit') {
                    handleFit();
                  } else {
                    state.setViewport({ zoom: Number(e.target.value) / 100 });
                  }
                }}
              >
                <option value={String(Math.round(state.viewport.zoom * 100))}>
                  {Math.round(state.viewport.zoom * 100)}%
                </option>
                <option value="50">50%</option>
                <option value="100">100%</option>
                <option value="200">200%</option>
                <option value="400">400%</option>
                <option value="fit">Fit</option>
              </select>
              <span>
                {state.selectedPointIds.length > 0
                  ? `${state.selectedPointIds.length} point(s) selected`
                  : state.selectedNodeIds.length > 0
                    ? `${state.selectedNodeIds.length === 1 ? (findNodeById(state.doc.nodes, state.selectedNodeIds[0]!)?.name ?? '1 layer') : `${state.selectedNodeIds.length} groups`} selected`
                    : 'No selection'}
              </span>
            </div>
            <span>
              V/A/R/S/C/W/T/I/G • Ctrl+Drag Point: Slide • Double-Click: Isolate
            </span>
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
