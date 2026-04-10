// karyote.wgsl — bioluminescent cellular organism surface.
// UV cytoplasm flow, velocity-driven chromatic aberration, nucleus pulse,
// per-instance hue variation, connection-count emission, wet-membrane lighting.
//
// Group 0 : shared view/proj + camPos  (80 bytes)
// Group 1 : per-node world + color + velocity + params  (128 bytes)
// Group 2 : sampler + albedo + normalMap + modulation

struct Globals {
  viewProj : mat4x4<f32>,
  camPos   : vec4<f32>,
}
struct NodeUniforms {
  world    : mat4x4<f32>,   // offset   0 — 64 bytes
  color    : vec4<f32>,     // offset  64 — 16 bytes
  velocity : vec4<f32>,     // offset  80 — xyz vel, w = speed magnitude
  params   : vec4<f32>,     // offset  96 — x=entropy, y=t_ms, z=seed, w=connCount
}

@group(0) @binding(0) var<uniform> globals  : Globals;
@group(1) @binding(0) var<uniform> node     : NodeUniforms;
@group(2) @binding(0) var kSampler  : sampler;
@group(2) @binding(1) var albedoTex : texture_2d<f32>;
@group(2) @binding(2) var normalTex : texture_2d<f32>;
@group(2) @binding(3) var modTex    : texture_2d<f32>;

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

// Overlay blend per channel: neutral at 0.5, darkens below, brightens above
fn ovr(a: f32, b: f32) -> f32 {
  return select(1.0 - 2.0*(1.0-a)*(1.0-b), 2.0*a*b, a < 0.5);
}

