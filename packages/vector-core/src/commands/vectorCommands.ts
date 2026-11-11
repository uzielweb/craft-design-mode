import type {
  AlignScope,
  AlignToMode,
  BezierPoint,
  HandleMode,
  MergePathsOperator,
  NodeTransform,
  ParametricData,
  PathfinderResultMode,
  ShapeOperator,
  VectorDocument,
  VectorNode,
  VectorStyle,
} from '../ast/types.js';
import {
  cloneValue,
  createDefaultTransform,
  createId,
  findNodeById,
  findNodeLookup,
  findPathLookup,
  flattenNodes,
  removeNodeById,
} from '../ast/utils.js';
import {
  applyHandleLengthDelta,
  getEffectiveContours,
  setPointHandleMode,
  slidePointByFactor,
  splitPathAtPosition,
  type Vec2,
} from '../math/bezier.js';
import {
  runPathfinderOnPaths,
  type PathfinderOp,
} from '../math/pathfinder.js';
import {
  applyMatrix,
  computeBoundingBoxes,
  getWorldMatrixForNode,
} from '../math/transform.js';
import type { CommandParamSchema, ICommand } from './ICommand.js';

export type DocAccessor = () => VectorDocument;

export class MoveNodesCommand implements ICommand<{ dx: number; dy: number }> {
  readonly id = 'transform.move';
  readonly label = 'Move Selection';
  readonly schema: CommandParamSchema[] = [
    { key: 'dx', label: 'Delta X', type: 'number', step: 1 },
    { key: 'dy', label: 'Delta Y', type: 'number', step: 1 },
  ];

  private snapshots = new Map<string, { x: number; y: number }>();

  constructor(
    private getDoc: DocAccessor,
    private nodeIds: string[],
    private params: { dx: number; dy: number },
  ) {
    const doc = this.getDoc();
    for (const id of nodeIds) {
      const node = findNodeById(doc.nodes, id);
      if (node) {
        this.snapshots.set(id, { x: node.transform.x, y: node.transform.y });
      }
    }
  }

  execute(): void {
    const doc = this.getDoc();
    for (const [id, orig] of this.snapshots) {
      const node = findNodeById(doc.nodes, id);
      if (node) {
        node.transform.x = orig.x + this.params.dx;
        node.transform.y = orig.y + this.params.dy;
      }
    }
  }

  undo(): void {
    const doc = this.getDoc();
    for (const [id, orig] of this.snapshots) {
      const node = findNodeById(doc.nodes, id);
      if (node) {
        node.transform.x = orig.x;
        node.transform.y = orig.y;
      }
    }
  }

  getParams() {
    return { ...this.params };
  }

  updateParams(next: Partial<{ dx: number; dy: number }>): void {
    if (typeof next.dx === 'number' && Number.isFinite(next.dx)) {
      this.params.dx = next.dx;
    }
    if (typeof next.dy === 'number' && Number.isFinite(next.dy)) {
      this.params.dy = next.dy;
    }
  }
}

export interface TransformDeltaParams extends Record<string, unknown> {
  dx: number;
  dy: number;
  dRotation: number;
  scaleFactor: number;
}

export class TransformNodesCommand implements ICommand<TransformDeltaParams> {
  readonly id = 'transform.delta';
  readonly label = 'Transform Selection';
  readonly schema: CommandParamSchema[] = [
    { key: 'dx', label: 'Offset X', type: 'number', step: 1 },
    { key: 'dy', label: 'Offset Y', type: 'number', step: 1 },
    { key: 'dRotation', label: 'Rotation (°)', type: 'number', step: 1 },
    { key: 'scaleFactor', label: 'Scale ×', type: 'number', min: 0.01, step: 0.05 },
  ];

  private snapshots = new Map<string, NodeTransform>();

  constructor(
    private getDoc: DocAccessor,
    private nodeIds: string[],
    private params: TransformDeltaParams,
  ) {
    const doc = this.getDoc();
    for (const id of nodeIds) {
      const node = findNodeById(doc.nodes, id);
      if (node) this.snapshots.set(id, { ...node.transform });
    }
  }

  execute(): void {
    const doc = this.getDoc();
    for (const [id, orig] of this.snapshots) {
      const node = findNodeById(doc.nodes, id);
      if (!node) continue;
      node.transform = {
        ...orig,
        x: orig.x + this.params.dx,
        y: orig.y + this.params.dy,
        rotation: orig.rotation + this.params.dRotation,
        scaleX: orig.scaleX * this.params.scaleFactor,
        scaleY: orig.scaleY * this.params.scaleFactor,
      };
    }
  }

  undo(): void {
    const doc = this.getDoc();
    for (const [id, orig] of this.snapshots) {
      const node = findNodeById(doc.nodes, id);
      if (node) node.transform = { ...orig };
    }
  }

  getParams(): TransformDeltaParams {
    return { ...this.params };
  }

