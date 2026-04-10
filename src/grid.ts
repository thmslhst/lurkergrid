// Grid layout — derives world-space cell positions from camera/viewport parameters.
// The visible world-space extent at z=0 is computed from the camera's vertical FOV,
// orbital radius, and canvas aspect ratio. Node home positions snap to cell centres.
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
 * Returns (cols × rows) world-space positions — one per carrier node —
 * distributed as a jittered grid centred on the origin at z = 0.
 * `jitterFactor` shifts each cell centre by up to that fraction of the cell size.
 * Row-major order: left-to-right, bottom-to-top.
 */
export function gridHomePositions(cfg: GridConfig, jitterFactor = 0): vec3[] {
  const { stepX, stepY } = extent(cfg);
  const out: vec3[] = [];
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      const jx = jitterFactor > 0 ? (Math.random() - 0.5) * stepX * jitterFactor : 0;
      const jy = jitterFactor > 0 ? (Math.random() - 0.5) * stepY * jitterFactor : 0;
      out.push([
        (c - (cfg.cols  - 1) / 2) * stepX + jx,
        (r - (cfg.rows  - 1) / 2) * stepY + jy,
        0,
      ]);
    }
  }
  return out;
}

