import { describe, expect, it } from 'vitest';
import {
  applyAxisLock,
  applyHandleLengthDelta,
  applySlideDrag,
  beginSlideDrag,
  buildParametricEllipseContours,
  CommandManager,
  computeBoundingBoxes,
  createDemoDocument,
  createNumericInputState,
  findPathLookup,
  getPointHandles,
  hitTestDocument,
  RoundCornerCommand,
  stepNumericInputMachine,
  type BezierPoint,
} from '../index.js';

describe('CommandManager & Last Action', () => {
  it('executes Last Action undo -> updateParams -> execute seamlessly', () => {
    const doc = createDemoDocument();
    const cm = new CommandManager();
    const cmd = new RoundCornerCommand(() => doc, 'path_shield', ['pt_top'], {
      cornerRadius: 10,
    });

    cm.execute(cmd);
    let pt = findPathLookup(doc.nodes, 'path_shield')!.path.points[0]!;
    expect(pt.cornerRadius).toBe(10);

    const updated = cm.updateLastActionParams({ cornerRadius: 25 });
    expect(updated).toBe(true);
    pt = findPathLookup(doc.nodes, 'path_shield')!.path.points[0]!;
    expect(pt.cornerRadius).toBe(25);

    cm.undo();
    pt = findPathLookup(doc.nodes, 'path_shield')!.path.points[0]!;
    expect(pt.cornerRadius).toBe(0);
  });
});

describe('Hit-Testing 3 Levels & Isolation Mode', () => {
  it('resolves path, group, and layer according to SelectionMode', () => {
    const doc = createDemoDocument();
    // Point on Donut ring: layer_badge is at (360,360), rx=120, holeRatio=0.45 -> (360+90, 360) is inside ring
    const x = 450;
    const y = 360;

    const hitPath = hitTestDocument(doc, x, y, {
      mode: 'path',
      isolationStack: [],
    });
    expect(hitPath?.resolvedMode).toBe('path');
    expect(hitPath?.resolvedId).toBe('path_donut');

    const hitGroup = hitTestDocument(doc, x, y, {
      mode: 'group',
      isolationStack: [],
    });
    expect(hitGroup?.resolvedMode).toBe('group');
    expect(hitGroup?.resolvedId).toBe('group_ring');

    const hitLayer = hitTestDocument(doc, x, y, {
      mode: 'layer',
      isolationStack: [],
    });
    expect(hitLayer?.resolvedMode).toBe('layer');
    expect(hitLayer?.resolvedId).toBe('layer_badge');
  });

  it('ignores non-descendant nodes when Isolation Mode is active', () => {
    const doc = createDemoDocument();
    // Shield center is at (840, 360); when isolated to group_ring, clicking shield returns null
    const hitOutside = hitTestDocument(doc, 840, 360, {
      mode: 'layer',
      isolationStack: ['group_ring'],
    });
    expect(hitOutside).toBeNull();

    // Clicking inside group_ring still hits
    const hitInside = hitTestDocument(doc, 450, 360, {
      mode: 'path',
      isolationStack: ['group_ring'],
    });
    expect(hitInside?.resolvedId).toBe('path_donut');
  });
});

