/**
 * Regenerates the tweakcn preset themes from their published source.
 *
 * Their tokens are the unprefixed shadcn set; Nextly's are the same set behind
 * an `--nx-` prefix plus extras. Tokens Nextly requires but shadcn has no
 * concept of are derived here rather than defaulted silently, because a missing
 * value would render as an inherited leftover and read as a design choice.
 *
 * Run: node scripts/import-tweakcn.mjs
 */
import { writeFileSync } from "node:fs";

import { describePreset } from "./tweakcn-description.mjs";

const SOURCE =
  "https://raw.githubusercontent.com/jnsahaj/tweakcn/main/utils/theme-presets.ts";

/** shadcn name -> Nextly token name (both without the `--nx-` prefix). */
const DIRECT = {
  background: "background",
  foreground: "foreground",
  card: "card",
  "card-foreground": "card-foreground",
  popover: "popover",
  "popover-foreground": "popover-foreground",
  primary: "primary",
  "primary-foreground": "primary-foreground",
  secondary: "secondary",
  "secondary-foreground": "secondary-foreground",
  muted: "muted",
  "muted-foreground": "muted-foreground",
  accent: "accent",
  "accent-foreground": "accent-foreground",
  destructive: "destructive",
  "destructive-foreground": "destructive-foreground",
  border: "border",
  input: "input",
  sidebar: "sidebar-background",
  "sidebar-foreground": "sidebar-foreground",
  "sidebar-primary": "sidebar-primary",
  "sidebar-primary-foreground": "sidebar-primary-foreground",
  "sidebar-accent": "sidebar-accent",
  "sidebar-accent-foreground": "sidebar-accent-foreground",
  "sidebar-border": "sidebar-border",
};

/**
 * Nextly tokens with no shadcn equivalent, copied verbatim from the shipped
 * design system (packages/ui/src/styles/theme.css, :root for light and .dark
 * for dark) rather than invented for a third-party palette. `highlight` styles
 * a rich-text marker and the `code-*` group is a syntax palette; tweakcn's
 * preset shape has no field for either, so there is nothing to derive them
 * from. Kept in sync by hand if theme.css changes.
 */
const SHIPPED = {
  light: {
    highlight: "oklch(0.9297 0.1638 101.06)",
    "highlight-foreground": "oklch(0.2079 0.0399 265.73)",
    "code-bg": "oklch(0.9761 0.0035 247.86)",
    "code-fg": "oklch(0.2079 0.0399 265.73)",
    "code-comment": "oklch(0.541 0.0407 257.44)",
    "code-keyword": "oklch(0.4882 0.2172 303.9)",
    "code-string": "oklch(0.4478 0.1189 152.1)",
    "code-number": "oklch(0.5106 0.1518 44.2)",
    "code-function": "oklch(0.4757 0.1444 254.6)",
    "code-operator": "oklch(0.4936 0.1418 8.4)",
    "code-punctuation": "oklch(0.541 0.0407 257.44)",
    "code-variable": "oklch(0.4694 0.1173 62.3)",
    "code-tag": "oklch(0.5054 0.1905 27.5)",
    "code-deleted": "oklch(0.5054 0.1905 27.5)",
    "code-inserted": "oklch(0.4478 0.1189 152.1)",
  },
  dark: {
    highlight: "oklch(0.8 0.1425 101.06)",
    "highlight-foreground": "oklch(0.2079 0.0399 265.73)",
    "code-bg": "oklch(0.1916 0.0228 266.36)",
    "code-fg": "oklch(0.9838 0.0035 247.86)",
    "code-comment": "oklch(0.6626 0.0364 256.79)",
    "code-keyword": "oklch(0.7482 0.1235 303.9)",
    "code-string": "oklch(0.7654 0.1476 152.1)",
    "code-number": "oklch(0.7807 0.1189 44.2)",
    "code-function": "oklch(0.7365 0.1163 254.6)",
    "code-operator": "oklch(0.7549 0.1234 8.4)",
    "code-punctuation": "oklch(0.6626 0.0364 256.79)",
    "code-variable": "oklch(0.7938 0.1052 62.3)",
    "code-tag": "oklch(0.7118 0.1476 27.5)",
    "code-deleted": "oklch(0.7118 0.1476 27.5)",
    "code-inserted": "oklch(0.7654 0.1476 152.1)",
  },
};

