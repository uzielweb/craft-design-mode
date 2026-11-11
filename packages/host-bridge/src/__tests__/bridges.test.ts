import { describe, expect, it } from 'vitest';
import { createDefaultTransform, createDemoDocument, type VectorNode } from '@design-mode/vector-core';
import {
  EffectCraftBridge,
  FILMCRAFT_TICKS_PER_SECOND,
  FilmCraftBridge,
} from '../index.js';

describe('Host Bridges (FilmCraft & EffectCraft)', () => {
  it('EffectCraftBridge pulls layers and uses prop.addKey when hasKeyframes === true', async () => {
    const bridge = new EffectCraftBridge();
    const pulled = await bridge.pull('all');
    expect(pulled.length).toBeGreaterThan(0);

    const doc = createDemoDocument();
    bridge.getTransport().clearCommandLog();
    await bridge.push(doc.nodes, 2.5);

    const log = bridge.getTransport().getCommandLog();
    // group_ring has hasKeyframes: true -> must call prop.addKey at time 2.5
    const keyCalls = log.filter((c) => c.command === 'prop.addKey');
    expect(keyCalls.length).toBeGreaterThanOrEqual(3);
    expect(keyCalls[0]!.params.time).toBe(2.5);
    expect(keyCalls[0]!.params.layer).toBe('Donut & Ribbon Group');
  });

  it('FilmCraftBridge pulls graphic layers and pushes keyframed nodes with ticks & keyframe=true', async () => {
    const bridge = new FilmCraftBridge();
    const pulled = await bridge.pull('all');
    expect(pulled.length).toBeGreaterThan(0);

    const bg = await bridge.getCompBackgroundColor();
    expect(bg).toMatch(/^#/);

    const fonts = await bridge.getInstalledFonts();
    expect(fonts.length).toBeGreaterThan(0);

    const doc = createDemoDocument();
    bridge.getTransport().clearCommandLog();
    await bridge.push(doc.nodes, 1.0);

    const log = bridge.getTransport().getCommandLog();
    const kfGraphicsSet = log.find(
      (c) => c.command === 'graphics.set' && c.params.keyframe === true,
    );
    expect(kfGraphicsSet).toBeDefined();
    expect(kfGraphicsSet!.params.time).toBe(FILMCRAFT_TICKS_PER_SECOND);
  });

  it('EffectCraftBridge pushes text, rect/star primitives, and shape operators', async () => {
    const bridge = new EffectCraftBridge();
    const nodes: VectorNode[] = [
      {
        id: 't1',
        name: 'Stat 64k',
        type: 'text',
        visible: true,
        locked: false,
        hasKeyframes: false,
        textContent: '64k',
        fontFamily: 'Inter',
        fontSize: 104,
        transform: createDefaultTransform({ x: 300, y: 200 }),
      },
      {
        id: 'r1',
        name: 'Body Rect',
        type: 'layer',
        visible: true,
        locked: false,
        hasKeyframes: false,
        transform: createDefaultTransform({ x: 500, y: 300 }),
        paths: [
          {
            id: 'rp',
            type: 'parametric_rect',
            closed: true,
            points: [],
            parametricData: { width: 84, height: 264, roundness: 8 },
          },
        ],
        operators: [
          { id: 'op1', type: 'trim_paths', enabled: true, start: 0, end: 80, offset: 0 },
        ],
      },
    ];
    bridge.getTransport().clearCommandLog();
    await bridge.push(nodes, 0);
    const log = bridge.getTransport().getCommandLog();
    expect(log.some((c) => c.command === 'layer.newText')).toBe(true);
    expect(log.some((c) => c.command === 'shape.newShape' && c.params.kind === 'rect')).toBe(true);
    expect(log.some((c) => c.command === 'layer.addShapeItem' && c.params.kind === 'trim')).toBe(true);
  });
});
