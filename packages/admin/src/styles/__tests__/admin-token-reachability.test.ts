/**
 * Every `--nx-*` token the admin stylesheet paints with must be declared in the
 * theme's token file, so a palette change reaches all of them.
 *
 * `packages/ui/src/styles/theme.css` is where the palette lives, and swapping a
 * palette rewrites the tokens in it. A token declared anywhere else keeps
 * whatever value it was written with: every surface around it moves and it
 * stays behind, with nothing in the theme file mentioning it. That is how a
 * table header kept a blue cast through a swap to an achromatic palette, while
 * the card beneath it went neutral.
 *
 * The check is containment rather than a colour judgement, because being
 * stranded is the defect and the hue is only one way it shows. A stranded token
 * can be equally wrong in lightness, in contrast, or simply frozen -- and under
 * a palette that legitimately carries hue, a neutrality check would pass while
 * the orphan kept the OLD hue.
 *
 * `--nx-*` is the palette's namespace. Knobs that are genuinely local to the
 * admin and have no business in a palette (`--sidebar-width-safe`) carry no
 * `--nx-` prefix and are not in scope here.
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

/** `var(--nx-name)`, the read side. */
const CONSUMED = /var\(\s*(--nx-[a-z0-9-]+)/g;

/**
 * `--nx-name:`, the declaration side. Anchored to a block opening, a preceding
 * declaration or a line start rather than to a line start alone: a rule written
 * on one line is still a declaration, and matching only formatted CSS would let
 * `.nextly-admin { --nx-x: ... }` pass unseen.
 */
const DECLARED = /(?:^|[{;])\s*(--nx-[a-z0-9-]+)\s*:/gm;

function namesIn(css: string, pattern: RegExp): Set<string> {
  return new Set([...css.matchAll(pattern)].map(match => match[1]));
}

const consumedByAdmin = namesIn(adminCss, CONSUMED);
const declaredByAdmin = namesIn(adminCss, DECLARED);
const declaredByTheme = namesIn(themeCss, DECLARED);

describe("admin tokens are reachable by a palette change", () => {
  it("reads tokens from both stylesheets", () => {
    // Containment over an empty set is vacuously true, so a renamed file or a
    // changed syntax would turn the real assertion into a pass.
    expect(consumedByAdmin.size).toBeGreaterThan(0);
    expect(declaredByTheme.size).toBeGreaterThan(0);
  });

  it("proves the check would catch a stranded token", () => {
    // A token consumed by the admin stylesheet but absent from the theme file
    // must be reported. Without this, containment could hold because the
    // comparison never actually distinguishes the two sets.
    const stranded = "--nx-does-not-exist-in-the-theme";
    expect(declaredByTheme.has(stranded)).toBe(false);
    expect(
      [...new Set([stranded])].filter(t => !declaredByTheme.has(t))
    ).toEqual([stranded]);
  });

  it("declares every token the admin stylesheet paints with", () => {
    const stranded = [...consumedByAdmin]
      .filter(token => !declaredByTheme.has(token))
      .sort();

    expect(
      stranded,
      `These tokens are used by the admin stylesheet but not declared in ` +
        `theme.css, so a palette change cannot reach them and they keep their ` +
        `current values while every surface around them moves. Declare them ` +
        `in theme.css alongside the tokens they sit among:\n` +
        stranded
          .map(
            token =>
              `  ${token}${declaredByAdmin.has(token) ? " (declared in the admin stylesheet)" : " (declared nowhere)"}`
          )
          .join("\n")
    ).toEqual([]);
  });

  it("keeps the palette namespace out of the admin stylesheet", () => {
    const local = [...declaredByAdmin].sort();
    expect(
      local,
      `The admin stylesheet declares palette tokens. \`--nx-*\` is the theme's ` +
        `namespace: a value set here is invisible to a palette change. Move ` +
        `these into theme.css, or rename them if they are genuinely admin-local ` +
        `knobs rather than palette values:\n${local.map(t => `  ${t}`).join("\n")}`
    ).toEqual([]);
  });
});
