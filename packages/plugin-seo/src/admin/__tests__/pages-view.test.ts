/**
 * What the Pages and addresses screen shows from the list it reads: its
 * counts, the addresses a filter and a search keep, and Google's result.
 */
import { describe, expect, it } from "vitest";

import type { SiteAddress } from "../../code-pages/contract";
import {
  countsOf,
  cut,
  developerNote,
  resultAddress,
  shownAddresses,
  valueSource,
} from "../pages-view";

const ITEMS: SiteAddress[] = [
  {
    path: "/",
    name: "Home",
    source: "entry",
    from: "Pages",
    standing: "listed",
  },
  {
    path: "/pricing",
    name: "Pricing",
    source: "built",
    from: "app/pricing/page.tsx",
    standing: "not-connected",
  },
  {
    path: "/contact",
    name: "Contact",
    source: "built",
    from: "app/contact/page.tsx",
    standing: "listed",
  },
  {
    path: "/integrations/wordpress",
    name: "Wordpress",
    source: "dynamic",
    from: "app/integrations/[name]/page.tsx",
    standing: "hidden",
  },
];

describe("the counts above the list", () => {
  it("counts each kind of address in the list", () => {
    expect(countsOf(ITEMS)).toEqual({
      all: 4,
      entries: 1,
      built: 2,
      dynamic: 1,
      notConnected: 1,
    });
  });
});

describe("the addresses shown", () => {
  const paths = (items: SiteAddress[]) => items.map(item => item.path);

  it("keeps each filter's addresses", () => {
    expect(paths(shownAddresses(ITEMS, "all", ""))).toEqual(paths(ITEMS));
    expect(paths(shownAddresses(ITEMS, "entry", ""))).toEqual(["/"]);
    expect(paths(shownAddresses(ITEMS, "code", ""))).toEqual([
      "/pricing",
      "/contact",
      "/integrations/wordpress",
    ]);
    expect(paths(shownAddresses(ITEMS, "not-connected", ""))).toEqual([
      "/pricing",
    ]);
  });

  it("finds an address by part of it or of its name, whatever the case", () => {
    expect(paths(shownAddresses(ITEMS, "all", "INTEGR"))).toEqual([
      "/integrations/wordpress",
    ]);
    expect(paths(shownAddresses(ITEMS, "all", " contact "))).toEqual([
      "/contact",
    ]);
    // The home page's address holds no "home": found by its name.
    expect(paths(shownAddresses(ITEMS, "all", "HOME"))).toEqual(["/"]);
    expect(paths(shownAddresses(ITEMS, "entry", "pricing"))).toEqual([]);
  });
});

describe("Google's result", () => {
  it("cuts a long text as Google does, and leaves a short one", () => {
    expect(cut("Pricing | Rext AI", 61)).toBe("Pricing | Rext AI");
    expect(cut("a".repeat(70), 61)).toBe(`${"a".repeat(60)} …`);
  });

  it("writes the address under the site's name", () => {
    expect(resultAddress("https://rext.ai/integrations/wordpress")).toBe(
      "https://rext.ai › integrations › wordpress"
    );
    expect(resultAddress("https://rext.ai/")).toBe("https://rext.ai");
  });
});

describe("the note for a developer", () => {
  it("names the address, its route and the line to add", () => {
    const note = developerNote(ITEMS[1]);
    expect(note).toContain("/pricing (app/pricing/page.tsx)");
    expect(note).toContain('seoMetadata("/pricing")');
  });
});

describe("where a field's value comes from", () => {
  const page = (
    standing: SiteAddress["standing"],
    automatic: NonNullable<SiteAddress["seo"]>["automatic"]
  ): SiteAddress => ({
    path: "/pricing",
    name: "Pricing",
    source: "built",
    from: "app/pricing/page.tsx",
    standing,
    seo: { typed: { hidden: false }, automatic },
  });
  const pattern = {
    title: {
      value: "Pricing | Acme",
      from: "pattern" as const,
      pattern: "{Title} | {Site name}",
    },
  };

  it("is what was typed, whatever else there is", () => {
    expect(valueSource(page("listed", pattern), "title", true)).toEqual({
      kind: "typed",
    });
  });

  it("is the route's code while the route is not connected, or where its code supplies it", () => {
    expect(valueSource(page("not-connected", pattern), "title", false)).toEqual(
      { kind: "code", connected: false }
    );
    expect(
      valueSource(
        page("listed", { title: { value: "Pricing", from: "code" } }),
        "title",
        false
      )
    ).toEqual({ kind: "code", connected: true });
  });

  it("is the site's pattern, or its defaults, otherwise", () => {
    expect(valueSource(page("listed", pattern), "title", false)).toEqual({
      kind: "pattern",
      pattern: "{Title} | {Site name}",
    });
    expect(valueSource(page("listed", pattern), "description", false)).toEqual({
      kind: "site",
      field: "description",
      found: false,
    });
  });
});
