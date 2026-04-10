import wireframeWGSL  from './shaders/wireframe.wgsl?raw';
import connectionWGSL from './shaders/connection.wgsl?raw';
import karyoteWGSL    from './shaders/karyote.wgsl?raw';
import { mat4Multiply } from './math';
import type { Scene }  from './scene';
import type { Camera } from './camera';
import { FLOATS_PER_CONN, VERTS_PER_CONN } from './connection';
import { PostProcess } from './PostProcess';

// Up to ~40 nodes transiently (evictions fade out over 120ms before removal)
// 40*39/2 = 780 — give headroom above the 32-node steady state
const MAX_CONNECTIONS = 780;
const MSAA_COUNT = 4;

export class Renderer {
  device!: GPUDevice;
  nodeBindGroupLayout!:  GPUBindGroupLayout;
  texBindGroupLayout!:        GPUBindGroupLayout;  // sampler(b0) + texture(b1) — for connections
  karyoteTexBindGroupLayout!: GPUBindGroupLayout;  // sampler(b0) + albedo(b1) + normalMap(b2)

  connTextureBindGroup: GPUBindGroup | null = null;

  private context!: GPUCanvasContext;
  private wirePipeline!:  GPURenderPipeline;
  private connPipeline!:  GPURenderPipeline;
  private texPipeline!:   GPURenderPipeline;
  private sharedUniformBuffer!: GPUBuffer;
  private sharedBindGroup!: GPUBindGroup;
  private connVertexBuffer!: GPUBuffer;
  private connScratch = new Float32Array(MAX_CONNECTIONS * FLOATS_PER_CONN);
  private depthTexture!:  GPUTexture;
  private msaaTexture!:   GPUTexture;
  private canvasFormat!:  GPUTextureFormat;
  private postProcess!:   PostProcess;
  private sharedScratch = new Float32Array(20); // 16 viewProj + 4 camPos

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found');
    this.device = await adapter.requestDevice();

    this.context = canvas.getContext('webgpu') as GPUCanvasContext;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.canvasFormat, alphaMode: 'opaque' });

    this.postProcess = new PostProcess();
    this.postProcess.init(this.device, this.canvasFormat);
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
    this.postProcess.resize(w, h);
  }

  private initPipelines(): void {
    const bgl0 = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
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
    this.karyoteTexBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
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
      multisample:  msaa,
    });

    // Karyote face pipeline — bioluminescent organism surface with normal mapping + distortion
    // Vertex layout: [pos(3) normal(3) uv(2) tangent(3)] = 11 floats / 44 bytes
    const texMod = this.device.createShaderModule({ code: karyoteWGSL });
    this.texPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bgl0, this.nodeBindGroupLayout, this.karyoteTexBindGroupLayout],
      }),
      vertex: {
        module: texMod, entryPoint: 'vs',
        buffers: [{ arrayStride: 44, attributes: [
          { shaderLocation: 0, offset: 0,  format: 'float32x3' },  // pos
          { shaderLocation: 1, offset: 12, format: 'float32x3' },  // normal
          { shaderLocation: 2, offset: 24, format: 'float32x2' },  // uv
          { shaderLocation: 3, offset: 32, format: 'float32x3' },  // tangent
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
      multisample:  msaa,
    });

    // Shared view/proj + camPos uniform — 16 floats viewProj + 4 floats camPos = 80 bytes
    this.sharedUniformBuffer = this.device.createBuffer({
      size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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

  frame(scene: Scene, camera: Camera, t: number, gridNode?: import('./node').Node): void {
    const camPos = camera.position();
    this.sharedScratch.set(mat4Multiply(camera.projMatrix(), camera.viewMatrix()), 0);
    this.sharedScratch[16] = camPos[0];
    this.sharedScratch[17] = camPos[1];
    this.sharedScratch[18] = camPos[2];
    this.sharedScratch[19] = 1.0;
    this.device.queue.writeBuffer(this.sharedUniformBuffer, 0, this.sharedScratch);

    // Acquire canvas view once — used as the distortion pass's render target.
    const canvasView = this.context.getCurrentTexture().createView();
    const encoder    = this.device.createCommandEncoder();

    // Pass 1 — scene → offscreen (MSAA-resolved), ready for post-processing
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view:          this.msaaTexture.createView(),
        resolveTarget: this.postProcess.resolveTarget(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'discard',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });

    const connCount = scene.buildConnGeometry(this.connScratch, t);
    if (connCount > 0 && this.connTextureBindGroup) {
      this.device.queue.writeBuffer(this.connVertexBuffer, 0, this.connScratch.subarray(0, connCount * FLOATS_PER_CONN));
      pass.setPipeline(this.connPipeline);
      pass.setBindGroup(0, this.sharedBindGroup);
      pass.setBindGroup(1, this.connTextureBindGroup);
      pass.setVertexBuffer(0, this.connVertexBuffer);
      pass.draw(connCount * VERTS_PER_CONN);
    }

    pass.setPipeline(this.texPipeline);
    pass.setBindGroup(0, this.sharedBindGroup);
    for (const node of scene.nodes) node.drawFaces(pass);

    if (gridNode) {
      pass.setPipeline(this.wirePipeline);
      pass.setBindGroup(0, this.sharedBindGroup);
      gridNode.draw(pass);
    }
    pass.end();

    // Pass 2 — post-process distortion → canvas
    this.postProcess.frame(encoder, canvasView, scene, camera);

    this.device.queue.submit([encoder.finish()]);
  }
}
