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

import { ACCEPTED_REGRESSIONS, acceptedFor, roleOf } from "../accepted";
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
  it("matches only role pairs that exist", () => {
    // An entry matching nothing suppresses nothing and is never evaluated, so
    // neither the ratio pin nor the still-failing check can catch it -- both
    // run only for pairings that ARE asserted. A renamed or deleted pairing
    // would leave a permanent unexamined entry, and a future pairing that
    // happened to take the same role pair would be silently pre-accepted.
    //
    // Both roles must name a token the theme declares. That is the property
    // worth asserting, and it is deliberately NOT "a pairing exists for this
    // entry": the accepted set is consulted by two suites, and the scan over
    // component source legitimately finds ink/surface combinations that the
    // enumerated pairing list never names. Requiring a pairing would have meant
    // inventing one for every scan finding purely as bookkeeping, which grows
    // the asserted set for reasons unrelated to what renders.
    //
    // A typo or a removed token is the real failure mode here, and token
    // existence catches both.
    const declared = new Set(
      [...light.keys(), ...dark.keys(), ...scale.keys()].map(roleOf)
    );
    const orphans = ACCEPTED_REGRESSIONS.flatMap(entry =>
      [entry.fg, entry.bg]
        .filter(role => !declared.has(role))
        .map(role => `${role} (in "${entry.fg} on ${entry.bg}")`)
    );

    expect(
      orphans,
      `These accepted-regression entries name a role no token in theme.css ` +
        `declares, so they can never match and suppress nothing. Either the ` +
        `token was renamed, in which case update the entry, or it was removed, ` +
        `in which case delete the entry.`
    ).toEqual([]);
  });

  it("holds one entry per identity", () => {
    // `acceptedFor` returns the FIRST match, so a second entry with the same
    // identity is never read: its ratio is never checked, its removal is never
    // demanded, and every reachability check collapses both to one key. A
    // contradictory duplicate -- the same pair recorded at two different ratios
    // -- therefore sits in the file looking authoritative while the shadowed
    // one is inert.
    const seen = new Map<string, number>();
    for (const entry of ACCEPTED_REGRESSIONS) {
      const key =
        `${entry.fg}|${entry.bg}|${entry.mode}|${entry.fgAlpha ?? "-"}|` +
        `${entry.bgAlpha ?? "-"}|${entry.bgOver ? roleOf(entry.bgOver) : "-"}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const duplicated = [...seen]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => `${key} — ${count} entries`);

    expect(
      duplicated,
      `These acceptance identities appear more than once. Only the first is ` +
        `ever consulted, so the rest are unexamined: delete them, or give them ` +
        `the detail (alpha, underlying surface) that makes them distinct pairs.`
    ).toEqual([]);
  });

  it("is applicable in the mode it claims", () => {
    // An entry is only ever consulted for the mode it names, so one naming a
    // mode where its pairing does not apply is inert: never evaluated, so
    // neither the ratio pin nor the still-failing check can see it, and it sits
    // in the file reading as live coverage. It also becomes a trap -- if the
    // pairing later becomes applicable in that mode again, it is pre-accepted
    // without anyone choosing that.
    //
    // Only entries that correspond to a pairing at all are checked. Entries
    // that exist for the component scan have no pairing to be applicable in,
    // and are covered by the token-existence check above.
    const pairingModes = new Map<string, Set<string>>();
    for (const p of PAIRINGS) {
      const key = `${roleOf(p.fg)}|${roleOf(p.bg)}`;
      const modes = pairingModes.get(key) ?? new Set<string>();
      if (p.mode === undefined) {
        modes.add("light");
        modes.add("dark");
      } else {
        modes.add(p.mode);
      }
      pairingModes.set(key, modes);
    }

    const inert = ACCEPTED_REGRESSIONS.filter(entry => {
      const modes = pairingModes.get(`${entry.fg}|${entry.bg}`);
      return modes !== undefined && !modes.has(entry.mode);
    }).map(
      entry =>
        `${entry.fg} on ${entry.bg} accepted for ${entry.mode}, but its ` +
        `pairing applies only in ` +
        `${[...(pairingModes.get(`${entry.fg}|${entry.bg}`) ?? [])].join("/")}`
    );

    expect(
      inert,
      `These accepted-regression entries name a mode their pairing does not ` +
        `apply in, so they are never evaluated. Correct the mode, or delete ` +
        `the entry if the pairing no longer renders in it.`
    ).toEqual([]);
  });

  it("is keyed by something that identifies one pairing", () => {
    // Lookup is by role pair, so two pairings reducing to the same one would
    // let a single entry silently accept both. The alpha variants are the live
    // risk: `text-primary` and `text-primary/50` on one surface share a role
    // pair while measuring very different ratios.
    const seen = new Map<string, string[]>();
    for (const p of PAIRINGS) {
      // The key carries everything that changes what a pairing measures, so
      // this reports genuine ambiguity rather than pairs that merely share
      // tokens.
      const key =
        `${roleOf(p.fg)}|${roleOf(p.bg)}|${p.mode ?? "both"}` +
        `|${p.fgAlpha ?? "-"}|${p.bgAlpha ?? "-"}|${p.bgOver ? roleOf(p.bgOver) : "-"}`;
      seen.set(key, [...(seen.get(key) ?? []), p.label]);
    }
    const duplicated = [...seen]
      .filter(([, labels]) => labels.length > 1)
      .map(([key, labels]) => `${key} — ${labels.join(", ")}`);

    expect(
      duplicated,
      `These pairings reduce to the same role pair, so accepting one would ` +
        `accept its twin. Either they are genuinely one pairing, or the ` +
        `accepted-regression key needs to carry what distinguishes them ` +
        `(alpha, or the surface a tint is painted over).`
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

      const accepted = acceptedFor(pairing.fg, pairing.bg, mode.name, {
        fgAlpha: pairing.fgAlpha,
        bgAlpha: pairing.bgAlpha,
        bgOver: pairing.bgOver,
      });
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
        // Compared at the precision the entry is WRITTEN at, by rounding both
        // sides, rather than through a tolerance. `toBeCloseTo(x, 1)` admits an
        // absolute difference just under 0.05, so a token could fade by several
        // hundredths while the file claimed to pin it to two decimal places --
        // the assertion would have been looser than its own documentation, and
        // looser than the change it exists to catch.
        expect(
          Number(ratio.toFixed(2)),
          `${where}\nThis pairing is recorded in accepted.ts at ` +
            `${accepted.ratio}:1 and now measures ${ratio.toFixed(2)}:1. If the ` +
            `change was intended, update the recorded ratio; if not, the token ` +
            `moved under an entry that was not agreed for this value.`
        ).toBe(accepted.ratio);
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
            fg: pairing.fg,
            bg: pairing.bg,
            fgAlpha: pairing.fgAlpha,
            bgAlpha: pairing.bgAlpha,
            bgOver: pairing.bgOver,
            margin: ratio - THRESHOLDS[pairing.kind],
            ratio,
            required: THRESHOLDS[pairing.kind],
          };
        })
        // A pairing that is knowingly below its threshold is not "thin", it is
        // accepted, and it is pinned by the case above. Leaving it in here
        // would report every accepted entry as a fragile pass forever.
        .filter(
          row =>
            !acceptedFor(row.fg, row.bg, mode.name, {
              fgAlpha: row.fgAlpha,
              bgAlpha: row.bgAlpha,
              bgOver: row.bgOver,
            })
        )
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
