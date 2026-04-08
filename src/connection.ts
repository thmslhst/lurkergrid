import type { Node } from './node';

export const CONNECTION_RADIUS = 8.0;

// 12 line segments per connection → 24 vertices (line-list) × 5 floats (xyz + uv)
const SEGMENTS = 12;
export const VERTS_PER_CONN  = SEGMENTS * 2;
export const FLOATS_PER_CONN = VERTS_PER_CONN * 5;

export class Connection {
  readonly a: Node;
  readonly b: Node;
  readonly seed: number;

  constructor(a: Node, b: Node) {
    this.a    = a;
    this.b    = b;
    this.seed = a.physics.seed * 3.141 + b.physics.seed * 1.618;
  }

  // Writes FLOATS_PER_CONN floats into buf starting at offset.
  // t = elapsed time in ms.
  writeGeometry(buf: Float32Array, offset: number, entropy: number, t: number): void {
    const pa = this.a.physics.pos;
    const pb = this.b.physics.pos;

    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2];
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    const ndx = dx/len, ndy = dy/len, ndz = dz/len;

    // Per-connection perpendicular axis for the bending plane (seeded, stable)
    const s = this.seed;
    let ax = Math.sin(s * 3.7), ay = Math.cos(s * 2.1), az = Math.sin(s * 1.4 + 1.0);
    let px = ndy*az - ndz*ay, py = ndz*ax - ndx*az, pz = ndx*ay - ndy*ax;
    let plen = Math.sqrt(px*px + py*py + pz*pz);
    if (plen < 0.01) { // near-parallel fallback
      ax = Math.cos(s * 5.1); ay = Math.sin(s * 0.9 + 2.0); az = Math.cos(s * 3.3);
      px = ndy*az - ndz*ay; py = ndz*ax - ndx*az; pz = ndx*ay - ndy*ax;
      plen = Math.sqrt(px*px + py*py + pz*pz) || 1;
    }
    px /= plen; py /= plen; pz /= plen;

    // Second perpendicular: gives 2-axis bending so curves can spiral slightly
    let qx = ndy*pz - ndz*py, qy = ndz*px - ndx*pz, qz = ndx*py - ndy*px;
    const qlen = Math.sqrt(qx*qx + qy*qy + qz*qz) || 1;
    qx /= qlen; qy /= qlen; qz /= qlen;

    // Animated control points — organic slow drift
    const bendAmp = len * 0.28 * (1 + entropy * 0.7);
    const freq     = 0.0007; // rad/ms — very slow
    const phase1   = t * freq + s;
    const phase2   = t * freq * 1.13 + s * 1.7 + 1.2;

    const o1p = Math.sin(phase1) * bendAmp;
    const o1q = Math.cos(phase1 * 0.8 + s * 2.3) * bendAmp * 0.4;
    const o2p = Math.cos(phase2) * bendAmp;
    const o2q = Math.sin(phase2 * 0.9 + s * 1.1) * bendAmp * 0.4;

    // Cubic Bézier control points
    const p0x = pa[0], p0y = pa[1], p0z = pa[2];
    const p1x = pa[0] + dx*0.33 + px*o1p + qx*o1q;
    const p1y = pa[1] + dy*0.33 + py*o1p + qy*o1q;
    const p1z = pa[2] + dz*0.33 + pz*o1p + qz*o1q;
    const p2x = pa[0] + dx*0.67 + px*o2p + qx*o2q;
    const p2y = pa[1] + dy*0.67 + py*o2p + qy*o2q;
    const p2z = pa[2] + dz*0.67 + pz*o2p + qz*o2q;
    const p3x = pb[0], p3y = pb[1], p3z = pb[2];

    // UV: u scrolls slowly with time (organic drift), tiles along the connection
    //     v varies per connection to sample a different horizontal band of the texture
    const uScroll = t * 0.00018 + s * 0.15;
    const vBand   = 0.25 + (Math.sin(s * 7.3) * 0.5 + 0.5) * 0.5; // 0.25 → 0.75

    const computeVertex = (curveT: number): [number, number, number, number, number] => {
      const mu = 1 - curveT;
      const ca = mu*mu*mu, cb = 3*mu*mu*curveT, cc = 3*mu*curveT*curveT, cd = curveT*curveT*curveT;
      const x = ca*p0x + cb*p1x + cc*p2x + cd*p3x;
      const y = ca*p0y + cb*p1y + cc*p2y + cd*p3y;
      const z = ca*p0z + cb*p1z + cc*p2z + cd*p3z;
      const texU = curveT * 2.5 + uScroll;
      const texV = vBand + Math.sin(curveT * Math.PI * 2 + s) * 0.08;
      return [x, y, z, texU, texV];
    };

    // Walk the curve keeping previous sample to form line-list segments
    let prev = computeVertex(0);

    for (let i = 1; i <= SEGMENTS; i++) {
      const cur = computeVertex(i / SEGMENTS);
      const o = offset + (i - 1) * 10; // 2 verts × 5 floats = 10 floats per segment
      buf[o+0] = prev[0]; buf[o+1] = prev[1]; buf[o+2] = prev[2];
      buf[o+3] = prev[3]; buf[o+4] = prev[4];
      buf[o+5] = cur[0];  buf[o+6] = cur[1];  buf[o+7] = cur[2];
      buf[o+8] = cur[3];  buf[o+9] = cur[4];
      prev = cur;
    }
  }
}
