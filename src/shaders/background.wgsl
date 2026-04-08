struct BgUniforms {
  time : f32,
  resX : f32,
  resY : f32,
  _pad : f32,
}
@group(0) @binding(0) var<uniform> u : BgUniforms;

// Fullscreen triangle — no vertex buffer needed
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
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);  // smoothstep
  return mix(
    mix(h22(i),                       h22(i + vec2<f32>(1.0, 0.0)), s.x),
    mix(h22(i + vec2<f32>(0.0, 1.0)), h22(i + vec2<f32>(1.0, 1.0)), s.x),
    s.y,
  );
}

fn fbm(p0 : vec2<f32>) -> f32 {
  var v = 0.0; var a = 0.5; var p = p0;
  for (var i = 0; i < 7; i++) {
    v += vnoise(p) * a;
    p  = p * 2.03 + vec2<f32>(0.311, 0.173);
    a *= 0.5;
  }
  return v;
}

@fragment
fn fs(@builtin(position) fragCoord : vec4<f32>) -> @location(0) vec4<f32> {
  let t1 = u.time * 0.00005;   // very slow base drift
  let t2 = u.time * 0.00009;   // mid warp layer
  let t3 = u.time * 0.00014;   // fine warp layer — gives parallax

  let uv = fragCoord.xy / vec2<f32>(u.resX, u.resY);

  // Three-pass domain warp: each layer warps the next → cumulus / nebula feel
  let q = fbm(uv * 3.0 + vec2<f32>(t1,          t1 * 0.7));
  let r = fbm(uv * 3.0 + vec2<f32>(q  + t2,     q  * 0.8 - t2 * 0.4));
  let f = fbm(uv * 2.5 + vec2<f32>(r  * 1.7 - t3 * 0.3, r  * 1.1 + t3));

  let c  = clamp(pow(f, 0.85), 0.0, 1.0);
  let c2 = c * c;

  // Deep indigo → teal palette — dark enough that gray nodes stay legible
  let col = mix(
    vec3<f32>(0.01, 0.01, 0.04),   // void black-blue
    mix(
      vec3<f32>(0.03, 0.06, 0.14), // deep indigo
      vec3<f32>(0.07, 0.14, 0.24), // dark teal highlight
      c,
    ),
    c2,
  );

  return vec4<f32>(col, 1.0);
}
