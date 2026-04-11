import { Renderer }      from './renderer';
import { Camera }        from './camera';
import { Scene }         from './scene';
import { SphereModel }   from './models/SphereModel';
import { type GridConfig } from './grid';
import { ModelSpawner }  from './ModelSpawner';

type vec4 = [number, number, number, number];
const NODE_COLOR: vec4 = [0.72, 0.74, 0.78, 1.0];

// Grid extent helpers (mirrors grid.ts logic without importing GridModel)
function halfExtents(cfg: GridConfig): { halfW: number; halfH: number } {
  const halfH = cfg.cameraRadius * Math.tan(cfg.cameraFov / 2) * cfg.fillFactor;
  return { halfH, halfW: halfH * cfg.aspect };
}

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

  // Pool of 32 sphere instances shared across nodes
  const modelPool: SphereModel[] = [];
  for (let i = 0; i < 32; i++) {
    const m = new SphereModel();
    m.init(renderer.device);
    modelPool.push(m);
  }

  const camera = new Camera(canvas.width / canvas.height);

  let gridCfg: GridConfig = {
    cols: 4, rows: 4,
    aspect:       canvas.width / canvas.height,
    cameraFov:    Math.PI / 3,
    cameraRadius: 14,
    fillFactor:   0.78,
  };

  const scene   = new Scene();
  const { halfW, halfH } = halfExtents(gridCfg);
  const spawner = new ModelSpawner(renderer, scene, modelPool, NODE_COLOR);
  spawner.updateExtent(halfW, halfH);

  window.addEventListener('resize', () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    camera.setAspect(canvas.width / canvas.height);
    renderer.resize(canvas.width, canvas.height);
    gridCfg = { ...gridCfg, aspect: canvas.width / canvas.height };
    const e = halfExtents(gridCfg);
    spawner.updateExtent(e.halfW, e.halfH);
  });

  let prev = performance.now();
  function loop(now: number): void {
    const dt = now - prev;
    prev = now;
    camera.tick(dt);
    scene.tick(dt, now);
    spawner.tick(dt, camera);
    renderer.frame(scene, camera, now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

main().catch(console.error);