  updateParams(next: Partial<TransformDeltaParams>): void {
    if (typeof next.dx === 'number' && Number.isFinite(next.dx)) this.params.dx = next.dx;
    if (typeof next.dy === 'number' && Number.isFinite(next.dy)) this.params.dy = next.dy;
    if (typeof next.dRotation === 'number' && Number.isFinite(next.dRotation)) {
      this.params.dRotation = next.dRotation;
    }
    if (typeof next.scaleFactor === 'number' && Number.isFinite(next.scaleFactor) && next.scaleFactor !== 0) {
      this.params.scaleFactor = next.scaleFactor;
    }
  }
}

export class SetTransformPropsCommand implements ICommand<Partial<NodeTransform>> {
  readonly id = 'transform.set';
  readonly label = 'Set Transform';
  private snapshots = new Map<string, NodeTransform>();

  constructor(
    private getDoc: DocAccessor,
    private nodeIds: string[],
    private params: Partial<NodeTransform>,
  ) {
    const doc = this.getDoc();
    for (const id of nodeIds) {
      const node = findNodeById(doc.nodes, id);
      if (node) this.snapshots.set(id, { ...node.transform });
    }
  }

  execute(): void {
    const doc = this.getDoc();
    for (const [id, orig] of this.snapshots) {
      const node = findNodeById(doc.nodes, id);
      if (node) {
        node.transform = { ...orig, ...this.params };
      }
    }
  }

  undo(): void {
    const doc = this.getDoc();
    for (const [id, orig] of this.snapshots) {
      const node = findNodeById(doc.nodes, id);
      if (node) node.transform = { ...orig };
    }
  }

  getParams() {
    return { ...this.params };
  }

  updateParams(next: Partial<NodeTransform>): void {
    this.params = { ...this.params, ...next };
  }
}

export class RoundCornerCommand implements ICommand<{ cornerRadius: number; cornerSmoothness?: number }> {
  readonly id = 'path.roundCorner';
  readonly label = 'Round Corners';
  readonly schema: CommandParamSchema[] = [
    { key: 'cornerRadius', label: 'Radius', type: 'number', min: 0, max: 300, step: 0.5 },
    { key: 'cornerSmoothness', label: 'Smoothness (%)', type: 'number', min: 0, max: 100, step: 1 },
  ];

  private snapshots = new Map<string, Map<string, { r?: number; s?: number }>>();

  constructor(
    private getDoc: DocAccessor,
    private pathId: string,
    private pointIds: string[] | null,
    private params: { cornerRadius: number; cornerSmoothness?: number },
  ) {
    const path = findPathLookup(this.getDoc().nodes, pathId)?.path;
    if (path) {
      const map = new Map<string, { r?: number; s?: number }>();
      for (const pt of path.points) {
        if (!pointIds || pointIds.includes(pt.id)) {
          map.set(pt.id, { r: pt.cornerRadius, s: pt.cornerSmoothness });
        }
      }
      this.snapshots.set(pathId, map);
    }
  }

  execute(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    const snap = this.snapshots.get(this.pathId);
    if (!path || !snap) return;
    for (const pt of path.points) {
      if (snap.has(pt.id)) {
        pt.cornerRadius = Math.max(0, this.params.cornerRadius);
        if (this.params.cornerSmoothness !== undefined) {
          pt.cornerSmoothness = Math.max(0, Math.min(100, this.params.cornerSmoothness));
        }
      }
    }
  }

  undo(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    const snap = this.snapshots.get(this.pathId);
    if (!path || !snap) return;
    for (const pt of path.points) {
      const prev = snap.get(pt.id);
      if (prev) {
        pt.cornerRadius = prev.r;
        pt.cornerSmoothness = prev.s;
      }
    }
  }

  getParams() {
    return { ...this.params };
  }

  updateParams(next: Partial<{ cornerRadius: number; cornerSmoothness?: number }>): void {
    if (typeof next.cornerRadius === 'number' && Number.isFinite(next.cornerRadius)) {
      this.params.cornerRadius = Math.max(0, next.cornerRadius);
    }
    if (typeof next.cornerSmoothness === 'number' && Number.isFinite(next.cornerSmoothness)) {
      this.params.cornerSmoothness = Math.max(0, Math.min(100, next.cornerSmoothness));
    }
  }
}

export class UpdatePathPointsCommand implements ICommand<{ count: number }> {
  readonly id = 'path.updatePoints';
  readonly label: string = 'Edit Bezier Points';

  private beforePoints: BezierPoint[] = [];

  constructor(
    private getDoc: DocAccessor,
    private pathId: string,
    private afterPoints: BezierPoint[],
    label?: string,
  ) {
    if (label) this.label = label;
    const path = findPathLookup(this.getDoc().nodes, pathId)?.path;
    if (path) {
      this.beforePoints = cloneValue(path.points);
    }
    this.afterPoints = cloneValue(afterPoints);
  }

  execute(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    if (path) {
      path.points = cloneValue(this.afterPoints);
    }
  }

  undo(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    if (path) {
      path.points = cloneValue(this.beforePoints);
    }
  }

  getParams() {
    return { count: this.afterPoints.length };
  }
}

export class OffsetHandlesCommand implements ICommand<{ field: 'inLength' | 'outLength'; delta: number }> {
  readonly id = 'path.offsetHandles';
  readonly label = 'Offset Handle Lengths';
  readonly schema: CommandParamSchema[] = [
    { key: 'delta', label: 'Handle Delta', type: 'number', min: -200, max: 200, step: 1 },
  ];

