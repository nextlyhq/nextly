import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { resetFilterRegistry } from "../../filters";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetFilterRegistry();
});

const notes = () =>
  defineCollection({
    slug: "notes",
    fields: [text({ name: "title" }), text({ name: "status" })],
  });

describe("collections.listQuery filter seam (D63)", () => {
  it("a registered collections.listQuery filter restricts the result set", async () => {
    // Plugin registers a filter that injects title==="B" constraint so only
    // entry B is returned, making the assertion unambiguous regardless of
    // any status default filtering.
    const filterPlugin = definePlugin({
      name: "@test/list-query-filter",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init(ctx) {
        ctx.filters.add(
          "collections.listQuery",
          (where: Record<string, unknown>) => ({
            ...where,
            title: { equals: "B" },
          })
        );
      },
    });

    current = await createTestNextly({
      collections: [notes()],
      plugins: [filterPlugin],
    });

    // Create two entries — overrideAccess bypasses permission checks in the harness
    await current.nextly.create({
      collection: "notes",
      data: { title: "A", status: "draft" },
    });
    await current.nextly.create({
      collection: "notes",
      data: { title: "B", status: "published" },
    });

    // List with overrideAccess so no access-level filtering interferes
    const result = await current.nextly.find({
      collection: "notes",
      overrideAccess: true,
    });

    expect(result.items).toHaveLength(1);
    expect((result.items[0] as { title: string }).title).toBe("B");
  });

  it("no filter registered → both entries come back", async () => {
    current = await createTestNextly({
      collections: [notes()],
    });

    await current.nextly.create({
      collection: "notes",
      data: { title: "A", status: "draft" },
    });
    await current.nextly.create({
      collection: "notes",
      data: { title: "B", status: "published" },
    });

    const result = await current.nextly.find({
      collection: "notes",
      overrideAccess: true,
    });

    expect(result.items).toHaveLength(2);
  });
});
