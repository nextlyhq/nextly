/**
 * Solves the lightness a token needs to clear a target ratio against a given
 * surface, for any theme.
 *
 * Generalised from the Calm rehabilitation: the same binary search against the
 * harness's own `resolveColor`/`contrastRatio`, so a solved value agrees with
 * the assertion by construction. Hue and chroma are held fixed, which is what
 * keeps a retune a change of legibility rather than of identity.
 *
 * Usage: pnpm theme:solve -- <themeId> <mode> <token> <surfaceToken> <target>
 * Example: pnpm theme:solve -- mono light warning card 5.0
 */

// Both from the barrel, which layers the accessibility corrections over the
// generated presets. Reading the generated file directly solved against RAW
// upstream values for any corrected preset, so the "current ratio" it reported
// described a theme the lab never renders and its proposed replacement could
// reinstate a value that was corrected for exactly this reason.
const { NEXTLY_THEMES, TWEAKCN_THEMES } = await import(
  "../src/theme-lab/themes/index.ts"
);
const { contrastRatio, compositeOver } = await import(
  "../../../packages/ui/src/styles/contrast/color.ts"
);
const { resolveColor } = await import(
  "../../../packages/ui/src/styles/contrast/resolve.ts"
);

const [, , themeId, mode, token, surfaceToken, targetRaw] = process.argv;
const target = Number(targetRaw);

const theme = [...NEXTLY_THEMES, ...TWEAKCN_THEMES].find(t => t.id === themeId);
if (!theme) throw new Error(`no theme "${themeId}"`);
const tokens = theme[mode];

const ctx = {
  tokens: new Map(Object.entries(tokens).map(([k, v]) => [`--nx-${k}`, v])),
  scale: new Map(),
};
const WHITE = { r: 1, g: 1, b: 1, alpha: 1 };

const current = tokens[token];
const m = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/.exec(current);
if (!m) throw new Error(`token "${token}" is not a plain oklch: ${current}`);
const [, l0, chroma, hue] = m;

let surface = resolveColor(tokens[surfaceToken], ctx);
if (surface.alpha < 1) surface = compositeOver(surface, WHITE);

const at = l => {
  let c = resolveColor(`oklch(${l} ${chroma} ${hue})`, ctx);
  if (c.alpha < 1) c = compositeOver(c, surface);
  return contrastRatio(c, surface);
};

// Which way clears the target: a text token on a light surface darkens, on a
// dark surface lightens. Decided by measurement rather than by assuming.
const darker = at(0) >= target;
let lo = darker ? 0 : Number(l0);
let hi = darker ? Number(l0) : 1;
if (darker) {
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) >= target) lo = mid;
    else hi = mid;
  }
} else {
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) >= target) hi = mid;
    else lo = mid;
  }
}
const solved = darker ? lo : hi;

console.log(
  `${themeId}/${mode} ${token} on ${surfaceToken}: ${Number(l0).toFixed(4)} -> ${solved.toFixed(4)}  (${at(Number(l0)).toFixed(2)}:1 -> ${at(solved).toFixed(2)}:1, target ${target})`
);
console.log(`  new value: oklch(${solved.toFixed(4)} ${chroma} ${hue})`);