  private beforePoints: BezierPoint[] = [];

  constructor(
    private getDoc: DocAccessor,
    private pathId: string,
    private pointIds: string[],
    private params: { field: 'inLength' | 'outLength'; delta: number },
  ) {
    const path = findPathLookup(this.getDoc().nodes, pathId)?.path;
    if (path) {
      this.beforePoints = cloneValue(path.points);
    }
  }

  execute(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    if (!path) return;
    const selectedSet = new Set(this.pointIds);
    const updatedSubset = applyHandleLengthDelta(
      this.beforePoints.filter((p) => selectedSet.has(p.id)),
      this.params.field,
      this.params.delta,
    );
    const byId = new Map(updatedSubset.map((p) => [p.id, p]));
    path.points = this.beforePoints.map((p) => byId.get(p.id) ?? cloneValue(p));
  }

  undo(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    if (path) path.points = cloneValue(this.beforePoints);
  }

  getParams() {
    return { ...this.params };
  }

  updateParams(next: Partial<{ field: 'inLength' | 'outLength'; delta: number }>): void {
    if (typeof next.delta === 'number' && Number.isFinite(next.delta)) {
      this.params.delta = next.delta;
    }
    if (next.field === 'inLength' || next.field === 'outLength') {
      this.params.field = next.field;
    }
  }
}

export class SetHandleModeCommand implements ICommand<{ handleMode: HandleMode }> {
  readonly id = 'path.handleMode';
  readonly label = 'Set Handle Mode';
  private beforePoints: BezierPoint[] = [];

  constructor(
    private getDoc: DocAccessor,
    private pathId: string,
    private pointIds: string[],
    private params: { handleMode: HandleMode },
  ) {
    const path = findPathLookup(this.getDoc().nodes, pathId)?.path;
    if (path) this.beforePoints = cloneValue(path.points);
  }

  execute(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    if (!path) return;
    const selected = new Set(this.pointIds);
    path.points = this.beforePoints.map((p) =>
      selected.has(p.id) ? setPointHandleMode(p, this.params.handleMode) : cloneValue(p),
    );
  }

  undo(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    if (path) path.points = cloneValue(this.beforePoints);
  }

  getParams() {
    return { ...this.params };
  }
}

export class UpdateParametricCommand implements ICommand<ParametricData> {
  readonly id = 'path.parametric';
  readonly label = 'Edit Parametric Shape';
  readonly schema: CommandParamSchema[];

  private beforeData: ParametricData = {};

  constructor(
    private getDoc: DocAccessor,
    private pathId: string,
    private params: ParametricData,
  ) {
    const path = findPathLookup(this.getDoc().nodes, pathId)?.path;
    this.beforeData = cloneValue(path?.parametricData ?? {});
    if (path?.type === 'parametric_ellipse') {
      this.schema = [
        { key: 'rx', label: 'Radius X', type: 'number', min: 1, max: 2000, step: 1 },
        { key: 'ry', label: 'Radius Y', type: 'number', min: 1, max: 2000, step: 1 },
        { key: 'holeRatio', label: 'Hole Ratio', type: 'number', min: 0, max: 0.98, step: 0.02 },
        { key: 'sweep', label: 'Sweep (°)', type: 'number', min: 1, max: 360, step: 1 },
      ];
    } else {
      this.schema = [
        { key: 'length', label: 'Length', type: 'number', min: 1, max: 5000, step: 1 },
        { key: 'angle', label: 'Angle (°)', type: 'number', min: -360, max: 360, step: 1 },
      ];
    }
  }

  execute(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    if (!path) return;
    path.parametricData = { ...this.beforeData, ...this.params };
  }

  undo(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    if (!path) return;
    path.parametricData = cloneValue(this.beforeData);
  }

  getParams() {
    return { ...this.params };
  }

  updateParams(next: Partial<ParametricData>): void {
    this.params = { ...this.params, ...next };
  }
}

export class UpdateStyleCommand implements ICommand<{ fillColor?: string; strokeColor?: string; strokeWidth?: number }> {
  readonly id = 'style.update';
  readonly label = 'Update Style';
  private beforeStyles = new Map<string, VectorStyle | undefined>();

  constructor(
    private getDoc: DocAccessor,
    private nodeIds: string[],
    private nextStylePatch: (prev: VectorStyle | undefined) => VectorStyle,
    private summaryParams: { fillColor?: string; strokeColor?: string; strokeWidth?: number } = {},
  ) {
    const doc = this.getDoc();
    for (const id of nodeIds) {
      const node = findNodeById(doc.nodes, id);
      if (node) this.beforeStyles.set(id, cloneValue(node.style));
    }
  }

  execute(): void {
    const doc = this.getDoc();
    for (const [id, prev] of this.beforeStyles) {
      const node = findNodeById(doc.nodes, id);
      if (node) node.style = this.nextStylePatch(cloneValue(prev));
    }
  }

