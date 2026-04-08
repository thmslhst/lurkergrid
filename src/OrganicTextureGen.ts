// OrganicTextureGen — CPU-side procedural organic textures → GPUTexture
// Three cloud variants: soft (layered fbm), cumulus (domain-warped), nebula (ridge-layered).
// PAGE_SEED is randomised once per load so the texture is never the same across reloads.

export const PAGE_SEED: number = (Math.random() * 0xFFFFFFFF) >>> 0;

export type OrgVariant = 'cellular' | 'veins' | 'membrane';

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function smooth(t: number): number { return t * t * t * (t * (6 * t - 15) + 10); }
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

export class OrganicTextureGen {
  private perm: Uint8Array;

  constructor(seed: number) {
    let s = (seed ^ 0xDEADBEEF) >>> 0;
    const rand = (): number => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {       // Fisher-Yates shuffle
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private h(ix: number, iy: number): number {
    return this.perm[(this.perm[((ix % 256) + 256) % 256] ^ ((iy % 256 + 256) % 256)) & 255] / 255;
  }

  private valueNoise(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const ux = smooth(xf), uy = smooth(yf);
    return lerp(
      lerp(this.h(xi, yi),     this.h(xi + 1, yi),     ux),
      lerp(this.h(xi, yi + 1), this.h(xi + 1, yi + 1), ux),
      uy,
    );
  }

  private fbm(x: number, y: number, oct: number): number {
    let v = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) {
      v += this.valueNoise(x * f, y * f) * a;
      n += a; a *= 0.5; f *= 2.1;
    }
    return v / n;
  }

  private samplePixel(u: number, v: number, variant: OrgVariant): [number, number, number] {

    if (variant === 'cellular') {
      // Overcast fog / rain-grey atmosphere — muted cool slate
      const sc = 3.2;
      const f = this.fbm(u * sc, v * sc, 7);
      const d = this.fbm(u * sc * 2.3 + 1.7, v * sc * 2.3 + 3.1, 4) * 0.22;
      const t = clamp01(Math.pow(f * 0.85 + d, 0.82));
      return [
        Math.floor(lerp(10, 148, Math.pow(t, 1.00))),
        Math.floor(lerp(13, 158, Math.pow(t, 0.95))),
        Math.floor(lerp(20, 172, Math.pow(t, 0.88))),
      ];
    }

    if (variant === 'veins') {
      // Amber resin / dark walnut grain — domain-warped warm earth tones
      const sc = 4.0;
      const wx = this.fbm(u * sc + 0.3, v * sc + 0.7, 4) * 2.2;
      const wy = this.fbm(u * sc + 5.1, v * sc + 1.9, 4) * 2.2;
      const f  = this.fbm(u * sc + wx, v * sc + wy, 7);
      const cx = this.fbm(u * sc * 1.8 + 2.3, v * sc * 1.8 + 0.9, 3) * 0.18;
      const t  = clamp01(Math.pow(f * 0.88 + cx, 0.85));
      return [
        Math.floor(lerp(18, 175, Math.pow(t, 0.88))),
        Math.floor(lerp(12, 132, Math.pow(t, 1.05))),
        Math.floor(lerp(6,  62,  Math.pow(t, 1.65))),
      ];
    }

    // membrane: Voronoi cellular — natural stone / lichen palette
    const sc = 6.5;
    const cx = u * sc, cy = v * sc;
    const xi = Math.floor(cx), yi = Math.floor(cy);
    let d1 = 999, d2 = 999;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = xi + dx, ny = yi + dy;
        const px = nx + this.h(nx, ny);
        const py = ny + this.h(nx + 53, ny + 31);
        const dist = Math.hypot(cx - px, cy - py);
        if (dist < d1) { d2 = d1; d1 = dist; }
        else if (dist < d2) { d2 = dist; }
      }
    }
    const edge   = clamp01((d2 - d1) * 4.0);
    const cell   = clamp01(d1 * 1.8);
    const detail = this.fbm(u * 8.5 + 1.1, v * 8.5 + 2.7, 4) * 0.18;
    const hash   = this.h(Math.floor(cx * 3), Math.floor(cy * 3)) * 0.12;
    const t = clamp01(edge * 0.45 + cell * 0.30 + detail * 0.15 + hash * 0.10);
    // deep slate-green → dusty olive stone → pale mineral cream
    const r = t < 0.5 ? lerp(28,  105, t * 2)       : lerp(105, 185, (t - 0.5) * 2);
    const g = t < 0.5 ? lerp(48,  98,  t * 2)       : lerp(98,  168, (t - 0.5) * 2);
    const b = t < 0.5 ? lerp(38,  72,  t * 2)       : lerp(72,  125, (t - 0.5) * 2);
    return [Math.floor(r), Math.floor(g), Math.floor(b)];
  }

  render(size: number, variant: OrgVariant): Uint8Array<ArrayBuffer> {
    const data = new Uint8Array(new ArrayBuffer(size * size * 4));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, g, b] = this.samplePixel(x / size, y / size, variant);
        const i = (y * size + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
    return data;
  }

  static generate(
    device: GPUDevice, size: number, seed: number, variant: OrgVariant = 'membrane',
  ): GPUTexture {
    const pixels = new OrganicTextureGen(seed).render(size, variant);
    const tex = device.createTexture({
      size: [size, size], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: tex }, pixels, { bytesPerRow: size * 4 }, [size, size],
    );
    return tex;
  }
}
