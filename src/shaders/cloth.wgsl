// cloth.wgsl — fabric-like rendering for ClothModel
// Softer specular than glass/metal, light transmission through thin fabric,
// slight shimmer at grazing angles. Same bind group layout as textured.wgsl.
//
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

  let viewDir = normalize(globals.camPos.xyz - in.worldPos);
  // Two-sided: flip normal toward the camera
  let N = select(in.normal, -in.normal, dot(in.normal, viewDir) < 0.0);

  // Key light — warm, slightly above
  let keyPos = vec3<f32>(10.0, 14.0, 8.0);
  let L      = normalize(keyPos - in.worldPos);
  let H      = normalize(L + viewDir);
  let diff   = max(dot(N, L), 0.0);

  // Cloth: low-exponent specular (fabric micro-fibers, not glass)
  let spec   = pow(max(dot(N, H), 0.0), 10.0) * 0.18;

  // Fill light — cool
  let fillDir = normalize(vec3<f32>(-0.5, 0.2, -0.7));
  let fill    = max(dot(N, fillDir), 0.0) * 0.22;

  // Transmission: light bleeding through from the back face
  let backDiff  = max(dot(-N, L), 0.0);
  let transAmt  = backDiff * 0.22;

  // Rim — thin-fabric shimmer at silhouette edges
  let rimAmt = pow(1.0 - max(dot(N, viewDir), 0.0), 2.0) * 0.35;

  let ambient   = vec3<f32>(0.07, 0.06, 0.10);
  let diffColor = vec3<f32>(0.90, 0.86, 0.80);   // warm key
  let fillColor = vec3<f32>(0.36, 0.46, 0.62);   // cool fill
  let specColor = vec3<f32>(0.75, 0.78, 0.88);   // soft highlight
  let transColor= vec3<f32>(0.88, 0.78, 0.65);   // warm amber bleed-through
  let rimColor  = vec3<f32>(0.32, 0.38, 0.82);   // blue-violet rim

  var color = albedo * (ambient + diff * 0.72 * diffColor + fill * fillColor + transAmt * transColor)
            + specColor * spec
            + rimColor  * rimAmt;

  // Reinhard tone-map + gamma 2.2
  color = color / (color + vec3<f32>(1.0));
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));

  return vec4<f32>(color, node.color.a);
}
