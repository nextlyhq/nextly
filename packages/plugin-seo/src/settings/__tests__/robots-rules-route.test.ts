/**
 * The pages the check of own robots.txt rules judges are the sitemap's
 * addresses as listed, in each language at the address it is served at, not
 * the record's path a language prefix is added to.
 */
import { describe, expect, it, vi } from "vitest";

import {
  checkRobotsRules,
  listingOrigins,
  sitemapPaths,
} from "../robots-rules-route";
import { blockedPagesKey } from "../robots-rules-stored";

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

describe("checkRobotsRules", () => {
  const ctx = {} as never;
  const text = "User-agent: *\nDisallow: /blog";

  it("finds nothing to confirm where the plugin serves no robots.txt or no sitemap", async () => {
    const listPaths = vi.fn(async () => ["/blog/a"]);
    const base = {
      readRules: () => Promise.resolve({ patterns: {} }),
      listPaths,
    };
    expect(
      await checkRobotsRules(ctx, { text }, { ...base, servesBoth: false })
    ).toEqual({ lines: [], pagesKey: blockedPagesKey([]) });
    expect(listPaths).not.toHaveBeenCalled();
    expect(
      (await checkRobotsRules(ctx, { text }, { ...base, servesBoth: true }))
        .lines
    ).toHaveLength(1);
  });

  it("lists the sitemap with the types the draft hides, not the saved ones", async () => {
    const listPaths = vi.fn(async () => ["/blog/a"]);
    await checkRobotsRules(
      ctx,
      { text, hiddenTypes: [] },
      {
        readRules: () =>
          Promise.resolve({ patterns: {}, hiddenTypes: ["posts"] }),
        listPaths,
        servesBoth: true,
      }
    );
    const readRules = listPaths.mock.calls[0]?.[1] as (
      ctx: never,
      locale: undefined
    ) => Promise<{ hiddenTypes?: readonly string[] }>;
    expect((await readRules(ctx, undefined)).hiddenTypes).toEqual([]);
  });
});

describe("checkRobotsRules before the address record is ready", () => {
  it("answers try again, never a listing that may leave pages out", async () => {
    const listPaths = vi.fn(async () => []);
    await expect(
      checkRobotsRules(
        {} as never,
        { text: "User-agent: *\nDisallow: /blog" },
        {
          readRules: () => Promise.resolve({ patterns: {} }),
          listPaths,
          servesBoth: true,
          recordReady: () => false,
        }
      )
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(listPaths).not.toHaveBeenCalled();
  });
});

describe("checkRobotsRules on a site serving its own robots.txt", () => {
  it("finds nothing to confirm, since the plugin's rules are not what crawlers read", async () => {
    const listPaths = vi.fn(async () => ["/blog/a"]);
    expect(
      await checkRobotsRules(
        {} as never,
        { text: "User-agent: *\nDisallow: /blog" },
        {
          readRules: () => Promise.resolve({ patterns: {} }),
          listPaths,
          servesBoth: true,
          recordReady: () => true,
          siteServesOwnRobots: () => Promise.resolve(true),
        }
      )
    ).toEqual({ lines: [], pagesKey: blockedPagesKey([]) });
    expect(listPaths).not.toHaveBeenCalled();
  });
});
