# lurkergrid — CLAUDE.md

## Project Identity

**lurkergrid** (package: `entropic-nodes`) is a tiny artistic PoC: a MIDI sequencer driven by emergent physics. A WebGPU 3D nodal system runs fullscreen and generates three categories of events. Each event fires a MIDI note. A minimal HUD console overlays the canvas and logs events + system state in real time.

The app has no UI controls, no user interaction — it is a generative instrument that plays itself.

---

## Tech Stack

| Layer | Tool |
|---|---|
| Runtime | Browser — WebGPU required |
| Language | TypeScript 5.6, strict, no unused locals/params |
| Build | Vite 6 |
| Types | `@webgpu/types` — no other deps |
| Entry | `index.html` → `src/main.ts` |

No framework. No UI library. No test runner. Keep it that way.

---

## Current Architecture

```
src/
  main.ts             — bootstrap: WebGPU init, resize, rAF loop
  math.ts             — vec3/mat4/quat primitives (column-major, no lib)
  camera.ts           — orbit camera, no auto-rotation
  physics.ts          — spring-damped oscillator + entropy + wind
  node.ts             — Node class: GPU uniform buffer + bind group per node
  scene.ts            — Scene: node list, connection graph, entropy, chaos events
  connection.ts       — Connection: cubic Bézier geometry writer
  grid.ts             — world-space grid position helpers
  renderer.ts         — WebGPU renderer: MSAA, two pipelines
  models/
    SphereModel.ts    — UV sphere builder (pos+normal, triangle-list)
    ModelSpawner.ts   — probabilistic node spawner/evictor
  shaders/
    solid.wgsl        — Blinn-Phong sphere pipeline
    connection.wgsl   — procedural alpha line pipeline
    wireframe.wgsl    — unused, keep for reference
```

### Key constants

| Symbol | Value | Location |
|---|---|---|
| `MAX_NODES` | 32 | `ModelSpawner.ts` |
| `MAX_CONNECTIONS` | 780 | `renderer.ts` |
| `CONNECTION_RADIUS` | 8.0 | `connection.ts` |
| `MSAA_COUNT` | 4 | `renderer.ts` |
| `SPAWN_INTERVAL_MS` | 900 | `ModelSpawner.ts` |
| `ENTROPY_MAX` | 1.0 | `scene.ts` |

### Render loop order (per frame)

1. `camera.tick(dt)` — no-op currently
2. `scene.tick(dt, t)` — physics, entropy, connection graph rebuild
3. `spawner.tick(dt, camera)` — probabilistic spawn/evict
4. `renderer.frame(scene, camera, t)` — connection geometry upload → draw connections → draw nodes

### Physics model

Nodes oscillate sinusoidally around a home position. Spring constant `SPRING = 0.06`, damping `DAMPING = 0.80`, float amplitude `FLOAT_AMP = 0.35` scaled by entropy. Entropy accumulates at `ENTROPY_RATE = 0.00004` per ms and decays at `ENTROPY_DECAY = 0.00001`. Spawn/delete events inject radial impulses and wind bursts.

---

## New Direction — What to Build

### 1. Event System

Create `src/events.ts` — a typed, synchronous event bus. Three event types, nothing more:

```typescript
type NodeSpawnEvent    = { type: 'node:spawn';      pos: vec3; nodeId: number; t: number }
type ConnectionEvent   = { type: 'node:connect';    posA: vec3; posB: vec3; t: number }
type CollisionEvent    = { type: 'node:collide';    pos: vec3; nodeId: number; t: number }
```

- **`node:spawn`** — emitted by `ModelSpawner` when `spawnNode()` completes.
- **`node:connect`** — emitted by `Scene.buildConnections()` when a connection key appears for the first time (i.e., when `!this.prevConnKeys.has(key)`). This detection already exists; move it to an event emission.
- **`node:collide`** — emitted when two nodes' current positions are closer than a threshold (e.g. 1.5× the sphere radius, `0.3` world units). Detect in `scene.tick` after physics integration; debounce per pair to avoid flooding (min 500 ms between same-pair collisions).

The bus is a plain `EventEmitter`-style class — no DOM events, no third-party lib. Subscribers register a callback; the bus calls them synchronously in registration order. Keep it under 40 lines.

**Emit points:**
- `ModelSpawner.spawnNode()` → emit `node:spawn`
- `Scene.buildConnections()` → emit `node:connect` for newly formed connections
- `Scene.tick()` → emit `node:collide` after physics step, with pair debounce

### 2. MIDI Output

Create `src/midi.ts`. Use the Web MIDI API (`navigator.requestMIDIAccess()`). Request MIDI access once at startup; if denied or unavailable, log a warning and skip silently — MIDI is non-blocking.

**Mapping — one octave per event type:**

| Event | Octave | MIDI note range |
|---|---|---|
| `node:spawn` | C4 (middle) | C4–B4 (60–71) |
| `node:connect` | C5 (high) | C5–B5 (72–83) |
| `node:collide` | C3 (low) | C3–B3 (48–59) |

**Pitch selection within the octave:**

Use the `pos` (or midpoint of `posA`/`posB` for connections) to select the semitone. Map the x-coordinate of the event position to 0–11 semitones. The world-space x range is `[-halfW, +halfW]` (available via `ModelSpawner.halfW`). Clamp and normalise: `semitone = Math.floor(((x + halfW) / (2 * halfW)) * 12)`.

**Note parameters:**
- Channel: 1 (all events)
- Velocity: 80 (fixed for now — can be wired to entropy later)
- Duration: 120 ms (send note-on, schedule note-off with `setTimeout`)

