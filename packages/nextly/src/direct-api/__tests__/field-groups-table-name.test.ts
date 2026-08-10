import { describe, expect, it, vi } from "vitest";

import { FieldGroupMetadataService } from "../../domains/field-groups/services/field-group-metadata-service";
import type { FieldGroupRegistryService } from "../../services/field-groups/field-group-registry-service";
import type { Logger } from "../../shared/types";
import { createFieldGroupsNamespace } from "../namespaces/field-groups";

// fieldGroups.create() derives the physical table name through the canonical
// resolver: the slug is normalized (dashes and other separators become
// underscores) before the comp_ prefix. An unnormalized name here would
// diverge from the table the schema layer actually creates.
describe("fieldGroups.create derives its table name", () => {
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
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    // Answers "no field group owns any table", which is the state a create starts from. The service
    // refuses a table another field group already holds before it renders any DDL, so a double
    // without this method describes a registry the create can no longer be performed against.
    const registry = {
      registerComponent,
      getAllComponents: vi.fn().mockResolvedValue([]),
    };
    const ctx = {
      fieldGroupRegistryService: registry,
      // The REAL service, with no adapter: the create then generates its statements and runs none,
      // which is the configuration this product supports and the one that keeps this test about
      // table-name derivation rather than about DDL.
      fieldGroupMetadataService: new FieldGroupMetadataService(
        registry as unknown as FieldGroupRegistryService,
        logger
      ),
      logger,
    };
    return { ctx, registerComponent };
  }

  it("normalizes the slug into the derived table name", async () => {
    const { ctx, registerComponent } = createCtx();
    const namespace = createFieldGroupsNamespace(
      ctx as unknown as Parameters<typeof createFieldGroupsNamespace>[0]
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
