/**
 * Measures how heavily each theme draws its boundaries.
 *
 * Two things a contrast suite does not answer, because both are questions
 * about weight rather than about a floor:
 *
 * 1. A boundary can fail by being too LOUD. WCAG only sets a minimum (3:1 for
 *    a boundary that identifies a control), so a gate built on it is silent
 *    about a divider at 6:1 drawing itself as a wall.
 * 2. A control can fail by being too QUIET. `input` and the checkbox border
 *    sit at that 3:1 minimum, and a theme landing just under it leaves a
 *    control with no visible edge.
 *
 * So this reports the SPREAD rather than a pass or a fail, per theme per mode,
 * and writes it as evidence: how heavy is too heavy is a design judgement, not
 * a line a test can draw.
 *
 * Run: pnpm theme:audit  (tsx scripts/audit-themes.mjs)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { contrastSourceStamp } from "./contrast-source-stamp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolvePath(here, "../../..");

const { NEXTLY_THEMES, TWEAKCN_THEMES } = await import(
  "../src/theme-lab/themes/index.ts"
);
const { validateTheme } = await import("../src/theme-lab/validate-contrast.ts");
const { contrastRatio, compositeOver } = await import(
  "../../../packages/ui/src/styles/contrast/color.ts"
);

/**
 * The opaque colour a translucent surface ends up over: the mode's own page
 * background, not a fixed white. A dark theme's page is near-black, so
 * compositing its alpha tokens over white inverts the result -- a translucent
 * light border on a dark page was scored as a dark border on a light one, and
 * every dark-mode number in the report was measured against a page that does
 * not exist.
 */
function pageUnder(tokens, ctx) {
  const page = resolveColor(tokens.background, ctx);
  return page && page.alpha === 1 ? page : { r: 1, g: 1, b: 1, alpha: 1 };
}
const { resolveColor } = await import(
  "../../../packages/ui/src/styles/contrast/resolve.ts"
);

const themeCss = readFileSync(
  resolvePath(root, "packages/ui/src/styles/theme.css"),
  "utf8"
);

const ALL = [...NEXTLY_THEMES, ...TWEAKCN_THEMES];

/**
 * Resolves a token against its own theme's map so `var(--nx-primary)`
 * references and alpha values composite the way the browser composites them.
 */
function ratio(tokens, fg, bg) {
  const ctx = {
    tokens: new Map(Object.entries(tokens).map(([k, v]) => [`--nx-${k}`, v])),
    scale: new Map(),
  };
  const a = resolveColor(tokens[fg], ctx);
  const b = resolveColor(tokens[bg], ctx);
  if (!a || !b) return null;
  // Composite BOTH over their backdrop before comparing. Most border tokens
  // are translucent (`oklch(0 0 0 / 0.445)`), and comparing one as if it were
  // opaque reports a 44%-opacity hairline as solid black -- which is how a
  // first run of this script scored Mono's border at 21:1, the theoretical
  // maximum, and called every theme's rules "prominent".
  const surface = b.alpha < 1 ? compositeOver(b, pageUnder(tokens, ctx)) : b;
  const rule = a.alpha < 1 ? compositeOver(a, surface) : a;
  return contrastRatio(rule, surface);
}

/**
 * How a boundary reads. The band is a judgement recorded once here rather
 * than re-argued per theme: below 1.5 a rule is decorative to the point of
 * absence, 3.0 is WCAG's floor for a boundary that identifies a control, and
 * past 4.5 a divider is drawing as hard as body text.
 */
function band(r) {
  if (r === null) return "unresolvable";
  if (r < 1.5) return "invisible";
  if (r < 3) return "faint";
  if (r <= 4.5) return "clear";
  return "prominent";
}

const evidence = [];

for (const theme of ALL) {
  for (const mode of ["light", "dark"]) {
    const t = theme[mode];
    const boundaries = {};
    for (const [label, fg, bg] of [
      ["border on page", "border", "page-background"],
      ["border on card", "border", "card"],
      ["border-subtle on card", "border-subtle", "card"],
      ["border-strong on page", "border-strong", "page-background"],
      ["input on card", "input", "card"],
      ["sidebar-border on sidebar", "sidebar-border", "sidebar-background"],
      ["table-border on card", "table-border", "card"],
    ]) {
      const r = ratio(t, fg, bg);
      boundaries[label] = { ratio: r === null ? null : +r.toFixed(2), band: band(r) };
    }

    // Does the selected nav row use the PRIMARY colour as its fill? The
    // founder's report was "menu items are using primary". `sidebar-accent`
    // is the intended selected-row fill; equality with primary means the
    // theme routed a brand colour into a nav state.
    const navUsesPrimary =
      t["sidebar-accent"] === t.primary ||
      t["sidebar-accent"] === t["sidebar-primary"];

    evidence.push({
      theme: theme.id,
      label: theme.label,
      group: theme.group,
      mode,
      boundaries,
      navSelectedUsesPrimary: navUsesPrimary,
      // Surfaces: how far the page, card and popover separate from each
      // other. A set that barely separates is the "background issues" report.
      surfaceSeparation: {
        "page vs card": +(ratio(t, "page-background", "card") ?? 0).toFixed(3),
        "card vs popover": +(ratio(t, "card", "popover") ?? 0).toFixed(3),
        "muted vs card": +(ratio(t, "muted", "card") ?? 0).toFixed(3),
      },
    });
  }
}

const failures = {};
for (const theme of ALL) {
  failures[theme.id] = validateTheme(theme, themeCss).map(f => ({
    mode: f.mode,
    label: f.label,
    ratio: +f.ratio.toFixed(2),
  }));
}

// Contents rather than a commit: see `contrast-source-stamp.mjs`.
const contrastSourceRev = contrastSourceStamp(root);

const outDir = resolvePath(here, "../src/theme-lab/audit-evidence");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  resolvePath(outDir, "tokens.json"),
  `${JSON.stringify(
    {
      generatedBy: "scripts/audit-themes.mjs",
      contrastSourceRev,
      note: "Ratios are only comparable with others taken against the same contrastSourceRev.",
      themes: evidence,
      wcagFailures: failures,
    },
    null,
    2
  )}\n`
);

// A readable summary, so the report can quote without re-deriving.
const prominent = evidence.flatMap(e =>
  Object.entries(e.boundaries)
    .filter(([, v]) => v.band === "prominent")
    .map(([k, v]) => `${e.theme}/${e.mode}: ${k} ${v.ratio}:1`)
);
const invisible = evidence.flatMap(e =>
  Object.entries(e.boundaries)
    .filter(([, v]) => v.band === "invisible")
    .map(([k, v]) => `${e.theme}/${e.mode}: ${k} ${v.ratio}:1`)
);
const navPrimary = evidence
  .filter(e => e.navSelectedUsesPrimary)
  .map(e => `${e.theme}/${e.mode}`);

console.log(`contrast source: ${contrastSourceRev}`);
console.log(`\nPROMINENT boundaries (>4.5:1, drawing as hard as body text): ${prominent.length}`);
prominent.forEach(l => console.log(`  ${l}`));
console.log(`\nINVISIBLE boundaries (<1.5:1): ${invisible.length}`);
invisible.forEach(l => console.log(`  ${l}`));
console.log(`\nNav selected row filled with primary: ${navPrimary.length}`);
navPrimary.forEach(l => console.log(`  ${l}`));
console.log(`\nwrote ${outDir}/tokens.json`);