  undo(): void {
    const doc = this.getDoc();
    for (const [id, prev] of this.beforeStyles) {
      const node = findNodeById(doc.nodes, id);
      if (node) node.style = cloneValue(prev);
    }
  }

  getParams() {
    return { ...this.summaryParams };
  }
}

export class UpdateGlobalColorCommand implements ICommand<{ color: string }> {
  readonly id = 'color.updateGlobal';
  readonly label = 'Update Global Color';
  readonly schema: CommandParamSchema[] = [
    { key: 'color', label: 'Swatch Color', type: 'color' },
  ];

  private prevColor = '#ffffff';

  constructor(
    private getDoc: DocAccessor,
    private swatchId: string,
    private params: { color: string },
  ) {
    const swatch = this.getDoc().globalColors.find((g) => g.id === swatchId);
    if (swatch) this.prevColor = swatch.color;
  }

  private applyColor(color: string): void {
    const doc = this.getDoc();
    const swatch = doc.globalColors.find((g) => g.id === this.swatchId);
    if (swatch) swatch.color = color;
    for (const node of flattenNodes(doc.nodes)) {
      if (node.style?.fill?.globalColorId === this.swatchId) {
        node.style.fill.color = color;
      }
      if (node.style?.stroke?.globalColorId === this.swatchId) {
        node.style.stroke.color = color;
      }
    }
  }

  execute(): void {
    this.applyColor(this.params.color);
  }

  undo(): void {
    this.applyColor(this.prevColor);
  }

  getParams() {
    return { ...this.params };
  }

  updateParams(next: Partial<{ color: string }>): void {
    if (typeof next.color === 'string') this.params.color = next.color;
  }
}

export class GroupNodesCommand implements ICommand<{ groupId: string }> {
  readonly id = 'layer.group';
  readonly label = 'Group Selection (Ctrl+G)';
  private beforeNodes: VectorNode[] = [];
  private groupId = createId('group');

  constructor(
    private getDoc: DocAccessor,
    private nodeIds: string[],
    private onCreatedGroup?: (groupId: string) => void,
  ) {
    this.beforeNodes = cloneValue(this.getDoc().nodes);
  }

  execute(): void {
    const doc = this.getDoc();
    doc.nodes = cloneValue(this.beforeNodes);
    if (this.nodeIds.length === 0) return;

    const extracted: VectorNode[] = [];
    for (const id of this.nodeIds) {
      const removed = removeNodeById(doc.nodes, id);
      if (removed) extracted.push(removed);
    }
    if (extracted.length === 0) return;

    const groupNode: VectorNode = {
      id: this.groupId,
      name: `Group (${extracted.length})`,
      type: 'group',
      visible: true,
      locked: false,
      hasKeyframes: false,
      transform: createDefaultTransform(),
      children: extracted,
    };

    doc.nodes.unshift(groupNode);
    this.onCreatedGroup?.(this.groupId);
  }

  undo(): void {
    this.getDoc().nodes = cloneValue(this.beforeNodes);
  }

  getParams() {
    return { groupId: this.groupId };
  }
}

export class SplitNodePathsCommand implements ICommand<{ nodeId: string }> {
  readonly id = 'layer.split';
  readonly label = 'Split Paths into Layers';
  private beforeNodes: VectorNode[] = [];

  constructor(
    private getDoc: DocAccessor,
    private nodeId: string,
  ) {
    this.beforeNodes = cloneValue(this.getDoc().nodes);
  }

  execute(): void {
    const doc = this.getDoc();
    doc.nodes = cloneValue(this.beforeNodes);
    const lookup = findNodeLookup(doc.nodes, this.nodeId);
    if (!lookup) return;

    const node = lookup.node;
    if (node.paths && node.paths.length > 1) {
      const splitChildren: VectorNode[] = node.paths.map((p, idx) => ({
        id: createId('split'),
        name: p.name ?? `${node.name} #${idx + 1}`,
        type: 'group',
        visible: node.visible,
        locked: node.locked,
        hasKeyframes: node.hasKeyframes,
        transform: createDefaultTransform(),
        style: cloneValue(node.style),
        paths: [cloneValue(p)],
      }));
      node.paths = undefined;
      node.children = [...(node.children ?? []), ...splitChildren];
      return;
    }

    // If it's a group with children, dissolve group into parent list
    if (node.type === 'group' && node.children && node.children.length > 0) {
      const parentList = lookup.parent?.children ?? doc.nodes;
      const idx = parentList.findIndex((n) => n.id === node.id);
      if (idx >= 0) {
        const promoted = node.children.map((c) => {
          const copy = cloneValue(c);
          copy.transform.x += node.transform.x;
          copy.transform.y += node.transform.y;
          return copy;
        });
        parentList.splice(idx, 1, ...promoted);
      }
    }
  }

  undo(): void {
    this.getDoc().nodes = cloneValue(this.beforeNodes);
  }

  getParams() {
    return { nodeId: this.nodeId };
  }
}

export type AlignTarget = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export interface AlignOptions {
  alignTo?: AlignToMode;
  scope?: AlignScope;
  keyObjectId?: string | null;
}

export class AlignNodesCommand implements ICommand<{ alignment: AlignTarget }> {
  readonly id = 'transform.align';
  readonly label = 'Align Selection';
  private snapshots = new Map<string, { x: number; y: number }>();

