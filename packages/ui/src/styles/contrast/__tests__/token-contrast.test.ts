/**
 * Asserts that every foreground/surface and boundary/surface pair the admin
 * renders meets its WCAG minimum, in both light and dark mode, reading the real
 * tokens straight from `theme.css`. Translucent tokens and alpha utilities are
 * composited over their surface first, and `color-mix()` shades are evaluated,
 * so the ratio asserted is the one that renders on screen. A failing pair names
 * both composited colors and the exact ratio so the fix is obvious.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACCEPTED_REGRESSIONS, acceptedFor } from "../accepted";
import { compositeOver, contrastRatio, toHex, type Rgb } from "../color";
import { PAIRINGS, THRESHOLDS, type Pairing } from "../pairings";
import {
  parseThemeScale,
  parseThemeTokens,
  type TokenMap,
} from "../parse-theme";
import { applyOpacity, resolveColor, type ResolveContext } from "../resolve";

const THEME_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../theme.css"
);

const css = readFileSync(THEME_CSS, "utf8");
const { light, dark } = parseThemeTokens(css);
const scale = parseThemeScale(css);

// A last-resort base for compositing an unexpectedly translucent surface; the
// real surfaces are opaque, so it is never used, but it keeps the check correct
// rather than trusting a raw translucent value.
const OPAQUE_BASE: Rgb = { r: 1, g: 1, b: 1, alpha: 1 };

const opaque = (c: Rgb, base: Rgb): Rgb =>
  c.alpha < 1 ? compositeOver(c, base) : c;

/** Resolve the surface a pairing sits on, compositing any alpha tint. */
function surfaceOf(pairing: Pairing, ctx: ResolveContext): Rgb {
  const raw = resolveColor(`var(${pairing.bg})`, ctx);
  if (pairing.bgAlpha !== undefined) {
    const over = resolveColor(
      `var(${pairing.bgOver ?? "--color-background"})`,
      ctx
    );
    // Scale the tint's own alpha by the utility opacity (Tailwind multiplies,
    // it does not overwrite) before compositing it over the underlying surface.
    return compositeOver(
      applyOpacity(raw, pairing.bgAlpha),
      opaque(over, OPAQUE_BASE)
    );
  }
  return opaque(raw, OPAQUE_BASE);
}

/** Resolve the foreground, applying any alpha, composited onto its surface. */
function foregroundOf(
  pairing: Pairing,
  ctx: ResolveContext,
  surface: Rgb
): Rgb {
  let fg = resolveColor(`var(${pairing.fg})`, ctx);
  // Multiply the foreground's own alpha by the utility opacity (Tailwind
  // semantics) before compositing it onto its surface.
  if (pairing.fgAlpha !== undefined) fg = applyOpacity(fg, pairing.fgAlpha);
  return opaque(fg, surface);
}

const MODES: ReadonlyArray<{ name: "light" | "dark"; tokens: TokenMap }> = [
  { name: "light", tokens: light },
  { name: "dark", tokens: dark },
];

