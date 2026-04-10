// karyote.wgsl — high-definition bacterial membrane surface.
// Normal-mapped Blinn-Phong with wet-membrane specular and thin-tissue subsurface.
// No animated effects — all motion comes from the post-processing distortion pass.
//
// Group 0 : shared view/proj + camPos
// Group 1 : per-node world + color
// Group 2 : sampler + albedo (x.png) + normalMap (x-normal.png)

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
@group(2) @binding(0) var kSampler  : sampler;
@group(2) @binding(1) var albedoTex : texture_2d<f32>;
@group(2) @binding(2) var normalTex : texture_2d<f32>;

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
  let wp4 = node.world * vec4<f32>(pos, 1.0);
  var out : VOut;
  out.pos      = globals.viewProj * wp4;
  out.uv       = uv;
  out.worldPos = wp4.xyz;
  out.normal   = normalize((node.world * vec4<f32>(nrm,     0.0)).xyz);
  out.tangent  = normalize((node.world * vec4<f32>(tangent, 0.0)).xyz);
  return out;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let albedoSample = textureSample(albedoTex, kSampler, in.uv);
  let albedo = albedoSample.rgb;
  let alpha  = albedoSample.a * node.color.a;
  if alpha < 0.05 { discard; }

  // TBN normal mapping
  let nMap  = textureSample(normalTex, kSampler, in.uv).rgb * 2.0 - 1.0;
  let N_geo = normalize(in.normal);
  let T     = normalize(in.tangent - dot(in.tangent, N_geo) * N_geo);
  let B     = cross(N_geo, T);
  var N     = normalize(nMap.x * T + nMap.y * B + nMap.z * N_geo);

  let viewDir = normalize(globals.camPos.xyz - in.worldPos);
  // Two-sided: flip toward camera so back faces light correctly
  N = select(N, -N, dot(N, viewDir) < 0.0);

  // Key light — camera-aligned headlight, always faces what the camera sees
  let L    = viewDir;
  let H    = normalize(L + viewDir);
  let diff = max(dot(N, L), 0.0);
  // Wet membrane: moderately sharp specular
  let spec = pow(max(dot(N, H), 0.0), 52.0) * 0.30;

  // Cool fill — opposite side, left-back
  let fillDir = normalize(vec3<f32>(-0.6, 0.1, -0.8));
  let fill    = max(dot(N, fillDir), 0.0) * 0.22;

  // Low fill — from below, prevents bottom faces going completely black
  let lowDir  = normalize(vec3<f32>(0.1, -1.0, 0.3));
  let lowFill = max(dot(N, lowDir), 0.0) * 0.18;

  // Thin-tissue subsurface: warm back-scatter through the membrane
  let backDiff = max(dot(-N, L), 0.0);
  let sss      = backDiff * 0.26;

  // Rim: subtle silhouette definition, not theatrical
  let rimFac = pow(1.0 - max(dot(N, viewDir), 0.0), 4.0) * 0.14;

  var color = albedo * (
      vec3<f32>(0.28, 0.27, 0.25)               // ambient — high enough so no face goes black
    + diff * 0.65 * vec3<f32>(0.90, 0.85, 0.78) // warm key diffuse
    + fill         * vec3<f32>(0.22, 0.34, 0.48) // cool side fill
    + lowFill      * vec3<f32>(0.30, 0.28, 0.40) // dim low fill
    + sss          * vec3<f32>(0.88, 0.54, 0.18) // amber subsurface
  )
  + vec3<f32>(0.88, 0.93, 1.00) * spec           // cool specular sheen
  + vec3<f32>(0.70, 0.72, 0.74) * rimFac;        // neutral rim

  // Reinhard tone-map + gamma 2.2
  color = color / (color + vec3<f32>(1.0));
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));

  return vec4<f32>(color, alpha);
}
