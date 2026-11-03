/**
 * The title and slug the seeded default Layout is given.
 *
 * The property that separates a correct picker from a plausible broken one is
 * that it never answers a name already taken: a picker returning the base name
 * unconditionally passes every case where nothing clashes, so each case below
 * names a clash and asserts the answer is free. Titles and slugs are picked
 * independently, so a clash on one never moves the other.
 */
import { describe, expect, it } from "vitest";

import { seedSlug, seedTitle } from "./seed-names";

describe("the seeded Layout's title", () => {
  it("is the base title when nothing holds it", () => {
    expect(seedTitle(new Set())).toBe("Default (site)");
  });

  it("is not moved by an authored Layout titled Default", () => {
    expect(seedTitle(new Set(["Default"]))).toBe("Default (site)");
  });

  it("takes the first free number when the base title is held", () => {
    expect(seedTitle(new Set(["Default (site)"]))).toBe("Default (site) 2");
  });

  it("skips every numbered title already held, and fills a gap", () => {
    expect(
      seedTitle(
        new Set(["Default (site)", "Default (site) 2", "Default (site) 3"])
      )
    ).toBe("Default (site) 4");
    expect(seedTitle(new Set(["Default (site)", "Default (site) 3"]))).toBe(
      "Default (site) 2"
    );
  });
});

describe("the seeded Layout's slug", () => {
  it("is the base slug when nothing holds it", () => {
    expect(seedSlug(new Set())).toBe("default-site");
  });

  it("is not moved by an authored Layout at the slug default", () => {
    expect(seedSlug(new Set(["default"]))).toBe("default-site");
  });

  it("takes the first free number when the base slug is held", () => {
    expect(seedSlug(new Set(["default-site"]))).toBe("default-site-2");
  });

  it("skips every numbered slug already held, and fills a gap", () => {
    expect(
      seedSlug(new Set(["default-site", "default-site-2", "default-site-3"]))
    ).toBe("default-site-4");
    expect(seedSlug(new Set(["default-site", "default-site-3"]))).toBe(
      "default-site-2"
    );
  });

  it("is picked apart from the title: a held title does not move the slug", () => {
    expect(seedSlug(new Set(["Default (site)"]))).toBe("default-site");
    expect(seedTitle(new Set(["default-site"]))).toBe("Default (site)");
  });
});
