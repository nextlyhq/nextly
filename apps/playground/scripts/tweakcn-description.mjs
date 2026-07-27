/**
 * Derives the one-line description shown beside a tweakcn preset in the theme
 * lab switcher, from the preset's own values.
 *
 * Written rather than hand-authored because the presets are third-party
 * reference material that gets re-imported wholesale: forty-odd hand-written
 * strings would go stale the first time tweakcn retouched a palette, and a
 * preset added upstream would arrive with no description at all. Deriving them
 * here means the description is a statement about the data that is true by
 * construction, and a regeneration relabels the whole set.
 *
 * Three facets, chosen because they are the three things a reader can't get
 * from the swatch strip alone: how round the corners are (the strip shows no
 * geometry), what hue family the primary belongs to (the strip shows the colour
 * but not its name, so it isn't searchable), and whether the surfaces are warm,
 * cool or neutral (a 2% chroma shift in an off-white is real but nearly
 * invisible at swatch size).
 *
 * Lives in its own module so the importer and its test derive descriptions
 * through the same code path.
 */

/**
 * Reads a CSS colour into OKLCH. tweakcn authors its presets in hex or in
 * `oklch()` and nothing else, so anything unrecognised throws rather than
 * defaulting: a silently mislabelled preset is worse than a failed import,
 * which is the same reason the importer refuses a preset missing a token.
 */
export function toOklch(value) {
  const input = String(value).trim();

  const oklch =
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/.*)?\)$/i.exec(
      input
    );
  if (oklch) {
    return {
      l: readNumber(oklch[1], 1),
      // Chroma may be written as a percentage, where 100% is the 0.4 that
      // OKLCH treats as its practical upper bound.
      c: readNumber(oklch[2], 0.4),
      h: ((parseFloat(oklch[3]) % 360) + 360) % 360,
    };
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(
    input
  );
  if (hex) return hexToOklch(hex[1]);

  throw new Error(`tweakcn-description: cannot read colour "${value}"`);
}

function readNumber(raw, percentBasis) {
  return raw.endsWith("%")
    ? (parseFloat(raw) / 100) * percentBasis
    : parseFloat(raw);
}

/** sRGB hex -> OKLCH, via linear sRGB and OKLab (Björn Ottosson's matrices). */
function hexToOklch(digits) {
  const expanded =
    digits.length <= 4
      ? digits
          .split("")
          .map(d => d + d)
          .join("")
      : digits;
  // A trailing alpha pair is dropped rather than composited: hue and chroma
  // are read off the colour itself, and no preset uses a translucent primary
  // or background.
  const [r, g, b] = [0, 2, 4].map(i =>
    toLinear(parseInt(expanded.slice(i, i + 2), 16) / 255)
  );

  const lms = [
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  ].map(Math.cbrt);

  const l =
    0.2104542553 * lms[0] + 0.793617785 * lms[1] - 0.0040720468 * lms[2];
  const a =
    1.9779984951 * lms[0] - 2.428592205 * lms[1] + 0.4505937099 * lms[2];
  const bb =
    0.0259040371 * lms[0] + 0.7827717662 * lms[1] - 0.808675766 * lms[2];

  return {
    l,
    c: Math.hypot(a, bb),
    h: (((Math.atan2(bb, a) * (180 / Math.PI)) % 360) + 360) % 360,
  };
}

function toLinear(channel) {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/**
 * Hue bands, as upper bounds in OKLCH degrees. OKLCH hue is not the HSL wheel:
 * its primaries land near 29 (red), 60 (orange), 110 (yellow), 145 (green),
 * 195 (teal), 230 (cyan), 265 (blue), 300 (violet) and 330 (magenta), so the
 * boundaries below sit between those landmarks rather than at even 40-degree
 * steps. Reds wrap past 360 and are handled by the final fallback.
 */
const HUE_BANDS = [
  [20, "red"],
  [50, "orange"],
  [95, "amber"],
  [128, "yellow-green"],
  [168, "green"],
  [200, "teal"],
  [232, "cyan"],
  [278, "blue"],
  [318, "violet"],
  [348, "magenta"],
];

/**
 * Below this OKLCH chroma a primary reads as a grey rather than as a colour,
 * so naming a hue family for it would be precise about something invisible.
 * Set at 0.03 because tweakcn's neutral presets sit at or under 0.02 while its
 * most muted real colours (dusty rose, sage) still clear 0.04.
 */
const ACHROMATIC_PRIMARY = 0.03;

/**
 * Surfaces are tinted far more faintly than accents are, so temperature uses
 * its own much lower threshold. Below 0.006 an off-white is neutral to the
 * eye; above it the cast is visible next to a true white.
 */
const NEUTRAL_SURFACE = 0.006;

/** Radius, in rem, at or under which corners still read as square-ish. */
const SOFT_RADIUS = 0.375;
/** Radius, in rem, at which corners stop reading as rounded and read as pills. */
const PILL_RADIUS = 1;

function hueFamily(hue) {
  for (const [upper, name] of HUE_BANDS) {
    if (hue < upper) return name;
  }
  return "red";
}

/** rem or px string -> rem number. Anything else is a preset this can't read. */
function toRem(radius) {
  const match = /^(-?[\d.]+)(rem|px)?$/.exec(String(radius).trim());
  if (!match) {
    throw new Error(`tweakcn-description: cannot read radius "${radius}"`);
  }
  const value = parseFloat(match[1]);
  return match[2] === "px" ? value / 16 : value;
}

function radiusWord(radius) {
  const rem = toRem(radius);
  if (rem <= 0) return "Sharp";
  if (rem <= SOFT_RADIUS) return "Soft";
  if (rem < PILL_RADIUS) return "Rounded";
  return "Pill";
}

/**
 * `radius` is the preset's own `--radius`; `tokens` is its light-mode token
 * map. Light mode rather than dark because a preset's light surfaces carry the
 * tint that makes warm/cool legible -- most dark modes bottom out near the same
 * near-black regardless of what the theme is doing everywhere else.
 */
export function describePreset(radius, tokens) {
  const primary = toOklch(tokens.primary);
  const background = toOklch(tokens.background);

  const primaryPhrase =
    primary.c < ACHROMATIC_PRIMARY
      ? "achromatic primary"
      : `${hueFamily(primary.h)} primary`;

  const surfacePhrase =
    background.c < NEUTRAL_SURFACE
      ? "neutral"
      : // Warm spans red through yellow-green and wraps back through magenta,
        // which is where the pink-tinted presets land.
        background.h < 128 || background.h >= 318
        ? "warm"
        : "cool";

  return `${radiusWord(radius)} corners, ${primaryPhrase}, ${surfacePhrase} surfaces.`;
}
