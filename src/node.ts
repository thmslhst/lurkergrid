import { translationMatrix, mat4Multiply, quatToMat4, type vec3, type mat4 } from './math';
import { type PhysicsState, makePhysicsState } from './physics';

type vec4 = [number, number, number, number];

export interface IModel {
  vertexBuffer: GPUBuffer;
  vertexCount:  number;
}

// 16 floats (world mat4) + 4 floats (color vec4) = 80 bytes
const UNIFORM_BYTES = 80;

export class Node {
  readonly physics: PhysicsState;
  readonly color: vec4;
  readonly model: IModel;
  /** Multiplied into color.a at draw time — used for fade-in / fade-out (0 → 1). */
  alphaScale = 1.0;
  /** When true, renders yellow instead of the node's normal color. */
  isSpawnFlashing = false;
  /** When true, renders red instead of the node's normal color. */
  isCollideFlashing = false;
  /** Number of active connections — updated by Scene.buildConnections() each frame. */
  connectionCount = 0;

  private device!: GPUDevice;
  private uniformBuffer!: GPUBuffer;
  private bindGroup!: GPUBindGroup;

  constructor(model: IModel, home: vec3, color: vec4, seed: number) {
    this.model   = model;
    this.color   = color;
    this.physics = makePhysicsState(home, seed);
  }

  init(device: GPUDevice, layout: GPUBindGroupLayout): void {
    this.device = device;
    this.uniformBuffer = device.createBuffer({
      size:  UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  worldMatrix(): mat4 {
    const r = quatToMat4(this.physics.rot);
    const t = translationMatrix(this.physics.pos[0], this.physics.pos[1], this.physics.pos[2]);
    return mat4Multiply(t, r);
  }

  private writeUniforms(): void {
    const data = new Float32Array(20);
    data.set(this.worldMatrix(), 0);
    if (this.isSpawnFlashing) {
      data.set([1, 1, 0, this.color[3] * this.alphaScale], 16);
    } else if (this.isCollideFlashing) {
      data.set([1, 0, 0, this.color[3] * this.alphaScale], 16);
    } else {
      data.set(this.color, 16);
      data[19] = this.color[3] * this.alphaScale;
    }
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  draw(passEncoder: GPURenderPassEncoder): void {
    this.writeUniforms();
    passEncoder.setBindGroup(1, this.bindGroup);
    passEncoder.setVertexBuffer(0, this.model.vertexBuffer);
    passEncoder.draw(this.model.vertexCount);
  }
}