describe("the accepted-regression set", () => {
  it("names only pairings that exist", () => {
    // An entry whose label no longer matches a pairing suppresses nothing and
    // is never evaluated, so it cannot be caught by the ratio or still-failing
    // checks -- those only run for pairings that ARE asserted. A renamed
    // pairing would therefore leave a permanent unexamined entry here while
    // quietly re-entering the strict path, or worse, a future pairing that
    // happens to take the old label would be silently pre-accepted.
    const labels = new Set(PAIRINGS.map(p => p.label));
    const orphans = ACCEPTED_REGRESSIONS.filter(
      entry => !labels.has(entry.label)
    ).map(entry => `${entry.label} (${entry.mode})`);

    expect(
      orphans,
      `These accepted-regression entries name no pairing in pairings.ts. ` +
        `Either the pairing was renamed, in which case update the entry, or it ` +
        `was removed, in which case delete the entry.`
    ).toEqual([]);
  });

  it("is keyed by something that identifies one pairing", () => {
    // The whole mechanism looks a pairing up by label, so two pairings sharing
    // a label would let one entry silently accept the other as well.
    const seen = new Map<string, number>();
    for (const p of PAIRINGS) {
      const key = `${p.label}|${p.mode ?? "both"}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const duplicated = [...seen].filter(([, n]) => n > 1).map(([key]) => key);

    expect(
      duplicated,
      `These labels describe more than one pairing, so accepting one would ` +
        `accept its twin. Give each a distinct label.`
    ).toEqual([]);
  });
});

for (const mode of MODES) {
  const ctx: ResolveContext = { tokens: mode.tokens, scale };
  const applicable = PAIRINGS.filter(
    p => p.mode === undefined || p.mode === mode.name
  );

  describe(`token contrast (${mode.name})`, () => {
    it.each(applicable)("$label ($fg on $bg)", pairing => {
      const required = THRESHOLDS[pairing.kind];

      const surface = surfaceOf(pairing, ctx);
      const foreground = foregroundOf(pairing, ctx, surface);
      const ratio = contrastRatio(foreground, surface);
      const where =
        `${mode.name}: ${pairing.label} — ${pairing.fg} ${toHex(foreground)} on ` +
        `${pairing.bg} ${toHex(surface)} = ${ratio.toFixed(2)}:1, ` +
        `needs ${required}:1 (${pairing.kind})`;

      const accepted = acceptedFor(pairing.label, mode.name);
      if (accepted) {
        // Still-failing is asserted BEFORE the ratio pin, and the order is
        // load-bearing rather than stylistic. Any repair moves the ratio too,
        // so pinning first would report every repair as "drifted" and the
        // stale-entry branch would be unreachable in practice -- an assertion
        // that cannot fire, which is worse than an absent one because it reads
        // as cover.
        expect(
          ratio,
          `${where}\nThis pairing now MEETS its threshold, so its accepted.ts ` +
            `entry is stale. Delete the entry: leaving it makes the accepted ` +
            `set read as larger than it is.`
        ).toBeLessThan(required);

        // Then pin how far below it sits. Recording only "this one fails"
        // would let the token slide further behind an entry that already
        // admits failure, which is how an accepted regression quietly becomes
        // a worse one.
        expect(
          ratio,
          `${where}\nThis pairing is recorded in accepted.ts at ` +
            `${accepted.ratio}:1 and now measures ${ratio.toFixed(2)}:1. If the ` +
            `change was intended, update the recorded ratio; if not, the token ` +
            `moved under an entry that was not agreed for this value.`
        ).toBeCloseTo(accepted.ratio, 1);
        return;
      }

      expect(ratio, where).toBeGreaterThanOrEqual(required);
    });

    it("clears every threshold by a margin, not on the line", () => {
      // Passing and passing-by-enough are different properties, and only the
      // first was ever asserted. A pairing sitting a hundredth above its
      // threshold is one rounding away from failing, and the suite would
      // report it as healthy right up until it did -- which is how a control
      // boundary reached 3.05:1 against a real page surface and stayed green.
      //
      // The band is the one the margin evidence already uses to call a pairing
      // fragile, so this enforces a distinction the audit was drawing by hand.
      const MARGIN = 0.25;

      const thin = applicable
        .map(pairing => {
          const surface = surfaceOf(pairing, ctx);
          const foreground = foregroundOf(pairing, ctx, surface);
          const ratio = contrastRatio(foreground, surface);
          return {
            label: pairing.label,
            margin: ratio - THRESHOLDS[pairing.kind],
            ratio,
            required: THRESHOLDS[pairing.kind],
          };
        })
        // A pairing that is knowingly below its threshold is not "thin", it is
        // accepted, and it is pinned by the case above. Leaving it in here
        // would report every accepted entry as a fragile pass forever.
        .filter(row => !acceptedFor(row.label, mode.name))
        .filter(row => row.margin < MARGIN)
        .sort((a, b) => a.margin - b.margin);

      expect(
        thin.map(
          row =>
            `${row.label} = ${row.ratio.toFixed(2)}:1, needs ${row.required}:1 ` +
            `(margin ${row.margin.toFixed(3)})`
        ),
        `${mode.name}: these pairings pass only just. Solve the token to a ` +
          `margin rather than to the threshold, so a later palette nudge ` +
          `cannot push it under without anyone choosing to.`
      ).toEqual([]);
    });
  });
}
