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
    // Guards the pairing rather than each value: `sm` mapping to the `-lg`
    // token would satisfy the agreement test above on its own, since agreement
    // says nothing about which step was agreed on.
    const order = [
      "--nx-control-height-sm",
      "--nx-control-height-md",
      "--nx-control-height",
      "--nx-control-height-lg",
    ];
    const rank = (token: string | undefined) => order.indexOf(token ?? "");

    const sm = rank(heightTokenOf(PRIMITIVES.Button("sm")));
    const base = rank(heightTokenOf(PRIMITIVES.Button("default")));
    const lg = rank(heightTokenOf(PRIMITIVES.Button("lg")));

    expect(sm).toBeGreaterThanOrEqual(0);
    expect(sm).toBeLessThan(base);
    expect(base).toBeLessThan(lg);
  });
});
