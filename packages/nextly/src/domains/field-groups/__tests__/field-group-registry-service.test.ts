import { describe, it, expect, beforeEach, vi } from "vitest";

// The sync asks the reconcile service to clear a diverged mark on a code-managed group. Mocked so
// the ASK is observable: the repair itself is proved in its own suite, and running it here would
// make these tests depend on introspection they do not model.
vi.mock("../services/field-group-reconcile-service", () => ({
  reconcileFieldGroup: vi.fn(async () => ({
    slug: "seo",
    localized: false,
    removed: [],
    repaired: [],
    adopted: [],
    unchanged: true,
    schemaVersion: 1,
  })),
}));

// The service throws NextlyError, so `rejects.toThrow(...)` asserts against
// that class for the instanceof check to line up with the thrown type.
import { NextlyError } from "../../../errors";
import { FieldGroupRegistryService } from "../../../services/field-groups/field-group-registry-service";

import {
  createSilentLogger,
  createMockAdapter,
} from "./field-group-test-helpers";

type RegistryTestCtx = {
  service: FieldGroupRegistryService;
  adapter: ReturnType<typeof createMockAdapter>;
};

function createCtx(
  adapterOverrides: Record<string, unknown> = {}
): RegistryTestCtx {
  const adapter = createMockAdapter(adapterOverrides);
  const logger = createSilentLogger();

  const service = new FieldGroupRegistryService(
    adapter as unknown as ConstructorParameters<
      typeof FieldGroupRegistryService
    >[0],
    logger
  );

  return { service, adapter };
}

function dbRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "comp-1",
    slug: "seo",
    label: "SEO",
    table_name: "comp_seo",
    description: null,
    fields: JSON.stringify([{ name: "metaTitle", type: "text" }]),
    admin: null,
    source: "code",
    locked: 1,
    config_path: null,
    schema_hash: "hash-1",
    schema_version: 1,
    migration_status: "applied",
    last_migration_id: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("FieldGroupRegistryService", () => {
  let ctx: RegistryTestCtx;

  beforeEach(() => {
    ctx = createCtx();
  });

  describe("registerComponent", () => {
    it("inserts a new component with correct snake_case columns", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null); // no existing
      ctx.adapter.insert.mockResolvedValue(dbRow());

      const result = await ctx.service.registerComponent({
        slug: "seo",
        label: "SEO",
        tableName: "comp_seo",
        fields: [{ name: "metaTitle", type: "text" }],
        source: "code",
        schemaHash: "hash-1",
      });

      expect(ctx.adapter.insert).toHaveBeenCalledTimes(1);
      const [tableName, row] = ctx.adapter.insert.mock.calls[0];
      expect(tableName).toBe("dynamic_components");
      expect(row).toMatchObject({
        slug: "seo",
        label: "SEO",
        table_name: "comp_seo",
        source: "code",
        locked: 1, // code-first → locked
        schema_hash: "hash-1",
        schema_version: 1,
        migration_status: "pending",
      });
      expect(row.id).toBeDefined();
      expect(row.fields).toBe(
        JSON.stringify([{ name: "metaTitle", type: "text" }])
      );
      expect(result.slug).toBe("seo");
    });

    it("throws DUPLICATE_KEY when component with same slug already exists", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow());

      await expect(
        ctx.service.registerComponent({
          slug: "seo",
          label: "SEO",
          tableName: "comp_seo",
          fields: [],
          source: "code",
          schemaHash: "hash-1",
        })
      ).rejects.toThrow(NextlyError);
    });

    it("auto-locks code-first components", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue(dbRow());

      await ctx.service.registerComponent({
        slug: "seo",
        label: "SEO",
        tableName: "comp_seo",
        fields: [],
        source: "code",
        schemaHash: "hash-1",
      });

      const row = ctx.adapter.insert.mock.calls[0][1];
      expect(row.locked).toBe(1);
    });

    it("does not auto-lock UI components by default", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue(dbRow({ source: "ui", locked: 0 }));

      await ctx.service.registerComponent({
        slug: "custom",
        label: "Custom",
        tableName: "comp_custom",
        fields: [],
        source: "ui",
        schemaHash: "hash-ui",
      });

      const row = ctx.adapter.insert.mock.calls[0][1];
      expect(row.locked).toBe(0);
    });
  });

  describe("getComponentBySlug", () => {
    it("returns deserialized component when found", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow());

      const result = await ctx.service.getComponentBySlug("seo");

      expect(result).not.toBeNull();
      expect(result?.slug).toBe("seo");
      expect(result?.label).toBe("SEO");
      expect(result?.tableName).toBe("comp_seo");
      expect(result?.fields).toEqual([{ name: "metaTitle", type: "text" }]);
      expect(result?.locked).toBe(true); // 1 → boolean
    });

    it("returns null when component does not exist", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);

      const result = await ctx.service.getComponentBySlug("missing");

      expect(result).toBeNull();
    });
  });

  describe("getComponent", () => {
    it("returns the component when found", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow());

      const result = await ctx.service.getComponent("seo");

      expect(result.slug).toBe("seo");
    });

    it("throws NOT_FOUND when component does not exist", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);

      await expect(ctx.service.getComponent("missing")).rejects.toThrow(
        NextlyError
      );
    });
  });

  describe("getAllComponents", () => {
    it("returns all components", async () => {
      ctx.adapter.select.mockResolvedValue([
        dbRow(),
        dbRow({ id: "comp-2", slug: "hero" }),
      ]);

      const result = await ctx.service.getAllComponents();

      expect(result).toHaveLength(2);
      expect(result[0].slug).toBe("seo");
      expect(result[1].slug).toBe("hero");
    });

    it("filters by source", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.getAllComponents({ source: "code" });

      const opts = ctx.adapter.select.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const where = opts.where as Record<string, unknown>;
      expect((where.and as Array<Record<string, unknown>>)[0]).toMatchObject({
        column: "source",
        value: "code",
      });
    });

    it("filters by migrationStatus", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.getAllComponents({ migrationStatus: "pending" });

      const opts = ctx.adapter.select.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const where = opts.where as Record<string, unknown>;
      expect((where.and as Array<Record<string, unknown>>)[0]).toMatchObject({
        // The SCHEMA PROPERTY, not the physical column. The adapter here is a
        // mock that accepts any name, which is exactly why the physical
        // spelling survived in the query for so long: only a real database
        // refuses it.
        column: "migrationStatus",
        value: "pending",
      });
    });

    it("filters by locked flag", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.getAllComponents({ locked: true });

      const opts = ctx.adapter.select.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const where = opts.where as Record<string, unknown>;
      expect((where.and as Array<Record<string, unknown>>)[0]).toMatchObject({
        column: "locked",
        value: true,
      });
    });
  });

  describe("listComponents", () => {
    it("returns paginated data with total count", async () => {
      // First call: count query (columns: ["id"])
      // Second call: actual data query
      ctx.adapter.select
        .mockResolvedValueOnce([{ id: "1" }, { id: "2" }, { id: "3" }])
        .mockResolvedValueOnce([
          dbRow(),
          dbRow({ id: "comp-2", slug: "hero" }),
        ]);

      const result = await ctx.service.listComponents({ limit: 2, offset: 0 });

      expect(result.total).toBe(3);
      expect(result.data).toHaveLength(2);
    });

    it("applies search filter across slug and label", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.listComponents({ search: "seo" });

      const opts = ctx.adapter.select.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const where = opts.where as Record<string, unknown>;
      const andArr = where.and as Array<Record<string, unknown>>;
      const orCond = andArr.find(c => "or" in c);
      expect(orCond).toBeDefined();
      const ors = orCond!.or as Array<Record<string, unknown>>;
      const columns = ors.map(c => c.column);
      expect(columns).toContain("slug");
      expect(columns).toContain("label");
    });
  });

  describe("updateComponent", () => {
    it("updates component and increments schema_version on fields change", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 0 })); // for getComponent
      ctx.adapter.update.mockResolvedValue([dbRow({ schema_version: 2 })]);

      await ctx.service.updateComponent("seo", {
        fields: [
          { name: "metaTitle", type: "text" },
          { name: "keywords", type: "json" },
        ],
        schemaHash: "new-hash",
      });

      const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(updateData.schema_version).toBe(2);
      expect(updateData.fields).toBeDefined();
      expect(updateData.migration_status).toBe("pending");
      expect(updateData.schema_hash).toBe("new-hash");
    });

    // 🔴 `schema_version` is an optimistic lock, and toggling localization MOVES every translatable
    // column between the main table and `comp_<slug>_locales`. Tying the bump to `fields` alone left
    // that transition invisible to `assertSchemaVersionMatch`: a preview taken beforehand still
    // matched, and applying it wrote a stale field set over a shape that had already moved.
    it("increments schema_version when localization is toggled with no field change", async () => {
      ctx.adapter.selectOne.mockResolvedValue(
        dbRow({ locked: 0, localized: 0 })
      );
      ctx.adapter.update.mockResolvedValue([dbRow({ schema_version: 2 })]);

      await ctx.service.updateComponent("seo", { localized: true });

      const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(updateData.schema_version).toBe(2);
      // Nothing about the field set changed, so the migration status must not be disturbed.
      expect(updateData.fields).toBeUndefined();
      expect(updateData.migration_status).toBeUndefined();
    });

    // 🔴 The control that keeps the bump from becoming noise. Compared against the STORED value
    // rather than merely being present: a request resending the current setting changes no storage,
    // so invalidating every open editor for it would make the lock fire on saves that conflict with
    // nothing.
    it("leaves schema_version alone when localized is resent unchanged", async () => {
      ctx.adapter.selectOne.mockResolvedValue(
        dbRow({ locked: 0, localized: 1 })
      );
      ctx.adapter.update.mockResolvedValue([dbRow()]);

      await ctx.service.updateComponent("seo", {
        localized: true,
        label: "Renamed",
      });

      const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(updateData.schema_version).toBeUndefined();
      expect(updateData.label).toBe("Renamed");
    });

    // 🔴 How far a schema change GOT is not a property of the field list. Writing the status only
    // alongside `fields` left it unwritable on its own — and the one caller who has an outcome and
    // nothing else to say is a write that failed AFTER its DDL committed, which is exactly when the
    // divergence needs recording.
    it("writes migration_status on its own, with no field change", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 0 }));
      ctx.adapter.update.mockResolvedValue([dbRow()]);

      await ctx.service.updateComponent(
        "seo",
        { migrationStatus: "failed" },
        { source: "code" }
      );

      const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(updateData.migration_status).toBe("failed");
      // The status says nothing about the shape, so neither the stored fields nor the optimistic
      // lock may move with it. A bump here would invalidate every open editor for a row whose
      // schema did not change.
      expect(updateData.fields).toBeUndefined();
      expect(updateData.schema_version).toBeUndefined();
    });

    // The control against the status becoming sticky: a later edit that says nothing about it must
    // leave the column alone rather than resetting it.
    it("leaves migration_status alone when the request does not carry one", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 0 }));
      ctx.adapter.update.mockResolvedValue([dbRow()]);

      await ctx.service.updateComponent("seo", { label: "Renamed" });

      const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(updateData.migration_status).toBeUndefined();
    });

    // 🔴 The optimistic lock has to move when the TABLES did, even though this write carries no new
    // field set. `assertSchemaVersionMatch` is all that stands between an editor loaded before a
    // partial transition and an apply against the tables that transition already moved.
    it("advances schema_version when the caller says the shape diverged", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 0 }));
      ctx.adapter.update.mockResolvedValue([dbRow({ schema_version: 2 })]);

      await ctx.service.updateComponent(
        "seo",
        { migrationStatus: "failed" },
        { source: "code", invalidateSchemaVersion: true }
      );

      const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(updateData.schema_version).toBe(2);
      expect(updateData.migration_status).toBe("failed");
    });

    it("throws FORBIDDEN when locked and source is not 'code'", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 1 }));

      await expect(
        ctx.service.updateComponent("seo", { label: "New" }, { source: "ui" })
      ).rejects.toThrow(NextlyError);
    });

    it("allows update when locked and source is 'code'", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 1 }));
      ctx.adapter.update.mockResolvedValue([dbRow()]);

      await expect(
        ctx.service.updateComponent(
          "seo",
          { label: "Updated" },
          { source: "code" }
        )
      ).resolves.toBeDefined();
    });

    it("throws NOT_FOUND when the component does not exist", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);

      await expect(
        ctx.service.updateComponent("missing", { label: "X" })
      ).rejects.toThrow(NextlyError);
    });
  });

  describe("deleteComponent", () => {
    it("throws FORBIDDEN when component is locked", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 1 }));

      await expect(ctx.service.deleteComponent("seo")).rejects.toThrow(
        NextlyError
      );
    });

    it("deletes unlocked component and drops its data table", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 0 }));
      // select calls for findComponentReferences return empty
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.deleteComponent("seo");

      expect(ctx.adapter.executeQuery).toHaveBeenCalled();
      const sql = ctx.adapter.executeQuery.mock.calls[0][0];
      expect(sql).toMatch(/DROP TABLE/i);
      expect(sql).toMatch(/comp_seo/);
      expect(ctx.adapter.delete).toHaveBeenCalledWith(
        "dynamic_components",
        expect.anything()
      );
    });

    it("throws CONFLICT when component is referenced by other entities", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 0 }));
      // First select: dynamic_collections with referencing field
      ctx.adapter.select.mockImplementation(async (table: string) => {
        if (table === "dynamic_collections") {
          return [
            {
              slug: "pages",
              fields: JSON.stringify([
                { name: "meta", type: "component", component: "seo" },
              ]),
            },
          ];
        }
        return [];
      });

      await expect(ctx.service.deleteComponent("seo")).rejects.toThrow(
        NextlyError
      );
    });
  });

  describe("isLocked", () => {
    it("returns true for locked component", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 1 }));
      expect(await ctx.service.isLocked("seo")).toBe(true);
    });

    it("returns false for unlocked component", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 0 }));
      expect(await ctx.service.isLocked("seo")).toBe(false);
    });

    it("returns false when component does not exist", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);
      expect(await ctx.service.isLocked("missing")).toBe(false);
    });
  });

  describe("updateMigrationStatus", () => {
    it("updates migration_status with snake_case column", async () => {
      ctx.adapter.update.mockResolvedValue([{ slug: "seo" }]);

      await ctx.service.updateMigrationStatus("seo", "applied", "mig-1");

      const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(updateData.migration_status).toBe("applied");
      expect(updateData.last_migration_id).toBe("mig-1");
    });

    it("throws NOT_FOUND when no rows updated", async () => {
      ctx.adapter.update.mockResolvedValue([]);

      await expect(
        ctx.service.updateMigrationStatus("missing", "applied")
      ).rejects.toThrow(NextlyError);
    });
  });

  describe("updateMigrationStatusWithVerification", () => {
    it("sets status to applied when table exists", async () => {
      ctx.adapter.tableExists.mockResolvedValue(true);
      ctx.adapter.update.mockResolvedValue([{ slug: "seo" }]);

      const result = await ctx.service.updateMigrationStatusWithVerification(
        "seo",
        "comp_seo"
      );

      expect(result.verified).toBe(true);
      expect(result.status).toBe("applied");
    });

    it("sets status to failed when table does not exist", async () => {
      ctx.adapter.tableExists.mockResolvedValue(false);
      ctx.adapter.update.mockResolvedValue([{ slug: "seo" }]);

      const result = await ctx.service.updateMigrationStatusWithVerification(
        "seo",
        "comp_seo"
      );

      expect(result.verified).toBe(false);
      expect(result.status).toBe("failed");
    });
  });

  describe("getPendingMigrations", () => {
    it("returns only components with pending/generated status", async () => {
      ctx.adapter.select.mockResolvedValue([
        dbRow({ migration_status: "pending" }),
      ]);

      const result = await ctx.service.getPendingMigrations();

      expect(result).toHaveLength(1);
      const opts = ctx.adapter.select.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const where = opts.where as Record<string, unknown>;
      const andArr = where.and as Array<Record<string, unknown>>;
      expect(andArr[0]).toMatchObject({
        // The SCHEMA PROPERTY, not the physical column. The adapter here is a
        // mock that accepts any name, which is exactly why the physical
        // spelling survived in the query for so long: only a real database
        // refuses it.
        column: "migrationStatus",
        value: ["pending", "generated"],
      });
    });
  });

  describe("syncCodeFirstComponents", () => {
    it("creates new components that do not exist", async () => {
      // getComponentBySlug returns null (doesn't exist)
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue(dbRow());

      const result = await ctx.service.syncCodeFirstComponents([
        {
          slug: "hero",
          label: "Hero",
          fields: [{ name: "heading", type: "text" }],
        },
      ]);

      expect(result.created).toEqual(["hero"]);
      expect(result.updated).toEqual([]);
      expect(result.unchanged).toEqual([]);
    });

    // 🔴 A code-managed group marked `diverged` is otherwise a DEAD END: the admin refuses it for
    // being locked and this sync refuses it for being diverged, so neither direction reaches it.
    // The sync holds the config file — which IS the definition for a locked group — so it is the
    // caller that may repair, and it must do so BEFORE deciding what to write.
    it("clears a diverged mark on a code-managed component before writing it", async () => {
      const fields = [{ name: "metaTitle", type: "text" }];
      ctx.adapter.selectOne.mockResolvedValue(
        dbRow({ migration_status: "diverged", locked: 1 })
      );
      ctx.adapter.update.mockResolvedValue([dbRow()]);
      // The repair itself is proved where it lives; here the question is only whether the sync
      // ASKS for it, so the introspection the reconcile service performs is answered minimally.
      ctx.adapter.tableExists.mockResolvedValue(true);

      await ctx.service.syncCodeFirstComponents([
        { slug: "seo", label: "SEO", fields },
      ]);

      // 🔴 Asserted on the CALL, not on the result lists. The component ends up in `updated` or
      // `unchanged` whether or not the repair was requested, so a result-shaped assertion would
      // pass with and without the wiring — coverage in appearance only. `fromCode: true` is the
      // part that matters: without it the repair is refused by the lock check it exists to pass.
      const { reconcileFieldGroup } = await import(
        "../services/field-group-reconcile-service"
      );
      expect(reconcileFieldGroup).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "seo", fromCode: true })
      );
    });

    it("does not ask for a repair when the component is not diverged", async () => {
      // The control that keeps the branch above from becoming unconditional: a healthy row must
      // not be run through a repair on every boot.
      const fields = [{ name: "metaTitle", type: "text" }];
      ctx.adapter.selectOne.mockResolvedValue(
        dbRow({ migration_status: "applied", locked: 1 })
      );
      ctx.adapter.update.mockResolvedValue([dbRow()]);

      // The mock is module-level and this suite's `beforeEach` only rebuilds the adapter, so a
      // call recorded by the test above would satisfy this assertion's opposite. Cleared here
      // rather than globally: 53 other tests in this file pass under the current lifecycle and
      // widening it would be a change to their experiment, not to mine.
      const { reconcileFieldGroup } = await import(
        "../services/field-group-reconcile-service"
      );
      vi.mocked(reconcileFieldGroup).mockClear();

      await ctx.service.syncCodeFirstComponents([
        { slug: "seo", label: "SEO", fields },
      ]);

      expect(reconcileFieldGroup).not.toHaveBeenCalled();
    });

    it("updates components with changed schema hash", async () => {
      // First call (getComponentBySlug during sync): returns existing with old hash
      // Second call (inside updateComponent → getComponent): same
      ctx.adapter.selectOne.mockResolvedValue(
        dbRow({ schema_hash: "old-hash" })
      );
      ctx.adapter.update.mockResolvedValue([dbRow()]);

      const result = await ctx.service.syncCodeFirstComponents([
        {
          slug: "seo",
          label: "SEO",
          fields: [{ name: "metaTitle", type: "text" }],
        },
      ]);

      expect(result.updated).toEqual(["seo"]);
      expect(result.created).toEqual([]);
    });

    it("leaves an already-canonical table name unchanged", async () => {
      const fields = [{ name: "metaTitle", type: "text" }];
      ctx.adapter.selectOne.mockImplementation(async () => {
        const { calculateSchemaHash } = await import(
          "../../schema/services/schema-hash"
        );
        return dbRow({
          schema_hash: calculateSchemaHash(fields),
          table_name: "comp_seo",
        });
      });

      const result = await ctx.service.syncCodeFirstComponents([
        { slug: "seo", label: "SEO", fields },
      ]);

      expect(result.unchanged).toEqual(["seo"]);
      expect(ctx.adapter.update).not.toHaveBeenCalled();
    });

    it("marks components as unchanged when schema hash matches", async () => {
      // Use calculateSchemaHash to get the actual hash for empty fields array
      // Easier: mock selectOne to return whatever hash the service computes
      const fields = [{ name: "metaTitle", type: "text" }];
      // We need to know what hash the service will compute; mock to match
      ctx.adapter.selectOne.mockImplementation(async () => {
        // Late import so we can call the same hash function the service uses
        const { calculateSchemaHash } = await import(
          "../../schema/services/schema-hash"
        );
        return dbRow({
          schema_hash: calculateSchemaHash(fields),
        });
      });

      const result = await ctx.service.syncCodeFirstComponents([
        { slug: "seo", label: "SEO", fields },
      ]);

      expect(result.unchanged).toEqual(["seo"]);
      expect(result.created).toEqual([]);
      expect(result.updated).toEqual([]);
    });

    it("collects errors per component", async () => {
      ctx.adapter.selectOne.mockRejectedValue(new Error("db explode"));

      const result = await ctx.service.syncCodeFirstComponents([
        { slug: "seo", label: "SEO", fields: [] },
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].slug).toBe("seo");
    });
  });

  describe("findComponentReferences", () => {
    it("finds single-component references in collection fields", async () => {
      ctx.adapter.select.mockImplementation(async (table: string) => {
        if (table === "dynamic_collections") {
          return [
            {
              slug: "pages",
              fields: JSON.stringify([
                { name: "seo", type: "component", component: "seo" },
              ]),
            },
          ];
        }
        return [];
      });

      const refs = await ctx.service.findComponentReferences("seo");

      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({
        entityType: "collection",
        entitySlug: "pages",
        fieldName: "seo",
        fieldPath: "seo",
      });
    });

    it("finds multi-component references (components array)", async () => {
      ctx.adapter.select.mockImplementation(async (table: string) => {
        if (table === "dynamic_singles") {
          return [
            {
              slug: "homepage",
              fields: JSON.stringify([
                {
                  name: "layout",
                  type: "component",
                  components: ["hero", "cta"],
                },
              ]),
            },
          ];
        }
        return [];
      });

      const refs = await ctx.service.findComponentReferences("hero");

      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({
        entityType: "single",
        entitySlug: "homepage",
      });
    });

    it("skips self-references when scanning components", async () => {
      ctx.adapter.select.mockImplementation(async (table: string) => {
        if (table === "dynamic_components") {
          return [
            {
              slug: "seo", // same as target
              fields: JSON.stringify([
                { name: "self", type: "component", component: "seo" },
              ]),
            },
          ];
        }
        return [];
      });

      const refs = await ctx.service.findComponentReferences("seo");

      expect(refs).toHaveLength(0);
    });

    it("returns empty array when no references are found", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      const refs = await ctx.service.findComponentReferences("seo");

      expect(refs).toEqual([]);
    });

    it("handles table-missing errors gracefully (fresh install)", async () => {
      ctx.adapter.select.mockRejectedValue(
        new Error("relation does not exist")
      );

      const refs = await ctx.service.findComponentReferences("seo");

      expect(refs).toEqual([]);
    });
  });

  describe("enrichFieldsWithComponentSchemas", () => {
    it("adds componentFields for single-component fields", async () => {
      ctx.adapter.select.mockResolvedValue([
        dbRow({
          slug: "seo",
          fields: JSON.stringify([{ name: "metaTitle", type: "text" }]),
        }),
      ]);

      const enriched = await ctx.service.enrichFieldsWithComponentSchemas([
        { name: "meta", type: "component", component: "seo" },
      ]);

      expect(enriched[0].componentFields).toBeDefined();
      expect(enriched[0].componentFields).toEqual([
        { name: "metaTitle", type: "text" },
      ]);
    });

    it("adds componentSchemas for multi-component fields", async () => {
      ctx.adapter.select.mockResolvedValue([
        dbRow({
          id: "h1",
          slug: "hero",
          table_name: "comp_hero",
          fields: JSON.stringify([{ name: "heading", type: "text" }]),
        }),
        dbRow({
          id: "c1",
          slug: "cta",
          table_name: "comp_cta",
          fields: JSON.stringify([{ name: "label", type: "text" }]),
        }),
      ]);

      const enriched = await ctx.service.enrichFieldsWithComponentSchemas([
        {
          name: "layout",
          type: "component",
          components: ["hero", "cta"],
        },
      ]);

      expect(enriched[0].componentSchemas).toBeDefined();
      expect(Object.keys(enriched[0].componentSchemas!)).toEqual([
        "hero",
        "cta",
      ]);
    });

    it("returns fields unchanged when no component fields present", async () => {
      const result = await ctx.service.enrichFieldsWithComponentSchemas([
        { name: "title", type: "text" },
      ]);

      expect(result).toEqual([{ name: "title", type: "text" }]);
      expect(ctx.adapter.select).not.toHaveBeenCalled();
    });

    it("recursively enriches nested fields in array/group", async () => {
      ctx.adapter.select.mockResolvedValue([
        dbRow({
          slug: "seo",
          fields: JSON.stringify([{ name: "metaTitle", type: "text" }]),
        }),
      ]);

      const enriched = await ctx.service.enrichFieldsWithComponentSchemas([
        {
          name: "group",
          type: "group",
          fields: [{ name: "meta", type: "component", component: "seo" }],
        },
      ]);

      const nested = (enriched[0].fields as Array<Record<string, unknown>>)[0];
      expect(nested.componentFields).toBeDefined();
    });
  });
});