  constructor(
    private getDoc: DocAccessor,
    private nodeIds: string[],
    private alignment: AlignTarget,
    private options: AlignOptions = {},
  ) {
    const doc = this.getDoc();
    for (const id of nodeIds) {
      const n = findNodeById(doc.nodes, id);
      if (n) this.snapshots.set(id, { x: n.transform.x, y: n.transform.y });
    }
  }

  execute(): void {
    const doc = this.getDoc();
    const boxes = computeBoundingBoxes(doc.nodes, this.nodeIds, 'individual_comp');
    if (boxes.length === 0) return;

    const alignTo: AlignToMode =
      this.options.alignTo ?? (boxes.length === 1 ? 'composition' : 'selection');
    const scope: AlignScope = this.options.scope ?? 'individual';

    let targetBounds: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      cx: number;
      cy: number;
    };

    const keyBox =
      alignTo === 'key_object' && this.options.keyObjectId
        ? boxes.find((b) => b.id === this.options.keyObjectId)
        : undefined;

    if (keyBox) {
      targetBounds = {
        minX: keyBox.minX,
        minY: keyBox.minY,
        maxX: keyBox.maxX,
        maxY: keyBox.maxY,
        cx: keyBox.center.x,
        cy: keyBox.center.y,
      };
    } else if (alignTo === 'composition' || boxes.length === 1) {
      targetBounds = {
        minX: 0,
        minY: 0,
        maxX: doc.width,
        maxY: doc.height,
        cx: doc.width / 2,
        cy: doc.height / 2,
      };
    } else {
      const minX = Math.min(...boxes.map((b) => b.minX));
      const minY = Math.min(...boxes.map((b) => b.minY));
      const maxX = Math.max(...boxes.map((b) => b.maxX));
      const maxY = Math.max(...boxes.map((b) => b.maxY));
      targetBounds = {
        minX,
        minY,
        maxX,
        maxY,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
      };
    }

    if (scope === 'set') {
      const unionMinX = Math.min(...boxes.map((b) => b.minX));
      const unionMinY = Math.min(...boxes.map((b) => b.minY));
      const unionMaxX = Math.max(...boxes.map((b) => b.maxX));
      const unionMaxY = Math.max(...boxes.map((b) => b.maxY));
      const unionCx = (unionMinX + unionMaxX) / 2;
      const unionCy = (unionMinY + unionMaxY) / 2;

      let dx = 0;
      let dy = 0;
      if (this.alignment === 'left') dx = targetBounds.minX - unionMinX;
      else if (this.alignment === 'hcenter') dx = targetBounds.cx - unionCx;
      else if (this.alignment === 'right') dx = targetBounds.maxX - unionMaxX;
      else if (this.alignment === 'top') dy = targetBounds.minY - unionMinY;
      else if (this.alignment === 'vcenter') dy = targetBounds.cy - unionCy;
      else if (this.alignment === 'bottom') dy = targetBounds.maxY - unionMaxY;

      for (const id of this.nodeIds) {
        const node = findNodeById(doc.nodes, id);
        if (node) {
          node.transform.x += dx;
          node.transform.y += dy;
        }
      }
      return;
    }

    for (const box of boxes) {
      if (keyBox && box.id === keyBox.id) continue;
      const node = findNodeById(doc.nodes, box.id);
      if (!node) continue;
      let dx = 0;
      let dy = 0;
      switch (this.alignment) {
        case 'left':
          dx = targetBounds.minX - box.minX;
          break;
        case 'hcenter':
          dx = targetBounds.cx - box.center.x;
          break;
        case 'right':
          dx = targetBounds.maxX - box.maxX;
          break;
        case 'top':
          dy = targetBounds.minY - box.minY;
          break;
        case 'vcenter':
          dy = targetBounds.cy - box.center.y;
          break;
        case 'bottom':
          dy = targetBounds.maxY - box.maxY;
          break;
      }
      node.transform.x += dx;
      node.transform.y += dy;
    }
  }

  undo(): void {
    const doc = this.getDoc();
    for (const [id, orig] of this.snapshots) {
      const n = findNodeById(doc.nodes, id);
      if (n) {
        n.transform.x = orig.x;
        n.transform.y = orig.y;
      }
    }
  }

  getParams() {
    return { alignment: this.alignment };
  }
}

export type DistributeMode =
  | 'horizontal'
  | 'vertical'
  | 'space_h'
  | 'space_v'
  | 'top'
  | 'vcenter'
  | 'bottom'
  | 'left'
  | 'hcenter'
  | 'right';

export class DistributeNodesCommand implements ICommand<{ mode: DistributeMode; fixedGap?: number }> {
  readonly id = 'transform.distribute';
  readonly label = 'Distribute Selection';
  private snapshots = new Map<string, { x: number; y: number }>();

  constructor(
    private getDoc: DocAccessor,
    private nodeIds: string[],
    private mode: DistributeMode,
    private fixedGap?: number,
  ) {
    const doc = this.getDoc();
    for (const id of nodeIds) {
      const n = findNodeById(doc.nodes, id);
      if (n) this.snapshots.set(id, { x: n.transform.x, y: n.transform.y });
    }
  }

