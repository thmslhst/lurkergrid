// LurkerModel — an irregular, creature-like wireframe form.
// Asymmetric hull with five animated appendages; body breathes with a slow pulse.
import { PlaneModel } from './PlaneModel';
import { OrganicTextureGen, PAGE_SEED, type OrgVariant } from '../OrganicTextureGen';
import { BODY, BODY_EDGES, BODY_FACES, fillLimbEdges, seg } from './LurkerGeom';

export class LurkerModel extends PlaneModel {
  private scratchEdges: Float32Array | null = null;
  private scratchFaces: Float32Array | null = null;

  protected faceTextureVariant(): OrgVariant { return 'membrane'; }
  protected faceTextureSeed():    number      { return PAGE_SEED; }

  override init(device: GPUDevice): void {
    const data = this.buildEdges();
    this.edgeCount = data.length / 6;
    this.scratchEdges = new Float32Array(data.length);
    this.edgeBuffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.edgeBuffer.getMappedRange()).set(data);
    this.edgeBuffer.unmap();
  }

  override initFaces(device: GPUDevice, bgl: GPUBindGroupLayout): void {
    const faces = this.buildFaces();
    if (!faces || faces.length === 0) return;
    this.faceCount = faces.length / 15;
    this.scratchFaces = new Float32Array(faces.length);
    this.faceBuffer = device.createBuffer({
      size: faces.byteLength,
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

  tick(device: GPUDevice, t: number): void {
    if (this.scratchEdges) {
      const tmp: number[] = [];
      this.fillEdges(t, tmp);
      for (let i = 0; i < tmp.length; i++) this.scratchEdges[i] = tmp[i];
      device.queue.writeBuffer(this.edgeBuffer, 0, this.scratchEdges);
    }
    if (this.scratchFaces && this.faceBuffer) {
      const tmp: number[] = [];
      this.fillFaces(t, tmp);
      for (let i = 0; i < tmp.length; i++) this.scratchFaces[i] = tmp[i];
      device.queue.writeBuffer(this.faceBuffer, 0, this.scratchFaces);
    }
  }

  buildEdges(): Float32Array {
    const tmp: number[] = [];
    this.fillEdges(0, tmp);
    return new Float32Array(tmp);
  }

  private fillEdges(t: number, out: number[]): void {
    for (const [a, b] of BODY_EDGES) {
      seg(out, BODY[a][0], BODY[a][1], BODY[a][2], BODY[b][0], BODY[b][1], BODY[b][2]);
    }
    fillLimbEdges(t, out);
  }

  buildFaces(): Float32Array {
    const tmp: number[] = [];
    this.fillFaces(0, tmp);
    return new Float32Array(tmp);
  }

  private fillFaces(t: number, out: number[]): void {
    // Slow breath: scale oscillates ±1.8% so the hull subtly pulses
    const s = 1.0 + Math.sin(t * 0.00080) * 0.018;
    for (const [ai, bi, ci] of BODY_FACES) {
      const A = BODY[ai], B = BODY[bi], C = BODY[ci];
      // Planar UV projection — stretched over the hull extents
      const uv = (v: number[]): [number, number] => [
        (v[0] + 0.30) / 0.60,
        (v[1] + 0.35) / 0.90,
      ];
      const [uA, vA] = uv(A), [uB, vB] = uv(B), [uC, vC] = uv(C);
      out.push(
        A[0]*s, A[1]*s, A[2]*s, uA, vA,
        B[0]*s, B[1]*s, B[2]*s, uB, vB,
        C[0]*s, C[1]*s, C[2]*s, uC, vC,
      );
    }
  }
}
