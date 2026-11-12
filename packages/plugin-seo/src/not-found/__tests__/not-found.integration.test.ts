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
