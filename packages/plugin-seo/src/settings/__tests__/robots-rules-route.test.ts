/**
 * The pages the check of own robots.txt rules judges are the sitemap's
 * addresses as listed, in each language at the address it is served at, not
 * the record's path a language prefix is added to.
 */
import { describe, expect, it } from "vitest";

import { listingOrigins, sitemapPaths } from "../robots-rules-route";

describe("sitemapPaths", () => {
  it("is each listed page's path as the sitemap lists it", () => {
    expect(
      sitemapPaths([
        { loc: "https://example.com/about", path: "/about" },
        { loc: "https://example.com/fr/a-propos", path: "/a-propos" },
        { loc: "https://example.com/search?q=1", path: "/search" },
      ])
    ).toEqual(["/about", "/fr/a-propos", "/search?q=1"]);
  });
});

describe("listingOrigins", () => {
  const ctx = {} as never;
  const reading = (productionAddresses: string[]) => () =>
    Promise.resolve({ patterns: {}, productionAddresses });

  it("is every production address, so each language domain's sitemap is read", async () => {
    expect(
      await listingOrigins(
        ctx,
        reading(["https://example.com", "https://example.de"]),
        "https://old.example.com"
      )
    ).toEqual(["https://example.com", "https://example.de"]);
  });

  it("is the configured origin where no production address is known, else this host", async () => {
    expect(
      await listingOrigins(ctx, reading([]), "https://example.com/blog")
    ).toEqual(["https://example.com"]);
    expect(await listingOrigins(ctx, reading([]), undefined)).toEqual([
      "http://localhost",
    ]);
  });
});
