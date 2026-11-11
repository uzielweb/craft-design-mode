import React, { useState } from 'react';
import { useStore } from 'zustand';
import {
  AlignNodesCommand,
  findNodeById,
  findPathLookup,
  MutateDocumentCommand,
  OffsetHandlesCommand,
  RoundCornerCommand,
  SetHandleModeCommand,
  SetTransformPropsCommand,
  UpdateGlobalColorCommand,
  UpdateParametricCommand,
  UpdateStyleCommand,
  type AlignTarget,
  type DesignStore,
  type HandleMode,
} from '@design-mode/vector-core';

export interface PropertiesPanelProps {
  store: DesignStore;
}

const ALIGN_BUTTONS: Array<{ id: AlignTarget; label: string }> = [
  { id: 'left', label: 'L' },
  { id: 'hcenter', label: 'HC' },
  { id: 'right', label: 'R' },
  { id: 'top', label: 'T' },
  { id: 'vcenter', label: 'VC' },
  { id: 'bottom', label: 'B' },
];

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ store }) => {
  const state = useStore(store);
  const [inDelta, setInDelta] = useState(0);
  const [outDelta, setOutDelta] = useState(0);

  const primaryNode = state.selectedNodeIds[0]
    ? findNodeById(state.doc.nodes, state.selectedNodeIds[0])
    : null;

  const primaryPathLookup = state.selectedPathIds[0]
    ? findPathLookup(state.doc.nodes, state.selectedPathIds[0])
    : primaryNode?.paths?.[0]
      ? findPathLookup(state.doc.nodes, primaryNode.paths[0].id)
      : null;

  const primaryPath = primaryPathLookup?.path ?? null;

  const applyTransformField = (field: keyof NonNullable<typeof primaryNode>['transform'], value: number) => {
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

  return (
    <div className="dm-panel" style={{ width: 310, overflowY: 'auto' }}>
      <div className="dm-panel-header">
        <span>Properties</span>
        <span className="dm-badge">
          {state.selectedNodeIds.length} sel
        </span>
      </div>

      {/* Global Color Swatches Manager */}
      <div className="dm-section">
        <div className="dm-section-title">
          <span>Global Color Swatches</span>
          <span style={{ fontSize: 10, color: '#64748b' }}>Linked</span>
        </div>
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
              <code style={{ fontSize: 10, color: '#94a3b8' }}>{swatch.color}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Alignment */}
      <div className="dm-section">
        <div className="dm-section-title">Align</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {ALIGN_BUTTONS.map((btn) => (
            <button
              key={btn.id}
              type="button"
              className="dm-btn"
              style={{ flex: 1 }}
              disabled={state.selectedNodeIds.length === 0}
              onClick={() =>
                state.executeCommand(
                  new AlignNodesCommand(
                    () => store.getState().doc,
                    state.selectedNodeIds,
                    btn.id,
                  ),
                )
              }
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {primaryNode ? (
        <>
          {/* Transform */}
          <div className="dm-section">
            <div className="dm-section-title">
              <span>Transform — {primaryNode.name}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                <input
                  type="checkbox"
                  checked={primaryNode.hasKeyframes}
                  onChange={() => {
                    state.executeCommand(
                      new MutateDocumentCommand(
                        () => store.getState().doc,
                        'Toggle Keyframes Flag',
                        (doc) => {
                          const target = findNodeById(doc.nodes, primaryNode.id);
                          if (target) target.hasKeyframes = !target.hasKeyframes;
                        },
                      ),
                    );
                  }}
                />
                Keyframed
              </label>
            </div>

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
                <span className="dm-field-label">Rotation (°)</span>
                <input
                  type="number"
                  className="dm-input"
                  value={primaryNode.transform.rotation}
                  onChange={(e) => applyTransformField('rotation', Number(e.target.value))}
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Anchor X</span>
                <input
                  type="number"
                  className="dm-input"
                  value={primaryNode.transform.anchorX}
                  onChange={(e) => applyTransformField('anchorX', Number(e.target.value))}
                />
              </label>
            </div>
          </div>

          {/* Style */}
          <div className="dm-section">
            <div className="dm-section-title">Appearance</div>
            <div className="dm-grid-2">
              <label className="dm-field">
                <span className="dm-field-label">Fill Color</span>
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
                            globalColorId: undefined,
                          },
                        }),
                        { strokeColor: e.target.value },
                      ),
                    )
                  }
                />
              </label>
              <label className="dm-field">
                <span className="dm-field-label">Stroke Width</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="dm-input"
                  value={primaryNode.style?.stroke?.width ?? 0}
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
            </div>
          </div>

          {/* Parametric Shape Controls */}
          {primaryPath && primaryPath.type === 'parametric_ellipse' && (
            <div className="dm-section">
              <div className="dm-section-title">Parametric Ellipse</div>
              <div className="dm-grid-2">
                <label className="dm-field">
                  <span className="dm-field-label">Radius X</span>
                  <input
                    type="number"
                    className="dm-input"
                    value={primaryPath.parametricData?.rx ?? 100}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(
                          () => store.getState().doc,
                          primaryPath.id,
                          { rx: Number(e.target.value) },
                        ),
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
                        new UpdateParametricCommand(
                          () => store.getState().doc,
                          primaryPath.id,
                          { ry: Number(e.target.value) },
                        ),
                      )
                    }
                  />
                </label>
                <label className="dm-field">
                  <span className="dm-field-label">Hole Ratio (0–1)</span>
                  <input
                    type="number"
                    min={0}
                    max={0.98}
                    step={0.05}
                    className="dm-input"
                    value={primaryPath.parametricData?.holeRatio ?? 0}
                    onChange={(e) =>
                      state.executeCommand(
                        new UpdateParametricCommand(
                          () => store.getState().doc,
                          primaryPath.id,
                          { holeRatio: Number(e.target.value) },
                        ),
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
                        new UpdateParametricCommand(
                          () => store.getState().doc,
                          primaryPath.id,
                          { sweep: Number(e.target.value) },
                        ),
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
                        new UpdateParametricCommand(
                          () => store.getState().doc,
                          primaryPath.id,
                          { length: Number(e.target.value) },
                        ),
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
                        new UpdateParametricCommand(
                          () => store.getState().doc,
                          primaryPath.id,
                          { angle: Number(e.target.value) },
                        ),
                      )
                    }
                  />
                </label>
              </div>
            </div>
          )}

          {/* Bezier Points & Handles Controls */}
          {primaryPath && primaryPath.type === 'path' && (
            <div className="dm-section">
              <div className="dm-section-title">
                <span>Bezier Handles</span>
                <span style={{ fontSize: 10 }}>
                  {state.selectedPointIds.length || primaryPath.points.length} pts
                </span>
              </div>

              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {(['symmetric', 'angle', 'broken'] as HandleMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className="dm-btn"
                    style={{ flex: 1 }}
                    onClick={() => {
                      const ids =
                        state.selectedPointIds.length > 0
                          ? state.selectedPointIds
                          : primaryPath.points.map((p) => p.id);
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
                    {mode}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="dm-btn"
                style={{ width: '100%', marginBottom: 8 }}
                onClick={() =>
                  state.executeCommand(
                    new RoundCornerCommand(
                      () => store.getState().doc,
                      primaryPath.id,
                      state.selectedPointIds.length > 0
                        ? state.selectedPointIds
                        : null,
                      { cornerRadius: 16 },
                    ),
                  )
                }
              >
                Apply Round Corner (Last Action)
              </button>

              <div className="dm-grid-2">
                <div className="dm-field">
                  <span className="dm-field-label">In Handle Δ Offset</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      type="number"
                      className="dm-input"
                      value={inDelta}
                      onChange={(e) => setInDelta(Number(e.target.value))}
                    />
                    <button
                      type="button"
                      className="dm-btn"
                      onClick={() => applyHandleOffset('inLength', inDelta)}
                    >
                      +Δ
                    </button>
                  </div>
                </div>
                <div className="dm-field">
                  <span className="dm-field-label">Out Handle Δ Offset</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      type="number"
                      className="dm-input"
                      value={outDelta}
                      onChange={(e) => setOutDelta(Number(e.target.value))}
                    />
                    <button
                      type="button"
                      className="dm-btn"
                      onClick={() => applyHandleOffset('outLength', outDelta)}
                    >
                      +Δ
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="dm-section" style={{ color: '#64748b' }}>
          Select a layer, group, or path on the canvas or Layers panel.
        </div>
      )}
    </div>
  );
};
