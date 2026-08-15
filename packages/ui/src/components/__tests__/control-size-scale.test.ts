/**
 * One size name means one control height.
 *
 * `size="sm"` used to resolve to `--nx-control-height-md` on a button and
 * `--nx-control-height-sm` on an input and a select, so a small button beside a
 * small input sat 4px out of line. Nothing rendered it — there was not one
 * `<Input size="sm">` or `<SelectTrigger size="sm">` in the repository — which
 * is exactly why it survived: the defect was waiting for its first call site
 * rather than showing up in a screenshot.
 *
 * Asserted by CALLING the real `cva` functions rather than by reading the
 * variant maps out of the source. The class string a caller receives is the
 * contract; a scan over the source is a second implementation of the same
 * question, and one that goes stale the moment a variant is composed rather
 * than written as a literal.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buttonVariants } from "../button";
import { inputVariants } from "../input";
import { selectTriggerVariants } from "../select";

/** The size names shared by every control primitive here. */
const SHARED_SIZES = ["sm", "default", "lg"] as const;

const PRIMITIVES = {
  Button: (size: string) => buttonVariants({ size: size as "sm" }),
  Input: (size: string) => inputVariants({ size: size as "sm" }),
  SelectTrigger: (size: string) =>
    selectTriggerVariants({ size: size as "sm" }),
};

/**
 * The height token a resolved class string carries.
 *
 * Returns undefined rather than throwing so the caller can assert the
 * POPULATION separately: a silent miss here would leave an empty set of tokens,
 * and "every token agrees" is trivially true of nothing.
 */
function heightTokenOf(classes: string): string | undefined {
  for (const name of classes.split(/\s+/)) {
    const match = /^h-\[var\((--nx-control-height[a-z-]*)\)\]$/.exec(name);
    if (match) return match[1];
  }
  return undefined;
}

const THEME = readFileSync(
  fileURLToPath(new URL("../../styles/theme.css", import.meta.url)),
  "utf8"
);

/**
 * A control-height token's value in rem, resolved from the theme.
 *
 * The steps are declared as `calc(var(--nx-control-height) ± Nrem)`, so this
 * reads the base and applies the offset rather than trusting a value repeated
 * here. Returns NaN when the token, or a spelling it uses, is not one this can
 * read — which the population test above turns into a named failure instead of
 * a comparison between two NaNs.
 */
function remValueOf(token: string | undefined): number {
  if (!token) return Number.NaN;
  const declared = new RegExp(`${token}:\\s*([^;]+);`).exec(THEME);
  if (!declared) return Number.NaN;
  const value = declared[1].trim();

  const literal = /^([\d.]+)rem$/.exec(value);
  if (literal) return Number(literal[1]);

  const offset = /^calc\(var\((--[a-z-]+)\)\s*([+-])\s*([\d.]+)rem\)$/.exec(
    value
  );
  if (!offset) return Number.NaN;
  const base = remValueOf(offset[1]);
  return offset[2] === "+"
    ? base + Number(offset[3])
    : base - Number(offset[3]);
}

describe("control size scale", () => {
  it("reads a height token from every primitive at every shared size", () => {
    // The control for the assertion below. Without it, a renamed utility or a
    // changed bracket spelling makes `heightTokenOf` return undefined
    // everywhere, and a comparison over an empty set passes while the scale it
    // was written to protect has drifted.
    for (const [name, variants] of Object.entries(PRIMITIVES)) {
      for (const size of SHARED_SIZES) {
        expect(
          heightTokenOf(variants(size)),
          `${name} size="${size}" carries no --nx-control-height token`
        ).toBeDefined();
      }
    }
  });

  it.each(SHARED_SIZES)(
    'resolves size="%s" to the same height on every primitive',
    size => {
      const byPrimitive = Object.fromEntries(
        Object.entries(PRIMITIVES).map(([name, variants]) => [
          name,
          heightTokenOf(variants(size)),
        ])
      );
      const distinct = new Set(Object.values(byPrimitive));

      expect(
        distinct.size,
        `size="${size}" resolves to more than one height: ${JSON.stringify(byPrimitive)}`
      ).toBe(1);
    }
  );

  it("keeps the steps ordered, so a bigger name is never a smaller control", () => {
    // Ordered by the token's VALUE, read from the theme, not by the position of
    // its name in a list written here. A name order is a restatement of what
    // the theme is supposed to say: redefining `--nx-control-height-md` above
    // the base height would leave a name-ranked assertion green while
    // `size="sm"` rendered taller than `default`.
    const sm = remValueOf(heightTokenOf(PRIMITIVES.Button("sm")));
    const base = remValueOf(heightTokenOf(PRIMITIVES.Button("default")));
    const lg = remValueOf(heightTokenOf(PRIMITIVES.Button("lg")));

    // Every value resolved, so the comparison is between numbers rather than
    // between two NaNs, which compare false and would fail loudly — but a
    // silent undefined reaching a rank lookup would not have.
    expect(Number.isFinite(sm)).toBe(true);
    expect(Number.isFinite(base)).toBe(true);
    expect(Number.isFinite(lg)).toBe(true);

    expect(sm).toBeLessThan(base);
    expect(base).toBeLessThan(lg);
  });

  it("resolves every step of the scale from the theme", () => {
    // The population control for `remValueOf`. If the theme's spelling changes
    // — a different unit, a nested `calc`, a token renamed — every lookup
    // returns NaN, and an ordering test over NaNs fails for the right reason
    // only by luck. This says plainly which token could not be read.
    for (const token of [
      "--nx-control-height-sm",
      "--nx-control-height-md",
      "--nx-control-height",
      "--nx-control-height-lg",
    ]) {
      expect(
        Number.isFinite(remValueOf(token)),
        `${token} could not be resolved from theme.css`
      ).toBe(true);
    }
  });
});