describe("FieldGroupRegistryService legacy table mismatch", () => {
  it("reports a stored name that no longer matches the config", async () => {
    // Storage is not repointed, but the mismatch must not pass silently:
    // registry-backed reads follow the stored name.
    const ctx = createCtx();
    const fields = [{ name: "metaTitle", type: "text" }];
    ctx.adapter.selectOne.mockImplementation(async () => {
      const { calculateSchemaHash } = await import(
        "../../schema/services/schema-hash"
      );
      return dbRow({
        schema_hash: calculateSchemaHash(fields),
        table_name: "comp_seo_meta",
      });
    });

    const result = await ctx.service.syncCodeFirstComponents([
      { slug: "seo", label: "SEO", fields, tableName: "seo_meta" },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].slug).toBe("seo");
    expect(result.errors[0].error).toMatch(/migration/i);
    expect(result.unchanged).toEqual([]);
    expect(ctx.adapter.update).not.toHaveBeenCalled();
  });
});

describe("FieldGroupRegistryService legacy pointer repair", () => {
  const fields = [{ name: "metaTitle", type: "text" }];

  function stubExisting(ctx: RegistryTestCtx, storedName: string) {
    ctx.adapter.selectOne.mockImplementation(async () => {
      const { calculateSchemaHash } = await import(
        "../../schema/services/schema-hash"
      );
      return dbRow({
        schema_hash: calculateSchemaHash(fields),
        table_name: storedName,
      });
    });
  }

  it("repairs a pointer whose table never existed when the configured one does", async () => {
    // Written before names resolved canonically: the data has always been in
    // the configured table, so correcting the row moves nothing.
    const ctx = createCtx();
    // An older version recorded a name the derived one no longer matches.
    stubExisting(ctx, "comp_seo_legacy");
    ctx.adapter.tableExists.mockImplementation(
      async (name: string) => name === "comp_seo"
    );
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    const result = await ctx.service.syncCodeFirstComponents([
      { slug: "seo", label: "SEO", fields },
    ]);

    expect(result.updated).toEqual(["seo"]);
    const [, updateData] = ctx.adapter.update.mock.calls[0];
    expect(updateData.table_name).toBe("comp_seo");
  });

  it("reports rather than repairs when the stored table still exists", async () => {
    const ctx = createCtx();
    stubExisting(ctx, "comp_seo_legacy");
    ctx.adapter.tableExists.mockResolvedValue(true);

    const result = await ctx.service.syncCodeFirstComponents([
      { slug: "seo", label: "SEO", fields },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(ctx.adapter.update).not.toHaveBeenCalled();
  });
});

describe("FieldGroupRegistryService case-differing pointers", () => {
  it("reports a pointer that differs only in case when its table exists", async () => {
    // PostgreSQL keeps `Comp_SEO` and `comp_seo` distinct, so a single listed
    // spelling says the other is absent — not that the server folded them.
    const ctx = createCtx();
    const fields = [{ name: "metaTitle", type: "text" }];
    ctx.adapter.selectOne.mockImplementation(async () =>
      dbRow({ schema_hash: "stale", table_name: "Comp_SEO" })
    );
    ctx.adapter.tableExists.mockImplementation(
      async (name: string) => name === "Comp_SEO"
    );

    const result = await ctx.service.syncCodeFirstComponents([
      { slug: "seo", label: "SEO", fields },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(ctx.adapter.update).not.toHaveBeenCalled();
  });
});
