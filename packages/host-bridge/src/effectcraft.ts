import {
  createDefaultTransform,
  getEffectiveContours,
  getPointHandles,
  type VectorNode,
  type VectorPath,
} from '@design-mode/vector-core';
import {
  SimulatedHostTransport,
  type HostTransport,
  type IHostBridge,
} from './IHostBridge.js';

export interface EffectCraftLayerRaw {
  uid?: string;
  name: string;
  kind?: 'shape' | 'text' | 'null' | 'mask';
  visible?: boolean;
  locked?: boolean;
  position?: [number, number];
  scale?: [number, number];
  rotation?: number;
  anchor?: [number, number];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  hasKeyframes?: boolean;
  vertices?: Array<[number, number]>;
}

export class EffectCraftBridge implements IHostBridge {
  readonly hostName = 'EffectCraft';
  readonly defaultPort = 7983;
  private transport: HostTransport;

  constructor(transport?: HostTransport) {
    this.transport =
      transport ??
      new SimulatedHostTransport((command, params) =>
        this.defaultSimulatedHandler(command, params),
      );
  }

  getTransport(): HostTransport {
    return this.transport;
  }

  private defaultSimulatedHandler(
    command: string,
    _params: Record<string, unknown>,
  ): unknown {
    if (command === 'layer.tree') {
      const layers: EffectCraftLayerRaw[] = [
        {
          uid: 'ec_shape_orb',
          name: 'HUD Ring Shape Layer',
          kind: 'shape',
          visible: true,
          position: [640, 360],
          scale: [100, 100],
          rotation: 0,
          anchor: [0, 0],
          fill: '#22d3ee',
          stroke: '#f8fafc',
          strokeWidth: 4,
          hasKeyframes: true,
          vertices: [
            [0, -110],
            [110, 0],
            [0, 110],
            [-110, 0],
          ],
        },
        {
          uid: 'ec_shape_crest',
          name: 'Motion Graphic Crest',
          kind: 'shape',
          visible: true,
          position: [320, 260],
          scale: [100, 100],
          rotation: -10,
          anchor: [0, 0],
          fill: '#a855f7',
          stroke: '#e2e8f0',
          strokeWidth: 2,
          hasKeyframes: false,
          vertices: [
            [-90, -70],
            [90, -70],
            [60, 80],
            [-60, 80],
          ],
        },
      ];
      return { layers };
    }
    if (command === 'list_fonts') {
      return {
        fonts: ['Inter', 'JetBrains Mono', 'Neue Haas Grotesk', 'Outfit', 'Syne'],
      };
    }
    if (command === 'comp.inspect') {
      return { backgroundColor: '#12141a' };
    }
    return { ok: true };
  }

  async pull(mode: 'all' | 'selected'): Promise<VectorNode[]> {
    const res = await this.transport.execute<{
      layers?: EffectCraftLayerRaw[];
    }>('layer.tree', { mode });

    return (res.layers ?? []).map((raw, idx) => this.mapRawToNode(raw, idx));
  }

  private mapRawToNode(raw: EffectCraftLayerRaw, idx: number): VectorNode {
    const [x, y] = raw.position ?? [640, 360];
    const [sx, sy] = raw.scale ?? [100, 100];
    const [ax, ay] = raw.anchor ?? [0, 0];

    const pts = (raw.vertices ?? [
      [-60, -60],
      [60, -60],
      [60, 60],
      [-60, 60],
    ]).map(([vx, vy], ptIdx) => ({
      id: `${raw.uid ?? `ec_${idx}`}_pt_${ptIdx}`,
      x: vx,
      y: vy,
      angle: 0,
      inLength: 0,
      outLength: 0,
      handleMode: 'symmetric' as const,
      cornerRadius: 0,
    }));

    const paths: VectorPath[] = [
      {
        id: `${raw.uid ?? `ec_${idx}`}_path`,
        name: `${raw.name} Shape`,
        type: 'path',
        closed: true,
        points: pts,
      },
    ];

    return {
      id: raw.uid ?? `ec_layer_${idx}`,
      name: raw.name,
      type: raw.kind === 'mask' ? 'mask' : raw.kind === 'text' ? 'text' : 'layer',
      visible: raw.visible ?? true,
      locked: raw.locked ?? false,
      hasKeyframes: Boolean(raw.hasKeyframes),
      transform: createDefaultTransform({
        x,
        y,
        scaleX: sx / 100,
        scaleY: sy / 100,
        rotation: raw.rotation ?? 0,
        anchorX: ax,
        anchorY: ay,
      }),
      style: {
        fill: raw.fill ? { color: raw.fill, opacity: 1 } : undefined,
        stroke: raw.stroke
          ? { color: raw.stroke, width: raw.strokeWidth ?? 2 }
          : undefined,
      },
      paths,
    };
  }

