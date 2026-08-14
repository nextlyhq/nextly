/**
 * What the tab variants resolve to, and what they refuse to let a caller move.
 *
 * `tabs-contract.test.ts` scans CALL SITES for classes that repaint the
 * indicator. This file asserts the other half: that the appearance those call
 * sites used to spell by hand is now named, and that naming it did not move the
 * parts of the tab a caller is not supposed to choose.
 *
 * Asserted on the variant functions rather than on rendered output, because the
 * variants ARE the contract — a render test would additionally depend on
 * `tailwind-merge` resolution and on jsdom, neither of which is the property
 * here.
 */
import { describe, expect, it } from "vitest";

import {
  tabsListVariants,
  tabsTriggerVariants,
  type TabsListProps,
  type TabsTriggerProps,
} from "../tabs";

// The PUBLIC aliases, not the component signatures. A consumer typing a wrapper
// reaches for these, and until they were derived from the components they
// described the Radix props alone — so `variant` and `size` were rejected on
// the very props object the component advertises. Checked at compile time
// because that is where the defect lived; `check-types` covers this file.
const listWithVariant: TabsListProps = { variant: "ghost" };
const triggerWithSize: TabsTriggerProps = { value: "a", size: "sm" };

/** Every class the variant resolves to, order-independent. */
const classesOf = (value: string): Set<string> =>
  new Set(value.split(/\s+/).filter(Boolean));

describe("tab variants", () => {
  it("exposes the variants on the public prop aliases", () => {
    expect(listWithVariant.variant).toBe("ghost");
    expect(triggerWithSize.size).toBe("sm");
  });

  it("gives the compact list its own name instead of two spellings", () => {
    const ghost = classesOf(tabsListVariants({ variant: "ghost" }));

    // The two call sites that hand-rolled this disagreed — `h-8` at one and
    // `h-7` at the other. One name means one height.
    expect(ghost).toContain("bg-transparent");
    expect(ghost).toContain("h-8");
    expect(ghost).not.toContain("h-10");
  });

  it("leaves the default list opaque and full height", () => {
    const base = classesOf(tabsListVariants());

    expect(base).toContain("h-10");
    expect(base).not.toContain("bg-transparent");
  });

  it("carries the type scale on size, and only the type scale", () => {
    const small = classesOf(tabsTriggerVariants({ size: "sm" }));
    const base = classesOf(tabsTriggerVariants());

    expect(small).toContain("text-xs");
    expect(base).toContain("text-sm");

    // The ONLY difference between the two. A size variant that also moved
    // padding, colour or the indicator would be a second way to restyle a tab,
    // which is what the call-site scan exists to prevent.
    const differences = [
      ...[...small].filter(entry => !base.has(entry)),
      ...[...base].filter(entry => !small.has(entry)),
    ].sort();
    expect(differences).toEqual(["text-sm", "text-xs"]);
  });
});

/**
 * Every class in `value` that draws the tab's edge, whatever modifier it hides
 * behind.
 *
 * Matched with `(^|:)` rather than an anchor, because a Tailwind utility can
 * sit behind any number of variant modifiers — `hover:border-b-4`,
 * `data-[state=active]:border-b-destructive!` — and an anchored pattern reads
 * those as unrelated classes. The base itself carries three of them, so the
 * modifier form is the normal case here rather than an exotic one.
 */
const edgeClassesOf = (value: string): string[] =>
  [...classesOf(value)]
    .filter(entry => /(^|:)(border-b-|border-|rounded-)/.test(entry))
    .sort();

describe("the tab edge", () => {
  // `tabs-contract.test.ts` watches CALL SITES and deliberately excludes
  // `tabs.tsx`, so nothing but this covers the variants themselves. Stated as
  // an equality rather than as a list of forbidden patterns: whatever the base
  // declares is the edge, and a variant that ADDS, REMOVES or CHANGES any of it
  // is a second way to restyle a tab regardless of how the class is spelled.
  it.each([
    ["list", tabsListVariants(), tabsListVariants({ variant: "ghost" })],
    ["trigger", tabsTriggerVariants(), tabsTriggerVariants({ size: "sm" })],
  ])("is identical across every %s variant", (_name, base, variant) => {
    expect(edgeClassesOf(variant)).toEqual(edgeClassesOf(base));
  });

  it("is drawn by the trigger base and left alone by the list", () => {
    // A positive control on the helper itself. An equality assertion is
    // satisfied by two empty sets, so without this the trigger case would pass
    // if `edgeClassesOf` silently matched nothing at all.
    expect(edgeClassesOf(tabsTriggerVariants())).toContain("border-b-2");
    // Behind a modifier, which is the form the anchored version of this helper
    // could not see at all.
    expect(edgeClassesOf(tabsTriggerVariants())).toContain(
      "data-[state=active]:border-b-primary!"
    );
    // The list draws no underline; its square corners are the edge it does own.
    expect(edgeClassesOf(tabsListVariants())).toEqual(["rounded-none"]);
  });
});
