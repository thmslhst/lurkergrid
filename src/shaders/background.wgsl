struct BgUniforms {
  time : f32,
  resX : f32,
  resY : f32,
}
@group(0) @binding(0) var<uniform> u : BgUniforms;

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return vec4<f32>(pos[vi], 0.0, 1.0);
}

fn h22(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn vnoise(p : vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(h22(i), h22(i + vec2<f32>(1.0, 0.0)), s.x),
    mix(h22(i + vec2<f32>(0.0, 1.0)), h22(i + vec2<f32>(1.0, 1.0)), s.x),
    s.y,
  );
}

// 4-octave smooth noise for cloud-like masses
fn clouds(p : vec2<f32>) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var freq = 1.0;
  for (var i = 0; i < 4; i++) {
    v += vnoise(p * freq) * amp;
    amp  *= 0.5;
    freq *= 2.1;
  }
  return v;
}

@fragment
fn fs(@builtin(position) fragCoord : vec4<f32>) -> @location(0) vec4<f32> {
  let uv     = fragCoord.xy / vec2<f32>(u.resX, u.resY);
  let center = vec2<f32>(0.5, 0.5);
  let aspect = u.resX / u.resY;

  // Radial vignette: slightly lighter at centre, deep dark at edges
  let d    = length((uv - center) * vec2<f32>(aspect, 1.0));
  let grad = clamp(d * 1.3, 0.0, 1.0);
  let base = mix(0.07, 0.01, grad * grad);

  // Cloud layer A — large, slow drift north-east
  let tA  = u.time * 0.000008;
  let cA  = clouds(uv * 1.4 + vec2<f32>(tA, tA * 0.45)) - 0.5;

  // Cloud layer B — medium, drifts slightly south-east, different phase
  let tB  = u.time * 0.000013;
  let cB  = clouds(uv * 2.5 + vec2<f32>(-tB * 0.6, tB * 0.8) + vec2<f32>(3.7, 1.2)) - 0.5;

  // Cloud layer C — fine detail, faster, drifts west
  let tC  = u.time * 0.000022;
  let cC  = clouds(uv * 4.8 + vec2<f32>(-tC, tC * 0.3) + vec2<f32>(8.1, 5.4)) - 0.5;

  // Combine: brighten where clouds accumulate, keep overall dark
  let cloud = cA * 0.040 + cB * 0.022 + cC * 0.010;

  let lum = clamp(base + cloud, 0.0, 1.0);

  // Subtle blue-grey tint
  let r = lum * 0.78;
  let g = lum * 0.82;
  let b = lum * 1.00;
  return vec4<f32>(r, g, b, 1.0);
}
