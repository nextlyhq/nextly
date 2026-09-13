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

import { defaultSeoFields } from "../fields";
import { seoPlugin } from "../plugin";
import { seoIssuesWidget } from "../widget-card";
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
          handler: async (req, ctx) => {
            const { resolve } = seoIssuesWidgetSource(
              collections,
              defaultSeoFields()
            );
            // 🔴 The CARD's own cell query, taken from the card rather than
            // rebuilt here. Reconstructing the filter would test this file's
            // idea of what the card asks, which is the one thing the seam case
            // exists to avoid assuming.
            const cellKey = new URL(req.url).searchParams.get("cell");
            const cell = seoIssuesWidget(defaultSeoFields())?.cells.find(
              candidate => candidate.key === cellKey
            );
            const result = await resolve(
              cell?.query ?? { source: SEO_ISSUES_SOURCE_ID, op: "count" },
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

async function countedIssues(cellKey?: string): Promise<unknown> {
  const handlers = createDynamicHandlers();
  const query =
    cellKey === undefined ? "" : `?cell=${encodeURIComponent(cellKey)}`;
  const res = await handlers.GET(
    new Request(`http://localhost/api/plugins/${PROBE_NAME}/count${query}`),
    { params: Promise.resolve({ params: PROBE_PARAMS }) }
  );
  return (await res.json()) as unknown;
}

/** One cell's number, from the card's OWN query through the shipped resolver. */
async function cellTotal(cellKey: string): Promise<number> {
  const result = (await countedIssues(cellKey)) as { total: number };
  return result.total;
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

  it("draws a card whose cells the source can actually answer", async () => {
    // 🔴 The SEAM. The card names each issue by LABEL in a `where` filter, and
    // the resolver produces those labels independently. Nothing checks that the
    // two spellings agree -- a renamed label leaves every cell reading zero,
    // which looks exactly like a clean site.
    //
    // Reconciling the parts against the whole is what catches that: a cell whose
    // filter matches nothing contributes nothing, so the sum falls short of the
    // unfiltered total.
    //
    // Booting at all is the other half. A malformed `admin.widgets` entry fails
    // boot, so a card that reached this line is one the host accepted.
    const t = await boot(["pages"]);
    await write(t, "Bare");
    await write(t, "Titled", { metaTitle: "Titled" });
    await write(t, "Hidden", { noindex: true });

    const card = seoIssuesWidget(defaultSeoFields());
    const cells = card?.cells ?? [];
    expect(cells).toHaveLength(5);

    const perCell = await Promise.all(cells.map(cell => cellTotal(cell.key)));
    const whole = (await countedIssues()) as { total: number };

    // Bare 4 + Titled 3 + Hidden 1.
    expect(whole.total).toBe(8);
    expect(perCell.reduce((sum, n) => sum + n, 0)).toBe(whole.total);
    // And the numbers are not all zero, which would satisfy the sum trivially.
    expect(perCell.filter(n => n > 0).length).toBeGreaterThan(1);
  });
});
