/**
 * End-to-end behaviour of a component whose `dbName` is honored verbatim.
 *
 * A custom name carries no `comp_` prefix, so every consumer that addresses the
 * component's storage has to read the physical name from the registry instead
 * of deriving it from the slug. This proves the whole round trip against a real
 * database: the table is created under the custom name, the registry row points
 * at it, values write and read back, and a filter on a component field finds
 * the entry.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  component,
  defineCollection,
  defineComponent,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const Seo = defineComponent({
  slug: "seo",
  label: { singular: "SEO" },
  // No comp_ prefix: the resolver honors this verbatim, which is exactly the
  // shape that a slug-derived name would fail to address.
  dbName: "seo_meta",
  fields: [text({ name: "metaTitle" })],
});

const Posts = defineCollection({
  slug: "posts",
  fields: [
    text({ name: "title" }),
    component({ name: "seo", component: "seo" }),
  ],
});

describe("component with a custom dbName", () => {
  it("creates the table under the custom name and registers it", async () => {
    const nextly = await createTestNextly({
      collections: [Posts],
      components: [Seo],
    });
    current = nextly;

    const tables = await nextly.adapter.listTables();
    expect(tables).toContain("seo_meta");
    expect(tables).not.toContain("comp_seo");

    const rows = await nextly.adapter.select<Record<string, unknown>>(
      "dynamic_components",
      {}
    );
    const seoRow = rows.find(r => r.slug === "seo");
    expect(seoRow?.table_name ?? seoRow?.tableName).toBe("seo_meta");
  });

  it("round-trips component values through the custom table", async () => {
    const nextly = await createTestNextly({
      collections: [Posts],
      components: [Seo],
    });
    current = nextly;

    await nextly.nextly.create({
      collection: "posts",
      data: { title: "Hello", seo: { metaTitle: "Hello | Site" } },
    });

    const found = await nextly.nextly.find({
      collection: "posts",
      where: { title: { equals: "Hello" } },
    });
    const seo = found.items[0]?.seo as { metaTitle?: string } | undefined;
    expect(seo?.metaTitle).toBe("Hello | Site");
  });

  it("filters on a component field stored in the custom table", async () => {
    const nextly = await createTestNextly({
      collections: [Posts],
      components: [Seo],
    });
    current = nextly;

    await nextly.nextly.create({
      collection: "posts",
      data: { title: "Match", seo: { metaTitle: "findme" } },
    });
    await nextly.nextly.create({
      collection: "posts",
      data: { title: "Other", seo: { metaTitle: "different" } },
    });

    // The EXISTS subquery has to target `seo_meta`; a slug-derived `comp_seo`
    // does not exist, so the query would fail or match nothing.
    const result = await nextly.nextly.find({
      collection: "posts",
      where: { "seo.metaTitle": { equals: "findme" } },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("Match");
  });
});