  execute(): void {
    const doc = this.getDoc();
    const boxes = computeBoundingBoxes(doc.nodes, this.nodeIds, 'individual_comp');
    if (boxes.length < 3 && this.fixedGap === undefined) return;
    if (boxes.length < 2) return;

    const isHoriz =
      this.mode === 'horizontal' ||
      this.mode === 'space_h' ||
      this.mode === 'left' ||
      this.mode === 'hcenter' ||
      this.mode === 'right';

    const getRef = (b: (typeof boxes)[number]): number => {
      switch (this.mode) {
        case 'left':
          return b.minX;
        case 'right':
          return b.maxX;
        case 'top':
          return b.minY;
        case 'bottom':
          return b.maxY;
        case 'vcenter':
        case 'vertical':
          return b.center.y;
        default:
          return b.center.x;
      }
    };

    const sorted = [...boxes].sort((a, b) =>
      isHoriz ? a.center.x - b.center.x : a.center.y - b.center.y,
    );

    if (
      this.mode !== 'space_h' &&
      this.mode !== 'space_v' &&
      this.fixedGap === undefined
    ) {
      const firstVal = getRef(sorted[0]!);
      const lastVal = getRef(sorted[sorted.length - 1]!);
      const step = (lastVal - firstVal) / (sorted.length - 1);
      for (let i = 1; i < sorted.length - 1; i++) {
        const b = sorted[i]!;
        const node = findNodeById(doc.nodes, b.id);
        if (!node) continue;
        const delta = firstVal + step * i - getRef(b);
        if (isHoriz) node.transform.x += delta;
        else node.transform.y += delta;
      }
      return;
    }

    // Equal spacing (either 'Even' gap between edges, or explicit fixedGap in px)
    const minEdge = isHoriz ? sorted[0]!.minX : sorted[0]!.minY;
    const maxEdge = isHoriz
      ? sorted[sorted.length - 1]!.maxX
      : sorted[sorted.length - 1]!.maxY;
    const totalSizes = sorted.reduce(
      (sum, b) => sum + (isHoriz ? b.width : b.height),
      0,
    );
    const gap =
      this.fixedGap !== undefined
        ? this.fixedGap
        : (maxEdge - minEdge - totalSizes) / (sorted.length - 1);

    let cursor = minEdge;
    for (const b of sorted) {
      const node = findNodeById(doc.nodes, b.id);
      if (node) {
        if (isHoriz) {
          node.transform.x += cursor - b.minX;
        } else {
          node.transform.y += cursor - b.minY;
        }
      }
      cursor += (isHoriz ? b.width : b.height) + gap;
    }
  }

  undo(): void {
    const doc = this.getDoc();
    for (const [id, orig] of this.snapshots) {
      const n = findNodeById(doc.nodes, id);
      if (n) {
        n.transform.x = orig.x;
        n.transform.y = orig.y;
      }
    }
  }

  getParams() {
    return { mode: this.mode, fixedGap: this.fixedGap };
  }
}

export class SlidePointCommand implements ICommand<{ slideFactor: number }> {
  readonly id = 'path.slide';
  readonly label = 'Slide Point';
  readonly schema: CommandParamSchema[] = [
    { key: 'slideFactor', label: 'Slide (-1..1)', type: 'number', min: -0.95, max: 0.95, step: 0.05 },
  ];

  private beforePoints: BezierPoint[] = [];

  constructor(
    private getDoc: DocAccessor,
    private pathId: string,
    private pointIds: string[],
    private params: { slideFactor: number },
  ) {
    const path = findPathLookup(this.getDoc().nodes, pathId)?.path;
    if (path) this.beforePoints = cloneValue(path.points);
  }

  execute(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    if (!path) return;
    const targetSet = new Set(this.pointIds);
    path.points = this.beforePoints.map((pt) =>
      targetSet.has(pt.id) ? slidePointByFactor(pt, this.params.slideFactor) : cloneValue(pt),
    );
  }

  undo(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    if (path) path.points = cloneValue(this.beforePoints);
  }

  getParams() {
    return { ...this.params };
  }

  updateParams(next: Partial<{ slideFactor: number }>): void {
    if (typeof next.slideFactor === 'number' && Number.isFinite(next.slideFactor)) {
      this.params.slideFactor = Math.max(-0.95, Math.min(0.95, next.slideFactor));
    }
  }
}

export class ReplaceColorCommand implements ICommand<{ toColor: string }> {
  readonly id = 'color.replaceAll';
  readonly label = 'Replace Color';
  readonly schema: CommandParamSchema[] = [
    { key: 'toColor', label: 'New Color', type: 'color' },
  ];

  private beforeNodes: VectorNode[];

  constructor(
    private getDoc: DocAccessor,
    private fromColor: string,
    private params: { toColor: string },
  ) {
    this.beforeNodes = cloneValue(this.getDoc().nodes);
  }

