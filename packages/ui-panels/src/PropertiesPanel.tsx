import React, { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import {
  AlignNodesCommand,
  collectDocumentColorUsages,
  createId,
  DistributeNodesCommand,
  findNodeById,
  findPathLookup,
  MutateDocumentCommand,
  OffsetHandlesCommand,
  PathfinderCommand,
  ReplaceColorCommand,
  RoundCornerCommand,
  SetHandleModeCommand,
  SetPathRotoBezierCommand,
  SetShapeOperatorCommand,
  SetTransformPropsCommand,
  SlidePointCommand,
  UpdateGlobalColorCommand,
  UpdateParametricCommand,
  UpdateStyleCommand,
  type AlignScope,
  type AlignTarget,
  type AlignToMode,
  type BlendMode,
  type DesignStore,
  type DistributeMode,
  type HandleMode,
  type LineCap,
  type LineJoin,
  type PathfinderOp,
  type ShapeOperator,
} from '@design-mode/vector-core';

export interface PropertiesPanelProps {
  store: DesignStore;
  onRefreshFonts?: () => Promise<string[]>;
}

const ALIGN_BUTTONS: Array<{ id: AlignTarget; label: string }> = [
  { id: 'left', label: 'L' },
  { id: 'hcenter', label: 'HC' },
  { id: 'right', label: 'R' },
  { id: 'top', label: 'T' },
  { id: 'vcenter', label: 'VC' },
  { id: 'bottom', label: 'B' },
];

const DISTRIBUTE_BUTTONS: Array<{ id: DistributeMode; label: string }> = [
  { id: 'top', label: 'DT' },
  { id: 'vcenter', label: 'DVC' },
  { id: 'bottom', label: 'DB' },
  { id: 'left', label: 'DL' },
  { id: 'hcenter', label: 'DHC' },
  { id: 'right', label: 'DR' },
];

const PATHFINDER_OPS: Array<{ op: PathfinderOp; label: string }> = [
  { op: 'unite', label: 'Unite' },
  { op: 'subtract', label: 'Subtract' },
  { op: 'intersect', label: 'Intersect' },
  { op: 'exclude', label: 'Exclude' },
];

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  store,
  onRefreshFonts,
}) => {
  const state = useStore(store);
  const [inDelta, setInDelta] = useState(0);
  const [outDelta, setOutDelta] = useState(0);
  const [slideVal, setSlideVal] = useState(0);

  const colorUsages = useMemo(
    () => collectDocumentColorUsages(state.doc.nodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.doc.nodes, state.revision],
  );

  const primaryNode = state.selectedNodeIds[0]
    ? findNodeById(state.doc.nodes, state.selectedNodeIds[0])
    : null;

  const primaryPathLookup = state.selectedPathIds[0]
    ? findPathLookup(state.doc.nodes, state.selectedPathIds[0])
    : primaryNode?.paths?.[0]
      ? findPathLookup(state.doc.nodes, primaryNode.paths[0].id)
      : null;

  const primaryPath = primaryPathLookup?.path ?? null;

  const selectedPoints = useMemo(() => {
    if (!primaryPath) return [];
    if (state.selectedPointIds.length === 0) return primaryPath.points;
    const set = new Set(state.selectedPointIds);
    return primaryPath.points.filter((p) => set.has(p.id));
  }, [primaryPath, state.selectedPointIds]);

  const mixedIn = useMemo(() => {
    if (selectedPoints.length <= 1) return false;
    const first = Math.round(selectedPoints[0]!.inLength);
    return selectedPoints.some((p) => Math.round(p.inLength) !== first);
  }, [selectedPoints]);

  const mixedOut = useMemo(() => {
    if (selectedPoints.length <= 1) return false;
    const first = Math.round(selectedPoints[0]!.outLength);
    return selectedPoints.some((p) => Math.round(p.outLength) !== first);
  }, [selectedPoints]);

  const selectedNodes = useMemo(
    () =>
      state.selectedNodeIds
        .map((id) => findNodeById(state.doc.nodes, id))
        .filter((n): n is NonNullable<typeof n> => Boolean(n)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.doc.nodes, state.selectedNodeIds, state.revision],
  );

  const mixedFill = useMemo(() => {
    if (selectedNodes.length <= 1) return false;
    const first = selectedNodes[0]?.style?.fill?.color ?? 'none';
    return selectedNodes.some((n) => (n.style?.fill?.color ?? 'none') !== first);
  }, [selectedNodes]);

  const mixedStrokeWidth = useMemo(() => {
    if (selectedNodes.length <= 1) return false;
    const first = selectedNodes[0]?.style?.stroke?.width ?? 0;
    return selectedNodes.some((n) => (n.style?.stroke?.width ?? 0) !== first);
  }, [selectedNodes]);

  const applyTransformField = (
    field: keyof NonNullable<typeof primaryNode>['transform'],
    value: number,
  ) => {
    if (!Number.isFinite(value) || state.selectedNodeIds.length === 0) return;
    state.executeCommand(
      new SetTransformPropsCommand(
        () => store.getState().doc,
        state.selectedNodeIds,
        { [field]: value },
      ),
    );
  };

  const applyHandleOffset = (field: 'inLength' | 'outLength', delta: number) => {
    if (!primaryPath || delta === 0) return;
    const targetPointIds =
      state.selectedPointIds.length > 0
        ? state.selectedPointIds
        : primaryPath.points.map((p) => p.id);
    state.executeCommand(
      new OffsetHandlesCommand(
        () => store.getState().doc,
        primaryPath.id,
        targetPointIds,
        { field, delta },
      ),
    );
    if (field === 'inLength') setInDelta(0);
    else setOutDelta(0);
  };

  const trimOp = primaryNode?.operators?.find((o) => o.type === 'trim_paths');
  const repeaterOp = primaryNode?.operators?.find((o) => o.type === 'repeater');
  const offsetOp = primaryNode?.operators?.find((o) => o.type === 'offset_paths');

  return (
    <div className="dm-panel" style={{ width: 320, overflowY: 'auto' }}>
      <div className="dm-panel-header">
        <span>Properties</span>
        <span className="dm-badge">{state.selectedNodeIds.length} sel</span>
      </div>

      {/* When nothing is selected: Document Colors Manager (matching screenshot) */}
      {!primaryNode && (
        <>
          <div className="dm-section">
            <div className="dm-section-title">
              <span>Colors ({colorUsages.length})</span>
              <span style={{ fontSize: 10 }}>Click swatch to replace</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {colorUsages.map((entry) => (
                <div
                  key={entry.color}
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <input
                    type="color"
                    value={entry.color}
                    onChange={(e) =>
                      state.executeCommand(
                        new ReplaceColorCommand(
                          () => store.getState().doc,
                          entry.color,
                          { toColor: e.target.value },
                        ),
                      )
                    }
                  />
                  <code style={{ flex: 1, fontSize: 11 }}>{entry.color}</code>
                  <span className="dm-badge">{entry.count}</span>
                  <button
                    type="button"
                    className="dm-btn"
                    style={{ padding: '2px 6px' }}
                    onClick={() => state.selectNodes(entry.nodeIds)}
                    title="Select all objects using this color"
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="dm-section">
            <div className="dm-section-title">Global Linked Swatches</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {state.doc.globalColors.map((swatch) => (
                <div
                  key={swatch.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <input
                    type="color"
                    value={swatch.color}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateGlobalColorCommand(
                          () => store.getState().doc,
                          swatch.id,
                          { color: e.target.value },
                        ),
                      )
                    }
                  />
                  <span style={{ flex: 1, fontSize: 11 }}>{swatch.name}</span>
                  <code style={{ fontSize: 10, color: '#94a3b8' }}>
                    {swatch.color}
                  </code>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {primaryNode && (
        <>
          {/* Alignment & Distribution */}
          <div className="dm-section">
            <div className="dm-section-title">
              <span>Align & Distribute</span>
              <select
                className="dm-select"
                style={{ width: 96 }}
                value={state.alignScope}
                onChange={(e) =>
                  state.setAlignScope(e.target.value as AlignScope)
                }
                title="Individual objects vs Set (preserve spacing)"
              >
                <option value="individual">Individual</option>
                <option value="set">As Set</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <select
                className="dm-select"
                value={state.alignToMode}
                onChange={(e) =>
                  state.setAlignToMode(e.target.value as AlignToMode)
                }
              >
                <option value="selection">Align to: Selection</option>
                <option value="key_object">Align to: Key Object</option>
                <option value="composition">Align to: Composition</option>
              </select>
              <button
                type="button"
                className={`dm-btn ${state.keyObjectId === primaryNode.id ? 'active' : ''}`}
                onClick={() => {
                  state.setKeyObject(primaryNode.id);
                  state.setAlignToMode('key_object');
                }}
                title="Mark current object as Key Object"
              >
                Key
              </button>
            </div>

            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              {ALIGN_BUTTONS.map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  className="dm-btn"
                  style={{ flex: 1 }}
                  onClick={() =>
                    state.executeCommand(
                      new AlignNodesCommand(
                        () => store.getState().doc,
                        state.selectedNodeIds,
                        btn.id,
                        {
                          alignTo: state.alignToMode,
                          scope: state.alignScope,
                          keyObjectId: state.keyObjectId,
                        },
                      ),
                    )
                  }
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {state.selectedNodeIds.length >= 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 3 }}>
                  {DISTRIBUTE_BUTTONS.map((btn) => (
                    <button
                      key={btn.id}
                      type="button"
                      className="dm-btn"
                      style={{ flex: 1, fontSize: 10, padding: '2px 3px' }}
                      onClick={() =>
                        state.executeCommand(
                          new DistributeNodesCommand(
                            () => store.getState().doc,
                            state.selectedNodeIds,
                            btn.id,
                            state.distributeGap ?? undefined,
                          ),
                        )
                      }
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>Spacing</span>
                  <button
                    type="button"
                    className={`dm-btn ${state.distributeGap === null ? 'active' : ''}`}
                    style={{ fontSize: 10, padding: '1px 6px' }}
                    onClick={() => state.setDistributeGap(null)}
                  >
                    Even
                  </button>
                  <input
                    type="number"
                    className="dm-input"
                    style={{ width: 62 }}
                    placeholder="px"
                    value={state.distributeGap ?? ''}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      state.setDistributeGap(val === '' ? null : Number(val));
                    }}
                  />
                  <button
                    type="button"
                    className="dm-btn"
                    style={{ fontSize: 10 }}
                    onClick={() =>
                      state.executeCommand(
                        new DistributeNodesCommand(
                          () => store.getState().doc,
                          state.selectedNodeIds,
                          'space_h',
                          state.distributeGap ?? undefined,
                        ),
                      )
                    }
                  >
                    Gap H
                  </button>
                  <button
                    type="button"
                    className="dm-btn"
                    style={{ fontSize: 10 }}
                    onClick={() =>
                      state.executeCommand(
                        new DistributeNodesCommand(
                          () => store.getState().doc,
                          state.selectedNodeIds,
                          'space_v',
                          state.distributeGap ?? undefined,
                        ),
                      )
                    }
                  >
                    Gap V
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Pathfinder Boolean Operations (Destructive vs Operator toggle matching screenshot 3bb99f0c) */}
          {state.selectedNodeIds.length >= 2 && (
            <div className="dm-section">
              <div className="dm-section-title">
                <span>Pathfinder</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    type="button"
                    className={`dm-btn ${state.pathfinderMode === 'destructive' ? 'active' : ''}`}
                    style={{ padding: '1px 5px', fontSize: 10 }}
                    onClick={() => state.setPathfinderMode('destructive')}
                  >
                    Destructive
                  </button>
                  <button
                    type="button"
                    className={`dm-btn ${state.pathfinderMode === 'operator' ? 'active' : ''}`}
                    style={{ padding: '1px 5px', fontSize: 10 }}
                    onClick={() => state.setPathfinderMode('operator')}
                  >
                    Operator
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {PATHFINDER_OPS.map((p) => (
                  <button
                    key={p.op}
                    type="button"
                    className="dm-btn"
                    style={{ flex: 1, fontSize: 10 }}
                    onClick={() =>
                      state.executeCommand(
                        new PathfinderCommand(
                          () => store.getState().doc,
                          state.selectedNodeIds[0]!,
                          state.selectedNodeIds[1]!,
                          p.op,
                          (newId) => state.selectNodes([newId]),
                          state.pathfinderMode,
                        ),
                      )
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Layer / Group Transform + Blend Mode + Skew + Opacity */}
          <div className="dm-section">
            <div className="dm-section-title">
              <span>{primaryNode.type === 'group' ? 'Group' : 'Layer'} — {primaryNode.name}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                <input
                  type="checkbox"
                  checked={primaryNode.hasKeyframes}
                  onChange={() =>
                    state.executeCommand(
                      new MutateDocumentCommand(
                        () => store.getState().doc,
                        'Toggle Keyframes Flag',
                        (doc) => {
                          const target = findNodeById(doc.nodes, primaryNode.id);
                          if (target) target.hasKeyframes = !target.hasKeyframes;
                        },
                      ),
                    )
                  }
                />
                Keyframed
              </label>
            </div>
            {state.selectedNodeIds.length > 1 && (
              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6 }}>
                {state.selectedNodeIds.length} objects selected. Editing applies across selection.
              </div>
            )}

            <label className="dm-field" style={{ marginBottom: 6 }}>
              <span className="dm-field-label">Blend Mode</span>
              <select
                className="dm-select"
                value={primaryNode.blendMode ?? 'normal'}
                onChange={(e) =>
                  state.executeCommand(
                    new MutateDocumentCommand(
                      () => store.getState().doc,
                      'Set Blend Mode',
                      (doc) => {
                        for (const id of state.selectedNodeIds) {
                          const target = findNodeById(doc.nodes, id);
                          if (target) target.blendMode = e.target.value as BlendMode;
                        }
                      },
                    ),
                  )
                }
              >
                <option value="normal">Normal</option>
                <option value="multiply">Multiply</option>
                <option value="screen">Screen</option>
                <option value="overlay">Overlay</option>
                <option value="darken">Darken</option>
                <option value="lighten">Lighten</option>
                <option value="color-dodge">Color Dodge</option>
                <option value="difference">Difference</option>
              </select>
            </label>

            <div className="dm-grid-2">
              <label className="dm-field">
                <span className="dm-field-label">Position X</span>
                <input
                  type="number"
                  className="dm-input"
                  value={Math.round(primaryNode.transform.x * 100) / 100}
                  onChange={(e) => applyTransformField('x', Number(e.target.value))}
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Position Y</span>
                <input
                  type="number"
                  className="dm-input"
                  value={Math.round(primaryNode.transform.y * 100) / 100}
                  onChange={(e) => applyTransformField('y', Number(e.target.value))}
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Scale X</span>
                <input
                  type="number"
                  step={0.05}
                  className="dm-input"
                  value={primaryNode.transform.scaleX}
                  onChange={(e) => applyTransformField('scaleX', Number(e.target.value))}
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Scale Y</span>
                <input
                  type="number"
                  step={0.05}
                  className="dm-input"
                  value={primaryNode.transform.scaleY}
                  onChange={(e) => applyTransformField('scaleY', Number(e.target.value))}
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Skew (°)</span>
                <input
                  type="number"
                  className="dm-input"
                  value={primaryNode.transform.skew ?? 0}
                  onChange={(e) => applyTransformField('skew', Number(e.target.value))}
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Skew Axis (°)</span>
                <input
                  type="number"
                  className="dm-input"
                  value={primaryNode.transform.skewAxis ?? 0}
                  onChange={(e) => applyTransformField('skewAxis', Number(e.target.value))}
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Rotation (°)</span>
                <input
                  type="number"
                  className="dm-input"
                  value={primaryNode.transform.rotation}
                  onChange={(e) => applyTransformField('rotation', Number(e.target.value))}
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Opacity (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="dm-input"
                  value={primaryNode.transform.opacity ?? 100}
                  onChange={(e) =>
                    applyTransformField('opacity', Math.max(0, Math.min(100, Number(e.target.value))))
                  }
                />
              </label>
            </div>
          </div>

          {/* Character & Paragraph Typography (matching screenshot 6ad5ef5d) */}
          {primaryNode.type === 'text' && (
            <div className="dm-section">
              <div className="dm-section-title">
                <span>Character & Paragraph</span>
                {onRefreshFonts && (
                  <button
                    type="button"
                    className="dm-btn"
                    style={{ padding: '1px 6px', fontSize: 10 }}
                    onClick={async () => {
                      const fonts = await onRefreshFonts();
                      state.setCachedFonts(fonts);
                    }}
                  >
                    Refresh Fonts
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  type="text"
                  className="dm-input"
                  value={primaryNode.textContent ?? ''}
                  onChange={(e) =>
                    state.executeCommand(
                      new MutateDocumentCommand(
                        () => store.getState().doc,
                        'Edit Text',
                        (doc) => {
                          const target = findNodeById(doc.nodes, primaryNode.id);
                          if (target) target.textContent = e.target.value;
                        },
                      ),
                    )
                  }
                />
                <div className="dm-grid-2">
                  <select
                    className="dm-select"
                    value={primaryNode.fontFamily ?? 'Inter'}
                    onChange={(e) =>
                      state.executeCommand(
                        new MutateDocumentCommand(
                          () => store.getState().doc,
                          'Change Font',
                          (doc) => {
                            const target = findNodeById(doc.nodes, primaryNode.id);
                            if (target) target.fontFamily = e.target.value;
                          },
                        ),
                      )
                    }
                  >
                    {state.cachedFonts.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <select
                    className="dm-select"
                    value={primaryNode.fontStyle ?? 'Medium'}
                    onChange={(e) =>
                      state.executeCommand(
                        new MutateDocumentCommand(
                          () => store.getState().doc,
                          'Change Font Style',
                          (doc) => {
                            const target = findNodeById(doc.nodes, primaryNode.id);
                            if (target) target.fontStyle = e.target.value;
                          },
                        ),
                      )
                    }
                  >
                    <option value="Regular">Regular</option>
                    <option value="Medium">Medium</option>
                    <option value="Bold">Bold</option>
                  </select>
                  <label className="dm-field">
                    <span className="dm-field-label">Size (px)</span>
                    <input
                      type="number"
                      className="dm-input"
                      value={primaryNode.fontSize ?? 48}
                      onChange={(e) =>
                        state.executeCommand(
                          new MutateDocumentCommand(
                            () => store.getState().doc,
                            'Font Size',
                            (doc) => {
                              const target = findNodeById(doc.nodes, primaryNode.id);
                              if (target) target.fontSize = Math.max(6, Number(e.target.value));
                            },
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="dm-field">
                    <span className="dm-field-label">Baseline Shift</span>
                    <input
                      type="number"
                      className="dm-input"
                      value={primaryNode.baselineShift ?? 0}
                      onChange={(e) =>
                        state.executeCommand(
                          new MutateDocumentCommand(
                            () => store.getState().doc,
                            'Baseline Shift',
                            (doc) => {
                              const target = findNodeById(doc.nodes, primaryNode.id);
                              if (target) target.baselineShift = Number(e.target.value);
                            },
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="dm-field">
                    <span className="dm-field-label">Tracking</span>
                    <input
                      type="number"
                      className="dm-input"
                      value={primaryNode.tracking ?? 0}
                      onChange={(e) =>
                        state.executeCommand(
                          new MutateDocumentCommand(
                            () => store.getState().doc,
                            'Tracking',
                            (doc) => {
                              const target = findNodeById(doc.nodes, primaryNode.id);
                              if (target) target.tracking = Number(e.target.value);
                            },
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="dm-field">
                    <span className="dm-field-label">Paragraph Align</span>
                    <select
                      className="dm-select"
                      value={primaryNode.textAlign ?? 'center'}
                      onChange={(e) =>
                        state.executeCommand(
                          new MutateDocumentCommand(
                            () => store.getState().doc,
                            'Text Align',
                            (doc) => {
                              const target = findNodeById(doc.nodes, primaryNode.id);
                              if (target) target.textAlign = e.target.value as 'left' | 'center' | 'right';
                            },
                          ),
                        )
                      }
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(
                    [
                      ['fauxBold', 'B'],
                      ['fauxItalic', 'I'],
                      ['allCaps', 'TT'],
                      ['ligatures', 'fi'],
                    ] as const
                  ).map(([propKey, lbl]) => (
                    <button
                      key={propKey}
                      type="button"
                      className={`dm-btn ${primaryNode[propKey] ? 'active' : ''}`}
                      style={{ flex: 1, fontSize: 10 }}
                      onClick={() =>
                        state.executeCommand(
                          new MutateDocumentCommand(
                            () => store.getState().doc,
                            `Toggle ${lbl}`,
                            (doc) => {
                              const target = findNodeById(doc.nodes, primaryNode.id);
                              if (target) target[propKey] = !target[propKey];
                            },
                          ),
                        )
                      }
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Style, Gradient, Line Cap/Join & Stroke Taper */}
          <div className="dm-section">
            <div className="dm-section-title">
              <span>Fill & Stroke</span>
              {(mixedFill || mixedStrokeWidth) && (
                <span className="dm-badge">Mixed</span>
              )}
            </div>
            <div className="dm-grid-2">
              <label className="dm-field">
                <span className="dm-field-label">
                  Fill {mixedFill ? '(Mixed)' : ''}
                </span>
                <input
                  type="color"
                  value={primaryNode.style?.fill?.color ?? '#4f8cff'}
                  onChange={(e) =>
                    state.executeCommand(
                      new UpdateStyleCommand(
                        () => store.getState().doc,
                        state.selectedNodeIds,
                        (prev) => ({
                          ...prev,
                          fill: {
                            opacity: prev?.fill?.opacity ?? 1,
                            ...prev?.fill,
                            color: e.target.value,
                            gradient: undefined,
                            globalColorId: undefined,
                          },
                        }),
                        { fillColor: e.target.value },
                      ),
                    )
                  }
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Fill Opacity</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  className="dm-input"
                  value={primaryNode.style?.fill?.opacity ?? 1}
                  onChange={(e) =>
                    state.executeCommand(
                      new UpdateStyleCommand(
                        () => store.getState().doc,
                        state.selectedNodeIds,
                        (prev) => ({
                          ...prev,
                          fill: {
                            color: prev?.fill?.color ?? '#4f8cff',
                            ...prev?.fill,
                            opacity: Math.max(0, Math.min(1, Number(e.target.value))),
                          },
                        }),
                      ),
                    )
                  }
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Stroke Color</span>
                <input
                  type="color"
                  value={primaryNode.style?.stroke?.color ?? '#e2e8f0'}
                  onChange={(e) =>
                    state.executeCommand(
                      new UpdateStyleCommand(
                        () => store.getState().doc,
                        state.selectedNodeIds,
                        (prev) => ({
                          ...prev,
                          stroke: {
                            width: prev?.stroke?.width ?? 2,
                            ...prev?.stroke,
                            color: e.target.value,
                          },
                        }),
                        { strokeColor: e.target.value },
                      ),
                    )
                  }
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">
                  Stroke Width {mixedStrokeWidth ? '(Mixed)' : ''}
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  placeholder={mixedStrokeWidth ? 'Mixed' : 'px'}
                  className="dm-input"
                  value={mixedStrokeWidth ? '' : (primaryNode.style?.stroke?.width ?? 0)}
                  onChange={(e) =>
                    state.executeCommand(
                      new UpdateStyleCommand(
                        () => store.getState().doc,
                        state.selectedNodeIds,
                        (prev) => ({
                          ...prev,
                          stroke: {
                            color: prev?.stroke?.color ?? '#e2e8f0',
                            ...prev?.stroke,
                            width: Math.max(0, Number(e.target.value)),
                          },
                        }),
                        { strokeWidth: Number(e.target.value) },
                      ),
                    )
                  }
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Taper Start (0–1)</span>
                <input
                  type="number"
                  min={0}
                  max={0.95}
                  step={0.05}
                  className="dm-input"
                  value={primaryNode.style?.stroke?.taperStart ?? 0}
                  onChange={(e) =>
                    state.executeCommand(
                      new UpdateStyleCommand(
                        () => store.getState().doc,
                        state.selectedNodeIds,
                        (prev) => ({
                          ...prev,
                          stroke: {
                            color: prev?.stroke?.color ?? '#e2e8f0',
                            width: prev?.stroke?.width ?? 3,
                            ...prev?.stroke,
                            taperStart: Math.max(0, Math.min(0.95, Number(e.target.value))),
                          },
                        }),
                      ),
                    )
                  }
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Taper End (0–1)</span>
                <input
                  type="number"
                  min={0}
                  max={0.95}
                  step={0.05}
                  className="dm-input"
                  value={primaryNode.style?.stroke?.taperEnd ?? 0}
                  onChange={(e) =>
                    state.executeCommand(
                      new UpdateStyleCommand(
                        () => store.getState().doc,
                        state.selectedNodeIds,
                        (prev) => ({
                          ...prev,
                          stroke: {
                            color: prev?.stroke?.color ?? '#e2e8f0',
                            width: prev?.stroke?.width ?? 3,
                            ...prev?.stroke,
                            taperEnd: Math.max(0, Math.min(0.95, Number(e.target.value))),
                          },
                        }),
                      ),
                    )
                  }
                />
              </label>
              <div className="dm-field">
                <span className="dm-field-label">Line Cap</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  {(['butt', 'round', 'square'] as LineCap[]).map((cap) => (
                    <button
                      key={cap}
                      type="button"
                      className={`dm-btn ${(primaryNode.style?.stroke?.lineCap ?? 'round') === cap ? 'active' : ''}`}
                      style={{ flex: 1, fontSize: 9, padding: '2px 3px' }}
                      onClick={() =>
                        state.executeCommand(
                          new UpdateStyleCommand(
                            () => store.getState().doc,
                            state.selectedNodeIds,
                            (prev) => ({
                              ...prev,
                              stroke: {
                                color: prev?.stroke?.color ?? '#e2e8f0',
                                width: prev?.stroke?.width ?? 2,
                                ...prev?.stroke,
                                lineCap: cap,
                              },
                            }),
                          ),
                        )
                      }
                    >
                      {cap}
                    </button>
                  ))}
                </div>
              </div>
              <div className="dm-field">
                <span className="dm-field-label">Line Join</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  {(['miter', 'round', 'bevel'] as LineJoin[]).map((join) => (
                    <button
                      key={join}
                      type="button"
                      className={`dm-btn ${(primaryNode.style?.stroke?.lineJoin ?? 'round') === join ? 'active' : ''}`}
                      style={{ flex: 1, fontSize: 9, padding: '2px 3px' }}
                      onClick={() =>
                        state.executeCommand(
                          new UpdateStyleCommand(
                            () => store.getState().doc,
                            state.selectedNodeIds,
                            (prev) => ({
                              ...prev,
                              stroke: {
                                color: prev?.stroke?.color ?? '#e2e8f0',
                                width: prev?.stroke?.width ?? 2,
                                ...prev?.stroke,
                                lineJoin: join,
                              },
                            }),
                          ),
                        )
                      }
                    >
                      {join}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Parametric Shape Controls (DM Ellipse Start/Sweep/Ratio) */}
          {primaryPath && primaryPath.type === 'parametric_ellipse' && (
            <div className="dm-section">
              <div className="dm-section-title">DM Ellipse</div>
              <div className="dm-grid-2">
                <label className="dm-field">
                  <span className="dm-field-label">Radius X</span>
                  <input
                    type="number"
                    className="dm-input"
                    value={primaryPath.parametricData?.rx ?? 100}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          rx: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Radius Y</span>
                  <input
                    type="number"
                    className="dm-input"
                    value={primaryPath.parametricData?.ry ?? 100}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          ry: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Start Angle (°)</span>
                  <input
                    type="number"
                    className="dm-input"
                    value={primaryPath.parametricData?.startAngle ?? -90}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          startAngle: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Sweep (°)</span>
                  <input
                    type="number"
                    min={1}
                    max={360}
                    className="dm-input"
                    value={primaryPath.parametricData?.sweep ?? 360}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          sweep: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Ratio (0–1)</span>
                  <input
                    type="number"
                    min={0}
                    max={0.98}
                    step={0.05}
                    className="dm-input"
                    value={primaryPath.parametricData?.holeRatio ?? 0}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          holeRatio: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
              </div>
            </div>
          )}

          {primaryPath && primaryPath.type === 'parametric_rect' && (
            <div className="dm-section">
              <div className="dm-section-title">Parametric Rectangle</div>
              <div className="dm-grid-2">
                <label className="dm-field">
                  <span className="dm-field-label">Width</span>
                  <input
                    type="number"
                    className="dm-input"
                    value={primaryPath.parametricData?.width ?? 160}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          width: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Height</span>
                  <input
                    type="number"
                    className="dm-input"
                    value={primaryPath.parametricData?.height ?? 120}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          height: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Roundness</span>
                  <input
                    type="number"
                    min={0}
                    className="dm-input"
                    value={primaryPath.parametricData?.roundness ?? 0}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          roundness: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
              </div>
            </div>
          )}

          {primaryPath && primaryPath.type === 'parametric_star' && (
            <div className="dm-section">
              <div className="dm-section-title">Parametric Star / Polygon</div>
              <div className="dm-grid-2">
                <label className="dm-field">
                  <span className="dm-field-label">Points</span>
                  <input
                    type="number"
                    min={3}
                    max={32}
                    className="dm-input"
                    value={primaryPath.parametricData?.pointsCount ?? 5}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          pointsCount: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Outer Radius</span>
                  <input
                    type="number"
                    className="dm-input"
                    value={primaryPath.parametricData?.outerRadius ?? 100}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          outerRadius: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Inner Radius</span>
                  <input
                    type="number"
                    className="dm-input"
                    value={primaryPath.parametricData?.innerRadius ?? 45}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          innerRadius: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Roundness</span>
                  <input
                    type="number"
                    min={0}
                    className="dm-input"
                    value={primaryPath.parametricData?.roundness ?? 0}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          roundness: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
              </div>
            </div>
          )}

          {primaryPath && primaryPath.type === 'parametric_line' && (
            <div className="dm-section">
              <div className="dm-section-title">Parametric Line</div>
              <div className="dm-grid-2">
                <label className="dm-field">
                  <span className="dm-field-label">Length</span>
                  <input
                    type="number"
                    className="dm-input"
                    value={primaryPath.parametricData?.length ?? 160}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          length: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Angle (°)</span>
                  <input
                    type="number"
                    className="dm-input"
                    value={primaryPath.parametricData?.angle ?? 0}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(() => store.getState().doc, primaryPath.id, {
                          angle: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </label>
              </div>
            </div>
          )}

          {/* Shape Operators: Trim Paths, Repeater, Offset Paths */}
          <div className="dm-section">
            <div className="dm-section-title">
              <span>Shape Operators</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  className={`dm-btn ${trimOp?.enabled ? 'active' : ''}`}
                  style={{ padding: '1px 5px', fontSize: 10 }}
                  onClick={() => {
                    const ops: ShapeOperator[] = (primaryNode.operators ?? []).filter(
                      (o) => o.type !== 'trim_paths',
                    );
                    if (!trimOp) {
                      ops.push({
                        id: createId('trim'),
                        type: 'trim_paths',
                        enabled: true,
                        start: 0,
                        end: 65,
                        offset: 0,
                      });
                    }
                    state.executeCommand(
                      new SetShapeOperatorCommand(() => store.getState().doc, primaryNode.id, ops),
                    );
                  }}
                >
                  Trim
                </button>
                <button
                  type="button"
                  className={`dm-btn ${repeaterOp?.enabled ? 'active' : ''}`}
                  style={{ padding: '1px 5px', fontSize: 10 }}
                  onClick={() => {
                    const ops: ShapeOperator[] = (primaryNode.operators ?? []).filter(
                      (o) => o.type !== 'repeater',
                    );
                    if (!repeaterOp) {
                      ops.push({
                        id: createId('rep'),
                        type: 'repeater',
                        enabled: true,
                        copies: 4,
                        offsetX: 35,
                        offsetY: 0,
                        rotation: 12,
                        scale: 0.92,
                      });
                    }
                    state.executeCommand(
                      new SetShapeOperatorCommand(() => store.getState().doc, primaryNode.id, ops),
                    );
                  }}
                >
                  Repeat
                </button>
                <button
                  type="button"
                  className={`dm-btn ${offsetOp?.enabled ? 'active' : ''}`}
                  style={{ padding: '1px 5px', fontSize: 10 }}
                  onClick={() => {
                    const ops: ShapeOperator[] = (primaryNode.operators ?? []).filter(
                      (o) => o.type !== 'offset_paths',
                    );
                    if (!offsetOp) {
                      ops.push({
                        id: createId('off'),
                        type: 'offset_paths',
                        enabled: true,
                        amount: 12,
                      });
                    }
                    state.executeCommand(
                      new SetShapeOperatorCommand(() => store.getState().doc, primaryNode.id, ops),
                    );
                  }}
                >
                  Offset
                </button>
              </div>
            </div>

            {trimOp && trimOp.type === 'trim_paths' && (
              <div className="dm-grid-2" style={{ marginBottom: 6 }}>
                <label className="dm-field">
                  <span className="dm-field-label">Trim Start %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="dm-input"
                    value={trimOp.start}
                    onChange={(e) => {
                      const next = (primaryNode.operators ?? []).map((o) =>
                        o.id === trimOp.id ? { ...trimOp, start: Number(e.target.value) } : o,
                      );
                      state.executeCommand(
                        new SetShapeOperatorCommand(() => store.getState().doc, primaryNode.id, next),
                      );
                    }}
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Trim End %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="dm-input"
                    value={trimOp.end}
                    onChange={(e) => {
                      const next = (primaryNode.operators ?? []).map((o) =>
                        o.id === trimOp.id ? { ...trimOp, end: Number(e.target.value) } : o,
                      );
                      state.executeCommand(
                        new SetShapeOperatorCommand(() => store.getState().doc, primaryNode.id, next),
                      );
                    }}
                  />
                </label>
              </div>
            )}

            {repeaterOp && repeaterOp.type === 'repeater' && (
              <div className="dm-grid-2" style={{ marginBottom: 6 }}>
                <label className="dm-field">
                  <span className="dm-field-label">Copies</span>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    className="dm-input"
                    value={repeaterOp.copies}
                    onChange={(e) => {
                      const next = (primaryNode.operators ?? []).map((o) =>
                        o.id === repeaterOp.id ? { ...repeaterOp, copies: Number(e.target.value) } : o,
                      );
                      state.executeCommand(
                        new SetShapeOperatorCommand(() => store.getState().doc, primaryNode.id, next),
                      );
                    }}
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Rot / Copy (°)</span>
                  <input
                    type="number"
                    className="dm-input"
                    value={repeaterOp.rotation}
                    onChange={(e) => {
                      const next = (primaryNode.operators ?? []).map((o) =>
                        o.id === repeaterOp.id ? { ...repeaterOp, rotation: Number(e.target.value) } : o,
                      );
                      state.executeCommand(
                        new SetShapeOperatorCommand(() => store.getState().doc, primaryNode.id, next),
                      );
                    }}
                  />
                </label>
              </div>
            )}

            {offsetOp && offsetOp.type === 'offset_paths' && (
              <label className="dm-field">
                <span className="dm-field-label">Offset Amount (px)</span>
                <input
                  type="number"
                  className="dm-input"
                  value={offsetOp.amount}
                  onChange={(e) => {
                    const next = (primaryNode.operators ?? []).map((o) =>
                      o.id === offsetOp.id ? { ...offsetOp, amount: Number(e.target.value) } : o,
                    );
                    state.executeCommand(
                      new SetShapeOperatorCommand(() => store.getState().doc, primaryNode.id, next),
                    );
                  }}
                />
              </label>
            )}
          </div>

          {/* Bezier Point, Corner Smoothness & RotoBezier Controls */}
          {primaryPath && primaryPath.type === 'path' && (
            <div className="dm-section">
              <div className="dm-section-title">
                <span>Point, Corner & Path</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(primaryPath.rotoBezier)}
                    onChange={(e) =>
                      state.executeCommand(
                        new SetPathRotoBezierCommand(
                          () => store.getState().doc,
                          primaryPath.id,
                          e.target.checked,
                        ),
                      )
                    }
                  />
                  RotoBezier
                </label>
              </div>

              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {(
                  [
                    ['symmetric', 'Symmetric'],
                    ['angle', 'Angle'],
                    ['broken', 'Free'],
                  ] as Array<[HandleMode, string]>
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`dm-btn ${selectedPoints[0]?.handleMode === mode ? 'active' : ''}`}
                    style={{ flex: 1 }}
                    onClick={() => {
                      const ids = selectedPoints.map((p) => p.id);
                      state.executeCommand(
                        new SetHandleModeCommand(
                          () => store.getState().doc,
                          primaryPath.id,
                          ids,
                          { handleMode: mode },
                        ),
                      );
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="dm-grid-2" style={{ marginBottom: 8 }}>
                <label className="dm-field">
                  <span className="dm-field-label">Corner Radius (px)</span>
                  <input
                    type="number"
                    min={0}
                    className="dm-input"
                    value={selectedPoints[0]?.cornerRadius ?? 0}
                    onChange={(e) =>
                      state.executeCommand(
                        new RoundCornerCommand(
                          () => store.getState().doc,
                          primaryPath.id,
                          state.selectedPointIds.length > 0 ? state.selectedPointIds : null,
                          {
                            cornerRadius: Number(e.target.value),
                            cornerSmoothness: selectedPoints[0]?.cornerSmoothness ?? 0,
                          },
                        ),
                      )
                    }
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Smoothness (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="dm-input"
                    value={selectedPoints[0]?.cornerSmoothness ?? 0}
                    onChange={(e) =>
                      state.executeCommand(
                        new RoundCornerCommand(
                          () => store.getState().doc,
                          primaryPath.id,
                          state.selectedPointIds.length > 0 ? state.selectedPointIds : null,
                          {
                            cornerRadius: selectedPoints[0]?.cornerRadius ?? 12,
                            cornerSmoothness: Number(e.target.value),
                          },
                        ),
                      )
                    }
                  />
                </label>
              </div>

              <div className="dm-grid-2" style={{ marginBottom: 8 }}>
                <div className="dm-field">
                  <span className="dm-field-label">
                    In Handle Δ ({mixedIn ? 'Mixed' : Math.round(selectedPoints[0]?.inLength ?? 0)})
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      type="number"
                      className="dm-input"
                      placeholder={mixedIn ? 'Mixed' : 'Δ'}
                      value={inDelta}
                      onChange={(e) => setInDelta(Number(e.target.value))}
                    />
                    <button
                      type="button"
                      className="dm-btn"
                      onClick={() => applyHandleOffset('inLength', inDelta)}
                    >
                      ±
                    </button>
                  </div>
                </div>
                <div className="dm-field">
                  <span className="dm-field-label">
                    Out Handle Δ ({mixedOut ? 'Mixed' : Math.round(selectedPoints[0]?.outLength ?? 0)})
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      type="number"
                      className="dm-input"
                      placeholder={mixedOut ? 'Mixed' : 'Δ'}
                      value={outDelta}
                      onChange={(e) => setOutDelta(Number(e.target.value))}
                    />
                    <button
                      type="button"
                      className="dm-btn"
                      onClick={() => applyHandleOffset('outLength', outDelta)}
                    >
                      ±
                    </button>
                  </div>
                </div>
              </div>

              <label className="dm-field">
                <span className="dm-field-label">Slide Point Between Handles ({slideVal})</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="range"
                    min={-0.85}
                    max={0.85}
                    step={0.05}
                    value={slideVal}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setSlideVal(v);
                      state.executeCommand(
                        new SlidePointCommand(
                          () => store.getState().doc,
                          primaryPath.id,
                          selectedPoints.map((p) => p.id),
                          { slideFactor: v },
                        ),
                      );
                    }}
                  />
                </div>
              </label>
            </div>
          )}

          {/* Bottom Colors Usage List even when a layer is selected */}
          <div className="dm-section">
            <div className="dm-section-title">
              <span>Colors ({colorUsages.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {colorUsages.slice(0, 8).map((entry) => (
                <div key={entry.color} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="color"
                    value={entry.color}
                    onChange={(e) =>
                      state.executeCommand(
                        new ReplaceColorCommand(
                          () => store.getState().doc,
                          entry.color,
                          { toColor: e.target.value },
                        ),
                      )
                    }
                  />
                  <code style={{ flex: 1, fontSize: 10 }}>{entry.color}</code>
                  <span className="dm-badge">{entry.count}</span>
                  <button
                    type="button"
                    className="dm-btn"
                    style={{ padding: '1px 5px', fontSize: 10 }}
                    onClick={() => state.selectNodes(entry.nodeIds)}
                  >
                    ⊕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
