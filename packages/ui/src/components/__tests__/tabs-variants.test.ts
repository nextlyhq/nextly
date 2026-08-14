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

/** Every class in one set and not the other, in both directions. */
const differenceBetween = (left: string, right: string): string[] => {
  const a = classesOf(left);
  const b = classesOf(right);
  return [
    ...[...a].filter(entry => !b.has(entry)),
    ...[...b].filter(entry => !a.has(entry)),
  ].sort();
};

/**
 * What each variant is allowed to change, stated COMPLETELY.
 *
 * Earlier versions of this file classified classes — "does this look like an
 * edge utility" — and were wrong three times running: an anchored pattern
 * missed `hover:border-b-4`, and the modifier-aware one still missed
 * `!rounded-md`, bare `rounded` and `[border-radius:8px]`. Every fix bought one
 * spelling, because Tailwind's surface is the whole language and a classifier
 * has to keep up with it.
 *
 * So nothing is classified. The FULL difference between a variant and its base
 * is pinned, which means any class a variant adds — whatever it is called,
 * however it is spelled, whatever modifier or important marker it carries —
 * appears in the difference and fails. There is no pattern to be short of.
 */
describe("what a variant is allowed to change", () => {
  it.each([
    [
      "TabsList ghost",
      tabsListVariants(),
      tabsListVariants({ variant: "ghost" }),
      // The compact surface-less list: shorter, and drawing no background.
      ["bg-transparent", "h-10", "h-8"],
    ],
    [
      "TabsTrigger sm",
      tabsTriggerVariants(),
      tabsTriggerVariants({ size: "sm" }),
      // The type scale, and nothing else.
      ["text-sm", "text-xs"],
    ],
  ])(
    "changes exactly the declared classes for %s",
    (_n, base, variant, only) => {
      expect(differenceBetween(base, variant)).toEqual(only);
    }
  );

  it("keeps the square edge and the underline in the base", () => {
    // A positive control on the assertion above, which is satisfied by two
    // IDENTICAL sets and so proves nothing on its own about what the base
    // actually declares.
    const trigger = classesOf(tabsTriggerVariants());
    expect(trigger).toContain("rounded-none");
    expect(trigger).toContain("border-b-2");
    expect(trigger).toContain("data-[state=active]:border-b-primary!");
    expect(classesOf(tabsListVariants())).toContain("rounded-none");
  });
});
