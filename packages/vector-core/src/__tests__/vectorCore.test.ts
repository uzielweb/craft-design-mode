import { describe, expect, it } from 'vitest';
import {
  AlignNodesCommand,
  applyAxisLock,
  applyHandleLengthDelta,
  applyRotoBezier,
  applySlideDrag,
  beginSlideDrag,
  booleanPolygons,
  buildParametricEllipseContours,
  buildParametricRectPoints,
  buildParametricStarPoints,
  collectDocumentColorUsages,
  CommandManager,
  computeBoundingBoxes,
  createDefaultTransform,
  createDemoDocument,
  createNumericInputState,
  DistributeNodesCommand,
  expandCornerRadius,
  findNodeById,
  findPathLookup,
  getPointHandles,
  hitTestDocument,
  offsetPolygon,
  PathfinderCommand,
  ReplaceColorCommand,
  RoundCornerCommand,
  SlidePointCommand,
  SplitPathCommand,
  stepNumericInputMachine,
  trimPolyline,
  type BezierPoint,
  type VectorNode,
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
      startAngle: 0,
    });
    expect(arc).toHaveLength(1);
    expect(arc[0]!.length).toBeGreaterThan(4);
    expect(arc[0]![0]!.x).toBeCloseTo(100, 1);
  });
});

describe('Pathfinder Booleans, Colors, Align/Distribute & Operators', () => {
  it('computes boolean unite, subtract, intersect, and exclude polygons', () => {
    const sqA = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const sqB = [
      { x: 50, y: 0 },
      { x: 150, y: 0 },
      { x: 150, y: 100 },
      { x: 50, y: 100 },
    ];

    expect(booleanPolygons(sqA, sqB, 'unite').length).toBeGreaterThanOrEqual(1);
    expect(booleanPolygons(sqA, sqB, 'subtract').length).toBeGreaterThanOrEqual(1);
    expect(booleanPolygons(sqA, sqB, 'intersect').length).toBeGreaterThanOrEqual(1);
    expect(booleanPolygons(sqA, sqB, 'exclude').length).toBeGreaterThanOrEqual(1);
  });

  it('supports Pathfinder Destructive vs Operator (non-destructive) modes', () => {
    const doc = createDemoDocument();
    const cm = new CommandManager();
    const cmdOp = new PathfinderCommand(
      () => doc,
      'layer_badge',
      'layer_shield',
      'unite',
      undefined,
      'operator',
    );
    cm.execute(cmdOp);
    const createdOp = doc.nodes.find((n) => n.name.includes('Merge (unite)'));
    expect(createdOp?.operators?.[0]?.type).toBe('merge_paths');
    expect(createdOp?.children).toHaveLength(2);
    cm.undo();
    expect(findNodeById(doc.nodes, 'layer_badge')).not.toBeNull();
  });

  it('collects document colors sorted by count and replaces colors globally', () => {
    const doc = createDemoDocument();
    const usages = collectDocumentColorUsages(doc.nodes);
    expect(usages.length).toBeGreaterThan(0);
    const first = usages[0]!;
    const cm = new CommandManager();
    cm.execute(new ReplaceColorCommand(() => doc, first.color, { toColor: '#123456' }));
    const after = collectDocumentColorUsages(doc.nodes);
    expect(after.some((u) => u.color === '#123456')).toBe(true);
  });

  it('aligns to Key Object and As Set, and distributes with fixed spacing', () => {
    const mkBox = (id: string, x: number): VectorNode => ({
      id,
      name: id,
      type: 'layer',
      visible: true,
      locked: false,
      hasKeyframes: false,
      transform: createDefaultTransform({ x, y: 100 }),
      paths: [
        {
          id: `${id}_p`,
          type: 'parametric_rect',
          closed: true,
          points: [],
          parametricData: { cx: 0, cy: 0, width: 40, height: 40 },
        },
      ],
    });
    const doc = {
      ...createDemoDocument(),
      nodes: [mkBox('b1', 100), mkBox('b2', 200), mkBox('b3', 350)],
    };
    const cm = new CommandManager();
    cm.execute(
      new AlignNodesCommand(() => doc, ['b1', 'b2', 'b3'], 'left', {
        alignTo: 'key_object',
        keyObjectId: 'b2',
      }),
    );
    expect(doc.nodes[0]!.transform.x).toBeCloseTo(200, 1);

    cm.execute(
      new DistributeNodesCommand(() => doc, ['b1', 'b2', 'b3'], 'space_h', 20),
    );
    const xs = doc.nodes.map((n) => n.transform.x).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeCloseTo(60, 1); // 40 width + 20 fixed gap
  });

  it('handles SlidePointCommand, SplitPathCommand (Scissors), RotoBezier, Squircle & Operators', () => {
    const doc = createDemoDocument();
    const cm = new CommandManager();
    cm.execute(new SlidePointCommand(() => doc, 'path_shield', ['pt_top'], { slideFactor: 0.25 }));
    expect(findPathLookup(doc.nodes, 'path_shield')!.path.points[0]!.x).not.toBe(0);

    cm.execute(new SplitPathCommand(() => doc, 'path_shield', { x: 0, y: -120 }));
    expect(findPathLookup(doc.nodes, 'path_shield')!.path.closed).toBe(false);

    const rectPts = buildParametricRectPoints({ width: 100, height: 80, roundness: 16 });
    expect(rectPts).toHaveLength(4);
    const squircle = expandCornerRadius(
      rectPts.map((p) => ({ ...p, cornerSmoothness: 80 })),
      true,
    );
    expect(squircle.length).toBeGreaterThan(4);

    const starPts = buildParametricStarPoints({ pointsCount: 5, outerRadius: 80, innerRadius: 40 });
    expect(starPts).toHaveLength(10);

    const roto = applyRotoBezier(starPts.slice(0, 4), true);
    expect(roto[0]!.inLength).toBeGreaterThan(0);

    const trimmed = trimPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      25,
      75,
    );
    expect(trimmed[0]!.x).toBeCloseTo(25, 1);
    expect(trimmed[trimmed.length - 1]!.x).toBeCloseTo(75, 1);

    const offsetted = offsetPolygon(
      [
        { x: -10, y: -10 },
        { x: 10, y: -10 },
        { x: 10, y: 10 },
        { x: -10, y: 10 },
      ],
      5,
    );
    expect(Math.abs(offsetted[0]!.x)).toBeCloseTo(15, 1);
  });
});
