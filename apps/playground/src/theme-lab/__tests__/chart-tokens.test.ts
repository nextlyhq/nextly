/**
 * A selected theme must reach the charts too.
 *
 * `themeToCss` emits the keys a theme declares, and no theme declares
 * `--nx-chart-*`. The dashboard reads them, so before this the page and the
 * cards took the selected palette while the charts kept the shipped
 * amber-and-cyan -- two palettes on one screen, captured as evidence of one.
 *
 * It failed silently in the worst way: the completeness check compared each
 * theme against a list that omitted these tokens, so the very check meant to
 * catch a partial theme certified it.
 */
import { describe, expect, it } from "vitest";

import { CHART_SLOT_WITHOUT_A_ROLE, themeToCss } from "../generate-css";
import { NEXTLY_THEMES, TWEAKCN_THEMES } from "../themes";

const ALL = [...NEXTLY_THEMES, ...TWEAKCN_THEMES];

/** Every chart slot the shipped admin defines. */
const SLOTS = [1, 2, 3, 4, 5];

/** `--nx-chart-N: <value>;` inside a block, whatever the value is. */
const declarationOf = (css: string, slot: number): string | null =>
  css.match(new RegExp(`--nx-chart-${slot}:\\s*([^;]+);`))?.[1]?.trim() ?? null;

describe("themed charts", () => {
  it("has themes to check, and they declare no chart token themselves", () => {
    // The precondition this rule exists for. If a theme ever declares its own
    // chart tokens, the derivation below is no longer the only source and the
    // assertions stop meaning what they say.
    expect(ALL.length).toBeGreaterThan(5);
    const selfDeclared = ALL.filter(
      t => "chart-1" in t.light || "chart-1" in t.dark
    ).map(t => t.id);
    expect(selfDeclared).toEqual([]);
  });

  it("points every derivable slot at a role the theme redefines", () => {
    const missing: string[] = [];

    for (const theme of ALL) {
      const css = themeToCss(theme);
      for (const slot of SLOTS) {
        if (slot === CHART_SLOT_WITHOUT_A_ROLE) continue;
        const value = declarationOf(css, slot);
        if (value === null) {
          missing.push(`${theme.id}: --nx-chart-${slot} is not emitted`);
          continue;
        }
        // A literal would freeze the chart at one theme's colour. The point is
        // the indirection: it has to resolve through a token the theme's own
        // dark block redeclares, or the chart stays light-mode in dark mode.
        const role = value.match(/^var\(--nx-([a-z-]+)\)$/)?.[1];
        if (!role) {
          missing.push(
            `${theme.id}: --nx-chart-${slot} is ${value}, not a role reference`
          );
          continue;
        }
        if (!(role in theme.light) || !(role in theme.dark)) {
          missing.push(
            `${theme.id}: --nx-chart-${slot} points at --nx-${role}, which ` +
              `this theme does not define in both modes`
          );
        }
      }
    }

    expect(
      missing.sort(),
      `A chart slot does not follow the selected theme. It must resolve ` +
        `through a role token the theme declares in BOTH modes, so the chart ` +
        `changes with the palette instead of keeping the shipped colour ` +
        `while everything around it moves.`
    ).toEqual([]);
  });

  it("leaves exactly one slot on the shipped palette, on purpose", () => {
    // The shipped chart-2 is a cyan and no theme role is cyan, so deriving it
    // would invent a colour nobody chose. That is a defensible omission and an
    // indefensible drift, so the count is pinned: a second undeclared slot
    // means the derivation quietly stopped covering something.
    const css = themeToCss(ALL[0]);
    const undeclared = SLOTS.filter(slot => declarationOf(css, slot) === null);

    expect(
      undeclared,
      `Exactly one chart slot is expected to keep the shipped value, and it ` +
        `is the one with no matching theme role. Any other slot appearing ` +
        `here is a chart that silently stopped following the theme.`
    ).toEqual([CHART_SLOT_WITHOUT_A_ROLE]);
  });
});
