struct Uniforms {
  viewProj : mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> u        : Uniforms;
@group(1) @binding(0) var connSampler       : sampler;
@group(1) @binding(1) var connTexture       : texture_2d<f32>;

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
  let tex = textureSample(connTexture, connSampler, in.uv);
  return vec4<f32>(tex.rgb, 1.0);
}
