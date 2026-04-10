// distort.wgsl — screen-space distortion driven by the nodal system.
//
// Each active node acts as a localised lens: nearby screen-pixels are displaced
// in the direction of the node's projected velocity, with a Gaussian falloff.
// At rest the effect is invisible. It builds with speed and global entropy,
// and is further boosted for highly-connected nodes (more connections = wider field).
//
// Layout of NodeInfluence (32 bytes, aligned to 8):
//   ndcPos    vec2<f32>   offset  0
//   vel       vec2<f32>   offset  8   (projected velocity, NDC units/frame)
//   speed     f32         offset 16
//   radius    f32         offset 20   (influence radius in NDC space)
//   connBoost f32         offset 24   (1 + connectionCount * 0.12)
//   _pad      f32         offset 28
//
// Header (16 bytes):
//   nodeCount f32  offset  0
//   entropy   f32  offset  4
//   _pad      vec2 offset  8

const MAX_NODES = 40u;

struct NodeInfluence {
  ndcPos    : vec2<f32>,
  vel       : vec2<f32>,
  speed     : f32,
  radius    : f32,
  connBoost : f32,
  _pad      : f32,
}
struct DistortUniforms {
  nodeCount : f32,
  entropy   : f32,
  _pad      : vec2<f32>,
  nodes     : array<NodeInfluence, 40>,
}

@group(0) @binding(0) var sceneSampler : sampler;
@group(0) @binding(1) var sceneTex     : texture_2d<f32>;
@group(0) @binding(2) var<uniform> u   : DistortUniforms;

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4<f32> {
  // Oversized triangle — covers the full screen in one draw call
  let x = select(-1.0,  3.0, vi == 1u);
  let y = select(-1.0, -1.0, vi == 2u);
  let yy = select(y, 3.0, vi == 2u);
  // Simpler: use a lookup
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return vec4<f32>(pos[vi], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fragPos : vec4<f32>) -> @location(0) vec4<f32> {
  let texDim   = vec2<f32>(textureDimensions(sceneTex, 0));
  let screenUV = fragPos.xy / texDim;
  // Fragment in NDC (Y-flipped: WebGPU clip-space Y+ is up, screen Y+ is down)
  let ndcFrag  = vec2<f32>(screenUV.x * 2.0 - 1.0, 1.0 - screenUV.y * 2.0);

  // Global amplitude: scales with entropy, near-zero at rest
  let amp = 0.0055 * (1.0 + u.entropy * 2.8);

  var totalDisp = vec2<f32>(0.0);

  for (var i = 0u; i < u32(u.nodeCount); i++) {
    let nd = u.nodes[i];
    if nd.speed < 0.0008 { continue; }  // skip near-stationary nodes

    let toFrag = ndcFrag - nd.ndcPos;
    let distSq = dot(toFrag, toFrag);
    let rSq    = (nd.radius * nd.connBoost) * (nd.radius * nd.connBoost);
    if distSq > rSq { continue; }

    // Gaussian falloff — smooth, no hard boundary
    let falloff = exp(-distSq / (rSq * 0.28));

    // Displace in velocity direction: pixels are pulled along the wake
    totalDisp += nd.vel * (nd.speed * falloff * amp);
  }

  // Convert NDC displacement → UV displacement (NDC is ±1, UV is 0..1, Y inverted)
  let uvDisp    = totalDisp * vec2<f32>(0.5, -0.5);
  let sampledUV = clamp(screenUV + uvDisp, vec2<f32>(0.001), vec2<f32>(0.999));

  return textureSample(sceneTex, sceneSampler, sampledUV);
}
