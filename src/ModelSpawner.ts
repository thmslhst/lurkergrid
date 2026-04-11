// ModelSpawner — probabilistic progressive node loading.
import type { Camera }      from './camera';
import type { Renderer }    from './renderer';
import type { Scene }       from './scene';
import { Node }             from './node';
import type { SphereModel } from './models/SphereModel';

export const MAX_NODES = 32;
const SPAWN_INTERVAL_MS = 900;
const MIN_WINDOW_MS     = 1200;
const MAX_WINDOW_MS     = 4000;
const MIN_PROB          = 0.15;
const MAX_PROB          = 0.94;
const FADE_OUT_MS       = 120;

interface Fading {
  node:    Node;
  elapsed: number;
  total:   number;
  from:    number;
  to:      number;
  onDone?: () => void;
}

export class ModelSpawner {
  private fading: Fading[] = [];
  private timer   = 400;
  private seed    = 200;
  private halfW   = 8;
  private halfH   = 5;

  constructor(
    private renderer:  Renderer,
    private scene:     Scene,
    private modelPool: SphereModel[],
    private nodeColor: [number, number, number, number],
  ) {}

  updateExtent(halfW: number, halfH: number): void {
    this.halfW = halfW;
    this.halfH = halfH;
  }

  tick(dt: number, _camera: Camera): void {
    this.tickFading(dt);

    // Fill up to MAX_NODES immediately before switching to the timed behaviour.
    if (this.scene.nodes.length < MAX_NODES) {
      const x = (Math.random() * 2 - 1) * this.halfW;
      const y = (Math.random() * 2 - 1) * this.halfH;
      const z = (Math.random() - 0.5) * 1.5;
      this.spawnNode([x, y, z]);
      return;
    }

    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = SPAWN_INTERVAL_MS * (0.5 + Math.random());
      const prob     = MIN_PROB + Math.random() * (MAX_PROB - MIN_PROB);
      const duration = MIN_WINDOW_MS + Math.random() * (MAX_WINDOW_MS - MIN_WINDOW_MS);
      setTimeout(() => {
        if (Math.random() < prob) {
          const x = (Math.random() * 2 - 1) * this.halfW;
          const y = (Math.random() * 2 - 1) * this.halfH;
          const z = (Math.random() - 0.5) * 1.5;
          this.spawnNode([x, y, z]);
        }
      }, duration);
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

  private spawnNode(worldPos: [number, number, number]): void {
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
    node.isSpawnFlashing = true;
    setTimeout(() => { node.isSpawnFlashing = false; }, 100);
    this.scene.addNode(node);
    this.scene.triggerSpawnChaos(worldPos);
  }
}
