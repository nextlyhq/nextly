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

import {
  createdSlug,
  createdTitle,
  seedSlug,
  seedTitle,
  starterSlug,
  starterTitle,
} from "./seed-names";

describe("the seeded Layout's title", () => {
  it("is the base title when nothing holds it", () => {
    expect(seedTitle(new Set())).toBe("Main");
  });

  it("is not moved by an authored Layout titled Default", () => {
    expect(seedTitle(new Set(["Default"]))).toBe("Main");
  });

  it("takes the first free number when the base title is held", () => {
    expect(seedTitle(new Set(["Main"]))).toBe("Main 2");
  });

  it("skips every numbered title already held, and fills a gap", () => {
    expect(seedTitle(new Set(["Main", "Main 2", "Main 3"]))).toBe("Main 4");
    expect(seedTitle(new Set(["Main", "Main 3"]))).toBe("Main 2");
  });
});

describe("the seeded Layout's slug", () => {
  it("is the base slug when nothing holds it", () => {
    expect(seedSlug(new Set())).toBe("main");
  });

  it("is not moved by an authored Layout at the slug default", () => {
    expect(seedSlug(new Set(["default"]))).toBe("main");
  });

  it("takes the first free number when the base slug is held", () => {
    expect(seedSlug(new Set(["main"]))).toBe("main-2");
  });

  it("skips every numbered slug already held, and fills a gap", () => {
    expect(seedSlug(new Set(["main", "main-2", "main-3"]))).toBe("main-4");
    expect(seedSlug(new Set(["main", "main-3"]))).toBe("main-2");
  });

  it("is picked apart from the title: a held title does not move the slug", () => {
    expect(seedSlug(new Set(["Main"]))).toBe("main");
    expect(seedTitle(new Set(["main"]))).toBe("Main");
  });
});

describe("the starter components' names", () => {
  it("are Starter header and Starter footer when nothing holds them", () => {
    expect(starterTitle("header", new Set())).toBe("Starter header");
    expect(starterTitle("footer", new Set())).toBe("Starter footer");
    expect(starterSlug("header", new Set())).toBe("starter-header");
    expect(starterSlug("footer", new Set())).toBe("starter-footer");
  });

  it("take the first free number when an authored component holds the name", () => {
    expect(
      starterTitle("header", new Set(["Starter header", "Starter header 2"]))
    ).toBe("Starter header 3");
    expect(starterSlug("footer", new Set(["starter-footer"]))).toBe(
      "starter-footer-2"
    );
  });
});

describe("a header or footer created from the canvas's band", () => {
  it("is Header or Footer, never named as the seed's starter", () => {
    expect(createdTitle("header", new Set())).toBe("Header");
    expect(createdTitle("footer", new Set())).toBe("Footer");
    expect(createdSlug("header", new Set())).toBe("header");
    expect(createdSlug("footer", new Set())).toBe("footer");
  });

  it("takes the first free number when a component holds the name", () => {
    expect(createdTitle("header", new Set(["Header", "Header 2"]))).toBe(
      "Header 3"
    );
    expect(createdSlug("footer", new Set(["footer"]))).toBe("footer-2");
  });
});
