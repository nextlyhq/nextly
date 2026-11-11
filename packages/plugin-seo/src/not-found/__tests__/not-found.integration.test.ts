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

import { seoPlugin } from "../../plugin";
import { putRedirect } from "../../redirects/store";
import { NOT_FOUND_SLUG } from "../collection";
import { pruneNotFound, recordNotFound } from "../log";
import { keptSeoContext, logNotFound } from "../report";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    plugins: [seoPlugin({ collections: [] })],
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
async function logged(t: TestNextly) {
  const { items } = await t.nextly.find({
    collection: NOT_FOUND_SLUG,
    limit: 500,
  });
  return Object.fromEntries(
    (items as Record<string, unknown>[]).map(row => [
      String(row.path),
      Number(row.hits),
    ])
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

    it("counts every request for one address when they arrive at once", async () => {
      const { t, seo } = await boot(dialect);

      await Promise.all(
        Array.from({ length: 8 }, () => recordNotFound(seo, "/busy"))
      );

      expect(await logged(t)).toEqual({ "/busy": 8 });
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
        await recordNotFound(seo, "/popular", "missing", at(0), bound);
      }
      await recordNotFound(seo, "/once-early", "missing", at(1), bound);
      for (let n = 0; n < 30; n++) {
        await recordNotFound(seo, `/flood-${n}`, "missing", at(10 + n), bound);
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
