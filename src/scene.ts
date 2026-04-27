import type { Node } from './node';
import { Connection, CONNECTION_RADIUS, FLOATS_PER_CONN } from './connection';
import { integratePhysics } from './physics';
import type { vec3 } from './math';
import type { EventBus } from './events';

const ENTROPY_RATE  = 0.00001;
const ENTROPY_MAX   = 1.0;
const ENTROPY_DECAY = 0.00004;

export class Scene {
  nodes: Node[] = [];
  connections: Connection[] = [];
  entropy = 0.0;

  private prevConnKeys = new Set<string>();
  private connFlashMap = new Map<string, number>();
  private collisionDebounce = new Map<string, number>();
  private bus: EventBus | null = null;

  // Wind: velocity force applied to all nodes each frame, decays exponentially
  windForce: vec3 = [0, 0, 0];
  // chaosBoost: extra multiplier for entropy-driven effects (filaments, float) — decays → 1
  chaosBoost = 1.0;

  private readonly windDecay  = 0.0018; // exp decay rate per ms
  private readonly chaosDecay = 0.0010;

  setEventBus(bus: EventBus): void { this.bus = bus; }

  addNode(node: Node): void {
    this.nodes.push(node);
  }

  removeNode(node: Node): void {
    const i = this.nodes.indexOf(node);
    if (i >= 0) this.nodes.splice(i, 1);
  }

  /** Radial impulse outward from spawnPos + entropy + wind burst. */
  triggerSpawnChaos(spawnPos: vec3): void {
    this.entropy    = Math.min(ENTROPY_MAX, this.entropy + 0.38);
    this.chaosBoost = Math.max(this.chaosBoost, 3.8);
    this.windForce  = [
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 2.5,
    ];
    for (const node of this.nodes) {
      const dx = node.physics.pos[0] - spawnPos[0];
      const dy = node.physics.pos[1] - spawnPos[1];
      const dz = node.physics.pos[2] - spawnPos[2];
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
      const imp  = 1.8 / (dist * 0.6 + 1);
      node.physics.vel[0] += (dx / dist) * imp;
      node.physics.vel[1] += (dy / dist) * imp;
      node.physics.vel[2] += (dz / dist) * imp;
    }
  }

  /** Implosion pull toward deletePos + stronger entropy + wind burst. */
  triggerDeleteChaos(deletePos: vec3): void {
    this.entropy    = Math.min(ENTROPY_MAX, this.entropy + 0.55);
    this.chaosBoost = Math.max(this.chaosBoost, 5.5);
    this.windForce  = [
      (Math.random() - 0.5) * 9,
      (Math.random() - 0.5) * 9,
      (Math.random() - 0.5) * 4,
    ];
    for (const node of this.nodes) {
      const dx = deletePos[0] - node.physics.pos[0];
      const dy = deletePos[1] - node.physics.pos[1];
      const dz = deletePos[2] - node.physics.pos[2];
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
      const imp  = 2.8 / (dist * 0.4 + 1);
      node.physics.vel[0] += (dx / dist) * imp;
      node.physics.vel[1] += (dy / dist) * imp;
      node.physics.vel[2] += (dz / dist) * imp;
    }
  }

  tick(dt: number, t: number): void {
    this.entropy = Math.min(ENTROPY_MAX, this.entropy + ENTROPY_RATE * dt);
    this.entropy = Math.max(0,           this.entropy - ENTROPY_DECAY * dt);

    const wdec = Math.exp(-this.windDecay  * dt);
    const cdec = Math.exp(-this.chaosDecay * dt);
    this.windForce[0] *= wdec;
    this.windForce[1] *= wdec;
    this.windForce[2] *= wdec;
    this.chaosBoost = 1 + Math.max(0, this.chaosBoost - 1) * cdec;

    for (const node of this.nodes) {
      integratePhysics(node.physics, dt, t, this.entropy, this.windForce);
    }
    this.detectCollisions(t);
    this.buildConnections(t);
  }

  buildConnGeometry(scratch: Float32Array, t: number): number {
    const maxConn = Math.floor(scratch.length / FLOATS_PER_CONN);
    let off = 0;
    let count = 0;
    for (const conn of this.connections) {
      if (count >= maxConn) break;
      conn.writeGeometry(scratch, off, this.entropy, t);
      off += FLOATS_PER_CONN;
      count++;
    }
    return count;
  }

  private detectCollisions(t: number): void {
    const THRESHOLD2 = 0.3 * 0.3;
    const DEBOUNCE   = 500;
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const pa = this.nodes[i].physics.pos;
        const pb = this.nodes[j].physics.pos;
        const dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2];
        if (dx*dx + dy*dy + dz*dz < THRESHOLD2) {
          const key = `${this.nodes[i].physics.seed}_${this.nodes[j].physics.seed}`;
          const last = this.collisionDebounce.get(key) ?? -Infinity;
          if (t - last >= DEBOUNCE) {
            this.collisionDebounce.set(key, t);
            const ni = this.nodes[i], nj = this.nodes[j];
            ni.isCollideFlashing = true;
            nj.isCollideFlashing = true;
            setTimeout(() => { ni.isCollideFlashing = false; nj.isCollideFlashing = false; }, 300);
            this.bus?.emit({
              type: 'node:collide',
              pos: [(pa[0]+pb[0])/2, (pa[1]+pb[1])/2, (pa[2]+pb[2])/2],
              nodeId: this.nodes[i].physics.seed,
              t,
            });
          }
        }
      }
    }
  }

  private buildConnections(t: number): void {
    // Reset connection counts
    for (const node of this.nodes) node.connectionCount = 0;

    // Clean up expired flash entries
    for (const [key, expiry] of this.connFlashMap) {
      if (t >= expiry) this.connFlashMap.delete(key);
    }

    this.connections = [];
    const r2 = CONNECTION_RADIUS * CONNECTION_RADIUS;
    const currKeys = new Set<string>();

    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const pa = this.nodes[i].physics.pos;
        const pb = this.nodes[j].physics.pos;
        const dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2];
        if (dx*dx + dy*dy + dz*dz < r2) {
          const key = `${this.nodes[i].physics.seed}_${this.nodes[j].physics.seed}`;
          currKeys.add(key);

          if (!this.prevConnKeys.has(key)) {
            this.connFlashMap.set(key, t + 100);
            this.bus?.emit({
              type: 'node:connect',
              posA: [pa[0], pa[1], pa[2]],
              posB: [pb[0], pb[1], pb[2]],
              t,
            });
          }

          const conn = new Connection(this.nodes[i], this.nodes[j]);
          if (this.connFlashMap.has(key)) conn.flash = 1;
          this.connections.push(conn);
          this.nodes[i].connectionCount++;
          this.nodes[j].connectionCount++;
        }
      }
    }

    this.prevConnKeys = currKeys;
  }
}
