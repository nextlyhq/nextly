/**
 * Redirects end to end on each dialect: a published page's move leaves a
 * permanent redirect from its old address, a chain resolves to one hop, a
 * page taking a redirect's address replaces it, a redirect that cannot be
 * saved keeps the page where it was, and the site's Proxy answers each
 * request from what is saved, the next request after a save included.
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
import { defineCollection, text } from "nextly";
import { createNextlyProxy } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { ADDRESS_RECORD_SLUG } from "../../address-record/collection";
import { keptSeoContext } from "../../not-found/report";
import { seoPlugin } from "../../plugin";
import { REDIRECTS_SLUG } from "../collection";
import { putRedirect, type RedirectInput } from "../store";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** What the helper plugin is told to do to the redirects collection. */
const faults = { failRedirects: false };

/** A plugin that hands its context over, and can make redirect saves fail. */
function helper() {
  const seen: { ctx?: PluginContext } = {};
  const plugin = definePlugin({
    name: "@test/redirect-helper",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      seen.ctx = ctx;
      ctx.hooks.on("beforeCreate", REDIRECTS_SLUG, () => {
        if (faults.failRedirects) throw new Error("the redirect store is down");
      });
    },
  });
  return { plugin, seen };
}

async function boot(dialect: TestDialect) {
  faults.failRedirects = false;
  const { plugin, seen } = helper();
  current = await createTestNextly({
    dialect,
    plugins: [seoPlugin({ collections: ["pages", "posts"] }), plugin],
    collections: [
      defineCollection({
        slug: "pages",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
      defineCollection({
        slug: "posts",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
    ],
  });
  const ctx = seen.ctx;
  const seo = keptSeoContext();
  if (!ctx || !seo) throw new Error("a plugin never started");
  // `ctx` moves addresses as any plugin would; `seo` saves redirects as the
  // SEO plugin's own screens do.
  return { t: current, ctx, seo };
}

async function publish(t: TestNextly, collection: string, slug: string) {
  const created = await t.nextly.create({
    collection,
    data: { title: slug, slug, status: "published" },
  });
  return String(created.item.id);
}

function rename(t: TestNextly, collection: string, id: string, slug: string) {
  return t.nextly.update({
    collection,
    id,
    data: { slug, _overwrite: true },
  });
}

/** Every redirect, as `locale|from` → `to`, with how it was made. */
async function redirects(t: TestNextly) {
  const { items } = await t.nextly.find({
    collection: REDIRECTS_SLUG,
    limit: 500,
  });
  return Object.fromEntries(
    (items as Record<string, unknown>[]).map(row => [
      `${row.locale}|${row.source}`,
      `${row.target} ${row.permanent ? "permanent" : "temporary"} ${row.origin}`,
    ])
  );
}

/** The record's held rows, as `locale|path` → holder collection. */
async function holders(t: TestNextly) {
  const { items } = await t.nextly.find({
    collection: ADDRESS_RECORD_SLUG,
    limit: 500,
  });
  return Object.fromEntries(
    (items as Record<string, unknown>[])
      .filter(row => row.kind === "address" || row.kind === "range")
      .map(row => [
        `${row.locale}|${row.path}${row.kind === "range" ? "/*" : ""}`,
        String(row.holderCollection),
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

/** Save a redirect as a person would, on a transaction of its own. */
function put(
  ctx: PluginContext,
  input: Partial<RedirectInput> & { source: string; target: string }
) {
  return ctx.services.collections.withTransaction(tx =>
    putRedirect(ctx, tx, { locale: "en", origin: "person", ...input })
  );
}

describe.each(getConfiguredTestDialects())("redirects (%s)", dialect => {
  it("a published page's new address leaves a permanent redirect from the old one", async () => {
    const { t, ctx, seo } = await boot(dialect);
    const page = await publish(t, "pages", "a");

    await rename(t, "pages", page, "b");

    expect(await redirects(t)).toEqual({ "en|/a": "/b permanent automatic" });
    expect(await ask("/a")).toBe("301 https://example.com/b");
    expect(await ask("/a?ref=1")).toBe("301 https://example.com/b?ref=1");
    expect(await ask("/b")).toBe("served");
  });

  it("a chain resolves to one hop, and a page moving back takes its address from the redirect", async () => {
    const { t, ctx, seo } = await boot(dialect);
    const page = await publish(t, "pages", "a");
    await rename(t, "pages", page, "b");
    await rename(t, "pages", page, "c");

    expect(await redirects(t)).toEqual({
      "en|/a": "/c permanent automatic",
      "en|/b": "/c permanent automatic",
    });

    await rename(t, "pages", page, "a");

    expect(await redirects(t)).toEqual({
      "en|/b": "/a permanent automatic",
      "en|/c": "/a permanent automatic",
    });
    expect(await holders(t)).toEqual({
      "en|/a": "pages",
      "en|/b": REDIRECTS_SLUG,
      "en|/c": REDIRECTS_SLUG,
    });
    expect(await ask("/a")).toBe("served");
  });

  it("two pages swapping addresses in one move make no redirect", async () => {
    const { t, ctx, seo } = await boot(dialect);
    const one = await publish(t, "pages", "x");
    const two = await publish(t, "posts", "y");

    const { refused } = await ctx.services.collections.withTransaction(tx =>
      ctx.publicAddresses.move(
        [
          {
            holder: { collection: "pages", id: one },
            holds: [{ locale: "en", path: "/y" }],
          },
          {
            holder: { collection: "posts", id: two },
            holds: [{ locale: "en", path: "/x" }],
          },
        ],
        tx
      )
    );

    expect(refused).toEqual([]);
    expect(await redirects(t)).toEqual({});
  });

  it("a page taken off the site leaves no redirect", async () => {
    const { t } = await boot(dialect);
    const page = await publish(t, "pages", "a");
    const other = await publish(t, "pages", "b");

    await t.nextly.update({
      collection: "pages",
      id: page,
      data: { status: "draft", _overwrite: true },
    });
    await t.nextly.delete({ collection: "pages", id: other });

    expect(await redirects(t)).toEqual({});
  });

  it("a redirect that cannot be saved keeps the page at its old address, and says why", async () => {
    const { t, ctx, seo } = await boot(dialect);
    const page = await publish(t, "pages", "a");
    faults.failRedirects = true;

    await expect(rename(t, "pages", page, "b")).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage: expect.stringContaining(
        "The old address /a (en) could not be kept as a redirect, so the address was not changed."
      ),
    });

    const saved = await t.nextly.findByID({ collection: "pages", id: page });
    expect((saved as Record<string, unknown>).slug).toBe("a");
    expect(await holders(t)).toEqual({ "en|/a": "pages" });
    expect(await redirects(t)).toEqual({});
    expect(await ask("/a")).toBe("served");
  });

  it("a saved redirect answers the very next request, exact before pattern, the longest pattern first", async () => {
    const { t, ctx, seo } = await boot(dialect);
    await publish(t, "pages", "old-kept");
    expect(await ask("/old/x")).toBe("served");

    expect(
      await put(seo, { source: "/old/*", target: "/new/*" })
    ).toHaveProperty("saved");
    expect(await ask("/old/x/y")).toBe("301 https://example.com/new/x/y");
    expect(await ask("/old")).toBe("301 https://example.com/new");

    await put(seo, { source: "/old/deep/*", target: "/deeper/*" });
    await put(seo, { source: "/old/special", target: "/special" });
    expect(await ask("/old/deep/z")).toBe("301 https://example.com/deeper/z");
    expect(await ask("/old/special")).toBe("301 https://example.com/special");
    expect(await ask("/older")).toBe("served");
  });

  it("a page at an address inside a pattern is served, and the pattern still redirects the rest", async () => {
    const { t, ctx, seo } = await boot(dialect);
    await put(seo, { source: "/old/*", target: "/new/*" });

    // A page's address inside the pattern, by a direct move as a template's
    // address would be held.
    const page = await publish(t, "posts", "elsewhere");
    await ctx.services.collections.withTransaction(tx =>
      ctx.publicAddresses.move(
        [
          {
            holder: { collection: "posts", id: page },
            holds: [{ locale: "en", path: "/old/kept" }],
          },
        ],
        tx
      )
    );

    expect(await ask("/old/kept")).toBe("served");
    expect(await ask("/old/gone")).toBe("301 https://example.com/new/gone");
    expect(await holders(t)).toMatchObject({ "en|/old/*": REDIRECTS_SLUG });
  });

  it("refuses a redirect from a published page's address, a second one from one address, and a loop", async () => {
    const { t, ctx, seo } = await boot(dialect);
    await publish(t, "pages", "live");

    expect(await put(seo, { source: "/live", target: "/x" })).toEqual({
      refused:
        "/live is the address of a published page, so it can't redirect. Give that page another address first.",
      reason: "held",
    });
    await put(seo, { source: "/a", target: "/b" });
    expect(await put(seo, { source: "/a", target: "/c" })).toMatchObject({
      reason: "duplicate",
      refused:
        "/a already has a redirect. Remove it first, or edit it in the list.",
    });
    await put(seo, { source: "/b", target: "/c" });
    expect(await put(seo, { source: "/c", target: "/a" })).toEqual({
      refused: "That makes a loop: /c → /a → /c.",
      reason: "loop",
    });
    // Nothing a refusal touched was kept.
    expect(await redirects(t)).toEqual({
      "en|/a": "/c permanent person",
      "en|/b": "/c permanent person",
    });
  });

  it("refuses a redirect that patterns would send round in a loop, and allows one a page stops", async () => {
    const { t, seo } = await boot(dialect);
    await put(seo, { source: "/old/*", target: "/new/*" });

    expect(await put(seo, { source: "/new/*", target: "/old/*" })).toEqual({
      refused: "That makes a loop: /new/* → /old/* → /new/*.",
      reason: "loop",
    });
    expect(await put(seo, { source: "/new/x", target: "/old/x" })).toEqual({
      refused: "That makes a loop: /new/x → /old/* → /new/x.",
      reason: "loop",
    });
    // A page at /new/live is served, so nothing comes back round.
    await publish(t, "pages", "live");
    const page = (await t.nextly.find({ collection: "pages", limit: 1 }))
      .items[0] as {
      id: string;
    };
    await seo.services.collections.withTransaction(tx =>
      seo.publicAddresses.move(
        [
          {
            holder: { collection: "pages", id: String(page.id) },
            holds: [{ locale: "en", path: "/new/live" }],
          },
        ],
        tx
      )
    );
    expect(
      await put(seo, { source: "/elsewhere", target: "/old/live" })
    ).toHaveProperty("saved");
  });

  it("makes a person's redirect permanent unless they choose otherwise", async () => {
    const { t, ctx, seo } = await boot(dialect);

    await put(seo, { source: "/kept", target: "/elsewhere" });
    await put(seo, { source: "/soon", target: "/back-soon", permanent: false });

    expect(await redirects(t)).toEqual({
      "en|/kept": "/elsewhere permanent person",
      "en|/soon": "/back-soon temporary person",
    });
    expect(await ask("/soon")).toBe("302 https://example.com/back-soon");
  });
});
