/**
 * Filtering entries by a value inside an embedded field group.
 *
 * The predicate is assembled as raw SQL rather than through the query builder,
 * because the field group's rows live in their own table and are joined back by
 * three plain string columns. That makes it the one filter path where a column
 * name can be emitted as a bind value instead of an identifier — which compiles
 * to `WHERE $1 = <parent id>` and quietly matches nothing rather than failing.
 * These cases exercise the path end to end so that mistake cannot pass.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";

/** The handler surface these cases use, narrowed to the two calls involved. */
interface Handler {
  createEntry: (
    ctx: Record<string, unknown>,
    data: Record<string, unknown>
  ) => Promise<{ data: Record<string, unknown> | null }>;
  listEntries: (
    params: Record<string, unknown>
  ) => Promise<{ data: { docs: Record<string, unknown>[] } | null }>;
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot() {
  return createTestNextly({
    fieldGroups: [
      defineFieldGroup({
        slug: "seo",
        fields: [text({ name: "metaTitle" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: "pages",
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "seo", component: "seo" }),
        ],
      }),
    ],
  });
}

describe("filtering by an embedded field group value (integration)", () => {
  it("returns only the entries whose field group matches", async () => {
    current = await boot();
    const handler = current.getService(
      "collectionsHandler"
    ) as unknown as Handler;

    await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "About", seo: { metaTitle: "About us" } }
    );
    await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Contact", seo: { metaTitle: "Reach us" } }
    );

    const result = await handler.listEntries({
      collectionName: "pages",
      overrideAccess: true,
      where: { "seo.metaTitle": { equals: "About us" } },
    });

    expect((result.data?.docs ?? []).map(e => e.title)).toEqual(["About"]);
  });

  it("returns nothing when no field group value matches", async () => {
    // Distinguishes a working filter from one that matches nothing for the
    // wrong reason: the positive case above must pass alongside this.
    current = await boot();
    const handler = current.getService(
      "collectionsHandler"
    ) as unknown as Handler;

    await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "About", seo: { metaTitle: "About us" } }
    );

    const result = await handler.listEntries({
      collectionName: "pages",
      overrideAccess: true,
      where: { "seo.metaTitle": { equals: "nothing matches this" } },
    });

    expect(result.data?.docs ?? []).toHaveLength(0);
  });
});
