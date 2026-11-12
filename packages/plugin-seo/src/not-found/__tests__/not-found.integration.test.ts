/**
 * The log of addresses not found, on each dialect: a page's not-found render
 * logs the address the Proxy passed on, grouped by address with a count;
 * admin, API and asset requests never enter it; a flood of distinct
 * addresses leaves it bounded, keeping the most recent and the most
 * frequent; and a redirect saved from a logged address takes it off.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createNextlyProxy } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { statementsOf } from "../../__tests__/count-statements";
import { lastCatchUp } from "../../address-record/catch-up";
import { seoPlugin } from "../../plugin";
import { putRedirect } from "../../redirects/store";
import { NOT_FOUND_SLUG } from "../collection";
import {
  moveLoggedRows,
  pathKey,
  pruneNotFound,
  readNotFoundLog,
  recordNotFound,
} from "../log";
import { keptSeoContext, logNotFound } from "../report";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect, languages = false) {
  current = await createTestNextly({
    dialect,
    plugins: [seoPlugin({ collections: [] })],
    ...(languages
      ? {
          localization: { locales: ["en", "de"], defaultLocale: "en" },
          languageAddresses: { by: "prefix", defaultLanguage: "unprefixed" },
        }
      : {}),
  });
  const seo = keptSeoContext();
  if (!seo) throw new Error("the SEO plugin never started");
  return { t: current, seo };
}

/**
 * The request headers a page renders with once the site's Proxy has let a
 * request for `path` through, as the not-found page reads them.
 */
async function renderedWith(path: string, sent: Record<string, string> = {}) {
  let forwarded = new Headers(sent);
  const proxy = createNextlyProxy(
    {} as Parameters<typeof createNextlyProxy>[0],
    {
      start: async () => undefined,
      next: () => init => {
        if (init?.request) forwarded = init.request.headers;
        return new Response(null);
      },
    }
  );
  await proxy(new Request(`https://example.com${path}`, { headers: sent }));
  return forwarded;
}

/** A row as an earlier version kept it, in the log's collection. */
function loggedEarlier(t: TestNextly, path: string, hits = 1) {
  return t.nextly.create({
    collection: NOT_FOUND_SLUG,
    data: {
      pathKey: pathKey({ locale: "en", path }),
      locale: "en",
      path,
      hits,
      lastSeen: "2026-10-01T00:00:00.000Z",
      kind: "missing",
    },
  });
}

/** Save a redirect from `source`, as the redirects screen does. */
function redirectFrom(seo: PluginContext, source: string, target: string) {
  return seo.services.collections.withTransaction(tx =>
    putRedirect(seo, tx, { locale: "en", source, target, origin: "person" })
  );
}

/** The log, as `address` → visits. */
async function logged(_t: TestNextly) {
  const seo = keptSeoContext();
  if (!seo) throw new Error("the SEO plugin never started");
  return Object.fromEntries(
    (await readNotFoundLog(seo)).map(row => [row.path, row.hits])
  );
}

