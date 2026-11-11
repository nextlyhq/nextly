/**
 * The staging guard: which hosts are kept out of search, where the site's
 * production addresses come from, and the header the Proxy sends.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SiteRules } from "../../resolver/page-levels";
import {
  PRODUCTION_ADDRESSES_ENV,
  keptOutOfSearch,
  originsFrom,
  stagingGuard,
} from "../guard";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A plugin context whose record holds `standing`, counting its reads. */
function context(standing?: "listable" | "guarded") {
  const reads = { count: 0 };
  const ctx = {
    self: { collections: {} },
    services: {
      ownCollections: {
        listEntries: async () => {
          reads.count += 1;
          return {
            data: standing === undefined ? [] : [{ id: "m1", path: standing }],
          };
        },
      },
    },
  } as unknown as PluginContext;
  return { ctx, reads };
}

const rules =
  (productionAddresses: string[]) => async (): Promise<SiteRules> => ({
    productionAddresses,
    patterns: {},
  });

describe("which hosts are kept out of search", () => {
  it("every host but the production addresses, where some are known", () => {
    const own = ["https://acme.example", "https://acme.de"];
    expect(keptOutOfSearch("https://acme.example", own, "guarded")).toBe(false);
    expect(keptOutOfSearch("https://acme.de", own, "guarded")).toBe(false);
    expect(keptOutOfSearch("https://acme.vercel.app", own, "listable")).toBe(
      true
    );
    expect(keptOutOfSearch("http://acme.example", own, "listable")).toBe(true);
  });

  it("with none known: every host of a new site, none of a live one", () => {
    expect(keptOutOfSearch("https://acme.example", [], "guarded")).toBe(true);
    expect(keptOutOfSearch("https://acme.example", [], "listable")).toBe(false);
    // Before the standing is decided, a site is served as it was.
    expect(keptOutOfSearch("https://acme.example", [], undefined)).toBe(false);
  });
});

describe("the production addresses", () => {
  it("are read as origins, unusable ones left out", () => {
    expect(
      originsFrom(" https://acme.example/ , https://acme.de/x, nope, ftp://x")
    ).toEqual(["https://acme.example", "https://acme.de"]);
    expect(originsFrom(undefined)).toEqual([]);
  });
});

describe("the Proxy handler", () => {
  it("sends noindex from any other host, the environment's addresses winning", async () => {
    vi.stubEnv(PRODUCTION_ADDRESSES_ENV, "https://acme.example");
    const { ctx } = context("listable");
    const guard = stagingGuard(rules(["https://settings.example"]));

    expect(
      await guard.handle(new Request("https://preview.acme.dev/about"), ctx)
    ).toEqual({ headers: { "X-Robots-Tag": "noindex" } });
    expect(
      await guard.handle(new Request("https://acme.example/about"), ctx)
    ).toBeUndefined();
    // The settings' address is overridden by the environment's.
    expect(
      await guard.handle(new Request("https://settings.example/about"), ctx)
    ).toEqual({ headers: { "X-Robots-Tag": "noindex" } });
  });

  it("takes the settings' addresses where the environment names none", async () => {
    const { ctx } = context("listable");
    const guard = stagingGuard(rules(["https://acme.example"]));
    expect(
      await guard.handle(new Request("https://acme.example/"), ctx)
    ).toBeUndefined();
    expect(
      await guard.handle(new Request("https://copy.acme.example/"), ctx)
    ).toEqual({ headers: { "X-Robots-Tag": "noindex" } });
  });

  it("keeps a new site with no address out of search, and leaves a live one listed", async () => {
    const guarded = stagingGuard(rules([]));
    expect(
      await guarded.handle(
        new Request("https://acme.example/"),
        context("guarded").ctx
      )
    ).toEqual({ headers: { "X-Robots-Tag": "noindex" } });
    const listable = stagingGuard(rules([]));
    expect(
      await listable.handle(
        new Request("https://acme.example/"),
        context("listable").ctx
      )
    ).toBeUndefined();
  });

  it("reads the standing at most every half minute", async () => {
    const { ctx, reads } = context("listable");
    const guard = stagingGuard(rules([]));
    for (let i = 0; i < 5; i++) {
      await guard.handle(new Request("https://acme.example/"), ctx);
    }
    expect(reads.count).toBe(1);
  });
});
