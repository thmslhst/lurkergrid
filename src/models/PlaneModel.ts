// Abstract base for all node geometry models.
// Subclasses implement buildEdges() for wireframe and optionally buildFaces()
// for texture-mapped filled geometry. init() / initFaces() upload once to GPU.
import { OrganicTextureGen, type OrgVariant } from '../OrganicTextureGen';

export abstract class PlaneModel {
  edgeBuffer!: GPUBuffer;
  edgeCount!: number;

  // Optional filled face geometry (triangles with interleaved pos+uv, 5 floats/vertex)
  faceBuffer:    GPUBuffer | null = null;
  faceCount:     number          = 0;   // number of triangles
  faceBindGroup: GPUBindGroup | null = null;

  abstract buildEdges(): Float32Array;

  // Subclasses override to supply triangle geometry [x,y,z,u,v, ...]
  buildFaces(): Float32Array | null { return null; }

  // Subclasses override to control texture appearance
  protected faceTextureVariant(): OrgVariant { return 'membrane'; }
  protected faceTextureSeed():    number      { return 42; }

  init(device: GPUDevice): void {
    const data = this.buildEdges();
    this.edgeCount = data.length / 6; // 6 floats per segment (2 × vec3)
    this.edgeBuffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.edgeBuffer.getMappedRange()).set(data);
    this.edgeBuffer.unmap();
  }

  // Call after init() and after Renderer.texBindGroupLayout is known.
  initFaces(device: GPUDevice, bgl: GPUBindGroupLayout): void {
    const faces = this.buildFaces();
    if (!faces || faces.length === 0) return;

    this.faceCount = faces.length / 15; // 5 floats × 3 verts per triangle
    this.faceBuffer = device.createBuffer({
      size: faces.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.faceBuffer.getMappedRange()).set(faces);
    this.faceBuffer.unmap();

    const tex = OrganicTextureGen.generate(
      device, 256, this.faceTextureSeed(), this.faceTextureVariant(),
    );
    const sampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'repeat', addressModeV: 'repeat',
    });
    this.faceBindGroup = device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: tex.createView() },
      ],
    });
  }
}
