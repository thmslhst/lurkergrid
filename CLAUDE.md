# CLAUDE.md — Entropic 3D Nodal System

## Artistic Context

Thomas Lhoest's practice: autoesoteric, entropic systems. Software as magical infrastructure — stochastic recursions, emergent behavior, unstable informational manifolds. This piece extends his 2D nodal work (GhostsOfInstead) into 3D, where **entropy** is a first-class parameter: a scalar that rises over time, amplifying drift, destabilizing rotations, stretching connections toward rupture. Nodes are carriers — abstract operators whose structural tendencies accumulate and mutate as the system cycles through noise, drift, and repetition.

## Technical Stack

- **Runtime**: Vanilla TypeScript, compiled with Vite (no framework)
- **GPU**: WebGPU — `GPUDevice`, `GPURenderPipeline`, WGSL shaders
- **Rendering**: Wireframe-only (line topology) until textures are introduced
- **Output**: Fullscreen canvas, no UI chrome

## Project Structure

```
entropic-nodes/
  index.html
  vite.config.ts
  tsconfig.json
  src/
    main.ts               # Bootstrap: canvas, WebGPU init, loop start
    renderer.ts           # Renderer class — device, pipelines, per-frame draw
    camera.ts             # Camera class — perspective proj, view matrix, slow auto-orbit
    scene.ts              # Scene class — owns all nodes + connections, ticks physics
    physics.ts            # PhysicsState type + integration helpers (spring, drift, entropy)
    node.ts               # Node class — 3D position/velocity, rotation, model ref
    connection.ts         # Connection class — pair of nodes, computes line geometry
    models/
      PlaneModel.ts       # Abstract base: plane mesh → wireframe edge buffer
      ShardModel.ts       # Model A: cluster of intersecting rectangular planes
      LatticeModel.ts     # Model B: subdivided cube faces (inner grid of planes)
      MandalaMdl.ts       # Model C: radial planes arranged around a central axis
    shaders/
      wireframe.wgsl      # Vertex + fragment for node wireframe geometry
      connection.wgsl     # Vertex + fragment for inter-node connection lines
```

## Class Contracts

### `Renderer`
- Owns `GPUDevice`, `GPUCanvasContext`, depth texture, two `GPURenderPipeline`s (wireframe + connection).
- `init(): Promise<void>` — requests adapter/device, configures context.
- `frame(scene: Scene, camera: Camera, t: number): void` — encodes one command buffer: clear, draw connections, draw nodes.
- Manages a shared `GPUBuffer` for per-frame view/proj uniforms (16-float mat4 × 2).

### `Camera`
- Stores `fov`, `aspect`, `near`, `far`, `radius`, `azimuth`, `elevation`.
- `tick(dt: number): void` — increments azimuth by a slow constant (auto-orbit).
- `viewMatrix(): Float32Array` — look-at computed from spherical coords.
- `projMatrix(): Float32Array` — standard perspective.

### `Scene`
- Owns `Node[]`, `Connection[]`, entropy scalar.
- `tick(dt: number, t: number): void` — advances entropy, calls physics on each node, rebuilds connection list each frame.
- `buildConnections(): void` — O(n²) distance check; connects pairs within `CONNECTION_RADIUS`.

### `PhysicsState` (plain object, no class)
```ts
interface PhysicsState {
  pos:  vec3;   // current world position
  vel:  vec3;   // current velocity
  home: vec3;   // rest/attractor position
  rot:  quat;   // current orientation
  angVel: vec3; // angular velocity (unique per node)
  seed: number; // drives per-node sinusoidal drift
}
```
Integration helpers (pure functions, no side effects):
- `integratePhysics(state, dt, t, entropy): void`
  - Float: `sin/cos` drift on each axis, amplitude = `FLOAT_AMP * (1 + entropy * 0.8)`
  - Spring: pull toward home, `k = SPRING`
  - Damping: `vel *= DAMPING^dt`
  - Rotation: `angVel` scaled by `(1 + entropy * 1.2)`, applied via incremental quaternion

### `Node`
- References one `PlaneModel` instance (shared across nodes of same type).
- Holds a `PhysicsState`.
- `worldMatrix(): Float32Array` — TRS from current pos + rot.
- Renders by uploading its world matrix to a per-node uniform buffer, then issuing a draw call for the model's edge buffer.

### `PlaneModel` (abstract)
- `buildEdges(): Float32Array` — returns flat array of line segment endpoints in local space (format: `[x0,y0,z0, x1,y1,z1, ...]`).
- `edgeBuffer: GPUBuffer` — uploaded once at init, never mutated.
- `edgeCount: number`

### `Connection`
- Holds refs to two `Node` instances.
- `buildGeometry(): Float32Array` — two endpoints in world space (straight line).
- Alpha driven by `1 - dist/CONNECTION_RADIUS`, further modulated by entropy.
- Uploads to a dynamic `GPUBuffer` each frame (connections change each frame).

## The Three Initial Models

