/**
 * On every configured dialect: the site's standing is decided from whether
 * it has pages, the Proxy sends `noindex` from any host but the production
 * address, and a page that lost its address to another is given no canonical.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text, type SanitizedNextlyConfig } from "nextly";
import {
  createNextlyProxy,
  createPublicContentRoute,
  type ContentEntry,
} from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { noteRows } from "../../address-record/__tests__/record-tables";
import { seoPlugin } from "../../plugin";
import { PRODUCTION_ADDRESSES_ENV } from "../../canonical";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  await current?.destroy();
  current = undefined;
});

/** A plugin that hands its context over, to move addresses directly. */
function contextOf() {
  const seen: { ctx?: PluginContext } = {};
  const plugin = definePlugin({
    name: "@test/address-mover",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      seen.ctx = ctx;
    },
  });
  return { plugin, seen };
}

async function boot(dialect: TestDialect) {
  const { plugin, seen } = contextOf();
  current = await createTestNextly({
    dialect,
    plugins: [seoPlugin({ collections: ["pages", "posts"] }), plugin],
    collections: ["pages", "posts"].map(slug =>
      defineCollection({
        slug,
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      })
    ),
  });
  const ctx = seen.ctx;
  if (!ctx) throw new Error("the helper plugin never started");
  return { t: current, ctx };
}

async function publish(t: TestNextly, collection: string, slug: string) {
  const created = await t.nextly.create({
    collection,
    data: { title: slug, slug, status: "published" },
  });
  return String(created.item.id);
}

/** The site's standing as the record holds it, once the start has decided it. */
async function standing(_t: TestNextly): Promise<unknown> {
  for (let tries = 0; tries < 50; tries++) {
    const row = (await noteRows()).find(
      item => item.value === "listable" || item.value === "guarded"
    );
    if (row !== undefined) return row.value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return undefined;
}

/** The Proxy as an app wires it, on the Nextly the test started. */
function proxy() {
  return createNextlyProxy({} as SanitizedNextlyConfig, {
    start: async () => undefined,
    next: () => () => new Response(null),
  });
}

describe.each(getConfiguredTestDialects())(
  "the SEO plugin keeps copies out of search (%s)",
  dialect => {
    it("a new site with no pages and no address is kept out of search everywhere", async () => {
      const { t } = await boot(dialect);
      expect(await standing(t)).toBe("guarded");

      const answer = await proxy()(new Request("https://acme.example/"));
      expect(answer?.headers.get("x-robots-tag")).toBe("noindex");
    });

    it("from any host but the production address", async () => {
      vi.stubEnv(PRODUCTION_ADDRESSES_ENV, "https://acme.example");
      await boot(dialect);
      const site = proxy();

      const live = await site(new Request("https://acme.example/about"));
      // Nothing to add: the request goes on as it came, with no answer.
      expect(live?.headers.get("x-robots-tag") ?? null).toBeNull();
      const preview = await site(
        new Request("https://acme-git-branch.vercel.app/about")
      );
      expect(preview?.headers.get("x-robots-tag")).toBe("noindex");
    });

    it("a page that lost its address to another page has no canonical", async () => {
      const { t, ctx } = await boot(dialect);
      const page = await publish(t, "pages", "news");
      // As a deploy that moved a post onto /news left it: the post holds it.
      await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            { holder: { collection: "pages", id: page }, holds: [] },
            {
              holder: { collection: "posts", id: "p9" },
              holds: [{ locale: "en", path: "/news" }],
            },
          ],
          tx
        )
      );
      const route = createPublicContentRoute({
        collections: ["pages"],
        nextly: t.nextly,
        render: (entry: ContentEntry) => entry.title,
      });

      const head = await route.generateMetadata({ params: { slug: ["news"] } });

      expect(head.alternates?.canonical).toBeUndefined();
    });
  }
);