describe.each(getConfiguredTestDialects())(
  "the not-found log (%s)",
  dialect => {
    it("logs the address a not-found page was asked for, grouped with a count", async () => {
      const { t } = await boot(dialect);

      await logNotFound(await renderedWith("/missing?utm=x"));
      await logNotFound(await renderedWith("/missing"));
      await logNotFound(await renderedWith("/blog/feed.xml"));

      expect(await logged(t)).toEqual({ "/missing": 2, "/blog/feed.xml": 1 });
    });

    it("keeps where visitors came from: another site's host, a path here, a direct visit changing nothing", async () => {
      const { seo } = await boot(dialect);
      const cameFrom = async () =>
        (await readNotFoundLog(seo))[0]?.cameFrom ?? null;

      await logNotFound(await renderedWith("/missing"));
      expect(await cameFrom()).toBeNull();
      await logNotFound(
        await renderedWith("/missing", {
          referer: "https://news.example.org/story?id=7",
        })
      );
      expect(await cameFrom()).toBe("news.example.org");
      await logNotFound(await renderedWith("/missing"));
      expect(await cameFrom()).toBe("news.example.org");
      await logNotFound(
        await renderedWith("/missing", {
          referer: "https://example.com/blog/launch?utm=x",
        })
      );
      expect(await cameFrom()).toBe("/blog/launch");
    });

    it("leaves bots' probes for other systems out of the log", async () => {
      const { t } = await boot(dialect);
      await logNotFound(await renderedWith("/wp-login.php"));
      await logNotFound(await renderedWith("/.env"));
      await logNotFound(await renderedWith("/old-page"));
      expect(await logged(t)).toEqual({ "/old-page": 1 });
    });

    it("counts a request once, however many times its not-found page renders", async () => {
      const { t } = await boot(dialect);
      const once = await renderedWith("/twice");

      // Next.js may render one request's not-found page more than once, and
      // at the same time.
      await Promise.all([logNotFound(once), logNotFound(once)]);
      await logNotFound(once);
      await logNotFound(await renderedWith("/twice"));

      expect(await logged(t)).toEqual({ "/twice": 2 });
    });

    it("counts every request for one address when they arrive at once", async () => {
      const { t, seo } = await boot(dialect);

      await Promise.all(
        Array.from({ length: 8 }, () =>
          recordNotFound(seo, { locale: "en", path: "/busy" })
        )
      );

      expect(await logged(t)).toEqual({ "/busy": 8 });
    });

    it("counts a request for an address already logged in one statement, and a first in at most three", async () => {
      const { t, seo } = await boot(dialect);
      // The start's own background work finished first, outside the count.
      await lastCatchUp();
      await moveLoggedRows(seo);

      const first = await statementsOf(dialect, () =>
        recordNotFound(seo, { locale: "en", path: "/gone" })
      );
      const again = await statementsOf(dialect, () =>
        recordNotFound(seo, { locale: "en", path: "/gone" })
      );

      expect(first.length).toBeLessThanOrEqual(3);
      expect(again).toHaveLength(1);
      expect(await logged(t)).toEqual({ "/gone": 2 });
    });

    it("moves the rows an earlier version logged in its collection, adding to an address logged since", async () => {
      const { t, seo } = await boot(dialect);
      // As an earlier version left them: two addresses in the collection.
      const earlier = (path: string, hits: number, kind: string) =>
        t.nextly.create({
          collection: NOT_FOUND_SLUG,
          data: {
            pathKey: pathKey({ locale: "en", path }),
            locale: "en",
            path,
            hits,
            lastSeen: "2026-10-01T00:00:00.000Z",
            kind,
          },
        });
      await earlier("/old", 7, "missing");
      await earlier("/moved", 3, "moved");
      // And one of them asked for again since this version started.
      await recordNotFound(seo, { locale: "en", path: "/old" });

      expect(await moveLoggedRows(seo)).toBe(2);

      const rows = await readNotFoundLog(seo);
      expect(
        Object.fromEntries(
          rows.map(row => [row.path, `${String(row.hits)} ${row.kind}`])
        )
      ).toEqual({ "/old": "8 missing", "/moved": "3 moved" });
      // The later last time: the request since, not the earlier row's.
      const old = rows.find(row => row.path === "/old");
      expect(Date.parse(old?.firstSeen ?? "")).toBeLessThanOrEqual(
        Date.parse(old?.lastSeen ?? "")
      );
      expect(Date.parse(old?.lastSeen ?? "")).toBeGreaterThan(
        Date.parse("2026-10-01T00:00:00.000Z")
      );
      const { items } = await t.nextly.find({ collection: NOT_FOUND_SLUG });
      expect(items).toEqual([]);

      // Moved once: a later start finds nothing left, and costs one count.
      let again: number | undefined;
      const statements = await statementsOf(dialect, async () => {
        again = await moveLoggedRows(seo);
      });
      expect(again).toBe(0);
      expect(statements).toHaveLength(1);
    });

    it("moves where visitors came from and whether the address is ignored, merging with an address logged since", async () => {
      const { t, seo } = await boot(dialect);
      await moveLoggedRows(seo);
      const earlier = (path: string, fields: Record<string, unknown>) =>
        t.nextly.create({
          collection: NOT_FOUND_SLUG,
          data: {
            pathKey: pathKey({ locale: "en", path }),
            locale: "en",
            path,
            hits: 2,
            lastSeen: "2026-10-01T00:00:00.000Z",
            kind: "missing",
            ...fields,
          },
        });
      await earlier("/copied", { cameFrom: "news.example.org", ignored: true });
      await earlier("/merged", { cameFrom: "news.example.org", ignored: true });
      await earlier("/sourced", { cameFrom: "/blog/launch", ignored: false });
      // Asked for since this version started: one from a newer source, one
      // directly, which knows no source.
      await recordNotFound(seo, {
        locale: "en",
        path: "/merged",
        cameFrom: "/pricing",
      });
      await recordNotFound(seo, { locale: "en", path: "/sourced" });

      await moveLoggedRows(seo);

      const rows = await readNotFoundLog(seo);
      expect(
        Object.fromEntries(
          rows.map(row => [
            row.path,
            `${String(row.hits)} ${String(row.cameFrom)} ${String(row.ignored)}`,
          ])
        )
      ).toEqual({
        // As the earlier version kept it.
        "/copied": "2 news.example.org true",
        // Ignored where either side was; the newer side's source.
        "/merged": "3 /pricing true",
        // The newer visit knew no source, so the earlier one stands.
        "/sourced": "3 /blog/launch false",
      });
    });

    it("keeps off the log an address a redirect was saved for before its earlier row moved", async () => {
      const { t, seo } = await boot(dialect);
      // The start's own move has found nothing: the rows below are what an
      // upgrade finds, still in the collection when the next move counts.
      await moveLoggedRows(seo);
      await loggedEarlier(t, "/gone", 4);
      await loggedEarlier(t, "/old/page", 2);
      await loggedEarlier(t, "/kept", 1);

      // The move has counted the rows and read none yet when the redirects
      // are saved: one from an address, and a pattern over another.
      await moveLoggedRows(seo, {
        afterCount: async () => {
          await redirectFrom(seo, "/gone", "/here");
          await redirectFrom(seo, "/old/*", "/new/*");
        },
      });

      expect(await logged(t)).toEqual({ "/kept": 1 });
      const { items } = await t.nextly.find({ collection: NOT_FOUND_SLUG });
      expect(items).toEqual([]);
    });

    it("reads nothing of the earlier collection on a redirect save once nothing is left to move", async () => {
      const { seo } = await boot(dialect);
      await moveLoggedRows(seo);

      const statements = await statementsOf(dialect, () =>
        redirectFrom(seo, "/gone", "/here")
      );

      expect(statements.filter(sql => /nx_seo_not_found/.test(sql))).toEqual(
        []
      );
    });

    it.skipIf(dialect === "sqlite")(
      "keeps an address off the log where its redirect is saved while the move holds its earlier row",
      async () => {
        const { t, seo } = await boot(dialect);
        await moveLoggedRows(seo);
        await loggedEarlier(t, "/gone", 4);

        // The move reads the row under its lock and stops there, before it
        // copies the row. The redirect is saved from the test's own flow, so
        // on a transaction of its own: one started inside the move's would
        // join the move's transaction instead.
        let locked!: () => void;
        const held = new Promise<void>(resolve => {
          locked = resolve;
        });
        let release!: () => void;
        const released = new Promise<void>(resolve => {
          release = resolve;
        });
        const moving = moveLoggedRows(seo, {
          afterLock: async () => {
            locked();
            await released;
          },
        });
        await held;
        const saving = redirectFrom(seo, "/gone", "/here");
        // Long enough for the save to reach the row the move holds and wait.
        await new Promise(resolve => setTimeout(resolve, 500));
        release();
        await Promise.all([moving, saving]);

        expect(await logged(t)).toEqual({});
        const { items } = await t.nextly.find({ collection: NOT_FOUND_SLUG });
        expect(items).toEqual([]);
      }
    );

    it("leaves admin, API and asset requests out, whatever header a visitor sends", async () => {
      const { t } = await boot(dialect);
      const spoofed = {
        "x-nextly-seo-asked-for": "https://example.com/made-up",
      };

      for (const path of [
        "/admin/x",
        "/api/x",
        "/_next/x",
        "/logo.png",
        "/app.js",
      ]) {
        await logNotFound(await renderedWith(path, spoofed));
      }

      expect(await logged(t)).toEqual({});
    });

    it("stays bounded under a flood of distinct addresses, keeping the most recent and the most frequent", async () => {
      const { t, seo } = await boot(dialect);
      const bound = { limit: 10, slack: 2 };
      const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
      for (let visit = 0; visit < 5; visit++) {
        await recordNotFound(
          seo,
          { locale: "en", path: "/popular" },
          "missing",
          at(0),
          bound
        );
      }
      await recordNotFound(
        seo,
        { locale: "en", path: "/once-early" },
        "missing",
        at(1),
        bound
      );
      for (let n = 0; n < 30; n++) {
        await recordNotFound(
          seo,
          { locale: "en", path: `/flood-${n}` },
          "missing",
          at(10 + n),
          bound
        );
      }

      const after = await logged(t);
      expect(Object.keys(after).length).toBeLessThanOrEqual(
        bound.limit + bound.slack
      );
      expect(after["/popular"]).toBe(5);
      expect(after["/flood-29"]).toBe(1);
      expect(after).not.toHaveProperty("/once-early");

      // Pruned now, the log keeps exactly the five most recent and the five
      // most visited, a tie on visits going to the more recent address.
      await pruneNotFound(seo, bound.limit);
      expect(await logged(t)).toEqual({
        "/popular": 5,
        "/flood-25": 1,
        "/flood-26": 1,
        "/flood-27": 1,
        "/flood-28": 1,
        "/flood-29": 1,
      });
    });

    it("keeps one path in two languages apart, and a redirect in one takes off only its own", async () => {
      const { t, seo } = await boot(dialect, true);
      await logNotFound(await renderedWith("/gone"));
      await logNotFound(await renderedWith("/de/gone"));
      await logNotFound(await renderedWith("/de/gone"));

      const byLanguage = async () =>
        Object.fromEntries(
          (await readNotFoundLog(seo)).map(row => [
            `${row.locale}|${row.path}`,
            row.hits,
          ])
        );
      expect(await byLanguage()).toEqual({ "en|/gone": 1, "de|/gone": 2 });

      await seo.services.collections.withTransaction(tx =>
        putRedirect(seo, tx, {
          locale: "de",
          source: "/gone",
          target: "/hier",
          origin: "person",
        })
      );

      expect(await byLanguage()).toEqual({ "en|/gone": 1 });
    });

    it("keeps an address logged where the redirect saved from it rolls back", async () => {
      const { seo } = await boot(dialect);
      await recordNotFound(seo, { locale: "en", path: "/gone" });

      // The log's row goes on the redirect's own transaction, so a save that
      // fails after it takes the row back with it.
      await expect(
        seo.services.collections.withTransaction(async tx => {
          await putRedirect(seo, tx, {
            locale: "en",
            source: "/gone",
            target: "/here",
            origin: "person",
          });
          throw new Error("the save failed after the redirect");
        })
      ).rejects.toThrow("the save failed after the redirect");

      expect(
        (await readNotFoundLog(seo)).map(row => `${row.path} ${row.hits}`)
      ).toEqual(["/gone 1"]);
    });

    it("takes off every address a saved pattern now answers, and only those", async () => {
      const { t, seo } = await boot(dialect);
      for (const path of ["/old/x", "/old/y/z", "/older", "/old"]) {
        await logNotFound(await renderedWith(path));
      }

      await seo.services.collections.withTransaction(tx =>
        putRedirect(seo, tx, {
          locale: "en",
          source: "/old/*",
          target: "/new/*",
          origin: "person",
        })
      );

      expect(await logged(t)).toEqual({ "/older": 1 });
    });

    it("logs an address asked for with a trailing slash as the address without one", async () => {
      const { t, seo } = await boot(dialect);
      await logNotFound(await renderedWith("/gone/"));
      await logNotFound(await renderedWith("/gone"));
      expect(await logged(t)).toEqual({ "/gone": 2 });

      await seo.services.collections.withTransaction(tx =>
        putRedirect(seo, tx, {
          locale: "en",
          source: "/gone",
          target: "/here",
          origin: "person",
        })
      );

      expect(await logged(t)).toEqual({});
    });

    it("takes an address off once a redirect answers it", async () => {
      const { t, seo } = await boot(dialect);
      await logNotFound(await renderedWith("/gone"));
      await logNotFound(await renderedWith("/still-gone"));

      await seo.services.collections.withTransaction(tx =>
        putRedirect(seo, tx, {
          locale: "en",
          source: "/gone",
          target: "/here",
          origin: "person",
        })
      );

      expect(await logged(t)).toEqual({ "/still-gone": 1 });
    });
  }
);
