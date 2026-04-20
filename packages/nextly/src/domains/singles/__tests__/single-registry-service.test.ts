/**
 * SingleRegistryService Contract Tests
 *
 * Captures the current behavior of SingleRegistryService before it is
 * refactored to extend BaseRegistryService. These tests must pass against
 * both the old and new implementations to prove the refactor is
 * behavior-preserving.
 *
 * Covers:
 * - CRUD: registerSingle, getSingle(BySlug), getAllSingles, listSingles,
 *   updateSingle, deleteSingle
 * - Locking & migration: isLocked, updateMigrationStatus,
 *   updateMigrationStatusWithVerification, getPendingMigrations
 * - Sync: syncCodeFirstSingles
 * - Transaction support: registerSingleInTransaction
 * - Helpers: generateTableName, ensureTableNamePrefix, deserializeRecord
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { ServiceError } from "../../../errors";
import { SingleRegistryService } from "../services/single-registry-service";

import {
  createMockAdapter,
  createSilentLogger,
  createMockPermissionSeedService,
} from "./single-test-helpers";

// ============================================================
// Test Fixture
// ============================================================

type RegistryTestCtx = {
  service: SingleRegistryService;
  adapter: ReturnType<typeof createMockAdapter>;
  permissionSeed: ReturnType<typeof createMockPermissionSeedService>;
};

function createCtx(
  adapterOverrides: Record<string, unknown> = {}
): RegistryTestCtx {
  const adapter = createMockAdapter(adapterOverrides);
  const logger = createSilentLogger();
  const permissionSeed = createMockPermissionSeedService();

  const service = new SingleRegistryService(
    adapter as unknown as Parameters<typeof SingleRegistryService>[0],
    logger
  );
  service.setPermissionSeedService(
    permissionSeed as unknown as Parameters<
      typeof service.setPermissionSeedService
    >[0]
  );

  return { service, adapter, permissionSeed };
}

function dbRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "single-1",
    slug: "site-settings",
    label: "Site Settings",
    table_name: "single_site_settings",
    description: null,
    fields: JSON.stringify([{ name: "siteName", type: "text" }]),
    admin: null,
    access_rules: null,
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

describe("SingleRegistryService", () => {
  let ctx: RegistryTestCtx;

  beforeEach(() => {
    ctx = createCtx();
  });

  // ============================================================
  // registerSingle
  // ============================================================

  describe("registerSingle", () => {
    it("inserts a new single with correct snake_case columns", async () => {
      // assertGlobalResourceSlugAvailable + existing-check both return null
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue(dbRow());

      const result = await ctx.service.registerSingle({
        slug: "site-settings",
        label: "Site Settings",
        tableName: "single_site_settings",
        fields: [{ name: "siteName", type: "text" }],
        source: "code",
        schemaHash: "hash-1",
      });

      expect(ctx.adapter.insert).toHaveBeenCalledTimes(1);
      const [tableName, row] = ctx.adapter.insert.mock.calls[0];
      expect(tableName).toBe("dynamic_singles");
      expect(row).toMatchObject({
        slug: "site-settings",
        label: "Site Settings",
        table_name: "single_site_settings",
        source: "code",
        locked: 1,
        schema_hash: "hash-1",
        schema_version: 1,
        migration_status: "pending",
      });
      expect(row.id).toBeDefined();
      expect(row.fields).toBe(
        JSON.stringify([{ name: "siteName", type: "text" }])
      );
      expect(result.slug).toBe("site-settings");
    });

    it("throws DUPLICATE_KEY when a single with same slug already exists", async () => {
      // First call (slug guard) returns null; second call (existing single) returns row
      ctx.adapter.selectOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(dbRow());

      await expect(
        ctx.service.registerSingle({
          slug: "site-settings",
          label: "Site Settings",
          tableName: "single_site_settings",
          fields: [],
          source: "code",
          schemaHash: "hash-1",
        })
      ).rejects.toThrow(ServiceError);
    });

    it("auto-locks code-first singles", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue(dbRow());

      await ctx.service.registerSingle({
        slug: "site-settings",
        label: "Site Settings",
        tableName: "single_site_settings",
        fields: [],
        source: "code",
        schemaHash: "hash-1",
      });

      const row = ctx.adapter.insert.mock.calls[0][1];
      expect(row.locked).toBe(1);
    });

    it("does not auto-lock UI singles by default", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue(dbRow({ source: "ui", locked: 0 }));

      await ctx.service.registerSingle({
        slug: "custom-single",
        label: "Custom",
        tableName: "single_custom",
        fields: [],
        source: "ui",
        schemaHash: "hash-ui",
      });

      const row = ctx.adapter.insert.mock.calls[0][1];
      expect(row.locked).toBe(0);
    });

    it("ensures single_ table name prefix", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue(dbRow());

      await ctx.service.registerSingle({
        slug: "site-settings",
        label: "Site Settings",
        tableName: "site_settings", // no prefix
        fields: [],
        source: "code",
        schemaHash: "h",
      });

      const row = ctx.adapter.insert.mock.calls[0][1];
      expect(row.table_name).toBe("single_site_settings");
    });

    it("serializes admin and accessRules to JSON", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue(dbRow());

      await ctx.service.registerSingle({
        slug: "site-settings",
        label: "Site Settings",
        tableName: "single_site_settings",
        fields: [],
        source: "code",
        schemaHash: "hash-1",
        admin: { group: "Config" },
        accessRules: {
          read: { allowAuthenticated: true },
        },
      });

      const row = ctx.adapter.insert.mock.calls[0][1];
      expect(row.admin).toBe(JSON.stringify({ group: "Config" }));
      expect(row.access_rules).toBe(
        JSON.stringify({ read: { allowAuthenticated: true } })
      );
    });

    it("seeds permissions after registration (non-blocking)", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue(dbRow());

      await ctx.service.registerSingle({
        slug: "site-settings",
        label: "Site Settings",
        tableName: "single_site_settings",
        fields: [],
        source: "code",
        schemaHash: "hash-1",
      });

      expect(ctx.permissionSeed.seedSinglePermissions).toHaveBeenCalledWith(
        "site-settings"
      );
    });
  });

  // ============================================================
  // getSingleBySlug / getSingle
  // ============================================================

  describe("getSingleBySlug", () => {
    it("returns deserialized single when found", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow());

      const result = await ctx.service.getSingleBySlug("site-settings");

      expect(result).not.toBeNull();
      expect(result?.slug).toBe("site-settings");
      expect(result?.label).toBe("Site Settings");
      expect(result?.tableName).toBe("single_site_settings");
      expect(result?.fields).toEqual([{ name: "siteName", type: "text" }]);
      expect(result?.locked).toBe(true); // 1 → boolean
    });

    it("returns null when single does not exist", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);

      const result = await ctx.service.getSingleBySlug("missing");

      expect(result).toBeNull();
    });

    it("parses JSON admin and accessRules", async () => {
      ctx.adapter.selectOne.mockResolvedValue(
        dbRow({
          admin: JSON.stringify({ group: "Config" }),
          access_rules: JSON.stringify({ read: { allowAuthenticated: true } }),
        })
      );

      const result = await ctx.service.getSingleBySlug("site-settings");

      expect(result?.admin).toEqual({ group: "Config" });
      expect(result?.accessRules).toEqual({
        read: { allowAuthenticated: true },
      });
    });
  });

  describe("getSingle", () => {
    it("returns the single when found", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow());

      const result = await ctx.service.getSingle("site-settings");

      expect(result.slug).toBe("site-settings");
    });

    it("throws NOT_FOUND when single does not exist", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);

      await expect(ctx.service.getSingle("missing")).rejects.toThrow(
        ServiceError
      );
    });
  });

  // ============================================================
  // getAllSingles
  // ============================================================

  describe("getAllSingles", () => {
    it("returns all singles", async () => {
      ctx.adapter.select.mockResolvedValue([
        dbRow(),
        dbRow({ id: "single-2", slug: "header", label: "Header" }),
      ]);

      const result = await ctx.service.getAllSingles();

      expect(result).toHaveLength(2);
      expect(result[0].slug).toBe("site-settings");
      expect(result[1].slug).toBe("header");
    });

    it("filters by source", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.getAllSingles({ source: "code" });

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

      await ctx.service.getAllSingles({ migrationStatus: "pending" });

      const opts = ctx.adapter.select.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const where = opts.where as Record<string, unknown>;
      expect((where.and as Array<Record<string, unknown>>)[0]).toMatchObject({
        column: "migration_status",
        value: "pending",
      });
    });

    it("filters by locked flag", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.getAllSingles({ locked: true });

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

  // ============================================================
  // listSingles
  // ============================================================

  describe("listSingles", () => {
    it("returns paginated data with total count", async () => {
      // First call: count query (columns: ["id"])
      // Second call: actual data query
      ctx.adapter.select
        .mockResolvedValueOnce([{ id: "1" }, { id: "2" }, { id: "3" }])
        .mockResolvedValueOnce([
          dbRow(),
          dbRow({ id: "single-2", slug: "header" }),
        ]);

      const result = await ctx.service.listSingles({ limit: 2, offset: 0 });

      expect(result.total).toBe(3);
      expect(result.data).toHaveLength(2);
    });

    it("applies search filter across slug and label", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.listSingles({ search: "settings" });

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

  // ============================================================
  // updateSingle
  // ============================================================

  describe("updateSingle", () => {
    /**
     * Mock selectOne by table name so the slug guard (which queries
     * `dynamic_collections` then `dynamic_singles`) and
     * `getSingle` (which queries `dynamic_singles` via `getSingleBySlug`)
     * both see the right data without brittle call-order chains.
     */
    function mockSelectOne(singleRow: Record<string, unknown> | null) {
      ctx.adapter.selectOne.mockImplementation(async (table: string) => {
        if (table === "dynamic_singles") return singleRow;
        return null;
      });
    }

    it("updates single and increments schema_version on fields change", async () => {
      mockSelectOne(dbRow({ locked: 0, schema_version: 1 }));
      ctx.adapter.update.mockResolvedValue([
        dbRow({ schema_version: 2, locked: 0 }),
      ]);

      await ctx.service.updateSingle("site-settings", {
        fields: [
          { name: "siteName", type: "text" },
          { name: "tagline", type: "text" },
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

    it("throws FORBIDDEN when locked and source is not 'code'", async () => {
      mockSelectOne(dbRow({ locked: 1 }));

      await expect(
        ctx.service.updateSingle(
          "site-settings",
          { label: "New" },
          { source: "ui" }
        )
      ).rejects.toThrow(ServiceError);
    });

    it("allows update when locked and source is 'code'", async () => {
      mockSelectOne(dbRow({ locked: 1 }));
      ctx.adapter.update.mockResolvedValue([dbRow()]);

      await expect(
        ctx.service.updateSingle(
          "site-settings",
          { label: "Updated" },
          { source: "code" }
        )
      ).resolves.toBeDefined();
    });

    it("throws NOT_FOUND when the single does not exist", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);

      await expect(
        ctx.service.updateSingle("missing", { label: "X" })
      ).rejects.toThrow(ServiceError);
    });

    it("writes locked as 1/0 integers", async () => {
      mockSelectOne(dbRow({ locked: 0 }));
      ctx.adapter.update.mockResolvedValue([dbRow({ locked: 1 })]);

      await ctx.service.updateSingle("site-settings", { locked: true });

      const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(updateData.locked).toBe(1);
    });
  });

  // ============================================================
  // deleteSingle
  // ============================================================

  describe("deleteSingle", () => {
    it("throws FORBIDDEN when force is not set", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 0 }));

      await expect(ctx.service.deleteSingle("site-settings")).rejects.toThrow(
        ServiceError
      );
    });

    it("force-deletes and removes associated permissions", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 0 }));
      ctx.adapter.delete.mockResolvedValue(1);

      await ctx.service.deleteSingle("site-settings", { force: true });

      expect(ctx.adapter.delete).toHaveBeenCalledWith(
        "dynamic_singles",
        expect.anything()
      );
      expect(
        ctx.permissionSeed.deletePermissionsForResource
      ).toHaveBeenCalledWith("site-settings");
    });

    it("force-deletes locked singles with a warning", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 1 }));
      ctx.adapter.delete.mockResolvedValue(1);

      await expect(
        ctx.service.deleteSingle("site-settings", { force: true })
      ).resolves.toBeUndefined();
    });

    it("throws NOT_FOUND when delete returns zero rows", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 0 }));
      ctx.adapter.delete.mockResolvedValue(0);

      await expect(
        ctx.service.deleteSingle("site-settings", { force: true })
      ).rejects.toThrow(ServiceError);
    });
  });

  // ============================================================
  // isLocked
  // ============================================================

  describe("isLocked", () => {
    it("returns true for locked single", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 1 }));
      expect(await ctx.service.isLocked("site-settings")).toBe(true);
    });

    it("returns false for unlocked single", async () => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow({ locked: 0 }));
      expect(await ctx.service.isLocked("site-settings")).toBe(false);
    });

    it("returns false when single does not exist", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);
      expect(await ctx.service.isLocked("missing")).toBe(false);
    });
  });

  // ============================================================
  // Migration status
  // ============================================================

  describe("updateMigrationStatus", () => {
    it("updates migration_status with snake_case column", async () => {
      ctx.adapter.update.mockResolvedValue([{ slug: "site-settings" }]);

      await ctx.service.updateMigrationStatus(
        "site-settings",
        "applied",
        "mig-1"
      );

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
      ).rejects.toThrow(ServiceError);
    });
  });

  describe("updateMigrationStatusWithVerification", () => {
    it("sets status to applied when table exists", async () => {
      ctx.adapter.tableExists.mockResolvedValue(true);
      ctx.adapter.update.mockResolvedValue([{ slug: "site-settings" }]);

      const result = await ctx.service.updateMigrationStatusWithVerification(
        "site-settings",
        "single_site_settings"
      );

      expect(result.verified).toBe(true);
      expect(result.status).toBe("applied");
    });

    it("sets status to failed when table does not exist", async () => {
      ctx.adapter.tableExists.mockResolvedValue(false);
      ctx.adapter.update.mockResolvedValue([{ slug: "site-settings" }]);

      const result = await ctx.service.updateMigrationStatusWithVerification(
        "site-settings",
        "single_site_settings"
      );

      expect(result.verified).toBe(false);
      expect(result.status).toBe("failed");
    });
  });

  describe("getPendingMigrations", () => {
    it("returns only singles with pending/generated status", async () => {
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
        column: "migration_status",
        value: ["pending", "generated"],
      });
    });
  });

  // ============================================================
  // syncCodeFirstSingles
  // ============================================================

  describe("syncCodeFirstSingles", () => {
    it("creates new singles that do not exist", async () => {
      // selectOne chain: slug guard (null) + existing check (null) → create
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue(dbRow({ slug: "header" }));

      const result = await ctx.service.syncCodeFirstSingles([
        {
          slug: "header",
          label: "Header",
          fields: [{ name: "logo", type: "upload" }],
        },
      ]);

      expect(result.created).toEqual(["header"]);
      expect(result.updated).toEqual([]);
      expect(result.unchanged).toEqual([]);
    });

    it("updates singles with changed schema hash", async () => {
      // Route all single queries to the existing row; collection queries to null
      // so the slug guard treats it as a same-resource update.
      ctx.adapter.selectOne.mockImplementation(async (table: string) => {
        if (table === "dynamic_singles") {
          return dbRow({ schema_hash: "old-hash" });
        }
        return null;
      });
      ctx.adapter.update.mockResolvedValue([dbRow()]);

      const result = await ctx.service.syncCodeFirstSingles([
        {
          slug: "site-settings",
          label: "Site Settings",
          fields: [{ name: "siteName", type: "text" }],
        },
      ]);

      expect(result.updated).toEqual(["site-settings"]);
      expect(result.created).toEqual([]);
    });

    it("marks singles as unchanged when schema hash matches", async () => {
      const fields = [{ name: "siteName", type: "text" }];
      ctx.adapter.selectOne.mockImplementation(async (table: string) => {
        if (table !== "dynamic_singles") return null;
        const { calculateSchemaHash } = await import(
          "../../../services/schema/schema-hash"
        );
        return dbRow({
          schema_hash: calculateSchemaHash(fields),
        });
      });

      const result = await ctx.service.syncCodeFirstSingles([
        { slug: "site-settings", label: "Site Settings", fields },
      ]);

      expect(result.unchanged).toEqual(["site-settings"]);
      expect(result.created).toEqual([]);
      expect(result.updated).toEqual([]);
    });

    it("collects errors per single", async () => {
      ctx.adapter.selectOne.mockRejectedValue(new Error("db explode"));

      const result = await ctx.service.syncCodeFirstSingles([
        { slug: "site-settings", label: "Site Settings", fields: [] },
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].slug).toBe("site-settings");
    });

    it("uses single_ prefix for auto-generated table name", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue(dbRow({ slug: "header-nav" }));

      await ctx.service.syncCodeFirstSingles([
        {
          slug: "header-nav",
          label: "Header Nav",
          fields: [{ name: "items", type: "json" }],
        },
      ]);

      const row = ctx.adapter.insert.mock.calls[0][1];
      expect(row.table_name).toBe("single_header_nav");
    });
  });

  // ============================================================
  // registerSingleInTransaction
  // ============================================================

  describe("registerSingleInTransaction", () => {
    it("uses the transaction context for insert/existing check", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null); // slug guard on adapter

      const tx = {
        selectOne: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue(dbRow()),
      };

      await ctx.service.registerSingleInTransaction(
        tx as unknown as Parameters<
          typeof ctx.service.registerSingleInTransaction
        >[0],
        {
          slug: "site-settings",
          label: "Site Settings",
          tableName: "single_site_settings",
          fields: [],
          source: "code",
          schemaHash: "hash",
        }
      );

      expect(tx.selectOne).toHaveBeenCalled();
      expect(tx.insert).toHaveBeenCalled();
      expect(ctx.adapter.insert).not.toHaveBeenCalled();
    });

    it("throws DUPLICATE_KEY via transaction when slug already exists", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null); // slug guard
      const tx = {
        selectOne: vi.fn().mockResolvedValue(dbRow()),
        insert: vi.fn(),
      };

      await expect(
        ctx.service.registerSingleInTransaction(
          tx as unknown as Parameters<
            typeof ctx.service.registerSingleInTransaction
          >[0],
          {
            slug: "site-settings",
            label: "Site Settings",
            tableName: "single_site_settings",
            fields: [],
            source: "code",
            schemaHash: "hash",
          }
        )
      ).rejects.toThrow(ServiceError);
      expect(tx.insert).not.toHaveBeenCalled();
    });
  });
});
