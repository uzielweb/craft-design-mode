export type SelectionMode = 'layer' | 'group' | 'path';
export type BBoxMode = 'combined' | 'individual_comp' | 'individual_object';
export type HandleMode = 'symmetric' | 'angle' | 'broken';
export type AxisLock = 'x' | 'y' | null;
export type ToolType =
  | 'select'
  | 'direct_select'
  | 'pen'
  | 'rect'
  | 'ellipse'
  | 'star'
  | 'line'
  | 'scissors'
  | 'text'
  | 'eyedropper'
  | 'rotate'
  | 'scale'
  | 'gradient'
  | 'width'
  | 'zoom'
  | 'pan';

export type AlignToMode = 'selection' | 'key_object' | 'composition';
export type AlignScope = 'individual' | 'set';
export type ShortcutPreset = 'illustrator' | 'after_effects' | 'figma';
export type PathfinderResultMode = 'destructive' | 'operator';
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'difference';
export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

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
  /** Squircle / Apple-style corner smoothing (0 to 100%) */
  cornerSmoothness?: number;
  /** Optional explicit outgoing angle when handleMode === 'broken' */
  outAngle?: number;
}

export interface ParametricData {
  // Ellipse (DM Ellipse: Width/Height + Start Angle + Sweep + Inner Ratio)
  holeRatio?: number;   // 0 to 1
  startAngle?: number;  // degrees, default -90
  sweep?: number;       // 0 to 360
  rx?: number;
  ry?: number;
  // Center
  cx?: number;
  cy?: number;
  // Line
  length?: number;
  angle?: number;
  // Rectangle
  width?: number;
  height?: number;
  roundness?: number;
  // Star / Polygon
  pointsCount?: number;
  outerRadius?: number;
  innerRadius?: number;
  isPolygon?: boolean;
}

export interface VectorPath {
  id: string;
  name?: string;
  type:
    | 'path'
    | 'parametric_ellipse'
    | 'parametric_line'
    | 'parametric_rect'
    | 'parametric_star';
  closed: boolean;
  rotoBezier?: boolean;
  points: BezierPoint[];
  parametricData?: ParametricData;
}

export interface TrimPathsOperator {
  id: string;
  type: 'trim_paths';
  enabled: boolean;
  start: number;  // 0..100
  end: number;    // 0..100
  offset: number; // degrees
}

export interface RepeaterOperator {
  id: string;
  type: 'repeater';
  enabled: boolean;
  copies: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  scale: number;
}

export interface OffsetPathsOperator {
  id: string;
  type: 'offset_paths';
  enabled: boolean;
  amount: number;
}

export interface MergePathsOperator {
  id: string;
  type: 'merge_paths';
  enabled: boolean;
  op: 'unite' | 'subtract' | 'intersect' | 'exclude';
}

export type ShapeOperator =
  | TrimPathsOperator
  | RepeaterOperator
  | OffsetPathsOperator
  | MergePathsOperator;

export interface NodeTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skew?: number;
  skewAxis?: number;
  opacity?: number; // 0..100
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
  lineCap?: LineCap;
  lineJoin?: LineJoin;
  taperStart?: number; // 0..1
  taperEnd?: number;   // 0..1
  taperStartWidth?: number; // 0..1
  taperEndWidth?: number;   // 0..1
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
  blendMode?: BlendMode;
  transform: NodeTransform;
  children?: VectorNode[];
  paths?: VectorPath[];
  operators?: ShapeOperator[];
  style?: VectorStyle;
  textContent?: string;
  fontFamily?: string;
  fontStyle?: string;
  fontSize?: number;
  leading?: number | 'auto';
  tracking?: number;
  baselineShift?: number;
  textScaleX?: number;
  textScaleY?: number;
  textAlign?: 'left' | 'center' | 'right';
  textFillEnabled?: boolean;
  textStrokeEnabled?: boolean;
  fauxBold?: boolean;
  fauxItalic?: boolean;
  allCaps?: boolean;
  smallCaps?: boolean;
  ligatures?: boolean;
  hindiDigits?: boolean;
  hasKeyframes: boolean;
}

export interface GlobalColorSwatch {
  id: string;
  name: string;
  color: string;
}

export interface ColorUsageEntry {
  color: string;
  count: number;
  nodeIds: string[];
}

export interface DesignPreferences {
  shortcutPreset: ShortcutPreset;
  uiScale: number;
  toolbarCompact: boolean;
  autoExpandSelected: boolean;
  matchCompBackground: boolean;
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
