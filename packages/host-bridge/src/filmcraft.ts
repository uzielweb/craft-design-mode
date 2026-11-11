import {
  createDefaultTransform,
  type VectorNode,
  type VectorPath,
} from '@design-mode/vector-core';
import {
  SimulatedHostTransport,
  type HostTransport,
  type IHostBridge,
} from './IHostBridge.js';

/** FilmCraft exact integer time base: 254,016,000,000 ticks per second */
export const FILMCRAFT_TICKS_PER_SECOND = 254_016_000_000;

export interface FilmCraftGraphicLayerRaw {
  index?: number;
  id?: string;
  name: string;
  kind?: 'shape' | 'text' | 'group';
  visible?: boolean;
  locked?: boolean;
  position?: [number, number];
  scale?: number | [number, number];
  rotation?: number;
  fill_color?: string;
  stroke_color?: string;
  stroke_width?: number;
  animated?: boolean;
  points?: Array<[number, number]>;
}

export class FilmCraftBridge implements IHostBridge {
  readonly hostName = 'FilmCraft';
  readonly defaultPort = 7982;
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
    if (command === 'graphics.list') {
      const layers: FilmCraftGraphicLayerRaw[] = [
        {
          index: 1,
          id: 'fc_title_badge',
          name: 'Lower Third Accent Pill',
          kind: 'shape',
          visible: true,
          position: [480, 560],
          scale: 100,
          rotation: 0,
          fill_color: '#4f8cff',
          stroke_color: '#ffffff',
          stroke_width: 2,
          animated: true,
          points: [
            [-180, -36],
            [180, -36],
            [180, 36],
            [-180, 36],
          ],
        },
        {
          index: 2,
          id: 'fc_headline',
          name: 'Broadcast Title Graphic',
          kind: 'shape',
          visible: true,
          position: [480, 480],
          scale: 100,
          rotation: 0,
          fill_color: '#f59e0b',
          stroke_color: '#0f172a',
          stroke_width: 3,
          animated: false,
          points: [
            [-140, -24],
            [140, -24],
            [140, 24],
            [-140, 24],
          ],
        },
      ];
      return { layers };
    }
    if (command === 'graphics.fonts.used') {
      return {
        fonts: ['Inter', 'Roboto', 'Space Grotesk', 'IBM Plex Mono', 'Montserrat'],
      };
    }
    if (command === 'sequence.inspect') {
      return { backgroundColor: '#111318' };
    }
    return { ok: true };
  }

  async pull(mode: 'all' | 'selected'): Promise<VectorNode[]> {
    const res = await this.transport.execute<{
      layers?: FilmCraftGraphicLayerRaw[];
    }>('graphics.list', { mode });

    const rawLayers = res.layers ?? [];
    return rawLayers.map((raw, idx) => this.mapRawToNode(raw, idx));
  }

  private mapRawToNode(raw: FilmCraftGraphicLayerRaw, idx: number): VectorNode {
    const [x, y] = raw.position ?? [640, 360];
    const scaleArr = Array.isArray(raw.scale)
      ? raw.scale
      : [(raw.scale ?? 100) / 100, (raw.scale ?? 100) / 100];

    const pts = (raw.points ?? [
      [-80, -80],
      [80, -80],
      [80, 80],
      [-80, 80],
    ]).map(([px, py], ptIdx) => ({
      id: `${raw.id ?? `fc_${idx}`}_pt_${ptIdx}`,
      x: px,
      y: py,
      angle: 0,
      inLength: 0,
      outLength: 0,
      handleMode: 'broken' as const,
      cornerRadius: 0,
    }));

    const paths: VectorPath[] = [
      {
        id: `${raw.id ?? `fc_${idx}`}_path`,
        name: `${raw.name} Path`,
        type: 'path',
        closed: true,
        points: pts,
      },
    ];

    return {
      id: raw.id ?? `fc_layer_${idx}`,
      name: raw.name,
      type: raw.kind === 'text' ? 'text' : 'layer',
      visible: raw.visible ?? true,
      locked: raw.locked ?? false,
      hasKeyframes: Boolean(raw.animated),
      transform: createDefaultTransform({
        x,
        y,
        scaleX: scaleArr[0] ?? 1,
        scaleY: scaleArr[1] ?? 1,
        rotation: raw.rotation ?? 0,
      }),
      style: {
        fill: raw.fill_color
          ? { color: raw.fill_color, opacity: 1 }
          : undefined,
        stroke: raw.stroke_color
          ? { color: raw.stroke_color, width: raw.stroke_width ?? 2 }
          : undefined,
      },
      paths,
    };
  }

  async push(nodes: VectorNode[], currentTime: number): Promise<void> {
    const timeTicks = Math.round(currentTime * FILMCRAFT_TICKS_PER_SECOND);

    for (const node of nodes) {
      await this.pushNodeRecursive(node, timeTicks, currentTime);
    }
  }

  private async pushNodeRecursive(
    node: VectorNode,
    timeTicks: number,
    currentTime: number,
  ): Promise<void> {
    const props: Record<string, unknown> = {
      position: [node.transform.x, node.transform.y],
      scale: Math.round(((node.transform.scaleX + node.transform.scaleY) / 2) * 100),
      rotation: node.transform.rotation,
    };

    if (node.style?.fill) {
      props.fill_color = node.style.fill.color;
    }
    if (node.style?.stroke) {
      props.stroke = node.style.stroke.width > 0;
      props.stroke_width = node.style.stroke.width;
    }

    if (node.hasKeyframes) {
      // Spec 3.E: invoke keyframe / setValueAtTime at playhead instead of overwriting base value
      await this.transport.execute('graphics.set', {
        layer: node.name,
        props,
        time: timeTicks,
        keyframe: true,
        setValueAtTime: { time: currentTime, value: props },
      });
    } else {
      await this.transport.execute('graphics.set', {
        layer: node.name,
        props,
      });
    }

    if (node.paths) {
      for (const path of node.paths) {
        if (path.type === 'parametric_ellipse') {
          await this.transport.execute('graphics.newEllipse', {
            position: [node.transform.x, node.transform.y],
            size: [
              (path.parametricData?.rx ?? 100) * 2,
              (path.parametricData?.ry ?? 100) * 2,
            ],
          });
        } else {
          await this.transport.execute('graphics.newShape', {
            shape: 'path',
            position: [node.transform.x, node.transform.y],
            points: path.points.map((p) => [p.x, p.y]),
          });
        }
      }
    }

    if (node.children) {
      for (const child of node.children) {
        await this.pushNodeRecursive(child, timeTicks, currentTime);
      }
    }
  }

  async getCompBackgroundColor(): Promise<string> {
    const res = await this.transport.execute<{ backgroundColor?: string }>(
      'sequence.inspect',
      {},
    );
    return res.backgroundColor ?? '#111318';
  }

  async getInstalledFonts(): Promise<string[]> {
    const res = await this.transport.execute<{ fonts?: string[] }>(
      'graphics.fonts.used',
      {},
    );
    return res.fonts ?? ['Inter', 'Roboto', 'Space Grotesk', 'IBM Plex Mono'];
  }
}
