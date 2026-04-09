import backgroundWGSL from './shaders/background.wgsl?raw';

// Renders a fullscreen animated FBM-cloud background via a single triangle draw.
// No vertex buffer — vertex positions are generated from vertex_index in the shader.
export class BackgroundPass {
  private pipeline!:     GPURenderPipeline;
  private uniformBuffer!: GPUBuffer;
  private bindGroup!:    GPUBindGroup;
  private scratch = new Float32Array(4);  // [time, resX, resY, pad]
  private w = 1; private h = 1;

  init(device: GPUDevice, format: GPUTextureFormat, sampleCount = 1): void {
    const bgl = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} }],
    });
    const mod = device.createShaderModule({ code: backgroundWGSL });
    this.pipeline = device.createRenderPipeline({
      layout:   device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      vertex:   { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] },
      primitive:    { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      multisample:  { count: sampleCount },
    });
    this.uniformBuffer = device.createBuffer({
      size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = device.createBindGroup({
      layout:  bgl,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  resize(w: number, h: number): void { this.w = w; this.h = h; }

  draw(device: GPUDevice, pass: GPURenderPassEncoder, t: number, chaos = 0): void {
    this.scratch[0] = t;
    this.scratch[1] = this.w;
    this.scratch[2] = this.h;
    this.scratch[3] = chaos;
    device.queue.writeBuffer(this.uniformBuffer, 0, this.scratch);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
  }
}
