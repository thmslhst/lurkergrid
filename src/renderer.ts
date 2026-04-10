import wireframeWGSL  from './shaders/wireframe.wgsl?raw';
import connectionWGSL from './shaders/connection.wgsl?raw';
import { mat4Multiply } from './math';
import type { Scene }  from './scene';
import type { Camera } from './camera';
import { FLOATS_PER_CONN, VERTS_PER_CONN } from './connection';

// Up to ~40 nodes transiently (evictions fade out over 120ms before removal)
// 40*39/2 = 780 — give headroom above the 32-node steady state
const MAX_CONNECTIONS = 780;
const MSAA_COUNT = 4;

export class Renderer {
  device!: GPUDevice;
  nodeBindGroupLayout!: GPUBindGroupLayout;

  private context!: GPUCanvasContext;
  private wirePipeline!:  GPURenderPipeline;
  private connPipeline!:  GPURenderPipeline;
  private sharedUniformBuffer!: GPUBuffer;
  private sharedBindGroup!: GPUBindGroup;
  private connVertexBuffer!: GPUBuffer;
  private connScratch = new Float32Array(MAX_CONNECTIONS * FLOATS_PER_CONN);
  private depthTexture!:  GPUTexture;
  private msaaTexture!:   GPUTexture;
  private canvasFormat!:  GPUTextureFormat;
  private sharedScratch = new Float32Array(16); // viewProj mat4

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found');
    this.device = await adapter.requestDevice();

    this.context = canvas.getContext('webgpu') as GPUCanvasContext;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.canvasFormat, alphaMode: 'opaque' });

    this.initDepth(canvas.width, canvas.height);
    this.initPipelines();
  }

  resize(w: number, h: number): void { this.initDepth(w, h); }

  private initDepth(w: number, h: number): void {
    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      size: [w, h], format: 'depth24plus', sampleCount: MSAA_COUNT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.msaaTexture = this.device.createTexture({
      size: [w, h], format: this.canvasFormat, sampleCount: MSAA_COUNT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private initPipelines(): void {
    const bgl0 = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
    });
    this.nodeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
    });

    const msaa = { count: MSAA_COUNT };

    // Wireframe pipeline (nodes)
    const wireMod = this.device.createShaderModule({ code: wireframeWGSL });
    this.wirePipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bgl0, this.nodeBindGroupLayout] }),
      vertex: {
        module: wireMod, entryPoint: 'vs',
        buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
      },
      fragment: { module: wireMod, entryPoint: 'fs', targets: [{ format: this.canvasFormat }] },
      primitive:    { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
      multisample:  msaa,
    });

    // Connection pipeline — procedural alpha, no depth write
    const connMod = this.device.createShaderModule({ code: connectionWGSL });
    this.connPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bgl0] }),
      vertex: {
        module: connMod, entryPoint: 'vs',
        buffers: [{ arrayStride: 20, attributes: [
          { shaderLocation: 0, offset: 0,  format: 'float32x3' },  // pos
          { shaderLocation: 1, offset: 12, format: 'float32x2' },  // uv
        ]}],
      },
      fragment: {
        module: connMod, entryPoint: 'fs',
        targets: [{ format: this.canvasFormat, blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one',       dstFactor: 'zero',                operation: 'add' },
        }}],
      },
      primitive:    { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      multisample:  msaa,
    });

    // Shared viewProj uniform — 64 bytes
    this.sharedUniformBuffer = this.device.createBuffer({
      size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sharedBindGroup = this.device.createBindGroup({
      layout: bgl0,
      entries: [{ binding: 0, resource: { buffer: this.sharedUniformBuffer } }],
    });

    // Dynamic connection vertex buffer
    this.connVertexBuffer = this.device.createBuffer({
      size: MAX_CONNECTIONS * FLOATS_PER_CONN * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  frame(scene: Scene, camera: Camera, t: number): void {
    this.sharedScratch.set(mat4Multiply(camera.projMatrix(), camera.viewMatrix()));
    this.device.queue.writeBuffer(this.sharedUniformBuffer, 0, this.sharedScratch);

    const canvasView = this.context.getCurrentTexture().createView();
    const encoder    = this.device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view:          this.msaaTexture.createView(),
        resolveTarget: canvasView,
        clearValue: { r: 0.10, g: 0.10, b: 0.10, a: 1 },
        loadOp: 'clear', storeOp: 'discard',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });

    const connCount = scene.buildConnGeometry(this.connScratch, t);
    if (connCount > 0) {
      this.device.queue.writeBuffer(this.connVertexBuffer, 0, this.connScratch.subarray(0, connCount * FLOATS_PER_CONN));
      pass.setPipeline(this.connPipeline);
      pass.setBindGroup(0, this.sharedBindGroup);
      pass.setVertexBuffer(0, this.connVertexBuffer);
      pass.draw(connCount * VERTS_PER_CONN);
    }

    pass.setPipeline(this.wirePipeline);
    pass.setBindGroup(0, this.sharedBindGroup);
    for (const node of scene.nodes) node.draw(pass);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
