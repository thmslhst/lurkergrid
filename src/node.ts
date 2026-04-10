import { translationMatrix, mat4Multiply, quatToMat4, type vec3, type mat4 } from './math';
import type { PlaneModel } from './models/PlaneModel';
import { type PhysicsState, makePhysicsState } from './physics';

type vec4 = [number, number, number, number];

// 16 (world) + 4 (color) + 4 (velocity+speed) + 4 (entropy,t,seed,connCount) + 4 (pad) = 32 floats = 128 bytes
const UNIFORM_BYTES = 128;

export class Node {
  readonly physics: PhysicsState;
  readonly color: vec4;
  readonly model: PlaneModel;
  /** Multiplied into color.a at draw time — used for fade-in / fade-out (0 → 1). */
  alphaScale = 1.0;
  /** Number of active connections — updated by Scene.buildConnections() each frame. */
  connectionCount = 0;

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

  private writeUniforms(entropy = 0, t = 0): void {
    const data = new Float32Array(32); // 128 bytes
    data.set(this.worldMatrix(), 0);   // world mat4  — floats 0-15
    data.set(this.color, 16);          // color vec4  — floats 16-19
    data[19] = this.color[3] * this.alphaScale;
    // velocity vec4: xyz + speed magnitude — floats 20-23
    const vel = this.physics.vel;
    const speed = Math.sqrt(vel[0] ** 2 + vel[1] ** 2 + vel[2] ** 2);
    data[20] = vel[0]; data[21] = vel[1]; data[22] = vel[2]; data[23] = speed;
    // params vec4: entropy, t_ms, seed, connCount — floats 24-27
    data[24] = entropy;
    data[25] = t;
    data[26] = this.physics.seed;
    data[27] = this.connectionCount;
    // floats 28-31: padding (struct must be 128-byte aligned)
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  draw(passEncoder: GPURenderPassEncoder): void {
    this.writeUniforms();
    passEncoder.setBindGroup(1, this.bindGroup);
    passEncoder.setVertexBuffer(0, this.model.edgeBuffer);
    passEncoder.draw(this.model.edgeCount * 2);
  }

  drawFaces(passEncoder: GPURenderPassEncoder, entropy: number, t: number): void {
    if (!this.model.faceBuffer || !this.model.faceBindGroup) return;
    this.writeUniforms(entropy, t);
    passEncoder.setBindGroup(1, this.bindGroup);
    passEncoder.setBindGroup(2, this.model.faceBindGroup);
    passEncoder.setVertexBuffer(0, this.model.faceBuffer);
    passEncoder.draw(this.model.faceCount * 3);
  }
}
