// SphereModel — solid shaded sphere for node rendering.
// UV sphere: positions + normals interleaved, triangle-list topology.

const RADIUS   = 0.2;
const LAT_SEGS = 10;
const LON_SEGS = 14;

export class SphereModel {
  vertexBuffer!: GPUBuffer;
  vertexCount!:  number;

  private buildVertices(): Float32Array {
    const out: number[] = [];

    const pushVert = (theta: number, phi: number) => {
      const nx = Math.sin(theta) * Math.cos(phi);
      const ny = Math.cos(theta);
      const nz = Math.sin(theta) * Math.sin(phi);
      // position
      out.push(nx * RADIUS, ny * RADIUS, nz * RADIUS);
      // normal (same as normalised position on a sphere)
      out.push(nx, ny, nz);
    };

    for (let lat = 0; lat < LAT_SEGS; lat++) {
      const t0 = (lat       / LAT_SEGS) * Math.PI;
      const t1 = ((lat + 1) / LAT_SEGS) * Math.PI;
      for (let lon = 0; lon < LON_SEGS; lon++) {
        const p0 = (lon       / LON_SEGS) * Math.PI * 2;
        const p1 = ((lon + 1) / LON_SEGS) * Math.PI * 2;
        // Two triangles per quad
        pushVert(t0, p0); pushVert(t1, p0); pushVert(t1, p1);
        pushVert(t0, p0); pushVert(t1, p1); pushVert(t0, p1);
      }
    }

    return new Float32Array(out);
  }

  init(device: GPUDevice): void {
    const data = this.buildVertices();
    this.vertexCount = data.length / 6; // 6 floats per vertex (pos + normal)
    this.vertexBuffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.vertexBuffer.getMappedRange()).set(data);
    this.vertexBuffer.unmap();
  }
}
