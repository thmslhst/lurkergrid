// textured.wgsl — Vertex + fragment for organic texture-mapped face geometry
// Group 0: shared view/proj  |  Group 1: per-node world+color  |  Group 2: texture+sampler

struct Globals {
  viewProj : mat4x4<f32>,
}
struct NodeUniforms {
  world : mat4x4<f32>,
  color : vec4<f32>,
}

@group(0) @binding(0) var<uniform> globals : Globals;
@group(1) @binding(0) var<uniform> node    : NodeUniforms;
@group(2) @binding(0) var orgSampler : sampler;
@group(2) @binding(1) var orgTexture : texture_2d<f32>;

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
  out.pos = globals.viewProj * node.world * vec4<f32>(pos, 1.0);
  out.uv  = uv;
  return out;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let tex = textureSample(orgTexture, orgSampler, in.uv);
  return vec4<f32>(tex.rgb, node.color.a);
}
