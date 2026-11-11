import { createStore } from 'zustand/vanilla';
import type {
  AxisLock,
  BBoxMode,
  SelectionMode,
  ToolType,
  VectorDocument,
  VectorNode,
} from '../ast/types.js';
import { createDemoDocument, findPathLookup } from '../ast/utils.js';
import {
  CommandManager,
  type ICommand,
  type LastActionSnapshot,
} from '../commands/index.js';
import {
  cycleSelectionMode as nextSelectionMode,
  popIsolation,
  pushIsolation,
  type ViewportState,
} from '../renderer/index.js';

export interface DesignState {
  doc: VectorDocument;
  revision: number;
  selectedNodeIds: string[];
  selectedPathIds: string[];
  selectedPointIds: string[];
  selectionMode: SelectionMode;
  bboxMode: BBoxMode;
  isolationStack: string[];
  activeTool: ToolType;
  lockAxis: AxisLock;
  outlineView: boolean;
  transparencyGrid: boolean;
  viewport: ViewportState;
  lastAction: LastActionSnapshot | null;
  canUndo: boolean;
  canRedo: boolean;
  commandManager: CommandManager;

  // Actions
  setDocument: (doc: VectorDocument) => void;
  setPulledNodes: (nodes: VectorNode[], backgroundColor?: string) => void;
  executeCommand: (cmd: ICommand) => void;
  undo: () => void;
  redo: () => void;
  updateLastAction: (params: Record<string, unknown>) => void;
  bumpRevision: () => void;

  setSelectionMode: (mode: SelectionMode) => void;
  cycleSelectionMode: () => void;
  setBBoxMode: (mode: BBoxMode) => void;
  setTool: (tool: ToolType) => void;
  toggleLockAxis: (axis: 'x' | 'y') => void;
  setLockAxis: (axis: AxisLock) => void;
  toggleOutlineView: () => void;
  toggleTransparencyGrid: () => void;
  setViewport: (next: Partial<ViewportState>) => void;

  selectNodes: (nodeIds: string[], additive?: boolean) => void;
  selectPath: (pathId: string, ownerNodeId?: string) => void;
  selectPoints: (pointIds: string[], additive?: boolean) => void;
  clearSelection: () => void;

  enterIsolation: (nodeId: string) => void;
  exitIsolationStep: () => void;
  clearIsolation: () => void;
}

export function createDesignStore(initialDoc?: VectorDocument) {
  const commandManager = new CommandManager(200);

  const store = createStore<DesignState>((set, get) => {
    const syncHistory = () => {
      set((s) => ({
        revision: s.revision + 1,
        lastAction: commandManager.getLastActionSnapshot(),
        canUndo: commandManager.canUndo(),
        canRedo: commandManager.canRedo(),
      }));
    };

    return {
      doc: initialDoc ?? createDemoDocument(),
      revision: 0,
      selectedNodeIds: ['layer_shield'],
      selectedPathIds: ['path_shield'],
      selectedPointIds: [],
      selectionMode: 'layer',
      bboxMode: 'individual_object',
      isolationStack: [],
      activeTool: 'select',
      lockAxis: null,
      outlineView: false,
      transparencyGrid: false,
      viewport: { zoom: 0.72, panX: 40, panY: 30 },
      lastAction: null,
      canUndo: false,
      canRedo: false,
      commandManager,

      setDocument: (doc) => {
        commandManager.clear();
        set({
          doc,
          revision: get().revision + 1,
          selectedNodeIds: [],
          selectedPathIds: [],
          selectedPointIds: [],
          isolationStack: [],
          lastAction: null,
          canUndo: false,
          canRedo: false,
        });
      },

      setPulledNodes: (nodes, backgroundColor) => {
        commandManager.clear();
        set((s) => ({
          doc: {
            ...s.doc,
            nodes,
            backgroundColor: backgroundColor ?? s.doc.backgroundColor,
          },
          revision: s.revision + 1,
          selectedNodeIds: nodes[0] ? [nodes[0].id] : [],
          selectedPathIds: [],
          selectedPointIds: [],
          isolationStack: [],
          lastAction: null,
          canUndo: false,
          canRedo: false,
        }));
      },

      executeCommand: (cmd) => {
        commandManager.execute(cmd);
        syncHistory();
      },

      undo: () => {
        if (commandManager.undo()) syncHistory();
      },

      redo: () => {
        if (commandManager.redo()) syncHistory();
      },

      updateLastAction: (params) => {
        if (commandManager.updateLastActionParams(params)) syncHistory();
      },

      bumpRevision: () => {
        set((s) => ({ revision: s.revision + 1 }));
      },

      setSelectionMode: (selectionMode) => set({ selectionMode }),
      cycleSelectionMode: () =>
        set((s) => ({ selectionMode: nextSelectionMode(s.selectionMode) })),
      setBBoxMode: (bboxMode) => set({ bboxMode }),
      setTool: (activeTool) => set({ activeTool }),
      toggleLockAxis: (axis) =>
        set((s) => ({ lockAxis: s.lockAxis === axis ? null : axis })),
      setLockAxis: (lockAxis) => set({ lockAxis }),
      toggleOutlineView: () => set((s) => ({ outlineView: !s.outlineView })),
      toggleTransparencyGrid: () =>
        set((s) => ({ transparencyGrid: !s.transparencyGrid })),
      setViewport: (next) =>
        set((s) => ({ viewport: { ...s.viewport, ...next } })),

      selectNodes: (nodeIds, additive = false) =>
        set((s) => {
          const nextIds = additive
            ? Array.from(new Set([...s.selectedNodeIds, ...nodeIds]))
            : nodeIds;
          return {
            selectedNodeIds: nextIds,
            selectedPathIds: [],
            selectedPointIds: [],
          };
        }),

      selectPath: (pathId, ownerNodeId) =>
        set((s) => {
          const resolvedOwner =
            ownerNodeId ?? findPathLookup(s.doc.nodes, pathId)?.ownerNode.id;
          return {
            selectedPathIds: [pathId],
            selectedNodeIds: resolvedOwner ? [resolvedOwner] : s.selectedNodeIds,
            selectedPointIds: [],
          };
        }),

      selectPoints: (pointIds, additive = false) =>
        set((s) => ({
          selectedPointIds: additive
            ? Array.from(new Set([...s.selectedPointIds, ...pointIds]))
            : pointIds,
        })),

      clearSelection: () =>
        set({
          selectedNodeIds: [],
          selectedPathIds: [],
          selectedPointIds: [],
        }),

      enterIsolation: (nodeId) =>
        set((s) => ({
          isolationStack: pushIsolation(s.isolationStack, nodeId),
        })),

      exitIsolationStep: () =>
        set((s) => ({
          isolationStack: popIsolation(s.isolationStack),
        })),

      clearIsolation: () => set({ isolationStack: [] }),
    };
  });

  return store;
}

export type DesignStore = ReturnType<typeof createDesignStore>;
