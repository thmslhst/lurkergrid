// textured.wgsl — Blinn-Phong lit face geometry
// Group 0: shared view/proj + camPos  |  Group 1: per-node world+color  |  Group 2: texture+sampler

struct Globals {
  viewProj : mat4x4<f32>,
  camPos   : vec4<f32>,
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
  @builtin(position) pos      : vec4<f32>,
  @location(0)       uv       : vec2<f32>,
  @location(1)       worldPos : vec3<f32>,
  @location(2)       normal   : vec3<f32>,
}

@vertex
fn vs(
  @location(0) pos : vec3<f32>,
  @location(1) nrm : vec3<f32>,
  @location(2) uv  : vec2<f32>,
) -> VOut {
  let worldPos4 = node.world * vec4<f32>(pos, 1.0);
  let worldNrm  = normalize((node.world * vec4<f32>(nrm, 0.0)).xyz);
  var out : VOut;
  out.pos      = globals.viewProj * worldPos4;
  out.uv       = uv;
  out.worldPos = worldPos4.xyz;
  out.normal   = worldNrm;
  return out;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let albedo = textureSample(orgTexture, orgSampler, in.uv).rgb;

  // Ensure normal faces the camera (two-sided lighting)
  let viewDir = normalize(globals.camPos.xyz - in.worldPos);
  let N = select(in.normal, -in.normal, dot(in.normal, viewDir) < 0.0);

  // Key light — warm, slightly above and to the right
  let keyPos  = vec3<f32>(10.0, 14.0, 8.0);
  let L       = normalize(keyPos - in.worldPos);
  let H       = normalize(L + viewDir);
  let diff    = max(dot(N, L), 0.0);
  let spec    = pow(max(dot(N, H), 0.0), 64.0);

  // Fill light — cool, opposite side
  let fillDir = normalize(vec3<f32>(-0.5, 0.2, -0.7));
  let fill    = max(dot(N, fillDir), 0.0) * 0.28;

  // Rim light — subtle blue-violet edge glow
  let rimAmt  = pow(1.0 - max(dot(N, viewDir), 0.0), 3.0) * 0.45;

  // Ambient
  let ambient = vec3<f32>(0.08, 0.07, 0.12);

  let diffColor  = vec3<f32>(0.95, 0.90, 0.85);  // warm key
  let fillColor  = vec3<f32>(0.40, 0.50, 0.70);  // cool fill
  let specColor  = vec3<f32>(0.90, 0.92, 1.00);  // near-white specular
  let rimColor   = vec3<f32>(0.30, 0.35, 0.80);  // blue-violet rim

  var color = albedo * (ambient + diff * 0.80 * diffColor + fill * fillColor)
            + specColor * spec * 0.55
            + rimColor  * rimAmt;

  // Tone-map (Reinhard) then gamma encode for sRGB display
  color = color / (color + vec3<f32>(1.0));
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));

  return vec4<f32>(color, node.color.a);
}
