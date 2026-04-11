struct Uniforms {
  viewProj : mat4x4<f32>,
}

struct NodeUniforms {
  world : mat4x4<f32>,
  color : vec4<f32>,
}

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(1) @binding(0) var<uniform> n : NodeUniforms;

struct VSOut {
  @builtin(position) pos         : vec4<f32>,
  @location(0)       worldNormal : vec3<f32>,
}

@vertex
fn vs(
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
) -> VSOut {
  var out : VSOut;
  out.pos         = u.viewProj * n.world * vec4<f32>(pos, 1.0);
  out.worldNormal = normalize((n.world * vec4<f32>(normal, 0.0)).xyz);
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let lightDir = normalize(vec3<f32>(0.6, 1.0, 0.8));
  let ambient  = 0.25;
  let diffuse  = max(dot(in.worldNormal, lightDir), 0.0) * 0.75;
  let lit      = ambient + diffuse;
  return vec4<f32>(n.color.rgb * lit, n.color.a);
}
