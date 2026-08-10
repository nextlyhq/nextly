/**
 * Conversions between the colour models an editing surface needs.
 *
 * ## Why each model is here
 *
 * - **sRGB** is what a screen displays and what `#rrggbb` encodes. Everything ends here.
 * - **HSV** is what a colour picker is: a square of saturation against value, beside a hue
 *   strip. No other model puts those three controls in the shape people expect.
 * - **OKLCH** is what this product's own theme is written in — every token in `theme.css` is an
 *   `oklch()` value. A picker that cannot read it cannot edit the theme.
 *
 * ## Why the maths is here rather than in a library
 *
 * These are fixed, published transforms: the sRGB transfer function and the OKLab matrices are
 * specified in CSS Color 4 and do not change. The package ships no runtime colour dependency, and
 * this module keeps it that way. `culori` remains a DEV dependency used as a test oracle — the
 * conversions here are cross-checked against it rather than trusted on their own.
 *
 * ## The part that is genuinely hard
 *
 * OKLCH describes more colours than a screen can show. Converting one that falls outside sRGB has
 * no correct answer, only choices, and the naive choice — clamp each channel independently — is
 * the wrong one: it shifts hue, because clipping red without clipping green changes the ratio
 * between them. {@link oklchToRgb} reduces chroma instead, holding lightness and hue, which is the
 * approach CSS Color 4 describes for gamut mapping.
 *
 * @module lib/color/convert
 */

/** An sRGB colour with channels in [0, 1]. Alpha is carried separately. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Hue in [0, 360), saturation and value in [0, 1]. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** Perceptual lightness in [0, 1], chroma from 0, hue in [0, 360). */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Wrap a hue into [0, 360), so -30 and 330 are the same angle. */
export function normalizeHue(hue: number): number {
  if (!Number.isFinite(hue)) return 0;
  const wrapped = hue % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * HSV to sRGB.
 *
 * Saturation and value are clamped rather than rejected: a picker drags them, and a drag that
 * overshoots by a rounding error should saturate rather than throw.
 */
export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = normalizeHue(h);
  const sat = clamp01(s);
  const val = clamp01(v);

  const sector = hue / 60;
  const chroma = val * sat;
  // The second-largest component, which falls as the hue moves away from a primary.
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const base = val - chroma;

  let rgb: [number, number, number];
  if (sector < 1) rgb = [chroma, x, 0];
  else if (sector < 2) rgb = [x, chroma, 0];
  else if (sector < 3) rgb = [0, chroma, x];
  else if (sector < 4) rgb = [0, x, chroma];
  else if (sector < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];

  return { r: rgb[0] + base, g: rgb[1] + base, b: rgb[2] + base };
}

/**
 * sRGB to HSV.
 *
 * Hue is UNDEFINED for a grey and value is undefined for black, and this returns 0 for both. A
 * picker must not take that 0 as the user's hue: it is the absence of one. Holding hue across a
 * drag to zero saturation is the caller's job, which is why a picker keeps HSV as its state
 * rather than deriving it from the colour each render.
 */
export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const red = clamp01(r);
  const green = clamp01(g);
  const blue = clamp01(b);

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const chroma = max - min;

  let hue = 0;
  if (chroma !== 0) {
    if (max === red) hue = ((green - blue) / chroma) % 6;
    else if (max === green) hue = (blue - red) / chroma + 2;
    else hue = (red - green) / chroma + 4;
    hue *= 60;
  }

  return {
    h: normalizeHue(hue),
    s: max === 0 ? 0 : chroma / max,
    v: max,
  };
}

/** The sRGB transfer function, gamma-encoded to linear light. */
function toLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** The inverse transfer function, linear light back to gamma-encoded. */
function toGamma(channel: number): number {
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

/**
 * Linear sRGB to OKLab.
 *
 * The two matrices and the cube root between them are the definition of OKLab, given in CSS
 * Color 4. They are transcribed rather than derived.
 */
function linearRgbToOklab(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

/** OKLab back to linear sRGB, the inverse of {@link linearRgbToOklab}. */
function oklabToLinearRgb(
  L: number,
  a: number,
  b: number
): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** sRGB to OKLCH. */
export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const [L, A, B] = linearRgbToOklab(
    toLinear(clamp01(r)),
    toLinear(clamp01(g)),
    toLinear(clamp01(b))
  );
  const chroma = Math.sqrt(A * A + B * B);
  // Below this the hue angle is numerical noise rather than a colour, so it is reported as 0
  // instead of whatever direction the rounding happened to point.
  const hue =
    chroma < 1e-6 ? 0 : normalizeHue((Math.atan2(B, A) * 180) / Math.PI);
  return { l: L, c: chroma, h: hue };
}

/** Whether every channel of a linear triple lies within the displayable range. */
function inGamut([r, g, b]: [number, number, number]): boolean {
  // A small tolerance, because the round trip through cube roots does not land exactly on the
  // boundary for a colour that sits on it.
  const epsilon = 1e-6;
  return (
    r >= -epsilon &&
    r <= 1 + epsilon &&
    g >= -epsilon &&
    g <= 1 + epsilon &&
    b >= -epsilon &&
    b <= 1 + epsilon
  );
}

/**
 * OKLCH to sRGB, reducing chroma until the colour fits on screen.
 *
 * OKLCH can name colours a display cannot show. Clamping the channels independently is the
 * obvious response and the wrong one: clipping red without clipping green changes the ratio
 * between them, so the colour that appears is a DIFFERENT HUE from the one asked for. Lightness
 * and hue are what a person chose; chroma is the part they will not miss, so chroma is what is
 * given up.
 *
 * The search is a bisection on chroma, which converges to well under a perceptible step in the
 * fixed number of rounds below — no loop that might not terminate.
 */
export function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const lightness = clamp01(l);
  const hueRadians = (normalizeHue(h) * Math.PI) / 180;

  const at = (chroma: number): [number, number, number] =>
    oklabToLinearRgb(
      lightness,
      chroma * Math.cos(hueRadians),
      chroma * Math.sin(hueRadians)
    );

  const requested = Math.max(0, c);
  let fitting = at(requested);

  if (!inGamut(fitting)) {
    let low = 0;
    let high = requested;
    // Twenty halvings take the interval below one part in a million of the starting chroma,
    // which is far finer than a screen or an eye can resolve.
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (inGamut(at(mid))) low = mid;
      else high = mid;
    }
    fitting = at(low);
  }

  return {
    r: clamp01(toGamma(fitting[0])),
    g: clamp01(toGamma(fitting[1])),
    b: clamp01(toGamma(fitting[2])),
  };
}
