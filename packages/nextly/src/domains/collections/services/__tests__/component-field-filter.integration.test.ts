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
  getEntry: (
    params: Record<string, unknown>
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

  it("round-trips the embedded value on read", async () => {
    // The write stores the value in the field group's own table keyed by the
    // three link columns, and the read reassembles it from there. Both sides
    // address those columns by name, so this proves the pair agrees — the
    // filter cases above would still pass if reads dropped the value entirely.
    current = await boot();
    const handler = current.getService(
      "collectionsHandler"
    ) as unknown as Handler;

    const created = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "About", seo: { metaTitle: "About us" } }
    );

    const fetched = await handler.getEntry({
      collectionName: "pages",
      entryId: (created.data as { id: string }).id,
      overrideAccess: true,
    });

    expect((fetched.data?.seo as { metaTitle?: string })?.metaTitle).toBe(
      "About us"
    );
  });

  it("round-trips the dynamic-zone discriminator", async () => {
    // A dynamic zone stores WHICH field group each row is, in a column, and
    // returns it under a JSON key. The two are spelled differently and are
    // migrated separately, so a read that emitted the wrong key would break the
    // write path's ability to round-trip its own output.
    current = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({ slug: "hero", fields: [text({ name: "heading" })] }),
        defineFieldGroup({ slug: "cta", fields: [text({ name: "label" })] }),
      ],
      collections: [
        defineCollection({
          slug: "pages",
          fields: [
            text({ name: "title" }),
            fieldGroup({
              name: "layout",
              components: ["hero", "cta"],
              repeatable: true,
            }),
          ],
        }),
      ],
    });
    const handler = current.getService(
      "collectionsHandler"
    ) as unknown as Handler;

    const created = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      {
        title: "Home",
        layout: [{ _componentType: "hero", heading: "Welcome" }],
      }
    );

    const fetched = await handler.getEntry({
      collectionName: "pages",
      entryId: (created.data as { id: string }).id,
      overrideAccess: true,
    });

    const layout = fetched.data?.layout as Array<Record<string, unknown>>;
    expect(layout?.[0]?._componentType).toBe("hero");
    expect(layout?.[0]?.heading).toBe("Welcome");
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
