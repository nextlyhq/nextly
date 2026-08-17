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
  TABS_LIST_VARIANTS,
  TABS_TRIGGER_SIZES,
} from "../tabs";
// Through the PACKAGE BARREL, which is the seam a consumer imports from and
// the one that regressed. Taking these from `../tabs` tests the component
// module instead, and would have stayed green while `src/index.ts` went on
// re-exporting the Radix-only aliases — the exact defect this covers.
import type { TabsListProps, TabsTriggerProps } from "../../index";

// Checked at COMPILE time, because that is where the defect lived: the aliases
// rejected `variant` and `size` on the very props object the component
// advertises. `check-types` covers this file.
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
    expect(ghost).toContain("h-8");
    expect(ghost).not.toContain("h-10");
  });

  it("separates the list variants by HEIGHT, not by opacity", () => {
    // Stated as height because that is what actually differs. Omitting
    // `bg-transparent` does not paint a background — a bare `div` is already
    // transparent — so `default` is not opaque and never was, and an assertion
    // that it is would describe a distinction the rendered tabs do not have.
    // `ghost` carries the utility to survive a caller's `tailwind-merge`
    // composition, which is a different property from being opaque.
    expect(classesOf(tabsListVariants())).toContain("h-10");
    expect(classesOf(tabsListVariants({ variant: "ghost" }))).toContain("h-8");
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
/**
 * What each variant is allowed to change, stated COMPLETELY, over every
 * variant the components actually DECLARE.
 *
 * Two independent failures are guarded here, and they need different
 * mechanisms:
 *
 * The first is a variant changing something it should not. Earlier versions
 * classified classes — "does this look like a border or a radius utility" —
 * and were wrong three times running: an anchored pattern missed
 * `hover:border-b-4`, and the modifier-aware replacement still missed
 * `!rounded-md`, bare `rounded` and `[border-radius:8px]`. Each fix bought one
 * spelling, because Tailwind's surface is the whole language. So nothing is
 * classified: the FULL difference from the base is pinned, and any class a
 * variant adds appears in it whatever it is called.
 *
 * The second is a variant nobody remembered to check. A hand-written case
 * table leaves a new arm silently unguarded, so the arms are read from
 * `ALLOWED` and cross-checked against what the component reports — a variant
 * added to the cva config without an entry here fails the exhaustiveness
 * assertion rather than passing unexamined.
 */
const ALLOWED = {
  list: {
    // The compact list: shorter, and declaring the transparent background
    // explicitly so a caller's own composition cannot paint over it.
    ghost: ["bg-transparent", "h-10", "h-8"],
  },
  trigger: {
    // The type scale, and nothing else.
    sm: ["text-sm", "text-xs"],
  },
} as const;

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
 * The arms a component DECLARES, read from the same object `cva` was handed.
 *
 * `cva` does not expose its configuration on the returned function — measured,
 * `Object.keys(fn)` is empty — so the arms are shared as a named declaration
 * instead. Reading it here rather than restating the names is what makes an arm
 * added to the component fail this file rather than pass unexamined.
 */
const armsOf = (declaration: Record<string, string>): string[] =>
  Object.keys(declaration)
    .filter(name => name !== "default")
    .sort();

describe("what a variant is allowed to change", () => {
  it.each([
    ["list", tabsListVariants, "variant", ALLOWED.list, TABS_LIST_VARIANTS],
    [
      "trigger",
      tabsTriggerVariants,
      "size",
      ALLOWED.trigger,
      TABS_TRIGGER_SIZES,
    ],
  ])(
    "guards every declared %s variant",
    (_n, fn, key, allowed, declaration) => {
      // Exhaustiveness FIRST. Without this the loop below is vacuously happy
      // about a variant that was never added to `ALLOWED`.
      const declared = armsOf(declaration);
      expect(declared).toEqual(Object.keys(allowed).sort());
      expect(declared.length).toBeGreaterThan(0);

      const base = (fn as (o?: Record<string, string>) => string)();
      for (const [arm, only] of Object.entries(allowed)) {
        const variant = (fn as (o?: Record<string, string>) => string)({
          [key]: arm,
        });
        expect(differenceBetween(base, variant)).toEqual(only);
      }
    }
  );

  it("keeps the square edge and the underline in the base", () => {
    // A positive control on the assertions above, which compare two resolved
    // strings and so prove nothing on their own about what the base declares.
    const trigger = classesOf(tabsTriggerVariants());
    expect(trigger).toContain("rounded-none");
    expect(trigger).toContain("border-b-2");
    expect(trigger).toContain("data-[state=active]:border-b-primary");

    // Unmarked, deliberately. The colour of the line under the selected tab is
    // the token system's to decide, and an important-marked utility is the one
    // thing a theme cannot override — so marking it would make this the single
    // line in the admin that ignores a retheme.
    expect(trigger).not.toContain("data-[state=active]:border-b-primary!");
    expect(classesOf(tabsListVariants())).toContain("rounded-none");
  });
});
