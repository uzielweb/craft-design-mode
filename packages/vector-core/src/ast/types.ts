export type SelectionMode = 'layer' | 'group' | 'path';
export type BBoxMode = 'combined' | 'individual_comp' | 'individual_object';
export type HandleMode = 'symmetric' | 'angle' | 'broken';
export type AxisLock = 'x' | 'y' | null;
export type ToolType = 'select' | 'pen' | 'ellipse' | 'line' | 'zoom' | 'pan';

export interface GradientStop {
  offset: number;
  color: string;
  opacity?: number;
}

export interface GradientDef {
  type: 'linear' | 'radial';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: GradientStop[];
}

export interface BezierPoint {
  id: string;
  x: number;
  y: number;
  angle: number;        // Tangent angle in radians
  inLength: number;     // Incoming handle length
  outLength: number;    // Outgoing handle length
  handleMode: HandleMode;
  cornerRadius?: number;
  /** Optional explicit outgoing angle when handleMode === 'broken' */
  outAngle?: number;
}

export interface ParametricData {
  holeRatio?: number; // 0 to 1 (Ellipse inner hole)
  sweep?: number;     // 0 to 360 (Ellipse sweep angle)
  rx?: number;        // Ellipse X radius
  ry?: number;        // Ellipse Y radius
  cx?: number;        // Parametric center X
  cy?: number;        // Parametric center Y
  length?: number;    // Line length
  angle?: number;     // Line angle in degrees
}

export interface VectorPath {
  id: string;
  name?: string;
  type: 'path' | 'parametric_ellipse' | 'parametric_line';
  closed: boolean;
  points: BezierPoint[];
  parametricData?: ParametricData;
}

export interface NodeTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  anchorX: number;
  anchorY: number;
}

export interface FillStyle {
  color: string;
  opacity: number;
  gradient?: GradientDef;
  globalColorId?: string;
}

export interface StrokeStyle {
  color: string;
  width: number;
  taperStart?: number;
  taperEnd?: number;
  globalColorId?: string;
}

export interface VectorStyle {
  fill?: FillStyle;
  stroke?: StrokeStyle;
}

export interface VectorNode {
  id: string;
  name: string;
  type: 'layer' | 'group' | 'text' | 'mask';
  visible: boolean;
  locked: boolean;
  transform: NodeTransform;
  children?: VectorNode[];
  paths?: VectorPath[];
  style?: VectorStyle;
  textContent?: string;
  fontFamily?: string;
  fontSize?: number;
  hasKeyframes: boolean; // Tells Push whether to create keyframe at playhead
}

export interface GlobalColorSwatch {
  id: string;
  name: string;
  color: string;
}

export interface VectorDocument {
  id: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
  nodes: VectorNode[];
  globalColors: GlobalColorSwatch[];
}
