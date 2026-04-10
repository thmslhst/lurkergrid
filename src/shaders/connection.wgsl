struct Uniforms {
  viewProj : mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> u : Uniforms;

struct VOut {
  @builtin(position) pos : vec4<f32>,
  @location(0)       uv  : vec2<f32>,
}

@vertex
fn vs(
  @location(0) pos : vec3<f32>,
  @location(1) uv  : vec2<f32>,
) -> VOut {
  var out : VOut;
  out.pos = u.viewProj * vec4<f32>(pos, 1.0);
  out.uv  = uv;
  return out;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let t     = fract(in.uv.x * 0.35);
  let alpha = sin(t * 3.14159265) * 0.35 + 0.08;
  return vec4<f32>(0.52, 0.55, 0.60, alpha);
}
