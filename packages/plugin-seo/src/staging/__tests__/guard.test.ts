/**
 * The staging guard: which hosts are kept out of search, where the site's
 * production addresses come from, and the header the Proxy sends.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { keepRecord } from "../../address-record/__tests__/record-double";
import type { SiteRules } from "../../resolver/page-levels";
import { PRODUCTION_ADDRESSES_ENV, originsFrom } from "../../canonical";
import { decideStanding, keptOutOfSearch, stagingGuard } from "../guard";

// The address record's notes, as each context keeps them.
vi.mock("../../address-record/store", async importOriginal => ({
  ...(await importOriginal()),
  ...(await import("../../address-record/__tests__/record-double"))
    .recordDouble,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A plugin context whose standing note is read by `note`. */
function withNote(note: () => Promise<string | undefined>): PluginContext {
  const ctx = { self: { collections: {} } } as unknown as PluginContext;
  keepRecord(ctx, [], note);
  return ctx;
}

/** A plugin context whose record holds `standing`, counting its reads. */
function context(standing?: "listable" | "guarded") {
  const reads = { count: 0 };
  const ctx = withNote(async () => {
    reads.count += 1;
    return standing;
  });
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

  it("with addresses named, never waits on the database, even when it is down", async () => {
    vi.stubEnv(PRODUCTION_ADDRESSES_ENV, "https://acme.example");
    const reads = { count: 0 };
    const ctx = withNote(async () => {
      reads.count += 1;
      throw new Error("database unavailable");
    });
    const guard = stagingGuard(rules([]));

    expect(
      await guard.handle(new Request("https://preview.acme.dev/"), ctx)
    ).toEqual({ headers: { "X-Robots-Tag": "noindex" } });
    expect(reads.count).toBe(0);
  });

  it("reads the standing again until it is decided", async () => {
    // The first request comes before the start has recorded the standing;
    // the guarded standing recorded next must count from the next request.
    let standing: string | undefined;
    const ctx = withNote(async () => standing);
    const guard = stagingGuard(rules([]));

    expect(
      await guard.handle(new Request("https://acme.example/"), ctx)
    ).toBeUndefined();
    standing = "guarded";
    expect(
      await guard.handle(new Request("https://acme.example/"), ctx)
    ).toEqual({ headers: { "X-Robots-Tag": "noindex" } });
  });

  it("without the environment, waits on the database for the first request only", async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      let answer: Promise<string | undefined> = Promise.resolve("guarded");
      const ctx = withNote(() => {
        reads += 1;
        return answer;
      });
      const guard = stagingGuard(rules([]));
      const noindex = { headers: { "X-Robots-Tag": "noindex" } };
      expect(
        await guard.handle(new Request("https://acme.example/"), ctx)
      ).toEqual(noindex);

      // Past the half minute the database stops answering: the request is
      // still answered at once, from what was read, and the read goes on in
      // the background.
      vi.advanceTimersByTime(31_000);
      answer = new Promise<string | undefined>(() => undefined);
      expect(
        await guard.handle(new Request("https://acme.example/"), ctx)
      ).toEqual(noindex);
      expect(reads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
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

/**
 * A new plugin context with no standing recorded, whose one site type lists
 * `pages` in turn, keeping the standing it records.
 */
function startingContext(pages: { holds: unknown[] }[][]) {
  const ctx = {
    self: { collections: {} },
    publicAddresses: {
      types: async () => ["authors"],
      held: async ({ after }: { after?: string }) => {
        const index = after === undefined ? 0 : Number(after);
        const next = index + 1 < pages.length ? String(index + 1) : undefined;
        return {
          items: (pages[index] ?? []).map((item, n) => ({
            holder: { collection: "authors", id: `${index}-${n}` },
            ...item,
          })),
          ...(next === undefined ? {} : { next }),
        };
      },
    },
  } as unknown as PluginContext;
  const { notes } = keepRecord(ctx);
  return { ctx, recorded: notes };
}

describe("the standing a site starts with", () => {
  it("is guarded where the stored documents hold no address", async () => {
    // Authors, say: stored, but with no page of their own on the site.
    const { ctx, recorded } = startingContext([[{ holds: [] }, { holds: [] }]]);
    expect(await decideStanding(ctx)).toBe("guarded");
    expect([...recorded.values()]).toEqual(["guarded"]);
  });

  it("is listable where a page holds an address, however far into the list", async () => {
    const { ctx } = startingContext([
      [{ holds: [] }],
      [{ holds: [] }, { holds: [{ locale: "en", path: "/about" }] }],
    ]);
    expect(await decideStanding(ctx)).toBe("listable");
  });
});
