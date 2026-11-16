/**
 * An entry whose collection names a field for its own address
 * (`publicAddressField`) is a page like any other to the SEO plugin: listed
 * at that address, and moved when it changes, leaving a permanent redirect
 * from the old one, as a changed slug does.
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
import { createNextlyProxy } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { keptSeoContext } from "../../not-found/report";
import { listPages } from "../../outputs/listing";
import { seoPlugin } from "../../plugin";
import { REDIRECTS_SLUG } from "../collection";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    plugins: [seoPlugin({ collections: ["features"] })],
    collections: [
      defineCollection({
        slug: "features",
        status: true,
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          text({ name: "address" }),
        ],
        publicAddress: "/features/{slug}",
        publicAddressField: "address",
      }),
    ],
  });
  const seo = keptSeoContext();
  if (!seo) throw new Error("the SEO plugin never started");
  return { t: current, seo };
}

/** Every redirect, as `locale|from` → `to`, with how it was made. */
async function redirects(t: TestNextly) {
  const { items } = await t.nextly.find({
    collection: REDIRECTS_SLUG,
    limit: 50,
  });
  return Object.fromEntries(
    (items as Record<string, unknown>[]).map(row => [
      `${row.locale}|${row.source}`,
      `${row.target} ${row.permanent ? "permanent" : "temporary"} ${row.origin}`,
    ])
  );
}

/** The site's Proxy, as an app wires it, on the Nextly the test started. */
const proxy = createNextlyProxy({} as Parameters<typeof createNextlyProxy>[0], {
  start: async () => undefined,
  next: () => () => new Response(null),
});

/** What the site's Proxy does with a request for `path`. */
async function ask(path: string) {
  const response = await proxy(new Request(`https://example.com${path}`));
  const location = response?.headers.get("location");
  return location === null || location === undefined
    ? "served"
    : `${response?.status} ${location}`;
}

describe.each(getConfiguredTestDialects())(
  "an entry's own address (%s)",
  dialect => {
    it("lists each entry at its own address, else at the template's", async () => {
      const { t, seo } = await boot(dialect);
      await t.nextly.create({
        collection: "features",
        data: {
          title: "Brand voice",
          slug: "brand-voice",
          address: "/brand-voice",
          status: "published",
        },
      });
      await t.nextly.create({
        collection: "features",
        data: {
          title: "Article writer",
          slug: "article-writer",
          status: "published",
        },
      });

      const { pages } = await listPages(seo, {
        origin: "https://example.com",
      });
      expect(pages.map(page => page.loc).sort()).toEqual([
        "https://example.com/brand-voice",
        "https://example.com/features/article-writer",
      ]);
    });

    it("leaves a permanent redirect from the old address when it changes", async () => {
      const { t } = await boot(dialect);
      const created = await t.nextly.create({
        collection: "features",
        data: {
          title: "Brand voice",
          slug: "brand-voice",
          address: "/brand-voice",
          status: "published",
        },
      });
      const id = String(created.item.id);

      await t.nextly.update({
        collection: "features",
        id,
        data: { address: "/voice", _overwrite: true },
      });

      expect(await redirects(t)).toEqual({
        "en|/brand-voice": "/voice permanent automatic",
      });
      expect(await ask("/brand-voice")).toBe("301 https://example.com/voice");
      expect(await ask("/voice")).toBe("served");
    });
  }
);
