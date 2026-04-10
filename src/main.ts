import { Renderer }      from './renderer';
import { Camera }        from './camera';
import { Scene }         from './scene';
import { ClothModel }    from './models/ClothModel';
import { OrganicTextureGen, PAGE_SEED } from './OrganicTextureGen';
import { type GridConfig } from './grid';
import { ModelSpawner }  from './ModelSpawner';

type vec4 = [number, number, number, number];
const NODE_COLOR: vec4 = [0.06, 0.06, 0.06, 1.0];

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

  // Pool of 32 morphologically distinct carriers (lazy: models init'd once, nodes spawn later).
  // initFaces is async — it fetches x.png + x-normal.png (cached after the first call).
  const modelPool: ClothModel[] = [];
  for (let seed = 0; seed < 32; seed++) {
    const m = new ClothModel(seed);
    m.init(renderer.device);
    await m.initFaces(renderer.device, renderer.clothTexBindGroupLayout);
    modelPool.push(m);
  }
  // Connections use their own organic texture — independent of the cloth sprite textures.
  const connTex     = OrganicTextureGen.generate(renderer.device, 256, PAGE_SEED, 'membrane');
  const connSampler = renderer.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  renderer.connTextureBindGroup = renderer.device.createBindGroup({
    layout: renderer.texBindGroupLayout,
    entries: [
      { binding: 0, resource: connSampler },
      { binding: 1, resource: connTex.createView() },
    ],
  });

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
  const spawner = new ModelSpawner(canvas, renderer, scene, modelPool, NODE_COLOR);
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
    // Tick models that are currently active
    for (const node of scene.nodes) {
      (node.model as ClothModel).tick(renderer.device, now, scene.entropy * scene.chaosBoost, node.physics.vel);
    }
    renderer.frame(scene, camera, now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

main().catch(console.error);
