import type {
  BezierPoint,
  HandleMode,
  NodeTransform,
  ParametricData,
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
  setPointHandleMode,
} from '../math/bezier.js';
import { computeBoundingBoxes } from '../math/transform.js';
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

export class RoundCornerCommand implements ICommand<{ cornerRadius: number }> {
  readonly id = 'path.roundCorner';
  readonly label = 'Round Corner';
  readonly schema: CommandParamSchema[] = [
    { key: 'cornerRadius', label: 'Corner Radius', type: 'number', min: 0, max: 300, step: 1 },
  ];

  private snapshots = new Map<string, Map<string, number | undefined>>();

  constructor(
    private getDoc: DocAccessor,
    private pathId: string,
    private pointIds: string[] | null,
    private params: { cornerRadius: number },
  ) {
    const path = findPathLookup(this.getDoc().nodes, pathId)?.path;
    if (path) {
      const map = new Map<string, number | undefined>();
      for (const pt of path.points) {
        if (!pointIds || pointIds.includes(pt.id)) {
          map.set(pt.id, pt.cornerRadius);
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
      }
    }
  }

  undo(): void {
    const path = findPathLookup(this.getDoc().nodes, this.pathId)?.path;
    const snap = this.snapshots.get(this.pathId);
    if (!path || !snap) return;
    for (const pt of path.points) {
      if (snap.has(pt.id)) {
        pt.cornerRadius = snap.get(pt.id);
      }
    }
  }

  getParams() {
    return { ...this.params };
  }

  updateParams(next: Partial<{ cornerRadius: number }>): void {
    if (typeof next.cornerRadius === 'number' && Number.isFinite(next.cornerRadius)) {
      this.params.cornerRadius = Math.max(0, next.cornerRadius);
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

export class AlignNodesCommand implements ICommand<{ alignment: AlignTarget }> {
  readonly id = 'transform.align';
  readonly label = 'Align Selection';
  private snapshots = new Map<string, { x: number; y: number }>();

  constructor(
    private getDoc: DocAccessor,
    private nodeIds: string[],
    private alignment: AlignTarget,
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

    const targetBounds =
      boxes.length === 1
        ? { minX: 0, minY: 0, maxX: doc.width, maxY: doc.height, cx: doc.width / 2, cy: doc.height / 2 }
        : {
            minX: Math.min(...boxes.map((b) => b.minX)),
            minY: Math.min(...boxes.map((b) => b.minY)),
            maxX: Math.max(...boxes.map((b) => b.maxX)),
            maxY: Math.max(...boxes.map((b) => b.maxY)),
            cx:
              (Math.min(...boxes.map((b) => b.minX)) +
                Math.max(...boxes.map((b) => b.maxX))) /
              2,
            cy:
              (Math.min(...boxes.map((b) => b.minY)) +
                Math.max(...boxes.map((b) => b.maxY))) /
              2,
          };

    for (const box of boxes) {
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
