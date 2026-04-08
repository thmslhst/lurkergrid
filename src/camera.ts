import { perspectiveMatrix, lookAtMatrix, type vec3, type mat4 } from './math';

const ORBIT_SPEED = 0.0003; // radians per ms — one full revolution ≈ 21 s

export class Camera {
  private fov: number;
  private aspect: number;
  private near: number;
  private far: number;
  private radius: number;
  private azimuth: number;
  private elevation: number;

  constructor(aspect: number) {
    this.fov       = Math.PI / 3; // 60°
    this.aspect    = aspect;
    this.near      = 0.1;
    this.far       = 100;
    this.radius    = 14;
    this.azimuth   = 0;
    this.elevation = 0.4;
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
  }

  tick(_dt: number): void {
    // no auto-orbit
  }

  private eye(): vec3 {
    const { radius, azimuth, elevation } = this;
    return [
      radius * Math.cos(elevation) * Math.sin(azimuth),
      radius * Math.sin(elevation),
      radius * Math.cos(elevation) * Math.cos(azimuth),
    ];
  }

  viewMatrix(): mat4 {
    return lookAtMatrix(this.eye(), [0, 0, 0], [0, 1, 0]);
  }

  projMatrix(): mat4 {
    return perspectiveMatrix(this.fov, this.aspect, this.near, this.far);
  }
}
