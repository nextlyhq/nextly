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

import { tabsListVariants, tabsTriggerVariants } from "../tabs";

/** Every class the variant resolves to, order-independent. */
const classesOf = (value: string): Set<string> =>
  new Set(value.split(/\s+/).filter(Boolean));

describe("tab variants", () => {
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

  it("keeps the indicator out of every variant", () => {
    // The property `tabs-contract.test.ts` watches at call sites, asserted here
    // at the source: no variant may repaint the underline or the corners, so
    // adding one cannot open a route the scan is not looking at.
    for (const resolved of [
      tabsListVariants(),
      tabsListVariants({ variant: "ghost" }),
      tabsTriggerVariants(),
      tabsTriggerVariants({ size: "sm" }),
    ]) {
      const classes = [...classesOf(resolved)];
      expect(classes.filter(entry => /^rounded-(?!none$)/.test(entry))).toEqual(
        []
      );
      expect(classes.filter(entry => /^border-b-\d/.test(entry))).toEqual([
        ...(resolved.includes("border-b-2") ? ["border-b-2"] : []),
      ]);
    }
  });
});
