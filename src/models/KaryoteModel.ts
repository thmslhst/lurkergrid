// KaryoteModel — subdivided quad with breathing Z-deformation and bioluminescent surface.
// Surface character: bacteria-like membrane with animated cytoplasm, pulsing nucleus,
// and velocity-quiver. Each instance gets a unique OrganicTextureGen modulation texture
// layered over the shared base albedo, giving every cell a distinct structural identity.
//
// Vertex layout: pos(3) nrm(3) uv(2) tangent(3) = 11 floats / 44 bytes per vertex.
// Textures: base albedo (x.png) + normal map (x-normal.png), shared across all instances.
//           modulation (OrganicTextureGen 'karyote', per-instance).
import { PlaneModel } from './PlaneModel';
import { OrganicTextureGen } from '../OrganicTextureGen';
import albedoUrl from '../x.png';
import normalUrl from '../x-normal.png';

const N    = 12;   // grid subdivisions — (N+1)² verts, 2N² triangles
const SIZE = 6.0;
const FLOATS_PER_VERT = 11; // pos(3) + nrm(3) + uv(2) + tangent(3)

// Shared PNG textures — fetched once, reused across all instances.
let _sharedTexPromise: Promise<{ albedo: GPUTexture; normal: GPUTexture }> | null = null;