  async push(nodes: VectorNode[], currentTime: number): Promise<void> {
    for (const node of nodes) {
      await this.pushNodeRecursive(node, currentTime);
    }
  }

  private async pushNodeRecursive(
    node: VectorNode,
    currentTime: number,
  ): Promise<void> {
    const posVal = [node.transform.x, node.transform.y];
    const scaleVal = [
      node.transform.scaleX * 100,
      node.transform.scaleY * 100,
    ];
    const rotVal = node.transform.rotation;

    if (node.hasKeyframes) {
      // Spec 3.E: invoke setValueAtTime / prop.addKey at current playhead without overwriting base value
      await this.setValueAtTime(node.name, 'transform/position', currentTime, posVal);
      await this.setValueAtTime(node.name, 'transform/scale', currentTime, scaleVal);
      await this.setValueAtTime(node.name, 'transform/rotation', currentTime, rotVal);
    } else {
      await this.transport.execute('prop.set', {
        layer: node.name,
        path: 'transform/position',
        value: posVal,
      });
      await this.transport.execute('prop.set', {
        layer: node.name,
        path: 'transform/scale',
        value: scaleVal,
      });
      await this.transport.execute('prop.set', {
        layer: node.name,
        path: 'transform/rotation',
        value: rotVal,
      });
    }

    if (node.type === 'text') {
      await this.transport.execute('layer.newText', {
        name: node.name,
        text: node.textContent ?? 'Text',
        fontFamily: node.fontFamily ?? 'Inter',
        fontStyle: node.fontStyle ?? 'Medium',
        fontSize: node.fontSize ?? 48,
        tracking: node.tracking ?? 0,
        baselineShift: node.baselineShift ?? 0,
        position: posVal,
      });
    }

    if (node.blendMode && node.blendMode !== 'normal') {
      await this.transport.execute('layer.setBlendMode', {
        layer: node.name,
        blendMode: node.blendMode,
      });
    }

    if (node.style?.fill || node.style?.stroke) {
      await this.transport.execute('shape.fillStroke', {
        layers: [node.name],
        fill: node.style.fill?.color ?? false,
        fillOpacity:
          node.style.fill !== undefined ? node.style.fill.opacity * 100 : undefined,
        stroke: node.style.stroke?.color ?? false,
        strokeWidth: node.style.stroke?.width ?? 0,
        lineCap: node.style.stroke?.lineCap,
        lineJoin: node.style.stroke?.lineJoin,
      });
      if (
        node.style.stroke?.taperStart !== undefined ||
        node.style.stroke?.taperEnd !== undefined
      ) {
        await this.transport.execute('shape.stroke.taper', {
          layer: node.name,
          units: 'percent',
          startLength: (node.style.stroke.taperStart ?? 0) * 100,
          endLength: (node.style.stroke.taperEnd ?? 0) * 100,
        });
      }
    }

    if (node.paths) {
      for (const path of node.paths) {
        if (path.type === 'parametric_rect') {
          await this.transport.execute('shape.newShape', {
            layer: node.name,
            kind: 'rect',
            size: [
              path.parametricData?.width ?? 160,
              path.parametricData?.height ?? 120,
            ],
            roundness: path.parametricData?.roundness ?? 0,
            position: [node.transform.x, node.transform.y],
          });
        } else if (path.type === 'parametric_star') {
          await this.transport.execute('shape.newShape', {
            layer: node.name,
            kind: path.parametricData?.isPolygon ? 'polygon' : 'star',
            points: path.parametricData?.pointsCount ?? 5,
            outerRadius: path.parametricData?.outerRadius ?? 100,
            innerRadius: path.parametricData?.innerRadius ?? 45,
            roundness: path.parametricData?.roundness ?? 0,
            position: [node.transform.x, node.transform.y],
          });
        } else if (
          path.type === 'parametric_ellipse' &&
          (path.parametricData?.holeRatio ?? 0) <= 0.001 &&
          (path.parametricData?.sweep ?? 360) >= 359.99 &&
          (path.parametricData?.startAngle ?? -90) === -90
        ) {
          await this.transport.execute('shape.newShape', {
            layer: node.name,
            kind: 'ellipse',
            size: [
              (path.parametricData?.rx ?? 100) * 2,
              (path.parametricData?.ry ?? 100) * 2,
            ],
            position: [node.transform.x, node.transform.y],
          });
        } else {
          const { contours, closed } = getEffectiveContours(path);
          for (const contour of contours) {
            const vertices: Array<[number, number]> = [];
            const inTangents: Array<[number, number]> = [];
            const outTangents: Array<[number, number]> = [];
            for (const pt of contour) {
              const h = getPointHandles(pt);
              vertices.push([pt.x, pt.y]);
              inTangents.push([h.inHandle.x - pt.x, h.inHandle.y - pt.y]);
              outTangents.push([h.outHandle.x - pt.x, h.outHandle.y - pt.y]);
            }
            await this.transport.execute('shape.newPath', {
              layer: node.name,
              vertices,
              inTangents,
              outTangents,
              closed,
              rotoBezier: Boolean(path.rotoBezier),
            });
          }
        }
      }
    }

    if (node.operators) {
      for (const op of node.operators) {
        if (!op.enabled) continue;
        if (op.type === 'trim_paths') {
          await this.transport.execute('layer.addShapeItem', {
            layer: node.name,
            kind: 'trim',
            start: op.start,
            end: op.end,
            offset: op.offset,
          });
        } else if (op.type === 'repeater') {
          await this.transport.execute('layer.addShapeItem', {
            layer: node.name,
            kind: 'repeater',
            copies: op.copies,
            offset: [op.offsetX, op.offsetY],
            rotation: op.rotation,
            scale: op.scale * 100,
          });
        } else if (op.type === 'offset_paths') {
          await this.transport.execute('layer.addShapeItem', {
            layer: node.name,
            kind: 'offset',
            amount: op.amount,
          });
        } else if (op.type === 'merge_paths') {
          await this.transport.execute('layer.addShapeItem', {
            layer: node.name,
            kind: 'merge',
            mode: op.op,
          });
        }
      }
    }

    if (node.children) {
      for (const child of node.children) {
        await this.pushNodeRecursive(child, currentTime);
      }
    }
  }

  /**
   * Mirrors After Effects / EffectCraft setValueAtTime semantics at the active playhead.
   */
  async setValueAtTime(
    layer: string,
    propPath: string,
    currentTime: number,
    newValue: unknown,
  ): Promise<void> {
    await this.transport.execute('prop.addKey', {
      layer,
      path: propPath,
      time: currentTime,
      value: newValue,
      timeBase: 'comp',
    });
  }

  async getCompBackgroundColor(): Promise<string> {
    const res = await this.transport.execute<{ backgroundColor?: string }>(
      'comp.inspect',
      {},
    );
    return res.backgroundColor ?? '#12141a';
  }

  async getInstalledFonts(): Promise<string[]> {
    const res = await this.transport.execute<{ fonts?: string[] }>(
      'list_fonts',
      {},
    );
    return res.fonts ?? ['Inter', 'JetBrains Mono', 'Outfit', 'Syne'];
  }
}
