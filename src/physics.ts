import { quatIdentity, type vec3, type quat } from './math';

export const FLOAT_AMP = 0.35;
export const SPRING    = 0.06;
export const DAMPING   = 0.80;

export interface PhysicsState {
  pos:    vec3;
  vel:    vec3;
  home:   vec3;
  rot:    quat;
  angVel: vec3;
  seed:   number;
}

export function makePhysicsState(home: vec3, seed: number): PhysicsState {
  return {
    pos:    [home[0], home[1], home[2]],
    vel:    [0, 0, 0],
    home:   [home[0], home[1], home[2]],
    rot:    quatIdentity(),
    angVel: [
      (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 1.2,
    ],
    seed,
  };
}

export function integratePhysics(state: PhysicsState, dt: number, t: number, entropy: number): void {
  const dtS = dt * 0.001;
  const ts  = t  * 0.001;
  const s   = state.seed;
  const amp = FLOAT_AMP * (1 + entropy * 0.8);

  // Sinusoidal drift: oscillate the spring target so nodes float with amplitude ~amp
  const tx = state.home[0] + Math.sin(ts * 0.7  + s)       * amp;
  const ty = state.home[1] + Math.sin(ts * 0.5  + s + 1.1) * amp;
  const tz = state.home[2] + Math.sin(ts * 0.9  + s + 2.2) * amp;

  // Spring toward drifting target
  state.vel[0] += (tx - state.pos[0]) * SPRING * dtS;
  state.vel[1] += (ty - state.pos[1]) * SPRING * dtS;
  state.vel[2] += (tz - state.pos[2]) * SPRING * dtS;

  // Exponential damping
  const damp = Math.pow(DAMPING, dtS);
  state.vel[0] *= damp;
  state.vel[1] *= damp;
  state.vel[2] *= damp;

  // Integrate position
  state.pos[0] += state.vel[0] * dtS;
  state.pos[1] += state.vel[1] * dtS;
  state.pos[2] += state.vel[2] * dtS;

  // Rotation disabled
}
