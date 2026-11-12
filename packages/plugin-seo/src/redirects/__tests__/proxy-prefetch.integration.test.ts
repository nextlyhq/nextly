/**
 * The site's Proxy passes the address a page request asked for on to the
 * page's render, so a route that answers not found can log it, but never
 * for a prefetch: the App Router asks for pages ahead of visits that may
 * never come, and a missing page a prefetch meets is not a visit. A redirect
 * still answers a prefetch, as it answers the visit.
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
import { afterEach, describe, expect, it } from "vitest";

import { keptSeoContext } from "../../not-found/report";
import { seoPlugin } from "../../plugin";
import { putRedirect } from "../store";
import {
  ASKED_FOR_HEADER,
  REQUEST_HEADER,
  redirectsProxyHandler,
} from "../proxy-handler";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect) {
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
  return seo;
}

/** What the handler answers a GET for `path` with, sent with `headers`. */
async function handled(path: string, headers: Record<string, string> = {}) {
  const seo = keptSeoContext();
  if (!seo) throw new Error("the SEO plugin never started");
  return redirectsProxyHandler().handle(
    new Request(`https://example.com${path}`, { headers }),
    seo
  );
}

describe.each(getConfiguredTestDialects())(
  "the address a request asked for (%s)",
  dialect => {
    it("is passed on for a visit, with the request's own id", async () => {
      await boot(dialect);
      const answer = await handled("/missing");
      expect(answer?.requestHeaders?.[ASKED_FOR_HEADER]).toBe(
        "https://example.com/missing"
      );
      expect(answer?.requestHeaders?.[REQUEST_HEADER]).not.toBe("");
    });

    it.each([
      ["a prefetch", { "next-router-prefetch": "1", rsc: "1" }],
      [
        "a segment prefetch",
        { "next-router-segment-prefetch": "/_tree", rsc: "1" },
      ],
    ])(
      "is emptied for %s, so a miss it meets is never logged",
      async (_why, headers) => {
        await boot(dialect);
        const answer = await handled("/missing", headers);
        expect(answer?.requestHeaders).toEqual({
          [ASKED_FOR_HEADER]: "",
          [REQUEST_HEADER]: "",
        });
      }
    );

    it("leaves a prefetch answered by a redirect", async () => {
      const seo = await boot(dialect);
      await seo.services.collections.withTransaction(tx =>
        putRedirect(seo, tx, {
          locale: "en",
          origin: "person",
          source: "/old",
          target: "/new",
        })
      );
      const answer = await handled("/old", {
        "next-router-prefetch": "1",
        rsc: "1",
      });
      expect(answer?.response?.headers.get("location")).toBe(
        "https://example.com/new"
      );
    });
  }
);