  execute(): void {
    const doc = this.getDoc();
    doc.nodes = cloneValue(this.beforeNodes);
    const match = this.fromColor.toUpperCase();
    for (const node of flattenNodes(doc.nodes)) {
      if (node.style?.fill) {
        if (node.style.fill.color.toUpperCase() === match) {
          node.style.fill.color = this.params.toColor;
        }
        if (node.style.fill.gradient) {
          for (const stop of node.style.fill.gradient.stops) {
            if (stop.color.toUpperCase() === match) {
              stop.color = this.params.toColor;
            }
          }
        }
      }
      if (node.style?.stroke?.color.toUpperCase() === match) {
        node.style.stroke.color = this.params.toColor;
      }
    }
  }

  undo(): void {
    this.getDoc().nodes = cloneValue(this.beforeNodes);
  }

  getParams() {
    return { ...this.params };
  }

  updateParams(next: Partial<{ toColor: string }>): void {
    if (typeof next.toColor === 'string') this.params.toColor = next.toColor;
  }
}

export class PathfinderCommand implements ICommand<{ op: PathfinderOp; mode: PathfinderResultMode }> {
  readonly id = 'path.pathfinder';
  readonly label = 'Pathfinder Boolean';
  private beforeNodes: VectorNode[];

  constructor(
    private getDoc: DocAccessor,
    private nodeIdA: string,
    private nodeIdB: string,
    private op: PathfinderOp,
    private onCreated?: (newNodeId: string) => void,
    private mode: PathfinderResultMode = 'destructive',
  ) {
    this.beforeNodes = cloneValue(this.getDoc().nodes);
  }

  execute(): void {
    const doc = this.getDoc();
    doc.nodes = cloneValue(this.beforeNodes);

    const nodeA = findNodeById(doc.nodes, this.nodeIdA);
    const nodeB = findNodeById(doc.nodes, this.nodeIdB);
    if (!nodeA || !nodeB) return;

    if (this.mode === 'operator') {
      const removedA = removeNodeById(doc.nodes, nodeA.id);
      const removedB = removeNodeById(doc.nodes, nodeB.id);
      if (!removedA || !removedB) return;
      const mergeOp: MergePathsOperator = {
        id: createId('merge'),
        type: 'merge_paths',
        enabled: true,
        op: this.op,
      };
      const container: VectorNode = {
        id: createId('pf_op'),
        name: `Merge (${this.op})`,
        type: 'group',
        visible: true,
        locked: false,
        hasKeyframes: false,
        transform: createDefaultTransform(),
        style: cloneValue(removedA.style ?? removedB.style),
        operators: [mergeOp],
        children: [removedA, removedB],
      };
      doc.nodes.push(container);
      this.onCreated?.(container.id);
      return;
    }

    const pathA = nodeA.paths?.[0];
    const pathB = nodeB.paths?.[0];
    if (!pathA || !pathB) return;

    const matA = getWorldMatrixForNode(doc.nodes, nodeA.id);
    const matB = getWorldMatrixForNode(doc.nodes, nodeB.id);

    const resultPaths = runPathfinderOnPaths(
      pathA,
      pathB,
      this.op,
      (p) => applyMatrix(matA, p.x, p.y),
      (p) => applyMatrix(matB, p.x, p.y),
    );
    if (resultPaths.length === 0) return;

    // Re-center points around bounding center
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const rp of resultPaths) {
      for (const pt of rp.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    for (const rp of resultPaths) {
      for (const pt of rp.points) {
        pt.x -= cx;
        pt.y -= cy;
      }
    }

    const newNode: VectorNode = {
      id: createId('pf_layer'),
      name: `${this.op.toUpperCase()} Shape`,
      type: 'layer',
      visible: true,
      locked: false,
      hasKeyframes: false,
      transform: createDefaultTransform({ x: cx, y: cy }),
      style: cloneValue(nodeA.style ?? nodeB.style),
      paths: resultPaths,
    };

    removeNodeById(doc.nodes, nodeA.id);
    removeNodeById(doc.nodes, nodeB.id);
    doc.nodes.push(newNode);
    this.onCreated?.(newNode.id);
  }

  undo(): void {
    this.getDoc().nodes = cloneValue(this.beforeNodes);
  }

  getParams() {
    return { op: this.op, mode: this.mode };
  }
}

export class SplitPathCommand implements ICommand<{ pathId: string }> {
  readonly id = 'path.scissorsSplit';
  readonly label = 'Split Path (Scissors)';
  private beforeNodes: VectorNode[];

  constructor(
    private getDoc: DocAccessor,
    private pathId: string,
    private localClick: Vec2,
  ) {
    this.beforeNodes = cloneValue(this.getDoc().nodes);
  }

  execute(): void {
    const doc = this.getDoc();
    doc.nodes = cloneValue(this.beforeNodes);
    const lookup = findPathLookup(doc.nodes, this.pathId);
    if (!lookup) return;
    const effective =
      lookup.path.type === 'path'
        ? { points: lookup.path.points, closed: lookup.path.closed }
        : {
            points: getEffectiveContours(lookup.path).contours[0] ?? [],
            closed: getEffectiveContours(lookup.path).closed,
          };
    const res = splitPathAtPosition(
      effective.points,
      effective.closed,
      this.localClick,
    );
    lookup.path.type = 'path';
    lookup.path.closed = res.closed;
    lookup.path.points = res.first;
    if (res.second && res.second.length >= 2) {
      lookup.ownerNode.paths = lookup.ownerNode.paths ?? [];
      lookup.ownerNode.paths.push({
        id: createId('cut_path'),
        name: `${lookup.path.name ?? 'Path'} Cut`,
        type: 'path',
        closed: false,
        points: res.second,
      });
    }
  }

