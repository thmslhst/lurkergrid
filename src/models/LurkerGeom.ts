// LurkerGeom — pure geometry data for LurkerModel. No GPU, no classes.
// Body: 11-vertex irregular hull. Five asymmetric appendages with per-limb sway.
import type { vec3 } from '../math';

// Irregular elongated hull — intentionally asymmetric, no bilateral symmetry.
export const BODY: vec3[] = [
  [  0.00,  0.48,  0.02],  // 0  crown
  [  0.22,  0.24, -0.06],  // 1  upper-R (slightly back)
  [ -0.16,  0.22,  0.13],  // 2  upper-L (slightly forward)
  [  0.06,  0.20,  0.24],  // 3  upper-F
  [  0.20,  0.00,  0.06],  // 4  mid-R
  [ -0.22, -0.03,  0.09],  // 5  mid-L
  [  0.04, -0.06,  0.22],  // 6  mid-F
  [ -0.03, -0.04, -0.18],  // 7  mid-B
  [  0.14, -0.30,  0.03],  // 8  low-R
  [ -0.12, -0.32, -0.02],  // 9  low-L
  [  0.02, -0.28,  0.17],  // 10 low-F
];

export const BODY_EDGES: [number, number][] = [
  [0,1],[0,2],[0,3],             // crown
  [1,2],[2,3],[1,3],             // upper ring
  [1,4],[2,5],[3,6],[1,7],[2,7], // upper → mid
  [4,5],[5,6],[4,6],[5,7],[4,7], // mid ring
  [4,8],[5,9],[6,10],[7,9],      // mid → low
  [8,9],[9,10],[8,10],           // lower ring
];

// Hull faces — roughly covers the outer surface, intentionally uneven.
export const BODY_FACES: [number, number, number][] = [
  [0,2,1],[0,3,2],               // top cap
  [1,3,4],[3,6,4],               // upper-front-right
  [2,3,6],[2,6,5],               // upper-front-left
  [1,2,7],[2,5,7],               // back upper
  [4,6,10],[4,10,8],             // right-front lower
  [5,6,10],[5,10,9],             // left-front lower
  [4,8,7],[8,9,7],               // right-back lower
  [5,7,9],                       // back lower
  [8,10,9],                      // bottom cap
];

export type Limb = {
  base:       number;          // index into BODY
  joints:     vec3[];          // offsets from BODY[base] for each joint
  fork?:      [vec3, vec3];    // optional twin tips branching from last joint
  swayAxis:   vec3;
  swayAmp:    number;
  swaySpeed:  number;          // rad/ms
  swayPhase:  number;
};

export const LIMBS: Limb[] = [
  // Long trailing tendril from low-L (v9) — slow side-sway
  {
    base: 9,
    joints: [
      [-0.10, -0.28,  0.01],
      [-0.19, -0.58, -0.04],
      [-0.25, -0.88,  0.06],
      [-0.29, -1.14,  0.01],
    ],
    swayAxis: [1, 0, 0.3],  swayAmp: 0.065, swaySpeed: 0.00090, swayPhase: 0.0,
  },
  // Forked right arm from mid-R (v4) — gentle up-down
  {
    base: 4,
    joints: [
      [ 0.24, -0.04, -0.02],
      [ 0.48, -0.10, -0.06],
    ],
    fork: [[ 0.60, -0.04, -0.18], [ 0.58, -0.24,  0.04]],
    swayAxis: [0, 1, 0],  swayAmp: 0.040, swaySpeed: 0.00075, swayPhase: 1.0,
  },
  // Medium left arm from mid-L (v5) — slightly faster, diagonal sway
  {
    base: 5,
    joints: [
      [-0.26,  0.02,  0.04],
      [-0.50, -0.05,  0.10],
    ],
    swayAxis: [0, 1, 0.5],  swayAmp: 0.050, swaySpeed: 0.00110, swayPhase: 2.2,
  },
  // Forward tendril from low-F (v10) — ripples forward
  {
    base: 10,
    joints: [
      [ 0.04, -0.22,  0.20],
      [-0.05, -0.44,  0.36],
      [ 0.09, -0.62,  0.46],
    ],
    swayAxis: [1, 0, 0],  swayAmp: 0.070, swaySpeed: 0.00130, swayPhase: 4.1,
  },
  // Short forked protrusion from upper-R (v1) — nervous tremor
  {
    base: 1,
    joints: [[ 0.20,  0.26, -0.10]],
    fork: [[ 0.30,  0.38, -0.16], [ 0.22,  0.40, -0.02]],
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

export function fillLimbEdges(t: number, out: number[]): void {
  for (const limb of LIMBS) {
    const base = BODY[limb.base];
    const sway = Math.sin(t * limb.swaySpeed + limb.swayPhase);
    const n = limb.joints.length;
    // Build joint world positions; tip joints sway more than joints near the base.
    const pts: vec3[] = [base];
    for (let j = 0; j < n; j++) {
      const rel = limb.joints[j];
      const frac = (j + 1) / n;
      const sw = sway * limb.swayAmp * frac;
      pts.push([
        base[0] + rel[0] + limb.swayAxis[0] * sw,
        base[1] + rel[1] + limb.swayAxis[1] * sw,
        base[2] + rel[2] + limb.swayAxis[2] * sw,
      ]);
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      seg(out, a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    if (limb.fork) {
      const last = pts[pts.length - 1];
      const sw = sway * limb.swayAmp;
      for (const frel of limb.fork) {
        seg(out, last[0], last[1], last[2],
          base[0] + frel[0] + limb.swayAxis[0] * sw,
          base[1] + frel[1] + limb.swayAxis[1] * sw,
          base[2] + frel[2] + limb.swayAxis[2] * sw,
        );
      }
    }
  }
}
