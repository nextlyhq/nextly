/**
 * Guards the sidebar navigation against `primary` being used as ink.
 *
 * `--nx-primary` is achromatic in the shipped theme (black in light, white in
 * dark), so `text-primary` on a nav label is indistinguishable from
 * `text-foreground` and can be introduced without anyone noticing. It is only
 * wrong once a theme gives primary a hue: the labels then render at that hue,
 * turning the whole nav into a column of saturated links, while
 * `--nx-sidebar-foreground` sits unused.
 *
 * So the check does what a themed install would: it re-resolves the sidebar
 * navigation's text utilities against a theme whose primary is deliberately
 * chromatic, converts each painted color back to OKLCH and asserts the chroma
 * stays near-neutral. Any utility that resolves through primary (`text-primary`,
 * and aliases of it such as `text-ring` or `text-chart-1`) fails; the neutral
 * ink tokens pass, because their chroma is fixed by the theme and does not move
 * when primary does.
 *
 * Scope is the navigation chrome only — the files that render menu buttons,
 * sub-buttons, badges, actions and the icon rail. The sidebar's user footer and
 * mobile drawer are excluded on purpose: their remaining primary uses are an
 * avatar tint and the fallback logo mark, which are brand surfaces rather than
 * label ink.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { converter } from "culori";
import { describe, expect, it } from "vitest";

import { toHex } from "../color";
import {
  parseThemeScale,
  parseThemeTokens,
  type TokenMap,
} from "../parse-theme";
import { resolveColor, type ResolveContext } from "../resolve";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../../..");
const css = readFileSync(resolve(here, "../../theme.css"), "utf8");
const { light, dark } = parseThemeTokens(css);
const scale = parseThemeScale(css);

const toOklch = converter("oklch");

/**
 * The files that render sidebar navigation chrome. Each is asserted to exist so
 * a rename cannot quietly reduce this to scanning nothing.
 */
const NAV_SOURCES = [
  "packages/admin/src/components/layout/sidebar/index.tsx",
  "packages/admin/src/components/layout/sidebar/DualSidebar.tsx",
  "packages/admin/src/components/features/dashboard/SidebarNavigation.tsx",
  "packages/admin/src/components/features/dashboard/DynamicCollectionNav.tsx",
  "packages/admin/src/components/features/dashboard/DynamicComponentNav.tsx",
  "packages/admin/src/components/features/dashboard/DynamicCustomGroupNav.tsx",
  "packages/admin/src/components/features/dashboard/DynamicSingleNav.tsx",
];

/**
 * A hue given to primary that no neutral token has. Nothing in the theme sits
 * near this chroma, so "resolved through primary" and "near-neutral" cannot be
 * confused. The value is a plausible warm brand color, not an extreme, so the
 * check fails for the reason a real theme would trip it.
 */
const CHROMATIC_PRIMARY = "oklch(0.72 0.115 45)";

/**
 * Highest chroma any neutral ink token in the theme carries (slate-derived
 * foregrounds sit at ~0.04), with headroom. Primary's chroma under the probe is
 * 0.115, so the two are separated by a wide margin and the threshold does not
 * need to track small theme edits.
 */
const MAX_NEUTRAL_CHROMA = 0.06;

/**
 * The admin's centralized hover classes. They are plain CSS classes that
 * `@apply` Tailwind utilities, so the utilities they contribute are invisible to
 * a scan of the nav sources even though the menu button carries `hover-unified`.
 * Their `@apply` bodies are expanded into the scan below.
 */
const HOVER_CLASS_CSS = "packages/admin/src/styles/globals.css";
const APPLY_RULE = /\.([a-z][a-z0-9-]*)\s*\{\s*@apply\s+([^;}]+);/g;

/** `text-<name>` with an optional Tailwind opacity, which does not affect hue. */
const TEXT_UTILITY = /\btext-([a-z][a-z0-9-]*)(?:\/(?:\[[0-9.]+%?\]|\d+))?\b/g;

