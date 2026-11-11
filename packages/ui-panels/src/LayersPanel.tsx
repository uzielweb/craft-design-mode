import React, { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import {
  AddNodeCommand,
  createDefaultTransform,
  createId,
  GroupNodesCommand,
  MutateDocumentCommand,
  removeNodeById,
  SplitGroupsToLayersCommand,
  SplitNodePathsCommand,
  type DesignStore,
  type VectorNode,
} from '@design-mode/vector-core';

export interface LayersPanelProps {
  store: DesignStore;
}

export const LayersPanel: React.FC<LayersPanelProps> = ({ store }) => {
  const state = useStore(store);
  const [query, setQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);

  const normalizedQuery = query.trim().toLowerCase();

  const matchesQuery = useMemo(() => {
    if (!normalizedQuery) return (_n: VectorNode) => true;
    const hasMatch = (node: VectorNode): boolean => {
      if (node.name.toLowerCase().includes(normalizedQuery)) return true;
      if (node.paths?.some((p) => (p.name ?? p.id).toLowerCase().includes(normalizedQuery))) {
        return true;
      }
      return Boolean(node.children?.some(hasMatch));
    };
    return hasMatch;
  }, [normalizedQuery]);

  const handleGroup = () => {
    if (state.selectedNodeIds.length === 0) return;
    state.executeCommand(
      new GroupNodesCommand(
        () => store.getState().doc,
        state.selectedNodeIds,
        (gid) => state.selectNodes([gid]),
      ),
    );
  };

  const handleSplit = () => {
    const first = state.selectedNodeIds[0];
    if (!first) return;
    state.executeCommand(new SplitNodePathsCommand(() => store.getState().doc, first));
  };

  const handleAddShapeLayer = () => {
    const node: VectorNode = {
      id: createId('layer'),
      name: `Vector Layer ${state.doc.nodes.length + 1}`,
      type: 'layer',
      visible: true,
      locked: false,
      hasKeyframes: false,
      transform: createDefaultTransform({ x: 640, y: 360 }),
      style: {
        fill: { color: '#4f8cff', opacity: 0.85 },
        stroke: { color: '#e2e8f0', width: 2 },
      },
      paths: [
        {
          id: createId('path'),
          name: 'Rect Shape',
          type: 'path',
          closed: true,
          points: [
            { id: createId('pt'), x: -80, y: -60, angle: 0, inLength: 0, outLength: 0, handleMode: 'broken', cornerRadius: 0 },
            { id: createId('pt'), x: 80, y: -60, angle: 0, inLength: 0, outLength: 0, handleMode: 'broken', cornerRadius: 0 },
            { id: createId('pt'), x: 80, y: 60, angle: 0, inLength: 0, outLength: 0, handleMode: 'broken', cornerRadius: 0 },
            { id: createId('pt'), x: -80, y: 60, angle: 0, inLength: 0, outLength: 0, handleMode: 'broken', cornerRadius: 0 },
          ],
        },
      ],
    };
    state.executeCommand(new AddNodeCommand(() => store.getState().doc, node));
    state.selectNodes([node.id]);
    state.selectPath(node.paths![0]!.id, node.id);
  };

  const toggleProp = (nodeId: string, prop: 'visible' | 'locked') => {
    state.executeCommand(
      new MutateDocumentCommand(
        () => store.getState().doc,
        `Toggle ${prop}`,
        (doc) => {
          const walk = (list: VectorNode[]) => {
            for (const n of list) {
              if (n.id === nodeId) {
                n[prop] = !n[prop];
                return;
              }
              if (n.children) walk(n.children);
            }
          };
          walk(doc.nodes);
        },
      ),
    );
  };

  const typeGlyph = (type: VectorNode['type']) => {
    if (type === 'text') return 'T';
    if (type === 'mask') return '◐';
    if (type === 'group') return '▣';
    return '★';
  };

  const renderNode = (node: VectorNode, depth = 0): React.ReactNode => {
    if (!matchesQuery(node)) return null;
    const isSelected = state.selectedNodeIds.includes(node.id);
    const isIsolated = state.isolationStack.includes(node.id);
    const isKeyObj = state.keyObjectId === node.id;
    const hasChildren =
      (node.children && node.children.length > 0) ||
      (node.paths && node.paths.length > 0);
    const isCollapsed = state.collapsedNodeIds.includes(node.id);

    return (
      <div key={node.id}>
        <div
          className={`dm-tree-row ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={(e) => {
            setContextMenu(null);
            state.selectNodes([node.id], e.shiftKey || e.ctrlKey);
          }}
          onDoubleClick={() => state.enterIsolation(node.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            state.selectNodes([node.id]);
            setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
          }}
          title="Click to select, Double-click to Isolate, Right-click for options"
        >
          <button
            type="button"
            className="dm-btn"
            style={{ padding: '0 4px', opacity: hasChildren ? 1 : 0.25 }}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) state.toggleNodeCollapsed(node.id);
            }}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>

          <span style={{ color: '#38bdf8', fontSize: 11 }}>{typeGlyph(node.type)}</span>

          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: node.visible ? '#e2e8f0' : '#64748b',
            }}
          >
            {node.name}
          </span>

          {isKeyObj && <span className="dm-badge" style={{ color: '#34d399' }}>KEY</span>}
          {isIsolated && <span className="dm-badge kf">ISO</span>}
          {node.hasKeyframes && (
            <span className="dm-badge kf" title="Has Keyframes">
              ◆
            </span>
          )}

          <button
            type="button"
            className="dm-btn"
            style={{ padding: '2px 5px' }}
            onClick={(e) => {
              e.stopPropagation();
              toggleProp(node.id, 'visible');
            }}
          >
            {node.visible ? '👁' : '—'}
          </button>

          <button
            type="button"
            className="dm-btn"
            style={{ padding: '2px 5px' }}
            onClick={(e) => {
              e.stopPropagation();
              toggleProp(node.id, 'locked');
            }}
          >
            {node.locked ? '🔒' : '🔓'}
          </button>
        </div>

        {!isCollapsed &&
          node.paths?.map((path) => {
            const isPathSel = state.selectedPathIds.includes(path.id);
            return (
              <div
                key={path.id}
                className={`dm-tree-row ${isPathSel ? 'selected' : ''}`}
                style={{ paddingLeft: 26 + depth * 12, opacity: 0.9 }}
                onClick={() => state.selectPath(path.id, node.id)}
              >
                <span className="dm-badge">
                  {path.type.replace('parametric_', '')}
                </span>
                <span style={{ flex: 1, fontSize: 11 }}>
                  {path.name ?? path.id}
                </span>
              </div>
            );
          })}

        {!isCollapsed && node.children?.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div
      className="dm-panel"
      style={{ width: 280, position: 'relative' }}
      onClick={() => setContextMenu(null)}
    >
      <div className="dm-panel-header">
        <span>Layers</span>
        <div style={{ display: 'flex', gap: 3 }}>
          <button type="button" className="dm-btn" onClick={handleAddShapeLayer}>
            +
          </button>
          <button
            type="button"
            className="dm-btn"
            disabled={state.selectedNodeIds.length === 0}
            onClick={handleGroup}
            title="Group (Ctrl+G)"
          >
            Grp
          </button>
          <button
            type="button"
            className="dm-btn"
            disabled={state.selectedNodeIds.length === 0}
            onClick={handleSplit}
            title="Split Paths / Ungroup"
          >
            Split
          </button>
          <button
            type="button"
            className="dm-btn"
            onClick={() => state.setAllCollapsed(false)}
            title="Expand All"
          >
            ⊞
          </button>
          <button
            type="button"
            className="dm-btn"
            onClick={() => state.setAllCollapsed(true)}
            title="Collapse All"
          >
            ⊟
          </button>
        </div>
      </div>

      <div className="dm-section" style={{ padding: 8 }}>
        <input
          type="search"
          className="dm-input"
          placeholder="Search layers, groups, paths..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {state.doc.nodes.map((node) => renderNode(node, 0))}
      </div>

      {contextMenu && (
        <div
          className="dm-hud-chip"
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            minWidth: 185,
          }}
        >
          <button
            type="button"
            className="dm-btn"
            onClick={() => {
              state.executeCommand(
                new SplitGroupsToLayersCommand(
                  () => store.getState().doc,
                  contextMenu.nodeId,
                ),
              );
              setContextMenu(null);
            }}
          >
            Split Groups into Layers
          </button>
          <button
            type="button"
            className="dm-btn"
            onClick={() => {
              state.executeCommand(
                new SplitNodePathsCommand(
                  () => store.getState().doc,
                  contextMenu.nodeId,
                ),
              );
              setContextMenu(null);
            }}
          >
            Split Paths / Ungroup
          </button>
          <button
            type="button"
            className="dm-btn"
            onClick={() => {
              state.setKeyObject(contextMenu.nodeId);
              state.setAlignToMode('key_object');
              setContextMenu(null);
            }}
          >
            Set as Key Object
          </button>
          <button
            type="button"
            className="dm-btn"
            onClick={() => {
              state.enterIsolation(contextMenu.nodeId);
              setContextMenu(null);
            }}
          >
            Isolate Subtree
          </button>
          <button
            type="button"
            className="dm-btn warn"
            onClick={() => {
              state.executeCommand(
                new MutateDocumentCommand(
                  () => store.getState().doc,
                  'Delete Layer',
                  (doc) => {
                    removeNodeById(doc.nodes, contextMenu.nodeId);
                  },
                ),
              );
              state.clearSelection();
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};
