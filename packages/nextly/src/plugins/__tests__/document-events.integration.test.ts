import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const articles = () =>
  defineCollection({
    slug: "articles",
    fields: [text({ name: "title" }), text({ name: "status" })],
  });

describe("document.* post-commit status events (D69)", () => {
  it("emits document.statusChanged AND document.published on draft->published", async () => {
    const statusChanged: Array<Record<string, unknown>> = [];
    const published: Array<Record<string, unknown>> = [];
    const watcher = definePlugin({
      name: "@test/watch-status",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init(ctx) {
        ctx.events.on<Record<string, unknown>>("document.statusChanged", e => {
          statusChanged.push(e.payload);
        });
        ctx.events.on<Record<string, unknown>>("document.published", e => {
          published.push(e.payload);
        });
      },
    });

    current = await createTestNextly({
      collections: [articles()],
      plugins: [watcher],
    });

    const created = await current.nextly.create({
      collection: "articles",
      data: { title: "T", status: "draft" },
    });
    const id = (created.item as { id: string }).id;

    await current.nextly.update({
      collection: "articles",
      id,
      data: { status: "published" },
    });
    await current.events.settle();

    expect(statusChanged).toHaveLength(1);
    expect(statusChanged[0]).toMatchObject({
      collection: "articles",
      id,
      previousStatus: "draft",
      status: "published",
    });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ collection: "articles", id });
  });

  it("emits NEITHER document.* event when status does not change", async () => {
    const statusChanged: Array<Record<string, unknown>> = [];
    const published: Array<Record<string, unknown>> = [];
    const watcher = definePlugin({
      name: "@test/watch-status-noop",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init(ctx) {
        ctx.events.on("document.statusChanged", e => {
          statusChanged.push(e.payload as Record<string, unknown>);
        });
        ctx.events.on("document.published", e => {
          published.push(e.payload as Record<string, unknown>);
        });
      },
    });

    current = await createTestNextly({
      collections: [articles()],
      plugins: [watcher],
    });

    const created = await current.nextly.create({
      collection: "articles",
      data: { title: "T", status: "draft" },
    });
    const id = (created.item as { id: string }).id;

    await current.nextly.update({
      collection: "articles",
      id,
      data: { title: "T2" },
    });
    await current.events.settle();

    expect(statusChanged).toHaveLength(0);
    expect(published).toHaveLength(0);
  });

  it("emits document.statusChanged only (NOT published) on published->draft", async () => {
    const statusChanged: Array<Record<string, unknown>> = [];
    const published: Array<Record<string, unknown>> = [];
    const watcher = definePlugin({
      name: "@test/watch-status-down",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init(ctx) {
        ctx.events.on<Record<string, unknown>>("document.statusChanged", e => {
          statusChanged.push(e.payload);
        });
        ctx.events.on("document.published", e => {
          published.push(e.payload as Record<string, unknown>);
        });
      },
    });

    current = await createTestNextly({
      collections: [articles()],
      plugins: [watcher],
    });

    const created = await current.nextly.create({
      collection: "articles",
      data: { title: "T", status: "published" },
    });
    const id = (created.item as { id: string }).id;

    await current.nextly.update({
      collection: "articles",
      id,
      data: { status: "draft" },
    });
    await current.events.settle();

    expect(statusChanged).toHaveLength(1);
    expect(statusChanged[0]).toMatchObject({
      collection: "articles",
      id,
      previousStatus: "published",
      status: "draft",
    });
    expect(published).toHaveLength(0);
  });
});