/** Nextly tokens shadcn has no equivalent for, derived from what it does have. */
function derive(src, mode) {
  const mixToward = mode === "light" ? "black" : "white";
  return {
    "page-background": src.muted ?? src.background,
    "destructive-solid": src.destructive,
    success:
      mode === "light" ? "oklch(0.53 0.17 149.2)" : "oklch(0.6 0.1921 149.58)",
    "success-solid":
      mode === "light"
        ? "oklch(0.53 0.17 149.2)"
        : "oklch(0.5225 0.1921 149.58)",
    "success-foreground": "oklch(1 0 0)",
    warning:
      mode === "light"
        ? "oklch(0.565 0.1646 70.11)"
        : "oklch(0.7686 0.1646 70.11)",
    "warning-foreground": "oklch(0.2079 0.0399 265.73)",
    "border-subtle": `color-mix(in srgb, ${src.border}, transparent 60%)`,
    "border-strong": `color-mix(in srgb, ${src.border}, ${mixToward} 25%)`,
    "shadow-color": src["shadow-color"] ?? "oklch(0 0 0)",
    "table-row-hover": src.muted ?? src.accent,
    // The header band sits on the card and is separated from it by its own
    // border, so it follows the card rather than carrying a colour of its own.
    // Required, so a preset missing it fails generation rather than silently
    // keeping the shipped neutral while every other surface retints.
    "table-header-bg": "var(--nx-card)",
    // var() references, not resolved literals, so they keep tracking the
    // theme's own primary/border if a future edit retouches either.
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    ...SHIPPED[mode],
  };
}

function mapMode(src, mode) {
  const out = {};
  for (const [from, to] of Object.entries(DIRECT)) {
    const value = src[from];
    if (!value) {
      throw new Error(`tweakcn preset is missing "${from}" in ${mode} mode`);
    }
    out[to] = value;
  }
  return { ...out, ...derive(src, mode) };
}

const text = await fetch(SOURCE).then(r => {
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  return r.text();
});

// The source is a TypeScript module, so the object literal is extracted rather
// than imported: evaluating fetched code would be arbitrary remote execution.
//
// Preset keys are quoted only when the slug needs it (contains a hyphen);
// single-word slugs such as `mono` or `catppuccin` are valid identifiers and
// the source's own formatter leaves them unquoted. Matching only the quoted
// form would silently drop every unquoted preset instead of failing loudly,
// so both forms are matched here.
const blocks = [...text.matchAll(/^ {2}"?([a-zA-Z0-9-]+)"?: \{/gm)];
const presets = [];

for (let i = 0; i < blocks.length; i++) {
  const start = blocks[i].index;
  const end = i + 1 < blocks.length ? blocks[i + 1].index : text.length;
  const body = text.slice(start, end);
  const key = blocks[i][1];

  const label = /label: "([^"]+)"/.exec(body)?.[1] ?? key;
  const section = name => {
    const m = new RegExp(`${name}: \\{([\\s\\S]*?)\\n {6}\\}`).exec(body);
    if (!m) throw new Error(`preset "${key}" has no ${name} styles`);
    // Values are normally double-quoted, but a font stack whose family name
    // itself needs double quotes (e.g. '"Oxanium", sans-serif') is written
    // single-quoted instead, so both forms are matched here — matching only
    // one would silently drop the value rather than fail on it.
    const out = {};
    for (const d of m[1].matchAll(
      /"?([a-z0-9-]+)"?: (?:"([^"]*)"|'([^']*)')/g
    )) {
      out[d[1]] = d[2] ?? d[3];
    }
    return out;
  };

  const light = section("light");
  const dark = { ...light, ...section("dark") };
  const radius = light.radius ?? "0.5rem";

  presets.push({
    id: `tweakcn-${key}`,
    label,
    // Derived from the preset's own radius and colours rather than written by
    // hand, so re-running this relabels every preset -- including any tweakcn
    // has added or retouched since the last import. See tweakcn-description.mjs.
    description: describePreset(radius, light),
    group: "tweakcn",
    recommendedDensity: "default",
    radius,
    fontSans: light["font-sans"] ?? "var(--font-inter), Inter, sans-serif",
    fontMono: light["font-mono"] ?? "ui-monospace, monospace",
    fontSerif: light["font-serif"],
    light: mapMode(light, "light"),
    dark: mapMode(dark, "dark"),
  });
}

// The source is a living third-party registry, not a fixed set: it has grown
// since this importer was first written and will keep growing. Asserting a
// specific count here would either go stale on the next run or require
// silently truncating real presets to hit a number, which is the same
// silent-partial-data failure this importer exists to avoid elsewhere. The
// real invariant is that parsing didn't drop anything: every block found
// above produced a preset.
if (presets.length !== blocks.length) {
  throw new Error(
    `parsed ${presets.length} presets from ${blocks.length} detected blocks`
  );
}

const header = `/**
 * tweakcn's published presets, mapped onto Nextly's token names.
 *
 * Generated by scripts/import-tweakcn.mjs — do not edit by hand. These are
 * third-party reference themes shown for comparison, not Nextly identity
 * candidates.
 */
import type { ThemeDefinition } from "../types";

export const TWEAKCN_THEMES: ThemeDefinition[] = ${JSON.stringify(presets, null, 2)};
`;

writeFileSync(
  new URL("../src/theme-lab/themes/tweakcn.generated.ts", import.meta.url),
  header
);
console.log(`wrote ${presets.length} presets`);