  undo(): void {
    this.getDoc().nodes = cloneValue(this.beforeNodes);
  }

  getParams() {
    return { pathId: this.pathId };
  }
}

export class SetPathRotoBezierCommand implements ICommand<{ rotoBezier: boolean }> {
  readonly id = 'path.rotoBezier';
  readonly label = 'Toggle RotoBezier';
  private beforeState = false;

  constructor(
    private getDoc: DocAccessor,
    private pathId: string,
    private rotoBezier: boolean,
  ) {
    const path = findPathLookup(this.getDoc().nodes, pathId)?.path;
    this.beforeState = Boolean(path?.rotoBezier);
  }

  execute(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    if (path) path.rotoBezier = this.rotoBezier;
  }

  undo(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    if (path) path.rotoBezier = this.beforeState;
  }

  getParams() {
    return { rotoBezier: this.rotoBezier };
  }
}

export class SplitGroupsToLayersCommand implements ICommand<{ nodeId: string }> {
  readonly id = 'layer.splitGroupsToLayers';
  readonly label = 'Split Groups into Layers';
  private beforeNodes: VectorNode[];

  constructor(
    private getDoc: DocAccessor,
    private nodeId: string,
  ) {
    this.beforeNodes = cloneValue(this.getDoc().nodes);
  }

  execute(): void {
    const doc = this.getDoc();
    doc.nodes = cloneValue(this.beforeNodes);
    const lookup = findNodeLookup(doc.nodes, this.nodeId);
    if (!lookup || !lookup.node.children || lookup.node.children.length === 0) {
      return;
    }
    const parent = lookup.node;
    const promoted: VectorNode[] = parent.children!.map((child) => {
      const c = cloneValue(child);
      c.type = 'layer';
      c.transform.x += parent.transform.x;
      c.transform.y += parent.transform.y;
      return c;
    });
    const idx = doc.nodes.findIndex((n) => n.id === parent.id);
    if (idx >= 0) {
      doc.nodes.splice(idx, 1, ...promoted);
    } else {
      removeNodeById(doc.nodes, parent.id);
      doc.nodes.push(...promoted);
    }
  }

  undo(): void {
    this.getDoc().nodes = cloneValue(this.beforeNodes);
  }

  getParams() {
    return { nodeId: this.nodeId };
  }
}

export class SetShapeOperatorCommand implements ICommand<{ nodeId: string }> {
  readonly id = 'shape.setOperator';
  readonly label = 'Update Shape Operator';
  private beforeOps: ShapeOperator[] | undefined;

  constructor(
    private getDoc: DocAccessor,
    private nodeId: string,
    private nextOps: ShapeOperator[],
  ) {
    const n = findNodeById(this.getDoc().nodes, nodeId);
    this.beforeOps = cloneValue(n?.operators);
  }

  execute(): void {
    const n = findNodeById(this.getDoc().nodes, this.nodeId);
    if (n) n.operators = cloneValue(this.nextOps);
  }

  undo(): void {
    const n = findNodeById(this.getDoc().nodes, this.nodeId);
    if (n) n.operators = cloneValue(this.beforeOps);
  }

  getParams() {
    return { nodeId: this.nodeId };
  }
}

export class AddNodeCommand implements ICommand<{ nodeId: string }> {
  readonly id = 'layer.add';
  readonly label = 'Create Vector Layer';
  private inserted = false;

  constructor(
    private getDoc: DocAccessor,
    private node: VectorNode,
  ) {}

  execute(): void {
    const doc = this.getDoc();
    if (!this.inserted) {
      doc.nodes.push(cloneValue(this.node));
      this.inserted = true;
    }
  }

  undo(): void {
    const doc = this.getDoc();
    removeNodeById(doc.nodes, this.node.id);
    this.inserted = false;
  }

  getParams() {
    return { nodeId: this.node.id };
  }
}

export class MutateDocumentCommand implements ICommand<Record<string, unknown>> {
  readonly id = 'doc.mutate';
  private beforeNodes: VectorNode[];
  private afterNodes: VectorNode[] | null = null;

  constructor(
    private getDoc: DocAccessor,
    public readonly label: string,
    private mutator: (doc: VectorDocument) => void,
  ) {
    this.beforeNodes = cloneValue(this.getDoc().nodes);
  }

  execute(): void {
    const doc = this.getDoc();
    if (this.afterNodes) {
      doc.nodes = cloneValue(this.afterNodes);
      return;
    }
    this.mutator(doc);
    this.afterNodes = cloneValue(doc.nodes);
  }

  undo(): void {
    this.getDoc().nodes = cloneValue(this.beforeNodes);
  }

  getParams() {
    return {};
  }
}
