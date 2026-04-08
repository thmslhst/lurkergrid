// Grid layout — derives world-space cell positions from camera/viewport parameters.
// The visible world-space extent at z=0 is computed from the camera's vertical FOV,
// orbital radius, and canvas aspect ratio. Node home positions snap to cell centres.
import { PlaneModel } from './models/PlaneModel';
import type { vec3 } from './math';

export interface GridConfig {
  cols:         number;
  rows:         number;
  aspect:       number;  // canvas width / height
  cameraFov:    number;  // vertical fov in radians
  cameraRadius: number;  // distance from origin to camera eye
  fillFactor:   number;  // 0..1 — fraction of visible height the grid occupies
}

// ── internal ────────────────────────────────────────────────────────────────

function extent(cfg: GridConfig): { halfW: number; halfH: number; stepX: number; stepY: number } {
  // Visible half-height at the scene origin plane, from the camera's perspective.
  const halfH = cfg.cameraRadius * Math.tan(cfg.cameraFov / 2) * cfg.fillFactor;
  const halfW = halfH * cfg.aspect;
  return {
    halfH,
    halfW,
    stepX: (halfW * 2) / cfg.cols,
    stepY: (halfH * 2) / cfg.rows,
  };
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Returns (cols × rows) world-space positions — one per lurker node —
 * distributed as a uniform grid centred on the origin at z = 0.
 * Row-major order: left-to-right, bottom-to-top.
 */
export function gridHomePositions(cfg: GridConfig): vec3[] {
  const { stepX, stepY } = extent(cfg);
  const out: vec3[] = [];
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      out.push([
        (c - (cfg.cols  - 1) / 2) * stepX,
        (r - (cfg.rows  - 1) / 2) * stepY,
        0,
      ]);
    }
  }
  return out;
}

/**
 * PlaneModel subclass that produces the grid line geometry.
 * Lines lie in the z = 0 plane, matching the node home-position layout exactly.
 * Call reinit() after a viewport resize to rebuild the GPU buffer.
 */
export class GridModel extends PlaneModel {
  private cfg: GridConfig;

  constructor(cfg: GridConfig) {
    super();
    this.cfg = cfg;
  }

  updateConfig(cfg: GridConfig): void {
    this.cfg = cfg;
  }

  buildEdges(): Float32Array {
    const { halfW, halfH, stepX, stepY } = extent(this.cfg);
    const { cols, rows } = this.cfg;
    const verts: number[] = [];

    // Horizontal lines — (rows + 1) lines along the x axis
    for (let r = 0; r <= rows; r++) {
      const y = -halfH + r * stepY;
      verts.push(-halfW, y, 0,  halfW, y, 0);
    }
    // Vertical lines — (cols + 1) lines along the y axis
    for (let c = 0; c <= cols; c++) {
      const x = -halfW + c * stepX;
      verts.push(x, -halfH, 0,  x, halfH, 0);
    }
    return new Float32Array(verts);
  }

  /** Destroy the old GPU buffer and rebuild from current config. */
  reinit(device: GPUDevice): void {
    this.edgeBuffer?.destroy();
    this.init(device);
  }
}
