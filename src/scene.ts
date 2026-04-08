import type { Node } from './node';
import { Connection, CONNECTION_RADIUS, FLOATS_PER_CONN } from './connection';
import { integratePhysics } from './physics';

const ENTROPY_RATE  = 0.00004; // per millisecond — entropy rises over ~33 s
const ENTROPY_MAX   = 1.0;
const ENTROPY_DECAY = 0.00001; // slow bleed; system never fully stabilizes

export class Scene {
  readonly nodes: Node[];
  connections: Connection[] = [];
  entropy = 0;

  constructor(nodes: Node[]) {
    this.nodes = nodes;
  }

  tick(dt: number, t: number): void {
    this.entropy = Math.min(ENTROPY_MAX, this.entropy + ENTROPY_RATE * dt);
    this.entropy = Math.max(0,           this.entropy - ENTROPY_DECAY * dt);

    for (const node of this.nodes) {
      integratePhysics(node.physics, dt, t, this.entropy);
    }

    this.buildConnections();
  }

  // Pack active connection geometry into scratch buffer; returns connection count.
  buildConnGeometry(scratch: Float32Array, t: number): number {
    let off = 0;
    for (const conn of this.connections) {
      conn.writeGeometry(scratch, off, this.entropy, t);
      off += FLOATS_PER_CONN;
    }
    return this.connections.length;
  }

  private buildConnections(): void {
    this.connections = [];
    const r2 = CONNECTION_RADIUS * CONNECTION_RADIUS;
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const pa = this.nodes[i].physics.pos;
        const pb = this.nodes[j].physics.pos;
        const dx = pa[0] - pb[0];
        const dy = pa[1] - pb[1];
        const dz = pa[2] - pb[2];
        if (dx*dx + dy*dy + dz*dz < r2) {
          this.connections.push(new Connection(this.nodes[i], this.nodes[j]));
        }
      }
    }
  }
}
