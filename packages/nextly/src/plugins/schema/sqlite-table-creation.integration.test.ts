import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("non-interactive SQLite table creation for plugin collections (D3, P1 SQLite gap)", () => {
  it("creates a plugin contributes.collection's physical table on in-memory SQLite (CRUD round-trips, no harness workaround)", async () => {
    // Contributed via `plugins:` (NOT `collections:`), so the harness's
    // ensureCollectionTables workaround does NOT create this table — only the
    // runtime auto-sync can. If the physical table is missing, `create` throws.
    const widgetsPlugin = definePlugin({
      name: "@test/p2-widgets",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        collections: [
          defineCollection({
            slug: "p2_widgets",
            fields: [text({ name: "title" })],
          }),
        ],
      },
    });

    current = await createTestNextly({ plugins: [widgetsPlugin] });

    const created = await current.nextly.create({
      collection: "p2_widgets",
      data: { title: "hello" },
    });
    expect((created.item as { id: string }).id).toBeTruthy();

    const list = await current.nextly.find({ collection: "p2_widgets" });
    expect(list.items.map((r: { title?: string }) => r.title)).toContain(
      "hello"
    );
  });
});
