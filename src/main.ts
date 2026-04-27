import { Renderer }      from './renderer';
import { Camera }        from './camera';
import { Scene }         from './scene';
import { SphereModel }   from './models/SphereModel';
import { type GridConfig } from './grid';
import { ModelSpawner }  from './models/ModelSpawner';
import { EventBus }      from './events';
import { MidiOutput }    from './midi';
import { Console }       from './ui/Console';

type vec4 = [number, number, number, number];
const NODE_COLOR: vec4 = [0.72, 0.74, 0.78, 1.0];

function halfExtents(cfg: GridConfig): { halfW: number; halfH: number } {
  const halfH = cfg.cameraRadius * Math.tan(cfg.cameraFov / 2) * cfg.fillFactor;
  return { halfH, halfW: halfH * cfg.aspect };
}

function noteForX(x: number, baseNote: number, halfW: number): number {
  const semitone = Math.min(11, Math.floor(((x + halfW) / (2 * halfW)) * 12));
  return baseNote + semitone;
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

  const bus     = new EventBus();
  const midi    = new MidiOutput();
  const hud     = new Console();

  const scene   = new Scene();
  scene.setEventBus(bus);

  const { halfW, halfH } = halfExtents(gridCfg);
  const spawner = new ModelSpawner(renderer, scene, modelPool, NODE_COLOR);
  spawner.setEventBus(bus);
  spawner.updateExtent(halfW, halfH);

  await midi.init().catch(() => {});
  hud.setMidiOutputs(midi.outputs, midi.selectedId, id => midi.selectOutput(id));

  bus.on((event) => {
    let note: number;
    let x: number;
    if (event.type === 'node:spawn') {
      x = event.pos[0];
      note = noteForX(x, 60, spawner.halfW);
    } else if (event.type === 'node:connect') {
      x = (event.posA[0] + event.posB[0]) / 2;
      note = noteForX(x, 72, spawner.halfW);
    } else {
      x = event.pos[0];
      note = noteForX(x, 48, spawner.halfW);
    }
    midi.playNote(note);
    hud.logEvent(event, note);
  });

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
    hud.updateState(scene.nodes.length, scene.connections.length, scene.entropy);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

main().catch(console.error);
