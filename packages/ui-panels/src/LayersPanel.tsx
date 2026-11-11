import React, { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import {
  AddNodeCommand,
  createDefaultTransform,
  createId,
  GroupNodesCommand,
  MutateDocumentCommand,
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

  const renderNode = (node: VectorNode, depth = 0): React.ReactNode => {
    if (!matchesQuery(node)) return null;
    const isSelected = state.selectedNodeIds.includes(node.id);
    const isIsolated = state.isolationStack.includes(node.id);

    return (
      <div key={node.id}>
        <div
          className={`dm-tree-row ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={(e) => state.selectNodes([node.id], e.shiftKey || e.ctrlKey)}
          onDoubleClick={() => state.enterIsolation(node.id)}
          title="Click to select, Double-click to Isolate"
        >
          <span className="dm-badge">{node.type}</span>
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

          {isIsolated && <span className="dm-badge kf">ISO</span>}
          {node.hasKeyframes && (
            <span className="dm-badge kf" title="Has Keyframes (Push uses setValueAtTime)">
              ◆ KF
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
            title="Toggle Visibility"
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
            title="Toggle Lock"
          >
            {node.locked ? '🔒' : '🔓'}
          </button>
        </div>

        {/* Paths inside this node */}
        {node.paths?.map((path) => {
          const isPathSel = state.selectedPathIds.includes(path.id);
          return (
            <div
              key={path.id}
              className={`dm-tree-row ${isPathSel ? 'selected' : ''}`}
              style={{ paddingLeft: 22 + depth * 14, opacity: 0.9 }}
              onClick={() => state.selectPath(path.id, node.id)}
            >
              <span className="dm-badge">
                {path.type === 'parametric_ellipse'
                  ? 'ellipse'
                  : path.type === 'parametric_line'
                    ? 'line'
                    : 'path'}
              </span>
              <span style={{ flex: 1, fontSize: 11 }}>
                {path.name ?? path.id}
              </span>
            </div>
          );
        })}

        {node.children?.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="dm-panel" style={{ width: 280 }}>
      <div className="dm-panel-header">
        <span>Layers</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="dm-btn" onClick={handleAddShapeLayer}>
            + Layer
          </button>
          <button
            type="button"
            className="dm-btn"
            disabled={state.selectedNodeIds.length === 0}
            onClick={handleGroup}
            title="Group Selection (Ctrl+G)"
          >
            Group
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
    </div>
  );
};
