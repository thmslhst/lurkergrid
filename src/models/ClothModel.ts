// ClothModel — subdivided plane that deforms like cloth.
// N×N grid with per-vertex Z displacement from multi-frequency wave functions.
// Amplitude scales with entropy×chaosBoost and node velocity.
// Vertex layout: pos(3) nrm(3) uv(2) tangent(3) = 11 floats / 44 bytes per vertex.
// Textures: x.png (albedo) + x-normal.png (normal map for surface volume).
import { PlaneModel } from './PlaneModel';
import albedoUrl from '../x.png';
import normalUrl from '../x-normal.png';

const N    = 10;   // grid subdivisions → (N+1)² verts, 2N² triangles
const SIZE = 1.0;  // side length in local units (±0.5)
const FLOATS_PER_VERT = 11; // pos(3) + nrm(3) + uv(2) + tangent(3)

// Shared texture promise — loaded once, reused across all instances.
let _texPromise: Promise<{ albedo: GPUTexture; normal: GPUTexture }> | null = null;

async function loadGpuTexture(device: GPUDevice, url: string): Promise<GPUTexture> {
  const res    = await fetch(url);
  const blob   = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const tex    = device.createTexture({
    size:  [bitmap.width, bitmap.height],
    format: 'rgba8unorm',
    usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture(
    { source: bitmap, flipY: true },
    { texture: tex },
    [bitmap.width, bitmap.height],
  );
  return tex;
}

function ensureTextures(device: GPUDevice): Promise<{ albedo: GPUTexture; normal: GPUTexture }> {
  if (!_texPromise) {
    _texPromise = Promise.all([
      loadGpuTexture(device, albedoUrl),
      loadGpuTexture(device, normalUrl),
    ]).then(([albedo, normal]) => ({ albedo, normal }));
  }
  return _texPromise;
}

export class ClothModel extends PlaneModel {
  private scratchFaces: Float32Array | null = null;

  constructor(readonly seed = 0) { super(); }

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

  override async initFaces(device: GPUDevice, bgl: GPUBindGroupLayout): Promise<void> {
    const faces       = this._buildFaces(0, 0);
    // 11 floats/vert × 3 verts/tri
    this.faceCount    = faces.length / (FLOATS_PER_VERT * 3);
    this.scratchFaces = new Float32Array(faces.length);
    this.faceBuffer   = device.createBuffer({
      size:  faces.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.faceBuffer.getMappedRange()).set(faces);
    this.faceBuffer.unmap();

    const { albedo, normal } = await ensureTextures(device);
    const sampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
    });
    this.faceBindGroup = device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: albedo.createView() },
        { binding: 2, resource: normal.createView() },
      ],
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
    device.queue.writeBuffer(this.faceBuffer, 0, this.scratchFaces as Float32Array<ArrayBuffer>);
  }

  // t, entropy, nodeVel kept for API compatibility but plane is flat — volume comes from normal map.
  private _buildFaces(_t: number, _entropy: number, _nodeVel?: [number, number, number]): Float32Array {
    const NV  = N + 1;
    const pos = new Float32Array(NV * NV * 3);
    const uvs = new Float32Array(NV * NV * 2);

    for (let iy = 0; iy <= N; iy++) {
      for (let ix = 0; ix <= N; ix++) {
        const u = ix / N, v = iy / N;
        const vi = iy * NV + ix;
        pos[vi * 3]     = (u - 0.5) * SIZE;
        pos[vi * 3 + 1] = (v - 0.5) * SIZE;
        pos[vi * 3 + 2] = 0;
        uvs[vi * 2]     = u;
        uvs[vi * 2 + 1] = v;
      }
    }

    // Per-vertex geometry normals (accumulate face normals, then normalize)
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

    // Per-vertex tangents — derivative of position along the U (ix) direction.
    // Uses central differences for interior vertices, forward/backward at edges.
    const tan = new Float32Array(NV * NV * 3);
    for (let iy = 0; iy <= N; iy++) {
      for (let ix = 0; ix <= N; ix++) {
        const vi = iy * NV + ix;
        const vL = iy * NV + Math.max(ix - 1, 0);
        const vR = iy * NV + Math.min(ix + 1, N);
        let tx = pos[vR*3]   - pos[vL*3];
        let ty = pos[vR*3+1] - pos[vL*3+1];
        let tz = pos[vR*3+2] - pos[vL*3+2];
        const tl = Math.sqrt(tx*tx + ty*ty + tz*tz) || 1;
        tan[vi*3]   = tx / tl;
        tan[vi*3+1] = ty / tl;
        tan[vi*3+2] = tz / tl;
      }
    }

    // Emit interleaved [pos(3) nrm(3) uv(2) tan(3)] × 3 verts per triangle
    const out = new Float32Array(N * N * 6 * FLOATS_PER_VERT);
    let off = 0;
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const v00 = iy*NV+ix, v10 = iy*NV+ix+1, v01 = (iy+1)*NV+ix, v11 = (iy+1)*NV+ix+1;
        for (const vi of [v00, v10, v11, v00, v11, v01]) {
          out[off++] = pos[vi*3];   out[off++] = pos[vi*3+1]; out[off++] = pos[vi*3+2];
          out[off++] = nrm[vi*3];   out[off++] = nrm[vi*3+1]; out[off++] = nrm[vi*3+2];
          out[off++] = uvs[vi*2];   out[off++] = uvs[vi*2+1];
          out[off++] = tan[vi*3];   out[off++] = tan[vi*3+1]; out[off++] = tan[vi*3+2];
        }
      }
    }
    return out;
  }
}
