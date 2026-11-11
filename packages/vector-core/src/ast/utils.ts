import type {
  NodeTransform,
  VectorDocument,
  VectorNode,
  VectorPath,
} from './types.js';

let uidCounter = 1;

export function createId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${(uidCounter++).toString(36)}`;
}

export function createDefaultTransform(
  overrides: Partial<NodeTransform> = {},
): NodeTransform {
  return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    anchorX: 0,
    anchorY: 0,
    ...overrides,
  };
}

export function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export interface NodeLookupResult {
  node: VectorNode;
  parent: VectorNode | null;
  rootLayer: VectorNode;
  ancestors: VectorNode[];
}

export function findNodeLookup(
  nodes: VectorNode[],
  targetId: string,
): NodeLookupResult | null {
  for (const root of nodes) {
    const found = walkLookup(root, null, root, [], targetId);
    if (found) return found;
  }
  return null;
}

function walkLookup(
  node: VectorNode,
  parent: VectorNode | null,
  rootLayer: VectorNode,
  ancestors: VectorNode[],
  targetId: string,
): NodeLookupResult | null {
  if (node.id === targetId) {
    return { node, parent, rootLayer, ancestors };
  }
  if (!node.children) return null;
  const nextAncestors = [...ancestors, node];
  for (const child of node.children) {
    const hit = walkLookup(child, node, rootLayer, nextAncestors, targetId);
    if (hit) return hit;
  }
  return null;
}

export function findNodeById(
  nodes: VectorNode[],
  targetId: string,
): VectorNode | null {
  return findNodeLookup(nodes, targetId)?.node ?? null;
}

export interface PathLookupResult {
  path: VectorPath;
  ownerNode: VectorNode;
  parentGroup: VectorNode | null;
  rootLayer: VectorNode;
  ancestors: VectorNode[];
}

export function findPathLookup(
  nodes: VectorNode[],
  pathId: string,
): PathLookupResult | null {
  for (const root of nodes) {
    const found = walkPathLookup(root, root, [], pathId);
    if (found) return found;
  }
  return null;
}

function walkPathLookup(
  node: VectorNode,
  rootLayer: VectorNode,
  ancestors: VectorNode[],
  pathId: string,
): PathLookupResult | null {
  if (node.paths) {
    for (const path of node.paths) {
      if (path.id === pathId) {
        const allAncestors = [...ancestors, node];
        let parentGroup: VectorNode | null = null;
        for (let i = allAncestors.length - 1; i >= 0; i--) {
          if (allAncestors[i]?.type === 'group') {
            parentGroup = allAncestors[i] ?? null;
            break;
          }
        }
        return {
          path,
          ownerNode: node,
          parentGroup,
          rootLayer,
          ancestors: allAncestors,
        };
      }
    }
  }
  if (!node.children) return null;
  const nextAncestors = [...ancestors, node];
  for (const child of node.children) {
    const hit = walkPathLookup(child, rootLayer, nextAncestors, pathId);
    if (hit) return hit;
  }
  return null;
}

export function isDescendantOrSelf(
  nodes: VectorNode[],
  ancestorId: string,
  candidateNodeId: string,
): boolean {
  if (ancestorId === candidateNodeId) return true;
  const ancestor = findNodeById(nodes, ancestorId);
  if (!ancestor) return false;
  return containsNode(ancestor, candidateNodeId);
}

function containsNode(root: VectorNode, targetId: string): boolean {
  if (root.id === targetId) return true;
  if (!root.children) return false;
  for (const child of root.children) {
    if (containsNode(child, targetId)) return true;
  }
  return false;
}

export function flattenNodes(nodes: VectorNode[]): VectorNode[] {
  const result: VectorNode[] = [];
  const visit = (list: VectorNode[]) => {
    for (const node of list) {
      result.push(node);
      if (node.children) visit(node.children);
    }
  };
  visit(nodes);
  return result;
}

export function removeNodeById(
  nodes: VectorNode[],
  targetId: string,
): VectorNode | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;
    if (node.id === targetId) {
      nodes.splice(i, 1);
      return node;
    }
    if (node.children) {
      const removed = removeNodeById(node.children, targetId);
      if (removed) return removed;
    }
  }
  return null;
}

export function createDemoDocument(): VectorDocument {
  return {
    id: 'doc_main',
    name: 'Comp 1 — Design Mode',
    width: 1280,
    height: 720,
    backgroundColor: '#16181d',
    globalColors: [
      { id: 'gc_accent', name: 'Brand Accent', color: '#4f8cff' },
      { id: 'gc_warm', name: 'Signal Amber', color: '#f59e0b' },
      { id: 'gc_ink', name: 'Crisp Stroke', color: '#e2e8f0' },
    ],
    nodes: [
      {
        id: 'layer_badge',
        name: 'Badge Group Layer',
        type: 'layer',
        visible: true,
        locked: false,
        hasKeyframes: false,
        transform: createDefaultTransform({ x: 360, y: 360 }),
        children: [
          {
            id: 'group_ring',
            name: 'Donut & Ribbon Group',
            type: 'group',
            visible: true,
            locked: false,
            hasKeyframes: true,
            transform: createDefaultTransform({ x: 0, y: 0, rotation: 0 }),
            style: {
              fill: { color: '#4f8cff', opacity: 0.9, globalColorId: 'gc_accent' },
              stroke: { color: '#e2e8f0', width: 3, globalColorId: 'gc_ink', taperStart: 0, taperEnd: 0 },
            },
            paths: [
              {
                id: 'path_donut',
                name: 'Arc Ring',
                type: 'parametric_ellipse',
                closed: true,
                points: [],
                parametricData: {
                  cx: 0,
                  cy: 0,
                  rx: 120,
                  ry: 120,
                  holeRatio: 0.45,
                  sweep: 300,
                },
              },
            ],
          },
          {
            id: 'group_needle',
            name: 'Vector Line Marker',
            type: 'group',
            visible: true,
            locked: false,
            hasKeyframes: false,
            transform: createDefaultTransform({ x: 0, y: 0 }),
            style: {
              stroke: { color: '#f59e0b', width: 6, globalColorId: 'gc_warm', taperStart: 0.2, taperEnd: 0.8 },
            },
            paths: [
              {
                id: 'path_line',
                name: 'Pointer Line',
                type: 'parametric_line',
                closed: false,
                points: [],
                parametricData: {
                  cx: 0,
                  cy: 0,
                  length: 180,
                  angle: -35,
                },
              },
            ],
          },
        ],
      },
      {
        id: 'layer_shield',
        name: 'Custom Bezier Shield',
        type: 'layer',
        visible: true,
        locked: false,
        hasKeyframes: false,
        transform: createDefaultTransform({ x: 840, y: 360, rotation: 12 }),
        style: {
          fill: { color: '#f59e0b', opacity: 0.85, globalColorId: 'gc_warm' },
          stroke: { color: '#e2e8f0', width: 4, globalColorId: 'gc_ink' },
        },
        paths: [
          {
            id: 'path_shield',
            name: 'Shield Contour',
            type: 'path',
            closed: true,
            points: [
              {
                id: 'pt_top',
                x: 0,
                y: -115,
                angle: 0,
                inLength: 55,
                outLength: 55,
                handleMode: 'symmetric',
                cornerRadius: 0,
              },
              {
                id: 'pt_right',
                x: 110,
                y: -30,
                angle: Math.PI / 2,
                inLength: 45,
                outLength: 65,
                handleMode: 'angle',
                cornerRadius: 0,
              },
              {
                id: 'pt_bottom',
                x: 0,
                y: 125,
                angle: Math.PI,
                inLength: 60,
                outLength: 60,
                handleMode: 'symmetric',
                cornerRadius: 0,
              },
              {
                id: 'pt_left',
                x: -110,
                y: -30,
                angle: -Math.PI / 2,
                inLength: 65,
                outLength: 45,
                handleMode: 'angle',
                cornerRadius: 0,
              },
            ],
          },
        ],
      },
    ],
  };
}
