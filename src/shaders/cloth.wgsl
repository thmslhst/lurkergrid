// cloth.wgsl — fabric rendering with normal map for surface volume.
// Normal map is sampled in tangent space and transformed via TBN to world space,
// giving per-pixel surface detail on top of the animated cloth geometry.
//
// Group 0: shared view/proj + camPos
// Group 1: per-node world + color
// Group 2: sampler + albedo texture + normal map texture

struct Globals {
  viewProj : mat4x4<f32>,
  camPos   : vec4<f32>,
}
struct NodeUniforms {
  world : mat4x4<f32>,
  color : vec4<f32>,
}

@group(0) @binding(0) var<uniform> globals   : Globals;
@group(1) @binding(0) var<uniform> node      : NodeUniforms;
@group(2) @binding(0) var orgSampler  : sampler;
@group(2) @binding(1) var albedoTex   : texture_2d<f32>;
@group(2) @binding(2) var normalTex   : texture_2d<f32>;

struct VOut {
  @builtin(position) pos      : vec4<f32>,
  @location(0)       uv       : vec2<f32>,
  @location(1)       worldPos : vec3<f32>,
  @location(2)       normal   : vec3<f32>,
  @location(3)       tangent  : vec3<f32>,
}

@vertex
fn vs(
  @location(0) pos     : vec3<f32>,
  @location(1) nrm     : vec3<f32>,
  @location(2) uv      : vec2<f32>,
  @location(3) tangent : vec3<f32>,
) -> VOut {
  let worldPos4 = node.world * vec4<f32>(pos, 1.0);
  // Transform directions with the normal matrix (upper-left 3×3 of world matrix).
  // For rigid bodies this equals the world matrix, but we keep it general.
  let worldNrm  = normalize((node.world * vec4<f32>(nrm,     0.0)).xyz);
  let worldTan  = normalize((node.world * vec4<f32>(tangent, 0.0)).xyz);
  var out : VOut;
  out.pos      = globals.viewProj * worldPos4;
  out.uv       = uv;
  out.worldPos = worldPos4.xyz;
  out.normal   = worldNrm;
  out.tangent  = worldTan;
  return out;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let albedoSample = textureSample(albedoTex, orgSampler, in.uv);
  let albedo = albedoSample.rgb;
  let alpha  = albedoSample.a * node.color.a;
  if (alpha < 0.05) { discard; }

  // Decode normal map from [0,1] → [-1,1] (OpenGL / Y-up convention)
  let nMapSample = textureSample(normalTex, orgSampler, in.uv).rgb * 2.0 - 1.0;

  // Gram-Schmidt re-orthogonalise tangent against interpolated normal
  let N_geo = normalize(in.normal);
  let T     = normalize(in.tangent - dot(in.tangent, N_geo) * N_geo);
  let B     = cross(N_geo, T);

  // Transform tangent-space normal to world space
  var N_world = normalize(nMapSample.x * T + nMapSample.y * B + nMapSample.z * N_geo);

  let viewDir = normalize(globals.camPos.xyz - in.worldPos);

  // Two-sided: flip normal toward the camera so back faces still light correctly
  N_world = select(N_world, -N_world, dot(N_world, viewDir) < 0.0);

  // Key light — warm, slightly above
  let keyPos = vec3<f32>(10.0, 14.0, 8.0);
  let L      = normalize(keyPos - in.worldPos);
  let H      = normalize(L + viewDir);
  let diff   = max(dot(N_world, L), 0.0);

  // Cloth micro-fibre specular (low exponent)
  let spec   = pow(max(dot(N_world, H), 0.0), 10.0) * 0.18;

  // Fill light — cool
  let fillDir = normalize(vec3<f32>(-0.5, 0.2, -0.7));
  let fill    = max(dot(N_world, fillDir), 0.0) * 0.22;

  // Thin-fabric transmission: light bleeding through from the back
  let backDiff  = max(dot(-N_world, L), 0.0);
  let transAmt  = backDiff * 0.22;

  // Rim shimmer at silhouette edges
  let rimAmt = pow(1.0 - max(dot(N_world, viewDir), 0.0), 2.0) * 0.35;

  let ambient   = vec3<f32>(0.07, 0.06, 0.10);
  let diffColor = vec3<f32>(0.90, 0.86, 0.80);
  let fillColor = vec3<f32>(0.36, 0.46, 0.62);
  let specColor = vec3<f32>(0.75, 0.78, 0.88);
  let transColor= vec3<f32>(0.88, 0.78, 0.65);
  let rimColor  = vec3<f32>(0.32, 0.38, 0.82);

  var color = albedo * (ambient + diff * 0.72 * diffColor + fill * fillColor + transAmt * transColor)
            + specColor * spec
            + rimColor  * rimAmt;

  // Reinhard tone-map + gamma 2.2
  color = color / (color + vec3<f32>(1.0));
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));

  return vec4<f32>(color, alpha);
}
