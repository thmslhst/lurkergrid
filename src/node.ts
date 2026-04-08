import { translationMatrix, mat4Multiply, quatToMat4, type vec3, type mat4 } from './math';
import type { PlaneModel } from './models/PlaneModel';
import { type PhysicsState, makePhysicsState } from './physics';

type vec4 = [number, number, number, number];

// 16 floats (world mat4) + 4 floats (color vec4) = 80 bytes
const UNIFORM_BYTES = 80;

export class Node {
  readonly physics: PhysicsState;
  readonly color: vec4;
  readonly model: PlaneModel;

  private device!: GPUDevice;
  private uniformBuffer!: GPUBuffer;
  private bindGroup!: GPUBindGroup;

  constructor(model: PlaneModel, home: vec3, color: vec4, seed: number) {
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
    data.set(this.color, 16);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  draw(passEncoder: GPURenderPassEncoder): void {
    this.writeUniforms();
    passEncoder.setBindGroup(1, this.bindGroup);
    passEncoder.setVertexBuffer(0, this.model.edgeBuffer);
    passEncoder.draw(this.model.edgeCount * 2);
  }

  drawFaces(passEncoder: GPURenderPassEncoder): void {
    if (!this.model.faceBuffer || !this.model.faceBindGroup) return;
    this.writeUniforms();
    passEncoder.setBindGroup(1, this.bindGroup);
    passEncoder.setBindGroup(2, this.model.faceBindGroup);
    passEncoder.setVertexBuffer(0, this.model.faceBuffer);
    passEncoder.draw(this.model.faceCount * 3);
  }
}
