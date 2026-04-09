// ClothModel — subdivided plane that deforms like cloth.
// N×N grid with per-vertex Z displacement from multi-frequency wave functions.
// Amplitude scales with entropy×chaosBoost (spawn/delete events) and node velocity
// (connection-driven physics), giving a reactive cloth feel.
import { PlaneModel } from './PlaneModel';
import { OrganicTextureGen, PAGE_SEED, type OrgVariant } from '../OrganicTextureGen';

const N    = 10;   // grid subdivisions → (N+1)² verts, 2N² triangles
const SIZE = 1.0;  // side length in local units (±0.5)

export class ClothModel extends PlaneModel {
  private scratchFaces: Float32Array | null = null;

  constructor(readonly seed = 0) { super(); }

  protected override faceTextureVariant(): OrgVariant { return 'membrane'; }
  protected override faceTextureSeed():    number      { return PAGE_SEED + this.seed * 31337; }

  override init(device: GPUDevice): void {
    const data = this.buildEdges();
    this.edgeCount = data.length / 6;
    this.edgeBuffer = device.createBuffer({
      size:  data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.edgeBuffer.getMappedRange()).set(data);
    this.edgeBuffer.unmap();
  }

  override initFaces(device: GPUDevice, bgl: GPUBindGroupLayout): void {
    const faces      = this._buildFaces(0, 0);
    this.faceCount   = faces.length / 24;
    this.scratchFaces = new Float32Array(faces.length);
    this.faceBuffer   = device.createBuffer({
      size:  faces.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.faceBuffer.getMappedRange()).set(faces);
    this.faceBuffer.unmap();
    const tex     = OrganicTextureGen.generate(device, 256, this.faceTextureSeed(), this.faceTextureVariant());
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
    this.faceBindGroup = device.createBindGroup({
      layout: bgl,
      entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: tex.createView() }],
    });
  }

  override buildEdges(): Float32Array {
    const out: number[] = [];
    for (let iy = 0; iy <= N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const x0 = (ix / N - 0.5) * SIZE, x1 = ((ix + 1) / N - 0.5) * SIZE;
        const y  = (iy / N - 0.5) * SIZE;
        out.push(x0, y, 0, x1, y, 0);
      }
    }
    for (let ix = 0; ix <= N; ix++) {
      for (let iy = 0; iy < N; iy++) {
        const y0 = (iy / N - 0.5) * SIZE, y1 = ((iy + 1) / N - 0.5) * SIZE;
        const x  = (ix / N - 0.5) * SIZE;
        out.push(x, y0, 0, x, y1, 0);
      }
    }
    return new Float32Array(out);
  }

  tick(device: GPUDevice, t: number, entropy = 0, nodeVel?: [number, number, number]): void {
    if (!this.scratchFaces || !this.faceBuffer) return;
    const faces = this._buildFaces(t, entropy, nodeVel);
    this.scratchFaces.set(faces);
    device.queue.writeBuffer(this.faceBuffer, 0, this.scratchFaces);
  }

  private _buildFaces(t: number, entropy: number, nodeVel?: [number, number, number]): Float32Array {
    const ts  = t * 0.001;
    const s   = this.seed;

    // Amplitude: entropy factor + velocity boost
    const velMag    = nodeVel ? Math.sqrt(nodeVel[0] ** 2 + nodeVel[1] ** 2 + nodeVel[2] ** 2) : 0;
    const entFactor = Math.min(1.0, entropy / 3.5);
    const amp       = (0.04 + entFactor * 0.32) * (1 + Math.min(velMag, 6.0) * 0.05);

    // Velocity-driven phase offset: wave lags behind movement direction
    const pvx = nodeVel ? nodeVel[0] * 0.7 : 0;
    const pvy = nodeVel ? nodeVel[1] * 0.7 : 0;

    const NV = N + 1;
    const pos = new Float32Array(NV * NV * 3);
    const uvs = new Float32Array(NV * NV * 2);

    for (let iy = 0; iy <= N; iy++) {
      for (let ix = 0; ix <= N; ix++) {
        const u = ix / N, v = iy / N;
        const x = (u - 0.5) * SIZE, y = (v - 0.5) * SIZE;
        // Two crossing wave modes with per-seed phase offsets
        const dz = amp * (
          Math.sin(6.2 * x + 0.80 * ts + pvx + s)       * Math.cos(5.0 * y + 0.66 * ts + pvy + s * 0.7) * 0.58 +
          Math.sin(9.1 * y - 1.10 * ts + s * 1.3)        * Math.cos(7.4 * x + 0.90 * ts       + s * 0.4) * 0.42
        );
        const vi = iy * NV + ix;
        pos[vi * 3]     = x;
        pos[vi * 3 + 1] = y;
        pos[vi * 3 + 2] = dz;
        uvs[vi * 2]     = u;
        uvs[vi * 2 + 1] = v;
      }
    }

    // Accumulate per-vertex normals from surrounding triangles
    const nrm = new Float32Array(NV * NV * 3);
    const addTri = (a: number, b: number, c: number) => {
      const ax = pos[a*3], ay = pos[a*3+1], az = pos[a*3+2];
      const e1x = pos[b*3]-ax, e1y = pos[b*3+1]-ay, e1z = pos[b*3+2]-az;
      const e2x = pos[c*3]-ax, e2y = pos[c*3+1]-ay, e2z = pos[c*3+2]-az;
      const nx = e1y*e2z - e1z*e2y, ny = e1z*e2x - e1x*e2z, nz = e1x*e2y - e1y*e2x;
      for (const vi of [a, b, c]) { nrm[vi*3] += nx; nrm[vi*3+1] += ny; nrm[vi*3+2] += nz; }
    };
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const v00 = iy*NV+ix, v10 = iy*NV+ix+1, v01 = (iy+1)*NV+ix, v11 = (iy+1)*NV+ix+1;
        addTri(v00, v10, v11);
        addTri(v00, v11, v01);
      }
    }
    for (let i = 0; i < NV * NV; i++) {
      const l = Math.sqrt(nrm[i*3]**2 + nrm[i*3+1]**2 + nrm[i*3+2]**2) || 1;
      nrm[i*3] /= l; nrm[i*3+1] /= l; nrm[i*3+2] /= l;
    }

    // Emit interleaved [pos(3) nrm(3) uv(2)] × 3 verts per triangle
    const out = new Float32Array(N * N * 6 * 8);
    let off = 0;
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const v00 = iy*NV+ix, v10 = iy*NV+ix+1, v01 = (iy+1)*NV+ix, v11 = (iy+1)*NV+ix+1;
        for (const vi of [v00, v10, v11, v00, v11, v01]) {
          out[off++] = pos[vi*3];   out[off++] = pos[vi*3+1]; out[off++] = pos[vi*3+2];
          out[off++] = nrm[vi*3];   out[off++] = nrm[vi*3+1]; out[off++] = nrm[vi*3+2];
          out[off++] = uvs[vi*2];   out[off++] = uvs[vi*2+1];
        }
      }
    }
    return out;
  }
}
