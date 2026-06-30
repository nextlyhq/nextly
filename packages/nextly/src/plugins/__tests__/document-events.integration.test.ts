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

/**
 * Build a watcher plugin that captures `document.statusChanged` and
 * `document.published` payloads into the caller-owned arrays. Each test passes
 * its own test-local arrays so assertions can never collide across tests, even
 * though `createTestNextly` teardown already resets the bus per boot.
 */
const watchDocumentEvents = (
  name: string,
  statusChanged: Array<Record<string, unknown>>,
  published: Array<Record<string, unknown>>
) =>
  definePlugin({
    name,
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

describe("document.* post-commit status events", () => {
  it("update draft->published emits BOTH statusChanged AND published", async () => {
    const statusChanged: Array<Record<string, unknown>> = [];
    const published: Array<Record<string, unknown>> = [];

    current = await createTestNextly({
      collections: [articles()],
      plugins: [
        watchDocumentEvents("@test/watch-up", statusChanged, published),
      ],
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

  it("non-status update emits NEITHER document.* event", async () => {
    const statusChanged: Array<Record<string, unknown>> = [];
    const published: Array<Record<string, unknown>> = [];

    current = await createTestNextly({
      collections: [articles()],
      plugins: [
        watchDocumentEvents("@test/watch-noop", statusChanged, published),
      ],
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

  it("update published->draft emits statusChanged only (NOT published)", async () => {
    const statusChanged: Array<Record<string, unknown>> = [];
    const published: Array<Record<string, unknown>> = [];

    current = await createTestNextly({
      collections: [articles()],
      plugins: [
        watchDocumentEvents("@test/watch-down", statusChanged, published),
      ],
    });

    const created = await current.nextly.create({
      collection: "articles",
      data: { title: "T", status: "draft" },
    });
    const id = (created.item as { id: string }).id;

    // Transition IN first (draft->published) so there is a published row to
    // transition out of. Settle, then clear so we only assert on the
    // published->draft transition below.
    await current.nextly.update({
      collection: "articles",
      id,
      data: { status: "published" },
    });
    await current.events.settle();

    statusChanged.length = 0;
    published.length = 0;

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

  it("create directly as published emits document.published (NOT statusChanged)", async () => {
    const statusChanged: Array<Record<string, unknown>> = [];
    const published: Array<Record<string, unknown>> = [];

    current = await createTestNextly({
      collections: [articles()],
      plugins: [
        watchDocumentEvents("@test/watch-create", statusChanged, published),
      ],
    });

    const created = await current.nextly.create({
      collection: "articles",
      data: { title: "T", status: "published" },
    });
    const id = (created.item as { id: string }).id;
    await current.events.settle();

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ collection: "articles", id });
    expect(statusChanged).toHaveLength(0);
  });
});
