// SphereModel — wireframe sphere for node rendering.
// Latitude rings + longitude lines, edge-buffer only.

const RADIUS   = 1.8;
const LAT_SEGS = 10;
const LON_SEGS = 14;

export class SphereModel {
  edgeBuffer!: GPUBuffer;
  edgeCount!: number;

  private buildEdges(): Float32Array {
    const out: number[] = [];

    // Latitude rings (skip poles)
    for (let lat = 1; lat < LAT_SEGS; lat++) {
      const theta = (lat / LAT_SEGS) * Math.PI;
      const y = Math.cos(theta) * RADIUS;
      const r = Math.sin(theta) * RADIUS;
      for (let lon = 0; lon < LON_SEGS; lon++) {
        const a0 = (lon       / LON_SEGS) * Math.PI * 2;
        const a1 = ((lon + 1) / LON_SEGS) * Math.PI * 2;
        out.push(Math.cos(a0) * r, y, Math.sin(a0) * r);
        out.push(Math.cos(a1) * r, y, Math.sin(a1) * r);
      }
    }

    // Longitude lines
    for (let lon = 0; lon < LON_SEGS; lon++) {
      const phi = (lon / LON_SEGS) * Math.PI * 2;
      const cx = Math.cos(phi), cz = Math.sin(phi);
      for (let lat = 0; lat < LAT_SEGS; lat++) {
        const t0 = (lat       / LAT_SEGS) * Math.PI;
        const t1 = ((lat + 1) / LAT_SEGS) * Math.PI;
        out.push(Math.sin(t0) * cx * RADIUS, Math.cos(t0) * RADIUS, Math.sin(t0) * cz * RADIUS);
        out.push(Math.sin(t1) * cx * RADIUS, Math.cos(t1) * RADIUS, Math.sin(t1) * cz * RADIUS);
      }
    }

    return new Float32Array(out);
  }

  init(device: GPUDevice): void {
    const data = this.buildEdges();
    this.edgeCount = data.length / 6; // 2 × vec3 per segment
    this.edgeBuffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.edgeBuffer.getMappedRange()).set(data);
    this.edgeBuffer.unmap();
  }
}