`midi.ts` exports a single `MidiOutput` class with:
- `init(): Promise<void>` — requests access, selects first available output
- `noteOn(note: number, velocity?: number, channel?: number): void`
- `noteOff(note: number, channel?: number): void`
- `playNote(note: number, durationMs?: number): void` — convenience wrapper

### 3. Console Overlay

Create `src/ui/Console.ts` and inject HTML/CSS from `src/ui/console.css` (or inject styles via a `<style>` tag — keep it co-located).

**Layout:** Fixed top-left panel, `font-family: monospace`, semi-transparent dark background (`rgba(0,0,0,0.55)`), no border-radius. Width: 320px. Max height: 220px. Overflow: hidden (newest line scrolls in at top, oldest line drops off bottom). No scrollbar.

**Content — two sections:**

*System state line* (top, always visible, updates every frame):
```
nodes: 32  connections: 14  entropy: 0.42  t: 00:01:23
```

*Event log* (below state line, max 8 lines, newest on top):
```
[00:01:23.4]  SPAWN    C4  (x: 3.2, y:-1.1)
[00:01:22.1]  CONNECT  C5  (x: 0.4, y: 2.3)
[00:01:21.9]  COLLIDE  C3  (x:-2.1, y: 0.8)
```

Each log line shows: elapsed time, event type (fixed-width, padded), MIDI note name, x/y position rounded to 1 decimal.

**Do not use React, Vue, or any framework.** Pure DOM manipulation. The `Console` class holds a reference to its container element and updates it directly. Update the state line every frame from `main.ts`; the event bus pushes log lines automatically via subscription.

**CSS:** inject a single `<style>` block on first `Console` instantiation. No external stylesheet import. Keep total CSS under 30 lines.

---

## Implementation Guidelines

### File structure after the new work

```
src/
  events.ts           — EventBus + event type definitions
  midi.ts             — MidiOutput
  ui/
    Console.ts        — HUD overlay
  main.ts             — wire everything together
  ... (existing files unchanged except targeted edits)
```

### Editing existing files

- `scene.ts` — add `EventBus` parameter to constructor (or set via setter); emit `node:connect` and `node:collide`
- `ModelSpawner.ts` — add `EventBus` parameter; emit `node:spawn`
- `main.ts` — instantiate `EventBus`, `MidiOutput`, `Console`; subscribe MIDI and console to events; pass bus to scene and spawner; update console state each frame

Do not restructure files beyond these targeted additions. Do not move existing logic unless it directly conflicts.

### Code style (match the existing codebase)

- No comments unless the WHY is non-obvious
- No docstrings
- `const` over `let` everywhere possible
- Types defined inline or as top-level `type` aliases — no `interface` unless structural polymorphism is needed
- Named exports, no default exports except where Vite requires it
- `vec3` is `[number, number, number]` — use the type alias from `math.ts`
- GPU resource creation always guards with `!` non-null assertion after `init()` — pattern is established in `node.ts` and `renderer.ts`
- `private` fields use `!` post-declaration (`device!: GPUDevice`)

### Do not add

- Tests
- A bundled MIDI library (use Web MIDI API directly)
- Logging to `console.log` in hot paths (frame loop, geometry writers)
- Error boundaries or retry logic for MIDI — fail silently
- Any dependency beyond the existing three (`@webgpu/types`, `typescript`, `vite`)

---

## MIDI Note Reference

```
C3 = 48   C#3 = 49  D3 = 50   D#3 = 51  E3 = 52   F3 = 53
F#3 = 54  G3 = 55   G#3 = 56  A3 = 57   A#3 = 58  B3 = 59

C4 = 60   C#4 = 61  D4 = 62   D#4 = 63  E4 = 64   F4 = 65
F4 = 65   G4 = 67   G#4 = 68  A4 = 69   A#4 = 70  B4 = 71

C5 = 72   C#5 = 73  D5 = 74   D#5 = 75  E5 = 76   F5 = 77
F#5 = 78  G5 = 79   G#5 = 80  A5 = 81   A#5 = 82  B5 = 83
```

Note name helper: `['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][note % 12]`

---

## World Space Reference

Camera is at radius 14, FOV 60°, looking at origin. With `fillFactor = 0.78`:

```
halfH = 14 * tan(π/6) * 0.78 ≈ 6.30 world units
halfW = halfH * aspect         ≈ 11.2 world units (16:9)
```

Node positions are distributed in `[-halfW, halfW] × [-halfH, halfH] × [-0.75, 0.75]`. Only x is used for pitch mapping — it gives the widest spread.

---

## Dev Workflow

```bash
npm run dev      # start Vite dev server (port 5173)
npm run build    # production build → dist/
npm run preview  # serve dist/
```

WebGPU requires a Chromium-based browser (Chrome 113+, Edge 113+) or Safari 18+. Firefox does not support WebGPU. The app checks `navigator.gpu` and shows an error message if missing.

---

## Known Quirks

- `wireframe.wgsl` exists but is unused — leave it
- `ORBIT_SPEED` is defined in `camera.ts` but `tick()` is a no-op — camera is static
- `_camera` parameter in `ModelSpawner.tick()` is intentionally unused (strict mode suppressed with underscore prefix)
- Node model pool is 32 slots but models are shared across nodes — multiple nodes may reference the same `SphereModel` instance; vertex buffer is read-only so this is safe
- `ModelSpawner` fills all 32 nodes immediately on first frames (before the probabilistic timer kicks in)
