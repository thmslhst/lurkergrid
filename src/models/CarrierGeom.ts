// CarrierGeom — pure geometry data for CarrierModel. No GPU, no classes.
// Hull: 10-vertex compact irregular polyhedron — no preferred axis, no bilateral symmetry.
// Five filaments with distinct sway patterns and attachment points distributed across the hull.
import type { vec3 } from '../math';

// Compact irregular polyhedron — vertices distributed spheroidally with no vertical bias.
export const BODY: vec3[] = [
  [  0.00,  0.26,  0.10],  // 0
  [  0.28,  0.10, -0.14],  // 1
  [ -0.22,  0.14,  0.08],  // 2
  [  0.10,  0.12,  0.30],  // 3
  [  0.30, -0.06,  0.06],  // 4
  [ -0.26, -0.02,  0.18],  // 5
  [  0.04, -0.04, -0.26],  // 6
  [ -0.06, -0.20,  0.04],  // 7
  [  0.16, -0.24,  0.18],  // 8
  [ -0.12, -0.26, -0.08],  // 9
];

export const BODY_EDGES: [number, number][] = [
  [0,1],[0,2],[0,3],
  [1,2],[1,4],[1,6],[1,3],
  [2,3],[2,5],[2,7],
  [3,5],[3,8],
  [4,6],[4,8],
  [5,7],[5,9],
  [6,7],[6,9],
  [7,8],[7,9],
  [0,6],
];

export const BODY_FACES: [number, number, number][] = [
  [0,2,1],[0,3,2],              // upper cap
  [0,1,4],[1,6,4],              // right
  [0,2,5],[2,7,5],              // left
  [0,4,3],[3,5,0],              // front-upper
  [1,2,6],[2,9,6],              // back
  [4,7,6],[4,8,7],              // lower-right
  [5,7,9],[5,8,7],              // lower-left
  [8,9,7],                      // base
];

export type Filament = {
  base:       number;          // index into BODY
  joints:     vec3[];          // offsets from BODY[base] for each joint
  fork?:      [vec3, vec3];    // optional twin tips branching from last joint
  swayAxis:   vec3;
  swayAmp:    number;
  swaySpeed:  number;          // rad/ms
  swayPhase:  number;
};

export const FILAMENTS: Filament[] = [
  // Long trailing filament from v9 — slow lateral drift
  {
    base: 9,
    joints: [
      [-0.10, -0.22,  0.00],
      [-0.18, -0.46, -0.06],
      [-0.24, -0.70,  0.08],
      [-0.28, -0.90,  0.02],
    ],
    swayAxis: [1, 0, 0.3],  swayAmp: 0.065, swaySpeed: 0.00090, swayPhase: 0.0,
  },
  // Bifurcating filament from v4 — slow vertical oscillation
  {
    base: 4,
    joints: [
      [ 0.24, -0.04, -0.02],
      [ 0.48, -0.10, -0.06],
    ],
    fork: [[ 0.60, -0.04, -0.20], [ 0.58, -0.22,  0.06]],
    swayAxis: [0, 1, 0],  swayAmp: 0.040, swaySpeed: 0.00075, swayPhase: 1.0,
  },
  // Lateral filament from v5 — diagonal sway
  {
    base: 5,
    joints: [
      [-0.26,  0.02,  0.04],
      [-0.50, -0.04,  0.10],
    ],
    swayAxis: [0, 1, 0.5],  swayAmp: 0.050, swaySpeed: 0.00110, swayPhase: 2.2,
  },
  // Forward filament from v8 — ripples outward
  {
    base: 8,
    joints: [
      [ 0.04, -0.20,  0.22],
      [-0.04, -0.40,  0.36],
      [ 0.08, -0.58,  0.46],
    ],
    swayAxis: [1, 0, 0],  swayAmp: 0.070, swaySpeed: 0.00130, swayPhase: 4.1,
  },
  // Short bifurcating filament from v1 — fast nervous tremor
  {
    base: 1,
    joints: [[ 0.20,  0.22, -0.12]],
    fork: [[ 0.30,  0.36, -0.18], [ 0.22,  0.38, -0.02]],
    swayAxis: [0.5, 0, 1],  swayAmp: 0.025, swaySpeed: 0.00170, swayPhase: 0.8,
  },
];

export function seg(
  out: number[],
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): void {
  out.push(ax, ay, az, bx, by, bz);
}

export function fillFilamentEdges(t: number, out: number[], scale = 1.0): void {
  for (const fil of FILAMENTS) {
    const base = BODY[fil.base];
    const sway = Math.sin(t * fil.swaySpeed + fil.swayPhase);
    const n = fil.joints.length;
    const pts: vec3[] = [base];
    for (let j = 0; j < n; j++) {
      const rel = fil.joints[j];
      const frac = (j + 1) / n;
      const sw = sway * fil.swayAmp * frac;
      pts.push([
        base[0] + rel[0] * scale + fil.swayAxis[0] * sw,
        base[1] + rel[1] * scale + fil.swayAxis[1] * sw,
        base[2] + rel[2] * scale + fil.swayAxis[2] * sw,
      ]);
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      seg(out, a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    if (fil.fork) {
      const last = pts[pts.length - 1];
      const sw = sway * fil.swayAmp;
      for (const frel of fil.fork) {
        seg(out, last[0], last[1], last[2],
          base[0] + frel[0] * scale + fil.swayAxis[0] * sw,
          base[1] + frel[1] * scale + fil.swayAxis[1] * sw,
          base[2] + frel[2] * scale + fil.swayAxis[2] * sw,
        );
      }
    }
  }
}
