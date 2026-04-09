import { Renderer } from './renderer';
import { Camera } from './camera';
import { Scene } from './scene';
import { Node } from './node';
import { CarrierModel } from './models/CarrierModel';
import { OrganicTextureGen, PAGE_SEED } from './OrganicTextureGen';
import { gridHomePositions, type GridConfig } from './grid';

type vec4 = [number, number, number, number];

const GRID_COLS = 4;
const GRID_ROWS = 4;

const NODE_COLOR: vec4 = [0.06, 0.06, 0.06, 1.0];

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

  // Four morphologically distinct carrier variants — same hull, divergent filaments.
  const models = [0, 1, 2, 3].map(seed => {
    const m = new CarrierModel(seed);
    m.init(renderer.device);
    m.initFaces(renderer.device, renderer.texBindGroupLayout);
    return m;
  });
  renderer.connTextureBindGroup = models[0].faceBindGroup;

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
  function redrawDbg(): void {
    const pixels = new OrganicTextureGen(PAGE_SEED).render(256, 'membrane');
    ctx2d.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), 256, 256), 0, 0);
    ctx2d.fillStyle = 'rgba(0,0,0,0.55)';
    ctx2d.fillRect(0, 0, 256, 20);
    ctx2d.fillStyle = 'rgba(255,255,255,0.85)';
    ctx2d.font = '11px monospace';
    ctx2d.fillText('texture 1/1 · membrane · 256²', 6, 14);
  }
  redrawDbg();
  // ─────────────────────────────────────────────────────────────────────────

  // ── Grid — positions derived from camera frustum at z = 0 ────────────────
  const camera = new Camera(canvas.width / canvas.height);

  let gridCfg: GridConfig = {
    cols:         GRID_COLS,
    rows:         GRID_ROWS,
    aspect:       canvas.width / canvas.height,
    cameraFov:    Math.PI / 3,  // must match Camera constructor
    cameraRadius: 14,           // must match Camera constructor
    fillFactor:   0.78,
  };

  // ── Carrier nodes — snapped to grid cell centres ─────────────────────────
  const nodePositions = gridHomePositions(gridCfg);
  const nodes = nodePositions.map((pos, i) => {
    const node = new Node(models[i % models.length], pos, NODE_COLOR, i * 1.7);
    node.init(renderer.device, renderer.nodeBindGroupLayout);
    return node;
  });

  const scene = new Scene(nodes);

  window.addEventListener('resize', () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    camera.setAspect(canvas.width / canvas.height);
    renderer.resize(canvas.width, canvas.height);

    // Recompute grid to match new viewport proportions.
    gridCfg = { ...gridCfg, aspect: canvas.width / canvas.height };

    // Slide node attractors to new grid positions without resetting velocities.
    const newPos = gridHomePositions(gridCfg);
    nodes.forEach((node, i) => {
      node.physics.home[0] = newPos[i][0];
      node.physics.home[1] = newPos[i][1];
      node.physics.home[2] = newPos[i][2];
    });
  });

  let prev = performance.now();
  function loop(now: number): void {
    const dt = now - prev;
    prev = now;
    camera.tick(dt);
    scene.tick(dt, now);
    for (const m of models) m.tick(renderer.device, now, scene.entropy);
    renderer.frame(scene, camera, now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

main().catch(console.error);