/** Names in the `@theme` block that a `text-*` utility can resolve to. */
const COLOR_NAMES = new Set(
  [...scale.keys()].map(k => k.replace("--color-", ""))
);

/** A copy of a mode's tokens with primary swapped for the chromatic probe. */
function withChromaticPrimary(tokens: TokenMap): TokenMap {
  const themed = new Map(tokens);
  themed.set("--nx-primary", CHROMATIC_PRIMARY);
  return themed;
}

/** Class name to the utilities its `@apply` body contributes. */
function applyBodies(): Map<string, string> {
  const css = readFileSync(resolve(repo, HOVER_CLASS_CSS), "utf8");
  const bodies = new Map<string, string>();
  for (const [, name, body] of css.matchAll(APPLY_RULE)) {
    bodies.set(name, `${bodies.get(name) ?? ""} ${body}`);
  }
  return bodies;
}

/**
 * Every distinct `text-*` color utility the navigation chrome paints with,
 * including those reached indirectly through an `@apply` helper class.
 */
function scanTextUtilities(): Map<string, Set<string>> {
  const bodies = applyBodies();
  const found = new Map<string, Set<string>>();
  const record = (name: string, origin: string): void => {
    if (!COLOR_NAMES.has(name)) return;
    const origins = found.get(name) ?? new Set<string>();
    origins.add(origin);
    found.set(name, origins);
  };

  for (const rel of NAV_SOURCES) {
    const source = readFileSync(resolve(repo, rel), "utf8");
    for (const [, name] of source.matchAll(TEXT_UTILITY)) record(name, rel);
    for (const [helper, body] of bodies) {
      // Word-boundary match so `hover-unified` does not also pull in
      // `hover-unified-table-row`, which the nav does not use.
      if (!new RegExp(`(?<![a-z0-9-])${helper}(?![a-z0-9-])`).test(source)) {
        continue;
      }
      for (const [, name] of body.matchAll(TEXT_UTILITY)) {
        record(name, `${rel} (via .${helper})`);
      }
    }
  }
  return found;
}

/** Chroma of a color token in one mode, painted through the chromatic theme. */
function chromaOf(name: string, tokens: TokenMap): number {
  const ctx: ResolveContext = { tokens: withChromaticPrimary(tokens), scale };
  const rgb = resolveColor(`var(--color-${name})`, ctx);
  return toOklch(toHex(rgb))?.c ?? 0;
}

describe("sidebar navigation ink stays neutral under a themed primary", () => {
  const utilities = scanTextUtilities();

  it("finds the navigation text utilities to check", () => {
    // A broken glob or a renamed file would otherwise turn the assertion below
    // into a vacuous pass over an empty set.
    expect(utilities.size).toBeGreaterThan(0);
  });

  it("proves the probe would catch primary used as ink", () => {
    // The threshold is only meaningful if primary actually exceeds it; this
    // pins that relationship so a future theme edit cannot make the real
    // assertion unfalsifiable without failing here first.
    for (const tokens of [light, dark]) {
      expect(chromaOf("primary", tokens)).toBeGreaterThan(MAX_NEUTRAL_CHROMA);
    }
  });

  it("no navigation text utility takes its color from primary", () => {
    const offenders: string[] = [];
    for (const [name, files] of utilities) {
      for (const [mode, tokens] of [
        ["light", light],
        ["dark", dark],
      ] as const) {
        const chroma = chromaOf(name, tokens);
        if (chroma > MAX_NEUTRAL_CHROMA) {
          offenders.push(
            `text-${name} (${mode}) = chroma ${chroma.toFixed(3)} in ` +
              `${[...files].join(", ")}`
          );
        }
      }
    }
    expect(
      offenders,
      `Sidebar navigation text resolves through the primary token, so a themed ` +
        `primary would color the nav labels. Use the sidebar ink tokens ` +
        `(text-sidebar-foreground at rest, text-sidebar-accent-foreground when ` +
        `active) or another neutral foreground:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
