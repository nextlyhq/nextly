/**
 * Guards tokens the admin stylesheet declares for itself against carrying a hue
 * the theme's surfaces do not.
 *
 * `packages/ui/src/styles/theme.css` is where the palette lives, and swapping a
 * palette rewrites every token in it. Tokens declared HERE are outside that
 * reach: they keep whatever value they were written with, so a palette change
 * moves every surface around them and leaves them behind. A header background
 * with its own hue then renders as a tinted band against neutral surroundings,
 * and nothing in the theme file mentions it.
 *
 * The threshold is derived from the theme's own surface tokens rather than
 * fixed, so a deliberately warm or cool palette raises it and this check keeps
 * meaning "matches the surfaces it sits among" instead of "is grey".
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const adminCss = readFileSync(resolve(here, "../globals.css"), "utf8");
const themeCss = readFileSync(
  resolve(here, "../../../../ui/src/styles/theme.css"),
  "utf8"
);

/**
 * The theme's neutral surfaces: the backdrops a component is painted onto. The
 * admin's own surface tokens are compared against these, so status roles and
 * chart colors -- which are chromatic on purpose -- never widen the threshold.
 */
const THEME_SURFACES = [
  "--nx-background",
  "--nx-card",
  "--nx-popover",
  "--nx-muted",
  "--nx-secondary",
  "--nx-accent",
  "--nx-sidebar-background",
  "--nx-sidebar-accent",
];

/**
 * Rounding in an authored value should not read as a hue, but anything a person
 * would see as one should. Chroma is on OKLCH's scale, where 0.02 is already a
 * visible tint on a dark surface and 0.004 is not.
 */
const ROUNDING_TOLERANCE = 0.005;

/** `--nx-name: oklch(L C H)`, with or without an alpha component. */
const OKLCH_TOKEN =
  /(--nx-[a-z0-9-]+)\s*:\s*oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/g;

/**
 * Every block a selector opens, not just the first. Both stylesheets reopen the
 * same selector several times, so reading one block scans a fraction of the
 * declarations and reports the rest as absent -- which passes.
 *
 * Blocks are closed by brace depth rather than by line, so an edit above one
 * cannot shift what is read, and the header is matched at the start of a line
 * so `.nextly-admin` does not also select `.nextly-admin.dark`.
 */
function blockBodies(css: string, selector: string): string[] {
  const header = new RegExp(
    `^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
    "gm"
  );
  const bodies: string[] = [];
  for (const match of css.matchAll(header)) {
    const open = css.indexOf("{", match.index);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        bodies.push(css.slice(open, i));
        break;
      }
    }
  }
  if (bodies.length === 0) throw new Error(`no \`${selector}\` block`);
  return bodies;
}

/** Every `--nx-*` OKLCH token a selector declares, as name to chroma. */
function chromaByToken(css: string, selector: string): Map<string, number> {
  const found = new Map<string, number>();
  for (const body of blockBodies(css, selector)) {
    for (const [, name, , chroma] of body.matchAll(OKLCH_TOKEN)) {
      found.set(name, Number(chroma));
    }
  }
  return found;
}

const adminModes = {
  light: chromaByToken(adminCss, ".nextly-admin"),
  dark: chromaByToken(adminCss, ".nextly-admin.dark"),
};

const themeModes = {
  light: chromaByToken(themeCss, ":root"),
  dark: chromaByToken(themeCss, ".dark"),
};

/** Highest chroma any theme surface carries in a mode. */
function surfaceCeiling(mode: "light" | "dark"): number {
  const tokens = themeModes[mode];
  const present = THEME_SURFACES.map(name => tokens.get(name)).filter(
    (c): c is number => c !== undefined
  );
  if (present.length === 0) {
    throw new Error(`no theme surface tokens parsed for ${mode}`);
  }
  return Math.max(...present);
}

describe("admin-declared tokens stay as neutral as the theme's surfaces", () => {
  it("reads tokens from both stylesheets", () => {
    // Every assertion below passes over an empty set if a selector is renamed
    // or the token syntax changes, so the sets are pinned as non-empty first.
    expect(adminModes.light.size).toBeGreaterThan(0);
    expect(adminModes.dark.size).toBeGreaterThan(0);
    expect(themeModes.light.size).toBeGreaterThan(0);
    expect(themeModes.dark.size).toBeGreaterThan(0);
  });

  it("finds the surface tokens the threshold is derived from", () => {
    for (const name of THEME_SURFACES) {
      expect(
        themeModes.light.has(name) && themeModes.dark.has(name),
        `\`${name}\` is missing from theme.css, so the neutrality threshold is ` +
          `derived from fewer surfaces than intended`
      ).toBe(true);
    }
  });

  it("proves the threshold would catch a tinted surface", () => {
    // The chroma a hue-carrying token would land at, against the ceiling the
    // real assertion uses. Without this the check could pass by measuring a
    // ceiling so wide that nothing could ever exceed it.
    const tinted = 0.0228;
    for (const mode of ["light", "dark"] as const) {
      expect(tinted).toBeGreaterThan(surfaceCeiling(mode) + ROUNDING_TOLERANCE);
    }
  });

  it("no admin-declared token carries a hue the surfaces do not", () => {
    const offenders: string[] = [];
    for (const mode of ["light", "dark"] as const) {
      const ceiling = surfaceCeiling(mode) + ROUNDING_TOLERANCE;
      for (const [name, chroma] of adminModes[mode]) {
        if (chroma > ceiling) {
          offenders.push(
            `${name} (${mode}) has chroma ${chroma} against a surface ceiling ` +
              `of ${ceiling.toFixed(3)}`
          );
        }
      }
    }
    expect(
      offenders,
      `A token declared in the admin stylesheet carries a hue none of the ` +
        `theme's surfaces carry, so a palette change moves every surface ` +
        `around it and leaves it tinted. Give it the surfaces' chroma, or ` +
        `move it into theme.css where the palette can reach it:\n` +
        offenders.join("\n")
    ).toEqual([]);
  });
});
