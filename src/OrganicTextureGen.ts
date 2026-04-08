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
      // Soft layered clouds — cool blue-white palette
      const sc = 3.2;
      const f = this.fbm(u * sc, v * sc, 7);
      const t = clamp01(Math.pow(f, 0.75));
      return [
        Math.floor(lerp(8,   210, Math.pow(t, 1.1))),
        Math.floor(lerp(14,  230, Math.pow(t, 0.85))),
        Math.floor(lerp(35,  255, Math.pow(t, 0.70))),
      ];
    }

    if (variant === 'veins') {
      // Domain-warped cumulus — warm amber/cream palette
      const sc = 4.0;
      const wx = this.fbm(u * sc + 0.3, v * sc + 0.7, 4) * 2.0;
      const wy = this.fbm(u * sc + 5.1, v * sc + 1.9, 4) * 2.0;
      const f  = this.fbm(u * sc + wx, v * sc + wy, 7);
      const t  = clamp01(Math.pow(f, 0.80));
      return [
        Math.floor(lerp(20,  255, Math.pow(t, 0.90))),
        Math.floor(lerp(10,  210, Math.pow(t, 1.10))),
        Math.floor(lerp(2,   100, Math.pow(t, 1.80))),
      ];
    }

    // membrane: ridge-layered nebula — deep teal / indigo palette
    const sc = 3.5;
    const f1 = this.fbm(u * sc,       v * sc,       6);
    const f2 = this.fbm(u * sc * 1.9 + f1 * 1.2, v * sc * 1.9 + f1 * 0.7, 5);
    const t  = clamp01(f1 * 0.55 + f2 * 0.45);
    return [
      Math.floor(lerp(4,   80,  Math.pow(t, 1.50))),
      Math.floor(lerp(10,  200, Math.pow(t, 0.80))),
      Math.floor(lerp(25,  255, Math.pow(t, 0.60))),
    ];
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
