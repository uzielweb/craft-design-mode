# Craft Design Mode — Vector Suite for FilmCraft & EffectCraft

A modular TypeScript monorepo implementing a full **Design Mode** vector authoring suite for **FilmCraft** and **EffectCraft**, structured around an agnostic AST vector engine (`@design-mode/vector-core`), host synchronization bridges (`@design-mode/host-bridge`), and three dockable React studio panels (`@design-mode/ui-panels` + `@design-mode/studio`).

## Monorepo Architecture

```text
craft-design-mode/
├── apps/
│   └── studio/                 # Vite + React host studio app (Layers | Canvas | Properties)
└── packages/
    ├── vector-core/            # Pure TypeScript vector engine (AST, Math, Commands, Renderer, Store)
    ├── host-bridge/            # IHostBridge adapters for FilmCraft & EffectCraft (Pull / Push)
    └── ui-panels/              # Dockable React panels (CanvasPanel, LayersPanel, PropertiesPanel)
```

## Implemented Features

- **Unified AST Contract**: `VectorDocument`, `VectorNode`, `VectorPath`, `BezierPoint`, `HandleMode` (`symmetric` | `angle` | `broken`), `SelectionMode`, and `BBoxMode`.
- **Command Pattern & Last Action**: Undo/Redo stack (`CommandManager`) plus live **Last Action** editing (`undo() -> updateParams() -> execute()`), e.g., adjusting `cornerRadius`, transform deltas, or parametric dimensions interactively.
- **3-Level Hit-Testing & Isolation Mode**:
  - `Shift+V` cycles between `layer` → `group` → `path`.
  - Double-click pushes into `isolationStack`, dimming non-descendant layers and filtering hit-tests exclusively to the isolated subtree.
- **3 Bounding Box Modes**:
  - `combined`: global canvas-space AABB across all selected objects.
  - `individual_comp`: canvas-aligned AABB per selected object.
  - `individual_object`: object-space OBB rendered with exact rotation.
- **Bézier & Parametric Math**:
  - `X` / `Y` axis lock during pointer drags.
  - `Ctrl + Drag` **Slide Mode**: moves an anchor point along its tangent vector while keeping `H_in` / `H_out` tips pinned in canvas space.
  - Relative delta offsets (`OffsetHandlesCommand`) for multi-point handle editing.
  - Parametric Ellipse (`holeRatio` 0–1, `sweep` 0–360) and Parametric Line (`length`, `angle`).
- **Numeric Double-Key Input (`V+V`, `R+R`, `S+S`)**: State machine (< 400ms) capturing numeric input (`0-9`, `.`, `-`) and committing on `Enter`.
- **Host Bridges (`FilmCraftBridge` & `EffectCraftBridge`)**:
  - Implements `IHostBridge` (`pull`, `push`, `getCompBackgroundColor`, `getInstalledFonts`).
  - Enforces the keyframe push rule: when `node.hasKeyframes === true`, pushes keyframes at the active playhead (`prop.addKey` / `graphics.set` with `keyframe: true` and FilmCraft ticks) instead of overwriting static base values.

## Quick Start

```bash
npm install
npm test
npm run typecheck
npm run dev
```
