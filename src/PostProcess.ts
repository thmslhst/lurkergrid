// PostProcess — screen-space node-reactive distortion.
// The main render resolves into an offscreen texture; this pass warps it
// based on each node's projected screen position, velocity, and connection count.
// Keeps Renderer.ts uncluttered.
import distortWGSL from './shaders/distort.wgsl?raw';
import type { Scene }  from './scene';
import type { Camera } from './camera';
import { mat4Multiply } from './math';

const MAX_NODES = 40;
// DistortUniforms layout — see distort.wgsl for field-level offsets.
// Header: nodeCount(f32) entropy(f32) pad(vec2) = 4 floats
// Per node: ndcPos(2) vel(2) speed(1) radius(1) connBoost(1) pad(1) = 8 floats
const HEADER_FLOATS = 4;
const NODE_FLOATS   = 8;
const UNIFORM_FLOATS = HEADER_FLOATS + MAX_NODES * NODE_FLOATS;  // 324 floats = 1296 bytes

export class PostProcess {
  private pipeline!:       GPURenderPipeline;
  private bgl!:            GPUBindGroupLayout;
  private offscreenTex!:   GPUTexture;
  private bindGroup!:      GPUBindGroup;
  private uniformBuffer!:  GPUBuffer;
  private scratch =        new Float32Array(UNIFORM_FLOATS);
  private sampler!:        GPUSampler;
  private device!:         GPUDevice;
  private canvasFormat!:   GPUTextureFormat;

  init(device: GPUDevice, canvasFormat: GPUTextureFormat): void {
    this.device = device;
    this.canvasFormat = canvasFormat;

    this.uniformBuffer = device.createBuffer({
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    this.bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler:  {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture:  {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer:   {} },
      ],
    });

    const mod = device.createShaderModule({ code: distortWGSL });
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bgl] }),
      vertex:   { module: mod, entryPoint: 'vs' },
      fragment: {
        module: mod, entryPoint: 'fs',
        targets: [{ format: canvasFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  resize(w: number, h: number): void {
    this.offscreenTex?.destroy();
    this.offscreenTex = this.device.createTexture({
      size: [w, h], format: this.canvasFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    // Rebuild bind group whenever the offscreen texture changes
    this.bindGroup = this.device.createBindGroup({
      layout: this.bgl,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.offscreenTex.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  /** Texture view to use as the main render-pass resolve target. */
  resolveTarget(): GPUTextureView {
    return this.offscreenTex.createView();
  }

  /**
   * Encodes the distortion pass into encoder.
   * Projects each node's world position + velocity into NDC, uploads to GPU,
   * then draws a full-screen triangle that warps the offscreen image.
   */
  frame(
    encoder:    GPUCommandEncoder,
    canvasView: GPUTextureView,
    scene:      Scene,
    camera:     Camera,
  ): void {
    const viewProj = mat4Multiply(camera.projMatrix(), camera.viewMatrix());

    // Build per-node distortion data
    const sc = this.scratch;
    const count = Math.min(scene.nodes.length, MAX_NODES);
    sc[0] = count;
    sc[1] = scene.entropy;
    // sc[2], sc[3] — padding

    for (let i = 0; i < count; i++) {
      const node = scene.nodes[i];
      const p    = node.physics.pos;
      const v    = node.physics.vel;

      // Project world position → NDC
      const cx = viewProj[0]*p[0] + viewProj[4]*p[1] + viewProj[8]*p[2]  + viewProj[12];
      const cy = viewProj[1]*p[0] + viewProj[5]*p[1] + viewProj[9]*p[2]  + viewProj[13];
      const cw = viewProj[3]*p[0] + viewProj[7]*p[1] + viewProj[11]*p[2] + viewProj[15];
      if (cw < 0.001) continue;  // behind camera — leave as zero, shader skips it

      // Project velocity into NDC (linear approximation — no perspective divide on velocity)
      const vx = (viewProj[0]*v[0] + viewProj[4]*v[1] + viewProj[8]*v[2]) / cw * 0.04;
      const vy = (viewProj[1]*v[0] + viewProj[5]*v[1] + viewProj[9]*v[2]) / cw * 0.04;
      const speed = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);

      const off = HEADER_FLOATS + i * NODE_FLOATS;
      sc[off]   = cx / cw;          // ndcPos.x
      sc[off+1] = cy / cw;          // ndcPos.y
      sc[off+2] = vx;               // vel.x (NDC units)
      sc[off+3] = vy;               // vel.y
      sc[off+4] = speed;
      sc[off+5] = 0.38;             // influence radius in NDC space
      sc[off+6] = 1 + node.connectionCount * 0.14;  // connBoost
      sc[off+7] = 0;                // pad
    }

    this.device.queue.writeBuffer(this.uniformBuffer, 0, sc);

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: canvasView,
        loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);  // full-screen triangle
    pass.end();
  }
}
