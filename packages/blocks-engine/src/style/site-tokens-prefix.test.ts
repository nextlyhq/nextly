/**
 * The site's CSS variable prefix as a setting a person changes: each refused
 * prefix says why in plain words, and a change moves nothing in the site's
 * sheet but the prefix.
 */
import { describe, expect, it } from "vitest";

import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import type { NamedClass } from "./named-class";
import { compileSiteSheet } from "./site-sheet";
import { resolveTokenPrefix, type SiteTokenSet } from "./site-tokens";

describe("resolveTokenPrefix's reason for a refusal", () => {
  it("gives none for a prefix it takes, or for no prefix at all", () => {
    expect(resolveTokenPrefix("--brand-").refusal).toBeUndefined();
    expect(resolveTokenPrefix("--site-").refusal).toBeUndefined();
    expect(resolveTokenPrefix(undefined).refusal).toBeUndefined();
  });

  it("says --nx- is the admin's own", () => {
    const result = resolveTokenPrefix("--nx-");
    expect(result.prefix).toBe("--site-");
    expect(result.refusal).toBe(
      "--nx- is kept for the admin's own styles. Choose another prefix."
    );
  });

  it("says --tw- is Tailwind's, for anything that starts with it", () => {
    expect(resolveTokenPrefix("--tw-brand-").refusal).toBe(
      "--tw- is used by Tailwind. Choose another prefix."
    );
  });

  it.each([
    "brand",
    "brand-",
    "--Brand-",
    "--brand_",
    "--brand -",
    "",
    // Nothing between the dashes: `--color-brand` and the like are
    // Tailwind's own theme names.
    "--",
    "---",
    // No closing dash, which would run the prefix into every name.
    "--brand",
  ])("says what a prefix looks like for %j", bad => {
    const result = resolveTokenPrefix(bad);
    expect(result.prefix).toBe("--site-");
    expect(result.refusal).toBe(
      "A prefix starts with two dashes, uses only lowercase letters, numbers and dashes, and ends with a dash, like --brand-."
    );
  });

  it("refuses an over-long prefix with the same plain reason", () => {
    expect(resolveTokenPrefix(`--${"a".repeat(80)}-`).refusal).toContain(
      "A prefix starts with two dashes"
    );
  });

  it("keeps the compiler's own report beside the reason", () => {
    // The issue is what a compile reports; the reason is what a person reads.
    // Both come from the one decision, so they never disagree on a refusal.
    for (const bad of ["--nx-", "brand"]) {
      const result = resolveTokenPrefix(bad);
      expect(result.issue).toBeDefined();
      expect(result.refusal).toBeDefined();
    }
  });
});

describe("a prefix change in the site's sheet", () => {
  const tokens: SiteTokenSet = {
    tokens: [
      {
        name: "color.brand",
        kind: "color",
        values: { light: "#0055ff", dark: "#88aaff" },
      },
      { name: "space.gap", kind: "dimension", values: { light: "12px" } },
    ],
  };
  const classes: NamedClass[] = [
    {
      id: "card",
      slug: "card",
      label: "Card",
      orderIndex: 0,
      styles: {
        base: {
          base: {
            color: { $token: "color.brand" },
            gap: { $token: "space.gap" },
          },
        },
      },
    },
  ];

  function sheet(prefix: string | undefined): string {
    return compileSiteSheet(
      {
        tokens: prefix === undefined ? tokens : { ...tokens, prefix },
        classes,
        blockBases: {
          "core/section": {
            base: { base: { padding: { $token: "space.gap" } } },
          },
        },
        breakpoints: FIXTURE_BREAKPOINTS,
      },
      {}
    ).css;
  }

  it("writes the same sheet with only the prefix changed", () => {
    const before = sheet(undefined);
    const after = sheet("--brand-");
    // A positive control: the sheet does define and read variables, so the
    // comparison below is about something.
    expect(before).toContain("--site-color-brand:");
    expect(before).toContain("var(--site-space-gap)");
    expect(after).not.toContain("--site-");
    expect(after).toBe(before.replaceAll("--site-", "--brand-"));
  });
});
