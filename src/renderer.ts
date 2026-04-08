import wireframeWGSL  from './shaders/wireframe.wgsl?raw';
import connectionWGSL from './shaders/connection.wgsl?raw';
import texturedWGSL   from './shaders/textured.wgsl?raw';
import { mat4Multiply } from './math';
import type { Scene }  from './scene';
import type { Camera } from './camera';
import { FLOATS_PER_CONN, VERTS_PER_CONN } from './connection';

// 16 nodes → max 120 connections (16*15/2)
const MAX_CONNECTIONS = 120;

export class Renderer {
  device!: GPUDevice;
  nodeBindGroupLayout!: GPUBindGroupLayout;
  texBindGroupLayout!:  GPUBindGroupLayout;  // sampler(b0) + texture(b1) — for model faces

  connTextureBindGroup: GPUBindGroup | null = null;

  private context!: GPUCanvasContext;
  private wirePipeline!:  GPURenderPipeline;
  private connPipeline!:  GPURenderPipeline;
  private texPipeline!:   GPURenderPipeline;
  private sharedUniformBuffer!: GPUBuffer;
  private sharedBindGroup!: GPUBindGroup;
  private connVertexBuffer!: GPUBuffer;
  private connScratch = new Float32Array(MAX_CONNECTIONS * FLOATS_PER_CONN);
  private depthTexture!: GPUTexture;
  private canvasFormat!: GPUTextureFormat;

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
    this.depthTexture = this.device.createTexture({
      size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private initPipelines(): void {
    const bgl0 = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {} }],
    });
    this.nodeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
    });
    this.texBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler:  {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture:  {} },
      ],
    });

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
    });

    // Connection pipeline — textured, per-vertex alpha, no depth write
    const connMod = this.device.createShaderModule({ code: connectionWGSL });
    this.connPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bgl0, this.texBindGroupLayout] }),
      vertex: {
        module: connMod, entryPoint: 'vs',
        buffers: [{ arrayStride: 20, attributes: [
          { shaderLocation: 0, offset: 0,  format: 'float32x3' },  // pos
          { shaderLocation: 1, offset: 12, format: 'float32x2' },  // uv
        ]}],
      },
      fragment: {
        module: connMod, entryPoint: 'fs',
        targets: [{ format: this.canvasFormat }],
      },
      primitive:    { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
    });

    // Textured face pipeline — alpha-blended triangles, depth-tested but no depth write
    const texMod = this.device.createShaderModule({ code: texturedWGSL });
    this.texPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bgl0, this.nodeBindGroupLayout, this.texBindGroupLayout],
      }),
      vertex: {
        module: texMod, entryPoint: 'vs',
        buffers: [{ arrayStride: 20, attributes: [
          { shaderLocation: 0, offset: 0,  format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x2' },
        ]}],
      },
      fragment: {
        module: texMod, entryPoint: 'fs',
        targets: [{ format: this.canvasFormat, blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one',       dstFactor: 'zero',                operation: 'add' },
        }}],
      },
      primitive:    { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    // Shared view/proj uniform
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
    const viewProj = mat4Multiply(camera.projMatrix(), camera.viewMatrix());
    this.device.queue.writeBuffer(this.sharedUniformBuffer, 0, viewProj);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.22, g: 0.22, b: 0.22, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });

    // 1 — Connections (textured, no depth, always through)
    const connCount = scene.buildConnGeometry(this.connScratch, t);
    if (connCount > 0 && this.connTextureBindGroup) {
      this.device.queue.writeBuffer(this.connVertexBuffer, 0, this.connScratch.subarray(0, connCount * FLOATS_PER_CONN));
      pass.setPipeline(this.connPipeline);
      pass.setBindGroup(0, this.sharedBindGroup);
      pass.setBindGroup(1, this.connTextureBindGroup);
      pass.setVertexBuffer(0, this.connVertexBuffer);
      pass.draw(connCount * VERTS_PER_CONN);
    }

    // 2 — Textured faces (no depth write, always-pass — depth buffer still clear here)
    pass.setPipeline(this.texPipeline);
    pass.setBindGroup(0, this.sharedBindGroup);
    for (const node of scene.nodes) node.drawFaces(pass);

    // 3 — Node wireframes (write depth, draw on top of faces)
    pass.setPipeline(this.wirePipeline);
    pass.setBindGroup(0, this.sharedBindGroup);
    for (const node of scene.nodes) node.draw(pass);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
