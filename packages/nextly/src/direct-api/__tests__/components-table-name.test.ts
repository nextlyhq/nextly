import { describe, expect, it, vi } from "vitest";

import { createComponentsNamespace } from "../namespaces/components";

// components.create() derives the physical table name through the canonical
// resolver: the slug is normalized (dashes and other separators become
// underscores) before the comp_ prefix. An unnormalized name here would
// diverge from the table the schema layer actually creates.
describe("components.create derives its table name", () => {
  function createCtx() {
    const registerComponent = vi.fn().mockResolvedValue({
      id: "comp-1",
      slug: "hero-section",
      label: "Hero Section",
      tableName: "comp_hero_section",
      fields: [],
      source: "code",
      migrationStatus: "pending",
    });
    const ctx = {
      componentRegistryService: { registerComponent },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    return { ctx, registerComponent };
  }

  it("normalizes the slug into the derived table name", async () => {
    const { ctx, registerComponent } = createCtx();
    const namespace = createComponentsNamespace(
      ctx as unknown as Parameters<typeof createComponentsNamespace>[0]
    );

    await namespace.create({
      slug: "hero-section",
      label: "Hero Section",
      fields: [{ type: "text", name: "title" }],
    });

    expect(registerComponent).toHaveBeenCalledTimes(1);
    expect(registerComponent.mock.calls[0][0].tableName).toBe(
      "comp_hero_section"
    );
  });
});
