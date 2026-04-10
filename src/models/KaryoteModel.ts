// KaryoteModel — static subdivided quad, high-definition normal-mapped surface.
// All visual motion comes from the post-processing distortion pass.
// Vertex layout: pos(3) nrm(3) uv(2) tangent(3) = 11 floats / 44 bytes.
// Textures: shared albedo (x.png) + shared normal map (x-normal.png).
import { PlaneModel } from './PlaneModel';
import albedoUrl from '../x.png';
import normalUrl from '../x-normal.png';

const N    = 12;   // subdivisions — smoother silhouette, better normal interpolation
const SIZE = 6.0;
const FLOATS_PER_VERT = 11;

let _sharedTexPromise: Promise<{ albedo: GPUTexture; normal: GPUTexture }> | null = null;

async function loadGpuTexture(device: GPUDevice, url: string): Promise<GPUTexture> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const tex = device.createTexture({
    size:  [bitmap.width, bitmap.height],
    format: 'rgba8unorm',
    usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap, flipY: true }, { texture: tex }, [bitmap.width, bitmap.height]);
  return tex;
}

function sharedTextures(device: GPUDevice): Promise<{ albedo: GPUTexture; normal: GPUTexture }> {
  if (!_sharedTexPromise) {
    _sharedTexPromise = Promise.all([
      loadGpuTexture(device, albedoUrl),
      loadGpuTexture(device, normalUrl),
    ]).then(([albedo, normal]) => ({ albedo, normal }));
  }
  return _sharedTexPromise;
}

export class KaryoteModel extends PlaneModel {
  constructor(readonly seed = 0) { super(); }

  override async initFaces(device: GPUDevice, bgl: GPUBindGroupLayout): Promise<void> {
    const faces    = this._buildFaces();
    this.faceCount = faces.length / (FLOATS_PER_VERT * 3);
    this.faceBuffer = device.createBuffer({
      size: faces.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.faceBuffer.getMappedRange()).set(faces);
    this.faceBuffer.unmap();

    const { albedo, normal } = await sharedTextures(device);
    const sampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
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

  private _buildFaces(): Float32Array {
    const NV  = N + 1;
    const pos = new Float32Array(NV * NV * 3);
    const uvs = new Float32Array(NV * NV * 2);
    for (let iy = 0; iy <= N; iy++) {
      for (let ix = 0; ix <= N; ix++) {
        const u = ix / N, v = iy / N, vi = iy * NV + ix;
        pos[vi*3]   = (u - 0.5) * SIZE;
        pos[vi*3+1] = (v - 0.5) * SIZE;
        pos[vi*3+2] = 0;
        uvs[vi*2]   = u;
        uvs[vi*2+1] = v;
      }
    }

    // Flat plane — all normals point +Z, all tangents point +X
    const out = new Float32Array(N * N * 6 * FLOATS_PER_VERT);
    let off = 0;
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const v00=iy*NV+ix, v10=iy*NV+ix+1, v01=(iy+1)*NV+ix, v11=(iy+1)*NV+ix+1;
        for (const vi of [v00,v10,v11,v00,v11,v01]) {
          out[off++]=pos[vi*3]; out[off++]=pos[vi*3+1]; out[off++]=0;  // pos
          out[off++]=0;         out[off++]=0;           out[off++]=1;  // normal +Z
          out[off++]=uvs[vi*2]; out[off++]=uvs[vi*2+1];               // uv
          out[off++]=1;         out[off++]=0;           out[off++]=0;  // tangent +X
        }
      }
    }
    return out;
  }
}
