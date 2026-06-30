import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { EventBus } from "../../events/event-bus";
import { HookRegistry } from "../../hooks/hook-registry";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("createTestNextly (D46 — real in-memory SQLite boot)", () => {
  it("boots, runs plugin init, and exposes the hook registry and event bus", async () => {
    let initRan = false;
    const probe = definePlugin({
      name: "@test/probe",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init() {
        initRan = true;
      },
    });

    current = await createTestNextly({ plugins: [probe] });

    expect(initRan).toBe(true);
    expect(current.hooks).toBeInstanceOf(HookRegistry);
    expect(current.events).toBeInstanceOf(EventBus);
  });

  it("creates and reads a code-first collection against the real DB", async () => {
    const widgets = defineCollection({
      slug: "widgets",
      fields: [text({ name: "title" })],
    });

    current = await createTestNextly({ collections: [widgets] });

    const created = await current.nextly.create({
      collection: "widgets",
      data: { title: "hello" },
    });
    expect((created.item as { title?: string }).title).toBe("hello");

    const list = await current.nextly.find({ collection: "widgets" });
    const titles = list.items.map(i => (i as { title?: string }).title);
    expect(titles).toContain("hello");
  });

  it("tears down cleanly so a second boot succeeds (no re-registration error)", async () => {
    const first = await createTestNextly();
    await first.destroy();

    // Should not throw "Services are already registered".
    current = await createTestNextly();
    expect(current.nextly).toBeDefined();
  });
});
