// LurkerLimbFaces — crystal prism face geometry for LurkerModel appendages.
// Per-instance variation driven by seed: proportions, cross-section shape, twist rate.
import type { vec3 } from '../math';
import { BODY, LIMBS } from './LurkerGeom';

export type LimbVariation = {
  scale:      number;                           // limb joint offset multiplier
  baseR:      number;                           // crystal radius at body junction
  tipR:       number;                           // radius at tip
  angOffsets: [number, number, number, number]; // per-face ring angle offsets
  radScales:  [number, number, number, number]; // per-face radius multipliers
  twistRate:  number;                           // radians of twist added per segment
};

const BASE_ANGS: [number,number,number,number] = [0, 1.05, Math.PI, Math.PI+0.92];
const BASE_RADS: [number,number,number,number] = [1.0, 0.62, 1.0, 0.68];

function prng(seed: number): () => number {
  let x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return () => { x = Math.sin(x) * 43758.5453; return x - Math.floor(x); };
}

export function makeLimbVariation(seed: number): LimbVariation {
  const r = prng(seed);
  return {
    scale:      0.90 + r() * 0.55,
    baseR:      0.12 + r() * 0.10,
    tipR:       0.010 + r() * 0.015,
    angOffsets: [r()*0.5-0.25, r()*0.5-0.25, r()*0.5-0.25, r()*0.5-0.25],
    radScales:  BASE_RADS.map(v => Math.max(0.2, v + (r()-0.5)*0.30)) as [number,number,number,number],
    twistRate:  0.13 + r() * 0.20,
  };
}

function n3(v: vec3): vec3 { const l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); return l<1e-9?[0,1,0]:[v[0]/l,v[1]/l,v[2]/l]; }
function cx(a: vec3, b: vec3): vec3 { return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }

function ring4(c: vec3, fwd: vec3, r: number, tw: number, v: LimbVariation): vec3[] {
  const up: vec3 = Math.abs(fwd[1]) < 0.85 ? [0,1,0] : [1,0,0];
  const rx = n3(cx(fwd, up)), ry = n3(cx(rx, fwd));
  return BASE_ANGS.map((a, i) => {
    const θ = a + v.angOffsets[i] + tw, rr = r * v.radScales[i];
    return [c[0]+rr*(Math.cos(θ)*rx[0]+Math.sin(θ)*ry[0]),
            c[1]+rr*(Math.cos(θ)*rx[1]+Math.sin(θ)*ry[1]),
            c[2]+rr*(Math.cos(θ)*rx[2]+Math.sin(θ)*ry[2])] as vec3;
  });
}

function pt(o:number[], a:vec3,ua:number,va:number, b:vec3,ub:number,vb:number, c:vec3,uc:number,vc:number): void {
  o.push(a[0],a[1],a[2],ua,va, b[0],b[1],b[2],ub,vb, c[0],c[1],c[2],uc,vc);
}

function crystalSeg(A:vec3, B:vec3, rA:number, rB:number, uA:number, uB:number, tw:number, v:LimbVariation, o:number[]): void {
  const fwd = n3([B[0]-A[0], B[1]-A[1], B[2]-A[2]] as vec3);
  const rA4 = ring4(A, fwd, rA, tw, v), rB4 = ring4(B, fwd, rB, tw+v.twistRate, v);
  for (let i = 0; i < 4; i++) {
    const a=rA4[i], b=rA4[(i+1)%4], v0=i/4, v1=(i+1)/4;
    if (rB < 0.001) { pt(o, a,uA,v0, b,uA,v1, B,uB,(v0+v1)*0.5); }
    else { const c=rB4[i], d=rB4[(i+1)%4];
      pt(o, a,uA,v0, b,uA,v1, c,uB,v0);
      pt(o, b,uA,v1, d,uB,v1, c,uB,v0); }
  }
}

export function fillLimbFaces(t: number, out: number[], v: LimbVariation): void {
  for (const limb of LIMBS) {
    const base=BODY[limb.base], sw=Math.sin(t*limb.swaySpeed+limb.swayPhase), n=limb.joints.length;
    const pts: vec3[] = [base];
    for (let j = 0; j < n; j++) {
      const rel=limb.joints[j], frac=(j+1)/n, s=sw*limb.swayAmp*frac;
      pts.push([
        base[0]+rel[0]*v.scale+limb.swayAxis[0]*s,
        base[1]+rel[1]*v.scale+limb.swayAxis[1]*s,
        base[2]+rel[2]*v.scale+limb.swayAxis[2]*s,
      ]);
    }
    const L=pts.length; let tw=0;
    for (let i = 0; i < L-1; i++) {
      const t0=i/(L-1||1), t1=(i+1)/(L-1||1);
      const rA=v.baseR*(1-t0)+v.tipR*t0, isLast=i===L-2&&!limb.fork;
      crystalSeg(pts[i], pts[i+1], rA, isLast?0:v.baseR*(1-t1)+v.tipR*t1, t0, t1, tw, v, out);
      tw += v.twistRate;
    }
    if (limb.fork) {
      const last=pts[L-1], s=sw*limb.swayAmp;
      for (const fr of limb.fork) {
        const tip: vec3 = [
          base[0]+fr[0]*v.scale+limb.swayAxis[0]*s,
          base[1]+fr[1]*v.scale+limb.swayAxis[1]*s,
          base[2]+fr[2]*v.scale+limb.swayAxis[2]*s,
        ];
        crystalSeg(last, tip, v.tipR*2.4, 0, 0.85, 1.0, tw, v, out);
        tw += 0.35;
      }
    }
  }
}
