import { createStore } from 'zustand/vanilla';
import type {
  AlignScope,
  AlignToMode,
  AxisLock,
  BBoxMode,
  DesignPreferences,
  PathfinderResultMode,
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
  keyObjectId: string | null;
  alignToMode: AlignToMode;
  alignScope: AlignScope;
  selectionMode: SelectionMode;
  bboxMode: BBoxMode;
  isolationStack: string[];
  activeTool: ToolType;
  lockAxis: AxisLock;
  outlineView: boolean;
  transparencyGrid: boolean;
  snapping: boolean;
  showBounds: boolean;
  showPixelGrid: boolean;
  showRulers: boolean;
  pathfinderMode: PathfinderResultMode;
  distributeGap: number | null;
  viewport: ViewportState;
  customPivot: { x: number; y: number } | null;
  preferences: DesignPreferences;
  cachedFonts: string[];
  collapsedNodeIds: string[];
  lastAction: LastActionSnapshot | null;
  canUndo: boolean;
  canRedo: boolean;
  commandManager: CommandManager;

  // Actions
  setDocument: (doc: VectorDocument) => void;
  setPulledNodes: (nodes: VectorNode[], backgroundColor?: string, replaceAll?: boolean) => void;
  executeCommand: (cmd: ICommand) => void;
  undo: () => void;
  redo: () => void;
  resetLastAction: () => void;
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
  toggleSnapping: () => void;
  toggleShowBounds: () => void;
  toggleShowPixelGrid: () => void;
  toggleShowRulers: () => void;
  setPathfinderMode: (mode: PathfinderResultMode) => void;
  setDistributeGap: (gap: number | null) => void;
  setViewport: (next: Partial<ViewportState>) => void;
  setCustomPivot: (pt: { x: number; y: number } | null) => void;
  setKeyObject: (id: string | null) => void;
  setAlignToMode: (mode: AlignToMode) => void;
  setAlignScope: (scope: AlignScope) => void;
  updatePreferences: (partial: Partial<DesignPreferences>) => void;
  setCachedFonts: (fonts: string[]) => void;
  toggleNodeCollapsed: (id: string) => void;
  setAllCollapsed: (collapsed: boolean) => void;

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

    const autoExpandForIds = (nodeIds: string[], prevCollapsed: string[]) => {
      if (!get().preferences.autoExpandSelected || prevCollapsed.length === 0) {
        return prevCollapsed;
      }
      const removeSet = new Set(nodeIds);
      return prevCollapsed.filter((id) => !removeSet.has(id));
    };

    return {
      doc: initialDoc ?? createDemoDocument(),
      revision: 0,
      selectedNodeIds: ['layer_shield'],
      selectedPathIds: ['path_shield'],
      selectedPointIds: [],
      keyObjectId: null,
      alignToMode: 'selection',
      alignScope: 'individual',
      selectionMode: 'layer',
      bboxMode: 'individual_object',
      isolationStack: [],
      activeTool: 'select',
      lockAxis: null,
      outlineView: false,
      transparencyGrid: false,
      snapping: true,
      showBounds: true,
      showPixelGrid: false,
      showRulers: true,
      pathfinderMode: 'destructive',
      distributeGap: null,
      viewport: { zoom: 0.72, panX: 40, panY: 30 },
      customPivot: null,
      preferences: {
        shortcutPreset: 'illustrator',
        uiScale: 1,
        toolbarCompact: false,
        autoExpandSelected: true,
        matchCompBackground: true,
      },
      cachedFonts: ['Inter', 'Roboto', 'Space Grotesk', 'JetBrains Mono', 'Montserrat'],
      collapsedNodeIds: [],
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
          keyObjectId: null,
          isolationStack: [],
          lastAction: null,
          canUndo: false,
          canRedo: false,
        });
      },

      setPulledNodes: (nodes, backgroundColor, replaceAll = true) => {
        commandManager.clear();
        set((s) => ({
          doc: {
            ...s.doc,
            nodes: replaceAll ? nodes : [...s.doc.nodes, ...nodes],
            backgroundColor: backgroundColor ?? s.doc.backgroundColor,
          },
          revision: s.revision + 1,
          selectedNodeIds: nodes[0] ? [nodes[0].id] : [],
          selectedPathIds: [],
          selectedPointIds: [],
          keyObjectId: null,
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

      resetLastAction: () => {
        if (commandManager.undo()) syncHistory();
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
      toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
      toggleShowBounds: () => set((s) => ({ showBounds: !s.showBounds })),
      toggleShowPixelGrid: () => set((s) => ({ showPixelGrid: !s.showPixelGrid })),
      toggleShowRulers: () => set((s) => ({ showRulers: !s.showRulers })),
      setPathfinderMode: (pathfinderMode) => set({ pathfinderMode }),
      setDistributeGap: (distributeGap) => set({ distributeGap }),
      setViewport: (next) =>
        set((s) => ({ viewport: { ...s.viewport, ...next } })),
      setCustomPivot: (customPivot) => set({ customPivot }),
      setKeyObject: (keyObjectId) => set({ keyObjectId }),
      setAlignToMode: (alignToMode) => set({ alignToMode }),
      setAlignScope: (alignScope) => set({ alignScope }),
      updatePreferences: (partial) =>
        set((s) => ({ preferences: { ...s.preferences, ...partial } })),
      setCachedFonts: (cachedFonts) => set({ cachedFonts }),
      toggleNodeCollapsed: (id) =>
        set((s) => ({
          collapsedNodeIds: s.collapsedNodeIds.includes(id)
            ? s.collapsedNodeIds.filter((c) => c !== id)
            : [...s.collapsedNodeIds, id],
        })),
      setAllCollapsed: (collapsed) =>
        set((s) => {
          if (!collapsed) return { collapsedNodeIds: [] };
          const ids: string[] = [];
          const walk = (list: VectorNode[]) => {
            for (const n of list) {
              if ((n.children && n.children.length > 0) || (n.paths && n.paths.length > 0)) {
                ids.push(n.id);
              }
              if (n.children) walk(n.children);
            }
          };
          walk(s.doc.nodes);
          return { collapsedNodeIds: ids };
        }),

      selectNodes: (nodeIds, additive = false) =>
        set((s) => {
          const nextIds = additive
            ? Array.from(new Set([...s.selectedNodeIds, ...nodeIds]))
            : nodeIds;
          return {
            selectedNodeIds: nextIds,
            selectedPathIds: [],
            selectedPointIds: [],
            keyObjectId:
              s.keyObjectId && nextIds.includes(s.keyObjectId)
                ? s.keyObjectId
                : null,
            collapsedNodeIds: autoExpandForIds(nextIds, s.collapsedNodeIds),
          };
        }),

      selectPath: (pathId, ownerNodeId) =>
        set((s) => {
          const resolvedOwner =
            ownerNodeId ?? findPathLookup(s.doc.nodes, pathId)?.ownerNode.id;
          const nextNodeIds = resolvedOwner ? [resolvedOwner] : s.selectedNodeIds;
          return {
            selectedPathIds: [pathId],
            selectedNodeIds: nextNodeIds,
            selectedPointIds: [],
            collapsedNodeIds: autoExpandForIds(nextNodeIds, s.collapsedNodeIds),
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
          keyObjectId: null,
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
