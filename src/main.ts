import { Renderer } from './renderer';
import { Camera } from './camera';
import { Scene } from './scene';
import { Node } from './node';
import { LurkerModel } from './models/LurkerModel';
import { OrganicTextureGen, PAGE_SEED } from './OrganicTextureGen';
import type { vec3 } from './math';

type vec4 = [number, number, number, number];

const COLOR: vec4 = [0.06, 0.06, 0.06, 1.0];

// Extended esoteric composition — 16 nodes across four ontological layers.
//
// Layer 0 — The Tree of Life (z ≈ 0, canonical sephiroth)
//   Three pillars: Mercy x=+2.2 · Severity x=-2.2 · Middle x=0
//   Y axis: Crown at top → Kingdom at bottom
//
// Layer 1 — Da'ath (z = +1.2, off-plane)
//   The hidden sphere; exists in the Abyss between the Supernal Triad and the rest.
//   Displaced forward so it floats between worlds, bridging Chokmah/Binah to Tiphareth.
//
// Layer 2 — Three Veils of Negative Existence (z recedes toward −2.4)
//   Ain Soph Aur / Ain Soph / Ain — pre-emanation states above Kether.
//   Each veil steps further back in z (deeper void) and higher in y.
//   They connect in a chain to Kether but not to each other's far ends.
//
// Layer 3 — Two Temple Pillars (z = +0.8, below Malkuth)
//   Jachin (right, Establishment) and Boaz (left, Strength).
//   Flank Malkuth, slightly forward — the gateway of manifestation.
//   Distance between pillars (~6.8) exceeds CONNECTION_RADIUS so no direct link.
const NODES: vec3[] = [
  // ── Ten Sephiroth ─────────────────────────────────────────────────────────
  [ 0.0,  4.5,  0.0],  //  0  Kether      — Crown
  [ 2.2,  3.0,  0.0],  //  1  Chokmah     — Wisdom
  [-2.2,  3.0,  0.0],  //  2  Binah       — Understanding
  [ 2.2,  1.0,  0.0],  //  3  Chesed      — Mercy
  [-2.2,  1.0,  0.0],  //  4  Geburah     — Severity
  [ 0.0,  0.0,  0.0],  //  5  Tiphareth   — Beauty
  [ 2.2, -1.8,  0.0],  //  6  Netzach     — Victory
  [-2.2, -1.8,  0.0],  //  7  Hod         — Splendor
  [ 0.0, -3.0,  0.0],  //  8  Yesod       — Foundation
  [ 0.0, -4.5,  0.0],  //  9  Malkuth     — Kingdom

  // ── Da'ath — the Abyss node ───────────────────────────────────────────────
  [ 0.0,  2.0,  1.2],  // 10  Da'ath      — hidden Knowledge, adrift off-plane

  // ── Three Veils of Negative Existence ─────────────────────────────────────
  [ 0.0,  6.2, -0.6],  // 11  Ain Soph Aur — Limitless Light
  [ 0.0,  7.8, -1.4],  // 12  Ain Soph     — Limitless
  [ 0.0,  9.4, -2.4],  // 13  Ain          — Nothing / Void

  // ── Two Pillars of the Temple ─────────────────────────────────────────────
  [ 3.4, -5.5,  0.8],  // 14  Jachin       — right pillar, Establishment
  [-3.4, -5.5,  0.8],  // 15  Boaz         — left pillar, Strength
];

async function main(): Promise<void> {
  if (!navigator.gpu) {
    document.body.innerHTML = '<p style="color:#f66;font-family:monospace;padding:2rem">WebGPU not supported in this browser.</p>';
    return;
  }

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const renderer = new Renderer();
  await renderer.init(canvas);

  const model = new LurkerModel();
  model.init(renderer.device);
  model.initFaces(renderer.device, renderer.texBindGroupLayout);
  renderer.connTextureBindGroup = model.faceBindGroup;

  // ── Debug: 2D canvas overlay showing the generated texture ──────────────
  const dbgCanvas = document.createElement('canvas');
  dbgCanvas.width = dbgCanvas.height = 256;
  Object.assign(dbgCanvas.style, {
    position: 'fixed', bottom: '12px', right: '12px',
    width: '180px', height: '180px',
    border: '1px solid rgba(255,255,255,0.3)',
    pointerEvents: 'none',
    fontFamily: 'monospace',
  });
  document.body.appendChild(dbgCanvas);
  const ctx2d = dbgCanvas.getContext('2d')!;
  const pixels = new OrganicTextureGen(PAGE_SEED).render(256, 'cellular');
  ctx2d.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), 256, 256), 0, 0);
  ctx2d.fillStyle = 'rgba(0,0,0,0.55)';
  ctx2d.fillRect(0, 0, 256, 20);
  ctx2d.fillStyle = 'rgba(255,255,255,0.85)';
  ctx2d.font = '11px monospace';
  ctx2d.fillText('texture 1/1 · membrane · 256²', 6, 14);
  // ─────────────────────────────────────────────────────────────────────────

  const nodes = NODES.map((pos, i) => {
    const node = new Node(model, pos, COLOR, i * 1.7);
    node.init(renderer.device, renderer.nodeBindGroupLayout);
    return node;
  });

  const scene  = new Scene(nodes);
  const camera = new Camera(canvas.width / canvas.height);

  window.addEventListener('resize', () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    camera.setAspect(canvas.width / canvas.height);
    renderer.resize(canvas.width, canvas.height);
  });

  let prev = performance.now();
  function loop(now: number): void {
    const dt = now - prev;
    prev = now;
    camera.tick(dt);
    scene.tick(dt, now);
    model.tick(renderer.device, now);
    renderer.frame(scene, camera, now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

main().catch(console.error);
