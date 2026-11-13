/**
 * An address made Gone answers 410. A site may name its own page for that
 * answer (`gonePage`): the Proxy reads that page and answers with it and
 * status 410. Without one, or where the page can't be read, the answer is a
 * short plain page, still with status 410.
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
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it, vi } from "vitest";

import { keptSeoContext } from "../../not-found/report";
import { seoPlugin } from "../../plugin";
import { redirectsProxyHandler } from "../proxy-handler";
import { putRedirect } from "../store";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect, gone: readonly string[]) {
  current = await createTestNextly({
    dialect,
    plugins: [seoPlugin({ collections: ["pages"] })],
    collections: [
      defineCollection({
        slug: "pages",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
    ],
  });
  const seo = keptSeoContext();
  if (!seo) throw new Error("the SEO plugin never started");
  for (const source of gone) {
    await seo.services.collections.withTransaction(tx =>
      putRedirect(seo, tx, {
        locale: "en",
        origin: "person",
        source,
        gone: true,
      })
    );
  }
  return seo;
}

/** The site's own page, as a fake `fetch` answers it. */
function sitePage(status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response("<html><body><h1>Retired</h1></body></html>", {
        status,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    )
  );
}

describe.each(getConfiguredTestDialects())(
  "a Gone address's answer (%s)",
  dialect => {
    it("is a short plain page with status 410 where the site names no page", async () => {
      const seo = await boot(dialect, ["/old-offer"]);
      const answer = await redirectsProxyHandler().handle(
        new Request("https://example.com/old-offer"),
        seo
      );
      expect(answer?.response?.status).toBe(410);
      expect(await answer?.response?.text()).toBe("This page is gone.");
    });

    it("is the site's own page with status 410 where the site names one", async () => {
      const seo = await boot(dialect, ["/old-offer"]);
      const fetchPage = sitePage();
      const answer = await redirectsProxyHandler(undefined, undefined, {
        gonePage: "/gone",
        fetchPage,
      }).handle(new Request("https://example.com/old-offer"), seo);
      expect(answer?.response?.status).toBe(410);
      expect(answer?.response?.headers.get("content-type")).toBe(
        "text/html; charset=utf-8"
      );
      expect(await answer?.response?.text()).toContain("<h1>Retired</h1>");
      expect(String(fetchPage.mock.calls[0]?.[0])).toBe(
        "https://example.com/gone"
      );
    });

    it.each([
      ["answers with an error", () => sitePage(500)],
      [
        "can't be reached",
        () =>
          vi.fn(async () => Promise.reject(new Error("connection refused"))),
      ],
    ])(
      "falls back to the plain page where the site's page %s",
      async (_why, make) => {
        const seo = await boot(dialect, ["/old-offer"]);
        const answer = await redirectsProxyHandler(undefined, undefined, {
          gonePage: "/gone",
          fetchPage: make(),
        }).handle(new Request("https://example.com/old-offer"), seo);
        expect(answer?.response?.status).toBe(410);
        expect(await answer?.response?.text()).toBe("This page is gone.");
      }
    );

    it("answers the plain page, reading nothing, where the named page is itself Gone", async () => {
      const seo = await boot(dialect, ["/gone"]);
      const fetchPage = sitePage();
      const answer = await redirectsProxyHandler(undefined, undefined, {
        gonePage: "/gone",
        fetchPage,
      }).handle(new Request("https://example.com/gone"), seo);
      expect(answer?.response?.status).toBe(410);
      expect(await answer?.response?.text()).toBe("This page is gone.");
      expect(fetchPage).not.toHaveBeenCalled();
    });
  }
);

describe("the gonePage option", () => {
  it.each(["gone", "//other.example/gone", "https://other.example/gone"])(
    "refuses %s, which is not an address from the site's root",
    gonePage => {
      expect(() => seoPlugin({ collections: ["pages"], gonePage })).toThrow(
        /gonePage/
      );
    }
  );
});
