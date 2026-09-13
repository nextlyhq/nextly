/**
 * The SEO source against a real instance: boot publishes it, and its resolver
 * counts real rows through the real managed services.
 *
 * 🔴 The resolver is driven through a ROUTE rather than called directly, and
 * that is the point of this file. A route handler receives the `PluginContext`
 * the host built -- the same object the boot binds a contributed resolver to --
 * so the services here are the genuine caller-scoped ones rather than a stub.
 * The unit file covers the counting rules; what only this can show is that the
 * arguments the resolver passes are ones the real service accepts.
 */
import { definePlugin, type ReadCaller } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, listSources, text } from "nextly";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../plugin";
import { SEO_ISSUES_SOURCE_ID, seoIssuesWidgetSource } from "../widget-source";

const PROBE_NAME = "@test/seo-probe";
// Segments after `/api/`, matching how the catch-all splits the path. The
// plugin name is two segments because it contains a slash.
const PROBE_PARAMS = ["plugins", "@test", "seo-probe", "count"];

/** A reader the collection's own `access.read` admits. */
const reader: ReadCaller = { user: { id: "reader-1", roles: ["editor"] } };

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * A test-only plugin that answers the SEO source from its own route.
 *
 * It calls the SAME factory the SEO plugin contributes, so the resolver under
 * test is the shipped one; only the way it is reached differs.
 */
function probePlugin(collections: string[]): unknown {
  return definePlugin({
    name: PROBE_NAME,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      routes: [
        {
          method: "GET",
          path: "/count",
          public: true,
          handler: async (_req, ctx) => {
            const { resolve } = seoIssuesWidgetSource(collections);
            const result = await resolve(
              { source: SEO_ISSUES_SOURCE_ID, op: "count" },
              reader,
              ctx,
              undefined
            );
            return new Response(JSON.stringify(result), {
              headers: { "content-type": "application/json" },
            });
          },
        },
      ],
    },
  });
}

const pages = () =>
  defineCollection({
    slug: "pages",
    access: { read: () => true, create: () => true, update: () => true },
    fields: [text({ name: "title" })],
  });

async function boot(collections: string[]): Promise<TestNextly> {
  const t = await createTestNextly({
    collections: [pages()],
    plugins: [
      seoPlugin({ collections: ["pages"], sitemap: false }),
      probePlugin(collections),
    ] as never,
  });
  current = t;
  return t;
}

async function write(
  t: TestNextly,
  title: string,
  seo?: Record<string, unknown>
): Promise<void> {
  await t.nextly.create({
    collection: "pages",
    data: { title, ...(seo === undefined ? {} : { seo }) },
  });
}

async function countedIssues(): Promise<unknown> {
  const handlers = createDynamicHandlers();
  const res = await handlers.GET(
    new Request(`http://localhost/api/plugins/${PROBE_NAME}/count`),
    { params: Promise.resolve({ params: PROBE_PARAMS }) }
  );
  return (await res.json()) as unknown;
}

describe("the SEO source, booted", () => {
  it("is published by the boot, in the plugin namespace", async () => {
    await boot(["pages"]);

    const published = listSources().find(s => s.id === SEO_ISSUES_SOURCE_ID);
    expect(published).toBeDefined();
    expect(published?.kind).toBe("plugin");
    expect(published?.supports).toEqual(["count"]);
  });

  it("counts the gaps in real rows through the real services", async () => {
    // 🔴 The number is the evidence: it cannot be produced without a context
    // that reaches the collection service, and it cannot be produced by a
    // resolver whose arguments the real service rejects.
    const t = await boot(["pages"]);
    await write(t, "Bare");
    await write(t, "Titled", { metaTitle: "Titled" });

    // Bare: 4 gaps. Titled: canonical, description and image still missing.
    expect(await countedIssues()).toEqual({ op: "count", total: 7 });
  });

  it("finds nothing to report when every field is filled in", async () => {
    // The must-differ half. Without it a resolver that returned a constant, or
    // one that counted every row regardless of its data, satisfies the case
    // above.
    const t = await boot(["pages"]);
    await write(t, "Complete", {
      metaTitle: "Complete",
      metaDescription: "A complete page.",
      canonical: "https://example.com/complete",
      ogImage: "media-1",
    });

    expect(await countedIssues()).toEqual({ op: "count", total: 0 });
  });

  it("reports nothing for a collection it was not configured with", async () => {
    // The source is bound to the collections the plugin extended. A collection
    // with no `seo` group would otherwise report the full set of missing fields
    // for every row it holds and drown the real answer.
    const t = await boot([]);
    await write(t, "Bare");

    expect(await countedIssues()).toEqual({ op: "count", total: 0 });
  });
});
