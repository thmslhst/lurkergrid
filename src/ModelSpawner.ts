// ModelSpawner — probabilistic progressive node loading.
// Each spawn slot is a ghost UI pinned to a world-space position showing
// a probability % and a draining time-bar. At expiry a die-roll decides
// whether the node materialises or the ghost simply vanishes.
import { mat4Multiply } from './math';
import type { Camera }       from './camera';
import type { Renderer }     from './renderer';
import type { Scene }        from './scene';
import { Node }              from './node';
import type { KaryoteModel } from './models/KaryoteModel';

export const MAX_NODES = 32;
const SPAWN_INTERVAL_MS  = 900;   // average ms between new slot attempts
const MIN_WINDOW_MS      = 1200;
const MAX_WINDOW_MS      = 4000;
const MIN_PROB           = 0.15;
const MAX_PROB           = 0.94;
const MAX_PENDING        = 5;     // concurrent pending slots
const FADE_IN_MS         = 550;
const FADE_OUT_MS        = 120;

interface SpawnSlot {
  worldPos: [number, number, number];
  probability: number;
  duration: number;
  elapsed: number;
  el:    HTMLElement;
  barEl: HTMLElement;
}

interface Fading {
  node:    Node;
  elapsed: number;
  total:   number;
  from:    number;  // starting alpha
  to:      number;  // target alpha
  onDone?: () => void;
}

export class ModelSpawner {
  private slots:   SpawnSlot[] = [];
  private fading:  Fading[]    = [];
  private timer    = 400;
  private seed     = 200;
  private halfW    = 8;
  private halfH    = 5;
  private overlay: HTMLElement;

  constructor(
    private canvas:    HTMLCanvasElement,
    private renderer:  Renderer,
    private scene:     Scene,
    private modelPool: KaryoteModel[],
    private nodeColor: [number, number, number, number],
  ) {
    this.overlay = document.getElementById('spawn-overlay') as HTMLElement;
  }

  updateExtent(halfW: number, halfH: number): void {
    this.halfW = halfW;
    this.halfH = halfH;
  }

  tick(dt: number, camera: Camera): void {
    this.tickFading(dt);
    this.tickSlots(dt, camera);
    this.timer -= dt;
    if (this.timer <= 0 && this.slots.length < MAX_PENDING) {
      this.timer = SPAWN_INTERVAL_MS * (0.5 + Math.random());
      this.createSlot();
    }
  }

  private tickFading(dt: number): void {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      f.elapsed += dt;
      const p = Math.min(1, f.elapsed / f.total);
      f.node.alphaScale = f.from + (f.to - f.from) * p;
      if (p >= 1) {
        f.node.alphaScale = f.to;
        f.onDone?.();
        this.fading.splice(i, 1);
      }
    }
  }

  private tickSlots(dt: number, camera: Camera): void {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const slot = this.slots[i];
      slot.elapsed += dt;
      const p = Math.min(1, slot.elapsed / slot.duration);
      slot.barEl.style.width = `${(1 - p) * 100}%`;
      this.projectSlot(slot, camera);
      if (p >= 1) {
        slot.el.remove();
        this.slots.splice(i, 1);
        if (Math.random() < slot.probability) this.spawnNode(slot.worldPos);
      }
    }
  }

  private createSlot(): void {
    const x = (Math.random() * 2 - 1) * this.halfW;
    const y = (Math.random() * 2 - 1) * this.halfH;
    const z = (Math.random() - 0.5) * 1.5;
    const prob     = MIN_PROB + Math.random() * (MAX_PROB - MIN_PROB);
    const duration = MIN_WINDOW_MS + Math.random() * (MAX_WINDOW_MS - MIN_WINDOW_MS);

    const el    = document.createElement('div');
    el.className = 'spawn-slot';
    const ctr   = document.createElement('div');
    ctr.className = 'spawn-corner-tr';
    const cbl   = document.createElement('div');
    cbl.className = 'spawn-corner-bl';
    const inner = document.createElement('div');
    inner.className = 'spawn-inner';
    const probEl  = document.createElement('div');
    probEl.className = 'spawn-prob';
    probEl.textContent = `${Math.round(prob * 100)}%`;
    const track   = document.createElement('div');
    track.className = 'spawn-bar-track';
    const barEl   = document.createElement('div');
    barEl.className = 'spawn-bar';
    barEl.style.width = '100%';
    track.appendChild(barEl);
    inner.appendChild(probEl);
    inner.appendChild(track);
    el.appendChild(ctr); el.appendChild(cbl); el.appendChild(inner);
    this.overlay.appendChild(el);

    this.slots.push({ worldPos: [x, y, z], probability: prob, duration, elapsed: 0, el, barEl });
  }

  private projectSlot(slot: SpawnSlot, camera: Camera): void {
    const vp = mat4Multiply(camera.projMatrix(), camera.viewMatrix());
    const [wx, wy, wz] = slot.worldPos;
    const cx = vp[0]*wx + vp[4]*wy + vp[8]*wz  + vp[12];
    const cy = vp[1]*wx + vp[5]*wy + vp[9]*wz  + vp[13];
    const cw = vp[3]*wx + vp[7]*wy + vp[11]*wz + vp[15];
    if (cw < 0.001) { slot.el.style.display = 'none'; return; }
    slot.el.style.display = '';
    const sx = (cx / cw * 0.5 + 0.5) * this.canvas.width;
    const sy = (1 - (cy / cw * 0.5 + 0.5)) * this.canvas.height;
    slot.el.style.left = `${sx}px`;
    slot.el.style.top  = `${sy}px`;
  }

  private spawnNode(worldPos: [number, number, number]): void {
    // Evict oldest node if at capacity
    if (this.scene.nodes.length >= MAX_NODES) {
      const victim = this.scene.nodes[0];
      this.scene.triggerDeleteChaos(victim.physics.pos);
      this.fading.push({
        node: victim, elapsed: 0, total: FADE_OUT_MS, from: 1, to: 0,
        onDone: () => this.scene.removeNode(victim),
      });
    }

    const model = this.modelPool[this.seed % this.modelPool.length];
    const node  = new Node(model, worldPos, [...this.nodeColor] as [number,number,number,number], this.seed * 1.7);
    this.seed++;
    node.init(this.renderer.device, this.renderer.nodeBindGroupLayout);
    node.alphaScale = 0;
    this.scene.addNode(node);
    this.scene.triggerSpawnChaos(worldPos);
    this.fading.push({ node, elapsed: 0, total: FADE_IN_MS, from: 0, to: 1 });
  }
}
