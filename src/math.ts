export type vec3 = [number, number, number];
export type mat4 = Float32Array<ArrayBuffer>;
export type quat = Float32Array<ArrayBuffer>; // [x, y, z, w]

export function quatIdentity(): quat {
  const q = new Float32Array(4);
  q[3] = 1;
  return q;
}

// Hamilton product: a * b
export function quatMultiply(a: quat, b: quat): quat {
  return new Float32Array([
    a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
    a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
    a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
    a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2],
  ]);
}

export function quatNormalize(q: quat): void {
  const len = Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]);
  if (len > 1e-8) { q[0] /= len; q[1] /= len; q[2] /= len; q[3] /= len; }
}

// Column-major rotation matrix from quaternion [x,y,z,w]
export function quatToMat4(q: quat): mat4 {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const m = new Float32Array(16);
  m[0]  = 1 - 2*(y*y + z*z);  m[1]  = 2*(x*y + w*z);      m[2]  = 2*(x*z - w*y);
  m[4]  = 2*(x*y - w*z);      m[5]  = 1 - 2*(x*x + z*z);  m[6]  = 2*(y*z + w*x);
  m[8]  = 2*(x*z + w*y);      m[9]  = 2*(y*z - w*x);      m[10] = 1 - 2*(x*x + y*y);
  m[15] = 1;
  return m;
}

export function mat4Identity(): mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

// Column-major mat4 multiply: out = a * b
export function mat4Multiply(a: mat4, b: mat4): mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

// WebGPU perspective: z NDC in [0, 1], right-handed view space
export function perspectiveMatrix(fovY: number, aspect: number, near: number, far: number): mat4 {
  const m = new Float32Array(16);
  const f = 1 / Math.tan(fovY / 2);
  m[0]  = f / aspect;
  m[5]  = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = near * far / (near - far);
  return m;
}

// Standard right-handed lookAt
export function lookAtMatrix(eye: vec3, center: vec3, up: vec3): mat4 {
  const fx = center[0] - eye[0], fy = center[1] - eye[1], fz = center[2] - eye[2];
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
  const f: vec3 = [fx / fl, fy / fl, fz / fl];

  const sx = f[1] * up[2] - f[2] * up[1];
  const sy = f[2] * up[0] - f[0] * up[2];
  const sz = f[0] * up[1] - f[1] * up[0];
  const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
  const s: vec3 = [sx / sl, sy / sl, sz / sl];

  const u: vec3 = [s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]];

  const m = new Float32Array(16);
  m[0] = s[0];  m[1] = u[0];  m[2]  = -f[0]; m[3]  = 0;
  m[4] = s[1];  m[5] = u[1];  m[6]  = -f[1]; m[7]  = 0;
  m[8] = s[2];  m[9] = u[2];  m[10] = -f[2]; m[11] = 0;
  m[12] = -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]);
  m[13] = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]);
  m[14] =   f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2];
  m[15] = 1;
  return m;
}

export function translationMatrix(tx: number, ty: number, tz: number): mat4 {
  const m = mat4Identity();
  m[12] = tx; m[13] = ty; m[14] = tz;
  return m;
}

export function rotateY(v: vec3, angle: number): vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

export function rotateX(v: vec3, angle: number): vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}