describe('Bounding Boxes & Numeric Double-Key Machine', () => {
  it('computes combined, individual_comp, and individual_object OBB', () => {
    const doc = createDemoDocument();
    const combined = computeBoundingBoxes(
      doc.nodes,
      ['layer_badge', 'layer_shield'],
      'combined',
    );
    expect(combined).toHaveLength(1);

    const comp = computeBoundingBoxes(
      doc.nodes,
      ['layer_badge', 'layer_shield'],
      'individual_comp',
    );
    expect(comp).toHaveLength(2);

    const obb = computeBoundingBoxes(
      doc.nodes,
      ['layer_shield'],
      'individual_object',
    );
    expect(obb).toHaveLength(1);
    expect(obb[0]!.rotationDeg).toBe(12);
    // OBB corners should not all share axis-aligned X/Y due to 12 deg rotation
    expect(obb[0]!.corners[0].y).not.toBeCloseTo(obb[0]!.corners[1].y, 2);
  });

  it('opens numeric buffer on V+V < 400ms and commits parsed value on Enter', () => {
    let state = createNumericInputState();
    let res = stepNumericInputMachine(state, 'v', 1000);
    state = res.state;
    expect(state.active).toBe(false);

    res = stepNumericInputMachine(state, 'v', 1200);
    expect(res.type).toBe('opened');
    state = res.state;
    expect(state.active).toBe(true);
    expect(state.target).toBe('position');

    for (const ch of ['-', '4', '2', '.', '5']) {
      state = stepNumericInputMachine(state, ch, 1250).state;
    }
    const committed = stepNumericInputMachine(state, 'Enter', 1300);
    expect(committed.type).toBe('commit');
    if (committed.type === 'commit') {
      expect(committed.value).toBe(-42.5);
      expect(committed.target).toBe('position');
    }
  });

  it('does not open numeric buffer if second key exceeds 400ms', () => {
    let state = createNumericInputState();
    state = stepNumericInputMachine(state, 'r', 1000).state;
    const res = stepNumericInputMachine(state, 'r', 1450);
    expect(res.type).toBe('none');
    expect(res.state.active).toBe(false);
  });
});

describe('Bezier Math: Axis Lock, Ctrl+Slide, Relative Offset, Parametric Ellipse', () => {
  it('enforces X/Y axis lock', () => {
    expect(applyAxisLock(25, -14, 'x')).toEqual({ deltaX: 25, deltaY: 0 });
    expect(applyAxisLock(25, -14, 'y')).toEqual({ deltaX: 0, deltaY: -14 });
  });

  it('keeps handle tips fixed in space during Ctrl+Slide', () => {
    const pt: BezierPoint = {
      id: 'p1',
      x: 100,
      y: 100,
      angle: 0,
      inLength: 40,
      outLength: 60,
      handleMode: 'angle',
    };
    const origHandles = getPointHandles(pt);
    const slideState = beginSlideDrag(pt);
    const slid = applySlideDrag(pt, 20, 15, slideState);

    // Moved along tangent (angle = 0 -> horizontal), so y stays 100, x becomes 120
    expect(slid.x).toBeCloseTo(120, 4);
    expect(slid.y).toBeCloseTo(100, 4);
    expect(slid.inLength).toBeCloseTo(60, 4);
    expect(slid.outLength).toBeCloseTo(40, 4);

    const newHandles = getPointHandles(slid);
    expect(newHandles.inHandle.x).toBeCloseTo(origHandles.inHandle.x, 4);
    expect(newHandles.inHandle.y).toBeCloseTo(origHandles.inHandle.y, 4);
    expect(newHandles.outHandle.x).toBeCloseTo(origHandles.outHandle.x, 4);
    expect(newHandles.outHandle.y).toBeCloseTo(origHandles.outHandle.y, 4);
  });

  it('applies relative delta offset to multi-point handles', () => {
    const pts: BezierPoint[] = [
      { id: 'a', x: 0, y: 0, angle: 0, inLength: 20, outLength: 30, handleMode: 'angle' },
      { id: 'b', x: 50, y: 0, angle: 0, inLength: 50, outLength: 10, handleMode: 'angle' },
    ];
    const updated = applyHandleLengthDelta(pts, 'inLength', 15);
    expect(updated[0]!.inLength).toBe(35);
    expect(updated[1]!.inLength).toBe(65);
  });

  it('builds parametric ellipse contours with holeRatio and sweep', () => {
    const donut = buildParametricEllipseContours({
      rx: 100,
      ry: 100,
      holeRatio: 0.5,
      sweep: 360,
    });
    expect(donut).toHaveLength(2);

    const arc = buildParametricEllipseContours({
      rx: 100,
      ry: 100,
      holeRatio: 0.4,
      sweep: 180,
    });
    expect(arc).toHaveLength(1);
    expect(arc[0]!.length).toBeGreaterThan(4);
  });
});