### A — `ShardModel`
Five rectangular planes, each ~0.4×0.8 units, arranged as a crystal shard:
- One vertical center plane (XY)
- Two planes rotated ±40° around Y from center
- Two planes rotated ±70° around X, offset slightly upward
Produces a jagged, asymmetric silhouette. Entropy amplifies the angular velocity so shards slowly spin open.

### B — `LatticeModel`
A 1×1×1 cube where each face is subdivided into a 3×3 grid of smaller planes (9 quads per face × 6 faces = 54 planes). Only edges are rendered. Looks like a cage with internal structure. Dense, architectural, stable at low entropy, chaotic at high.

### C — `MandalaMdl`
Eight planes of identical size (0.6×0.3), arranged radially: each rotated `(i / 8) * 2π` around the Y axis. A ninth horizontal plane sits at the equator. Produces a flower/wheel silhouette. Auto-rotates along Y; entropy causes individual planes to cant outward (local tilt increases with entropy).

## Entropy System

```ts
const ENTROPY_RATE  = 0.00004;  // per millisecond
const ENTROPY_MAX   = 1.0;
const ENTROPY_DECAY = 0.00001;  // slow bleed back toward 0 (system never fully stabilizes)
```

Entropy governs:
| Parameter | Low entropy (≈0) | High entropy (≈1) |
|---|---|---|
| Float amplitude | `FLOAT_AMP` (base) | `FLOAT_AMP * 1.8` |
| Angular velocity | base `angVel` | `angVel * 2.2` |
| Connection alpha | `0.4 * proximity²` | `0.15 * proximity` (washed out) |
| Node count | static | (future: nodes spawn/die) |

## WebGPU Pipeline Notes

### Wireframe pipeline
- Topology: `line-list`
- Vertex layout: `float32x3` (position only, no normals needed for wireframe)
- Bind group 0: view + proj matrices (shared, updated once per frame)
- Bind group 1: world matrix (per-node, updated per draw call)
- Vertex shader: `worldMatrix * vec4(pos, 1.0)` → clip space via `viewProj`
- Fragment shader: flat color from a per-pipeline uniform (`nodeColor: vec4f`)

### Connection pipeline
- Topology: `line-list`
- Same vertex layout
- All connection segments packed into one dynamic buffer each frame
- Per-connection alpha passed as instance data or as a uniform (start simple: single buffer upload per frame)
- Fragment shader: `vec4(color.rgb, alpha)` with `alpha-to-coverage` or premultiplied blend

### Depth
- Format: `depth24plus`
- Enabled for node wireframes (occlusion matters)
- Disabled or write-masked for connections (always draw through)

## Shaders (WGSL)

### `wireframe.wgsl`
```wgsl
struct Uniforms {
  viewProj : mat4x4<f32>,
}
struct NodeUniforms {
  world : mat4x4<f32>,
  color : vec4<f32>,
}
@group(0) @binding(0) var<uniform> u : Uniforms;
@group(1) @binding(0) var<uniform> n : NodeUniforms;

@vertex
fn vs(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
  return u.viewProj * n.world * vec4<f32>(pos, 1.0);
}
@fragment
fn fs() -> @location(0) vec4<f32> {
  return n.color;
}
```

### `connection.wgsl`
```wgsl
struct Uniforms {
  viewProj : mat4x4<f32>,
}
struct ConnUniforms {
  color : vec4<f32>,  // alpha encodes proximity
}
@group(0) @binding(0) var<uniform> u : Uniforms;
@group(1) @binding(0) var<uniform> c : ConnUniforms;

@vertex
fn vs(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
  return u.viewProj * vec4<f32>(pos, 1.0);
}
@fragment
fn fs() -> @location(0) vec4<f32> {
  return c.color;
}
```

## Physics Constants

```ts
const FLOAT_AMP        = 0.35;   // world-space units
const SPRING           = 0.06;
const DAMPING          = 0.80;
const CONNECTION_RADIUS = 4.5;   // world-space units
const NODE_COUNT       = 12;     // initial; 3 of each model type, 4 instances each
const SCENE_RADIUS     = 5.0;    // home positions distributed in this sphere
```

## Development Phases

### Phase 1 — Static wireframes (current)
- Three models rendered as wireframes, no physics, no entropy.
- Camera auto-orbits. Confirm pipeline and shaders work.

### Phase 2 — Physics + entropy
- Add `PhysicsState` to nodes. Float, spring, damping. Entropy ramp.
- Nodes drift and rotate. Connection lines appear.

### Phase 3 — Material / texture
- Replace flat wireframe color with texture-mapped planes (UV per vertex).
- Each model type gets its own texture.

## Code Standards

- No file exceeds 200 lines. If it does, split.
- No class imports from more than two other classes directly.
- Pure functions for math (matrix, quaternion, vec3 helpers) in `src/math.ts`.
- All GPU buffer allocations happen in `init()` methods, never in the render loop.
- `Float32Array` everywhere for GPU data — no `Array<number>` on hot paths.
- WGSL shaders live in `.wgsl` files, imported as strings via Vite's `?raw` import.
- No `any`. Strict TypeScript.