// Fast hue rotation — equal-power approximation
fn hueRot(rgb: vec3<f32>, ang: f32) -> vec3<f32> {
  let c  = cos(ang);
  let s  = sin(ang);
  let k  = (1.0 - c) / 3.0;
  let sq = s * 0.57735;
  return clamp(
    vec3<f32>(
      rgb.r*(c+k)  + rgb.g*(k-sq) + rgb.b*(k+sq),
      rgb.r*(k+sq) + rgb.g*(c+k)  + rgb.b*(k-sq),
      rgb.r*(k-sq) + rgb.g*(k+sq) + rgb.b*(c+k),
    ),
    vec3<f32>(0.0), vec3<f32>(1.0),
  );
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let entropy   = node.params.x;
  let t         = node.params.y;   // milliseconds
  let seed      = node.params.z;
  let connCount = node.params.w;
  let vel       = node.velocity.xyz;
  let speed     = node.velocity.w;

  // ── UV animation ──────────────────────────────────────────────────────────
  // Slow cytoplasm drift — direction unique per instance via golden-angle spacing
  let flowDir = normalize(vec2<f32>(sin(seed * 1.6180), cos(seed * 2.3999)));
  let uvFlow  = in.uv + flowDir * t * 0.00008;

  // Velocity-driven warp — smear UVs in the direction of motion
  let warpAmt = clamp(speed * 0.038, 0.0, 0.055);
  let warpDir = normalize(vel.xy + vec2<f32>(0.00001));
  let uvWarp  = uvFlow + warpDir * warpAmt;

  // ── Chromatic aberration (proportional to speed) ─────────────────────────
  // Each RGB channel sampled at a slightly different UV — cell-membrane shimmer
  let chromaAmt = clamp(speed * 0.016, 0.0, 0.036);
  let chromaDir = normalize(vel.xy + vec2<f32>(0.00001));
  let aR = textureSample(albedoTex, kSampler, uvWarp + chromaDir * chromaAmt      ).r;
  let aG = textureSample(albedoTex, kSampler, uvWarp                               ).g;
  let aB = textureSample(albedoTex, kSampler, uvWarp - chromaDir * chromaAmt * 0.6).b;
  var albedo = vec3<f32>(aR, aG, aB);

  // Alpha from stable (un-warped) UV so edges don't shimmer away
  let baseAlpha = textureSample(albedoTex, kSampler, in.uv).a;
  let alpha = baseAlpha * node.color.a;
  if (alpha < 0.05) { discard; }

  // ── Per-instance modulation overlay ───────────────────────────────────────
  // Rotate the modulation UV by seed-derived angle: breaks radial symmetry
  let modAngle = seed * 0.7213;
  let mc = cos(modAngle); let ms = sin(modAngle);
  let mOff = uvFlow - vec2<f32>(0.5);
  let modUV = vec2<f32>(mOff.x*mc - mOff.y*ms, mOff.x*ms + mOff.y*mc) + vec2<f32>(0.5);
  let modRgb = textureSample(modTex, kSampler, modUV).rgb;
  // Soft overlay at 38% weight — adds structural variety without killing the base
  albedo = mix(albedo, vec3<f32>(ovr(albedo.r, modRgb.r), ovr(albedo.g, modRgb.g), ovr(albedo.b, modRgb.b)), 0.38);

  // Per-instance hue shift: ±15° spread across the cell population
  let hueAngle = (fract(seed * 0.1373) * 2.0 - 1.0) * 0.26;
  albedo = hueRot(albedo, hueAngle);

  // ── Normal mapping (TBN) ──────────────────────────────────────────────────
  let nMap    = textureSample(normalTex, kSampler, uvWarp).rgb * 2.0 - 1.0;
  let N_geo   = normalize(in.normal);
  let T       = normalize(in.tangent - dot(in.tangent, N_geo) * N_geo);
  let B       = cross(N_geo, T);
  var N_world = normalize(nMap.x * T + nMap.y * B + nMap.z * N_geo);
  let viewDir = normalize(globals.camPos.xyz - in.worldPos);
  // Two-sided: flip normal toward camera so back faces light correctly
  N_world = select(N_world, -N_world, dot(N_world, viewDir) < 0.0);

  // ── Lighting ──────────────────────────────────────────────────────────────
  let keyPos  = vec3<f32>(10.0, 14.0, 8.0);
  let L       = normalize(keyPos - in.worldPos);
  let H       = normalize(L + viewDir);
  let diff    = max(dot(N_world, L), 0.0);
  // Wet membrane: sharp specular (water-like surface tension)
  let spec    = pow(max(dot(N_world, H), 0.0), 34.0) * 0.28;
  let fillDir = normalize(vec3<f32>(-0.5, 0.2, -0.7));
  let fill    = max(dot(N_world, fillDir), 0.0) * 0.15;
  // Subsurface: amber warmth bleeding through from interior cytoplasm
  let backDiff   = max(dot(-N_world, L), 0.0);
  let subsurface = backDiff * 0.32;
  // Rim: bioluminescent green at silhouette, entropy-amplified
  let rimAmt = pow(1.0 - max(dot(N_world, viewDir), 0.0), 3.0) * (0.16 + entropy * 0.52);

  // ── Nucleus pulse (UV-space glow at membrane center) ─────────────────────
  let uvDist     = length(in.uv - vec2<f32>(0.5));
  let nucShape   = exp(-uvDist * uvDist * 20.0);
  let pulseFreq  = 0.0019 * (1.0 + entropy * 3.8);
  let pulse      = 0.5 + 0.5 * sin(t * pulseFreq + seed * 6.2832);
  let nucGlow    = nucShape * pulse * (0.32 + entropy * 0.68);

  // ── Connection glow: connected nodes emit warmer ambient ─────────────────
  let connGlow = clamp(connCount * 0.052, 0.0, 0.44);

  // Material colors — tuned for bioluminescent prokaryote membrane
  let ambient      = vec3<f32>(0.04, 0.06, 0.05);
  let diffColor    = vec3<f32>(0.87, 0.80, 0.73);
  let fillColor    = vec3<f32>(0.18, 0.36, 0.52);
  let specColor    = vec3<f32>(0.86, 0.94, 1.00);
  let subsurfColor = vec3<f32>(0.93, 0.56, 0.16);  // amber cytoplasm
  let rimColor     = vec3<f32>(0.10, 0.64, 0.34);  // bioluminescent green
  let nucColor     = vec3<f32>(0.06, 0.46, 0.22);  // nucleus emission
  let connColor    = vec3<f32>(0.52, 0.40, 0.10);  // warm amber from connections

  var color = albedo * (ambient
            + diff      * 0.68 * diffColor
            + fill      * fillColor
            + subsurface * subsurfColor)
            + specColor  * spec
            + rimColor   * rimAmt
            + nucColor   * nucGlow
            + connColor  * connGlow;

  // Reinhard tone-map + gamma 2.2
  color = color / (color + vec3<f32>(1.0));
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));

  return vec4<f32>(color, alpha);
}
