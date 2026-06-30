import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const widgets = () =>
  defineCollection({ slug: "widgets", fields: [text({ name: "title" })] });

describe("collection.<slug>.* post-commit events", () => {
  it("emits collection.<slug>.created with the row id after commit", async () => {
    const seen: Array<{ name: string; id: unknown }> = [];
    const watcher = definePlugin({
      name: "@test/watch-created",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init(ctx) {
        ctx.events.on<{ id: string }>("collection.widgets.created", e => {
          seen.push({ name: e.name, id: e.payload.id });
        });
      },
    });

    current = await createTestNextly({
      collections: [widgets()],
      plugins: [watcher],
    });

    const created = await current.nextly.create({
      collection: "widgets",
      data: { title: "x" },
    });
    await current.events.settle();

    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe("collection.widgets.created");
    expect(seen[0].id).toBe((created.item as { id: string }).id);
  });

  it("a throwing subscriber does not fail the create (best-effort)", async () => {
    const watcher = definePlugin({
      name: "@test/watch-throw",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init(ctx) {
        ctx.events.on("collection.widgets.created", () => {
          throw new Error("subscriber boom");
        });
      },
    });

    current = await createTestNextly({
      collections: [widgets()],
      plugins: [watcher],
    });

    await expect(
      current.nextly.create({ collection: "widgets", data: { title: "y" } })
    ).resolves.toBeDefined();
  });

  it("emits created, updated, and deleted across the CRUD lifecycle", async () => {
    const seen: string[] = [];
    const watcher = definePlugin({
      name: "@test/watch-all",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init(ctx) {
        for (const action of ["created", "updated", "deleted"]) {
          ctx.events.on(`collection.widgets.${action}`, () =>
            seen.push(action)
          );
        }
      },
    });

    current = await createTestNextly({
      collections: [widgets()],
      plugins: [watcher],
    });

    const created = await current.nextly.create({
      collection: "widgets",
      data: { title: "a" },
    });
    const id = (created.item as { id: string }).id;
    await current.nextly.update({
      collection: "widgets",
      id,
      data: { title: "b" },
    });
    await current.nextly.delete({ collection: "widgets", id });
    await current.events.settle();

    expect(seen).toEqual(
      expect.arrayContaining(["created", "updated", "deleted"])
    );
  });
});