async function loadGpuTexture(device: GPUDevice, url: string): Promise<GPUTexture> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const tex = device.createTexture({
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
  private scratchFaces: Float32Array | null = null;

  constructor(readonly seed = 0) { super(); }

  override init(device: GPUDevice): void {
    const data = this.buildEdges();
    this.edgeCount = data.length / 6;
    this.edgeBuffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.edgeBuffer.getMappedRange()).set(data);
    this.edgeBuffer.unmap();
  }

  override async initFaces(device: GPUDevice, bgl: GPUBindGroupLayout): Promise<void> {
    const faces    = this._buildFaces(0, 0);
    this.faceCount = faces.length / (FLOATS_PER_VERT * 3);
    this.scratchFaces = new Float32Array(faces.length);

    this.faceBuffer = device.createBuffer({
      size: faces.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.faceBuffer.getMappedRange()).set(faces);
    this.faceBuffer.unmap();

    const { albedo, normal } = await sharedTextures(device);

    // Per-instance modulation texture: unique cellular structure per seed.
    // 'karyote' variant produces Voronoi cells with nuclei and organelle speckles.
    const modulation = OrganicTextureGen.generate(device, 128, this.seed * 3571 + 1013, 'karyote');

    const sampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'repeat', addressModeV: 'repeat',
    });
    this.faceBindGroup = device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: albedo.createView() },
        { binding: 2, resource: normal.createView() },
        { binding: 3, resource: modulation.createView() },
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

  /** Called every frame from main loop — deforms the membrane geometry. */
  tick(device: GPUDevice, t: number, entropy = 0, nodeVel?: [number, number, number]): void {
    if (!this.scratchFaces || !this.faceBuffer) return;
    const faces = this._buildFaces(t, entropy, nodeVel);
    this.scratchFaces.set(faces);
    device.queue.writeBuffer(this.faceBuffer, 0, this.scratchFaces as Float32Array<ArrayBuffer>);
  }

  private _buildFaces(t: number, entropy: number, nodeVel?: [number, number, number]): Float32Array {
    const ts    = t * 0.001;
    const NV    = N + 1;
    const speed = nodeVel
      ? Math.sqrt(nodeVel[0] ** 2 + nodeVel[1] ** 2 + nodeVel[2] ** 2)
      : 0;

    const pos = new Float32Array(NV * NV * 3);
    const uvs = new Float32Array(NV * NV * 2);

    for (let iy = 0; iy <= N; iy++) {
      for (let ix = 0; ix <= N; ix++) {
        const u  = ix / N, v = iy / N;
        const vi = iy * NV + ix;

        // Radial distance from membrane center
        const r = Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2);

        // 1. Breathing dome — Gaussian bump at center, slow oscillation
        const breathAmp   = 0.28 * (1 + entropy * 1.4);
        const dome        = Math.exp(-r * 4.5) * Math.sin(ts * 0.72 + this.seed * 0.37) * breathAmp;

        // 2. Membrane ripple — radial wave emanating outward from nucleus
        const rippleAmp   = 0.055 + entropy * 0.11;
        const ripple      = Math.sin(r * 11 - ts * 3.1 + this.seed) * rippleAmp;

        // 3. Velocity quiver — high-frequency trembling when the cell moves fast
        const quiverAmp   = speed * 0.13;
        const quiver      = Math.sin(ts * 9.5 + u * 5.8 + v * 3.9 + this.seed) * quiverAmp;

        pos[vi * 3]     = (u - 0.5) * SIZE;
        pos[vi * 3 + 1] = (v - 0.5) * SIZE;
        pos[vi * 3 + 2] = dome + ripple + quiver;
        uvs[vi * 2]     = u;
        uvs[vi * 2 + 1] = v;
      }
    }

    // Accumulate face normals then normalize
    const nrm = new Float32Array(NV * NV * 3);
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const v00 = iy*NV+ix, v10 = iy*NV+ix+1, v01 = (iy+1)*NV+ix, v11 = (iy+1)*NV+ix+1;
        for (const [a, b, c] of [[v00,v10,v11],[v00,v11,v01]] as [number,number,number][]) {
          const ax=pos[a*3],ay=pos[a*3+1],az=pos[a*3+2];
          const nx=(pos[b*3+1]-ay)*(pos[c*3+2]-az)-(pos[b*3+2]-az)*(pos[c*3+1]-ay);
          const ny=(pos[b*3+2]-az)*(pos[c*3  ]-ax)-(pos[b*3  ]-ax)*(pos[c*3+2]-az);
          const nz=(pos[b*3  ]-ax)*(pos[c*3+1]-ay)-(pos[b*3+1]-ay)*(pos[c*3  ]-ax);
          for (const vi of [a,b,c]) { nrm[vi*3]+=nx; nrm[vi*3+1]+=ny; nrm[vi*3+2]+=nz; }
        }
      }
    }
    for (let i = 0; i < NV * NV; i++) {
      const l = Math.sqrt(nrm[i*3]**2+nrm[i*3+1]**2+nrm[i*3+2]**2) || 1;
      nrm[i*3]/=l; nrm[i*3+1]/=l; nrm[i*3+2]/=l;
    }

    // Central-difference tangents along U direction
    const tan = new Float32Array(NV * NV * 3);
    for (let iy = 0; iy <= N; iy++) {
      for (let ix = 0; ix <= N; ix++) {
        const vi = iy*NV+ix;
        const vL = iy*NV+Math.max(ix-1,0), vR = iy*NV+Math.min(ix+1,N);
        let tx=pos[vR*3]-pos[vL*3], ty=pos[vR*3+1]-pos[vL*3+1], tz=pos[vR*3+2]-pos[vL*3+2];
        const tl=Math.sqrt(tx*tx+ty*ty+tz*tz)||1;
        tan[vi*3]=tx/tl; tan[vi*3+1]=ty/tl; tan[vi*3+2]=tz/tl;
      }
    }

    // Interleave [pos(3) nrm(3) uv(2) tan(3)] × 3 verts / triangle
    const out = new Float32Array(N * N * 6 * FLOATS_PER_VERT);
    let off = 0;
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const v00=iy*NV+ix, v10=iy*NV+ix+1, v01=(iy+1)*NV+ix, v11=(iy+1)*NV+ix+1;
        for (const vi of [v00,v10,v11,v00,v11,v01]) {
          out[off++]=pos[vi*3];   out[off++]=pos[vi*3+1]; out[off++]=pos[vi*3+2];
          out[off++]=nrm[vi*3];   out[off++]=nrm[vi*3+1]; out[off++]=nrm[vi*3+2];
          out[off++]=uvs[vi*2];   out[off++]=uvs[vi*2+1];
          out[off++]=tan[vi*3];   out[off++]=tan[vi*3+1]; out[off++]=tan[vi*3+2];
        }
      }
    }
    return out;
  }
}
