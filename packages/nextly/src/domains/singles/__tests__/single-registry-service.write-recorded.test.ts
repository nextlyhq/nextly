/**
 * The code-first Single projection (`toCodeFirstSingleConfig`) and the writer
 * `nextly migrate` brings a Single's registry row to a recorded declaration
 * with (`writeRecordedSingle`).
 *
 * The writer shares its decision and its columns with `syncCodeFirstSingles`,
 * so these tests pin what it writes and, as importantly, what it leaves: where
 * the row came from (source, lock, config path, creator), and everything the
 * sync does besides writing the row (permission seeding).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The adapter double holds no stored schema version: registry writes run as
// they are (`unversionedRegistryWrites`).
vi.mock("../../schema/schema-version", async importOriginal =>
  (
    await import("../../../__tests__/helpers/unversioned-registry-writes")
  ).unversionedRegistryWrites(await importOriginal())
);

import type { SingleConfig } from "../../../singles/config/types";
import { calculateSchemaHash } from "../../schema/services/schema-hash";
import { resetWebhookRecordingPolicy } from "../../webhooks/recording-policy";
import {
  SingleRegistryService,
  toCodeFirstSingleConfig,
  type CodeFirstSingleConfig,
} from "../services/single-registry-service";

import {
  createMockAdapter,
  createMockPermissionSeedService,
  createSilentLogger,
} from "./single-test-helpers";

type Ctx = {
  service: SingleRegistryService;
  adapter: ReturnType<typeof createMockAdapter>;
  permissionSeed: ReturnType<typeof createMockPermissionSeedService>;
};

function createCtx(): Ctx {
  const adapter = createMockAdapter();
  const permissionSeed = createMockPermissionSeedService();
  const service = new SingleRegistryService(
    adapter as unknown as ConstructorParameters<
      typeof SingleRegistryService
    >[0],
    createSilentLogger()
  );
  service.setPermissionSeedService(
    permissionSeed as unknown as Parameters<
      typeof service.setPermissionSeedService
    >[0]
  );
  return { service, adapter, permissionSeed };
}

// Typed as the registry types it, so the literal `type` is not widened.
const fields: CodeFirstSingleConfig["fields"] = [
  { name: "siteName", type: "text" },
];

/** A stored row that matches `declared()` exactly. */
function dbRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "single-1",
    slug: "site-settings",
    label: "Site Settings",
    table_name: "single_site_settings",
    description: "Global settings",
    fields: JSON.stringify(fields),
    admin: JSON.stringify({ group: "Config" }),
    source: "code",
    locked: 1,
    config_path: "singles/site-settings.ts",
    schema_hash: calculateSchemaHash(fields),
    schema_version: 3,
    migration_status: "applied",
    last_migration_id: null,
    created_by: "user-7",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The declaration the row above records. */
function declared(
  overrides: Partial<CodeFirstSingleConfig> = {}
): CodeFirstSingleConfig {
  return {
    slug: "site-settings",
    source: "code",
    label: "Site Settings",
    fields,
    description: "Global settings",
    admin: { group: "Config" },
    configPath: "singles/other-path.ts",
    ...overrides,
  };
}

/** Answer registry reads with `row`, and every other table's with nothing. */
function storedRow(ctx: Ctx, row: Record<string, unknown> | null): void {
  ctx.adapter.selectOne.mockImplementation(async (table: string) =>
    table === "dynamic_singles" ? row : null
  );
}

function updateData(ctx: Ctx): Record<string, unknown> {
  return ctx.adapter.update.mock.calls[0][1] as Record<string, unknown>;
}

describe("toCodeFirstSingleConfig", () => {
  it("projects a config entry as the start's sync has always written it", () => {
    const single = {
      slug: "site-settings",
      label: { singular: "Site" },
      fields: [{ name: "siteName", type: "text" }],
      description: "Global settings",
      dbName: "settings",
      admin: { group: "Config" },
      status: true,
      localized: true,
      versions: { drafts: { autosave: false }, maxPerDoc: 10 },
      revalidate: { tags: ["settings"] },
      webhooks: false,
    } satisfies SingleConfig;

    expect(toCodeFirstSingleConfig(single, "code")).toEqual({
      source: "code",
      slug: "site-settings",
      label: "Site",
      fields: [{ name: "siteName", type: "text" }],
      description: "Global settings",
      // The authored name as written: the registry resolves the prefix.
      tableName: "settings",
      admin: { group: "Config" },
      status: true,
      localized: true,
      versions: {
        enabled: true,
        drafts: {
          enabled: true,
          autosave: { enabled: false, intervalMs: 1000 },
        },
        maxPerDoc: 10,
      },
      revalidate: { tags: ["settings"] },
      webhooks: { record: false },
    });
  });

  it("titles the slug when no label is declared, and resolves the defaults", () => {
    const single = {
      slug: "header-nav_main",
      fields: [],
      status: true,
    } satisfies SingleConfig;

    expect(toCodeFirstSingleConfig(single, "code")).toEqual({
      source: "code",
      slug: "header-nav_main",
      // Split on `-` only: an underscore stays inside its word.
      label: "Header Nav_main",
      fields: [],
      description: undefined,
      tableName: undefined,
      admin: undefined,
      status: true,
      localized: false,
      // `status: true` alone aliases to history-only versioning.
      versions: {
        enabled: true,
        drafts: {
          enabled: false,
          autosave: { enabled: false, intervalMs: 1000 },
        },
        maxPerDoc: 50,
      },
      revalidate: undefined,
      webhooks: null,
    });
  });
});

describe("SingleRegistryService.writeRecordedSingle", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = createCtx();
  });

  // A row whose source is not config-owned publishes its recording decision
  // into the process-wide policy as it is written; dropped after each test so
  // no decision outlives it.
  afterEach(() => {
    resetWebhookRecordingPolicy();
  });

  it("registers a missing Single with the origin it is given, seeding nothing", async () => {
    storedRow(ctx, null);
    ctx.adapter.insert.mockResolvedValue(dbRow());

    const outcome = await ctx.service.writeRecordedSingle(declared(), {
      source: "ui",
      locked: false,
    });

    expect(outcome).toBe("created");
    expect(ctx.adapter.insert).toHaveBeenCalledTimes(1);
    const row = ctx.adapter.insert.mock.calls[0][1] as Record<string, unknown>;
    expect(row).toMatchObject({
      slug: "site-settings",
      label: "Site Settings",
      table_name: "single_site_settings",
      description: "Global settings",
      fields: JSON.stringify(fields),
      admin: JSON.stringify({ group: "Config" }),
      source: "ui",
      locked: 0,
      schema_hash: calculateSchemaHash(fields),
    });
    // Where the row came from is the origin's, not the declaration's.
    expect(row.config_path).toBeUndefined();
    // Permissions are another writer's.
    expect(ctx.permissionSeed.seedSinglePermissions).not.toHaveBeenCalled();
  });

  it("writes nothing when the row already matches", async () => {
    storedRow(ctx, dbRow());

    const outcome = await ctx.service.writeRecordedSingle(declared(), {
      source: "code",
      locked: true,
    });

    expect(outcome).toBe("unchanged");
    expect(ctx.adapter.update).not.toHaveBeenCalled();
    expect(ctx.adapter.insert).not.toHaveBeenCalled();
    expect(ctx.permissionSeed.seedSinglePermissions).not.toHaveBeenCalled();
  });

  it("writes a field change through, past the lock of a row defined in code", async () => {
    storedRow(ctx, dbRow());
    ctx.adapter.update.mockResolvedValue([dbRow()]);
    const changed: CodeFirstSingleConfig["fields"] = [
      ...fields,
      { name: "tagline", type: "text" },
    ];

    const outcome = await ctx.service.writeRecordedSingle(
      declared({ fields: changed, revalidate: { tags: ["x"] } }),
      { source: "ui", locked: false }
    );

    expect(outcome).toBe("updated");
    const data = updateData(ctx);
    expect(data).toMatchObject({
      label: "Site Settings",
      description: "Global settings",
      fields: JSON.stringify(changed),
      admin: JSON.stringify({ group: "Config" }),
      schema_hash: calculateSchemaHash(changed),
      schema_version: 4,
      migration_status: "pending",
      status: 0,
      localized: 0,
      revalidate: JSON.stringify({ tags: ["x"] }),
      // Cleared rather than left, as the sync clears it.
      webhooks: null,
    });
    expect(ctx.permissionSeed.seedSinglePermissions).not.toHaveBeenCalled();
  });

  it("moves the row to the table a changed dbName names", async () => {
    // Fields and metadata as stored: only the physical table differs.
    storedRow(ctx, dbRow());
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    const outcome = await ctx.service.writeRecordedSingle(
      declared({ tableName: "settings" }),
      { source: "code", locked: true }
    );

    expect(outcome).toBe("updated");
    // Resolved as a registration resolves it, prefix included.
    expect(updateData(ctx).table_name).toBe("single_settings");
  });

  it("writes a metadata-only change without touching the fields or the migration columns", async () => {
    storedRow(ctx, dbRow());
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    const outcome = await ctx.service.writeRecordedSingle(
      declared({
        label: "Settings",
        description: undefined,
        admin: { group: "Site" },
      }),
      { source: "code", locked: true }
    );

    expect(outcome).toBe("updated");
    const data = updateData(ctx);
    expect(data).toMatchObject({
      label: "Settings",
      description: null,
      admin: JSON.stringify({ group: "Site" }),
    });
    expect("fields" in data).toBe(false);
    expect("schema_version" in data).toBe(false);
    expect("migration_status" in data).toBe(false);
  });

  it("leaves where the row came from as it is on an update", async () => {
    // A Builder row: unlocked, from the UI, with a creator and a config path.
    storedRow(
      ctx,
      dbRow({ source: "ui", locked: 0, schema_hash: "older-hash" })
    );
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    await ctx.service.writeRecordedSingle(declared(), {
      source: "code",
      locked: true,
    });

    const data = updateData(ctx);
    expect("source" in data).toBe(false);
    expect("locked" in data).toBe(false);
    expect("config_path" in data).toBe(false);
    expect("created_by" in data).toBe(false);
  });

  it("leaves the hooks and access columns alone on an update", async () => {
    storedRow(ctx, dbRow({ schema_hash: "older-hash" }));
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    await ctx.service.writeRecordedSingle(declared(), {
      source: "code",
      locked: true,
    });

    const data = updateData(ctx);
    expect("hooks" in data).toBe(false);
    expect("access" in data).toBe(false);
    expect("access_rules" in data).toBe(false);
  });
});

describe("who owns a Single's row", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = createCtx();
    ctx.adapter.select.mockResolvedValue([]);
  });

  afterEach(() => {
    resetWebhookRecordingPolicy();
  });

  const PLUGIN = "plugin:@acme/shop" as const;
  const written = () =>
    ctx.adapter.update.mock.calls[0][1] as Record<string, unknown>;

  it.each([
    ["the app's own, now a plugin's", "code", PLUGIN],
    ["a plugin's, now the app's own", PLUGIN, "code"],
    ["a plugin's, now another plugin's", "plugin:@acme/old", PLUGIN],
  ] as const)(
    "moves with the declaration: %s, its owner alone",
    async (_case, recorded, declares) => {
      storedRow(ctx, dbRow({ source: recorded, locked: 0 }));
      ctx.adapter.select.mockResolvedValue([
        dbRow({ source: recorded, locked: 0 }),
      ]);
      ctx.adapter.update.mockResolvedValue([dbRow({ source: declares })]);

      const result = await ctx.service.syncCodeFirstSingles([
        declared({ source: declares }),
      ]);

      expect(result.updated).toEqual(["site-settings"]);
      expect(written()).toMatchObject({ source: declares, locked: 1 });
      // No column it stores changed, so nothing is left to migrate.
      expect(written()).not.toHaveProperty("schema_version");
      expect(written()).not.toHaveProperty("migration_status");
    }
  );

  it("stays the Schema Builder's, and Nextly's own, under any declaration", async () => {
    for (const recorded of ["ui", "built-in"]) {
      const row = dbRow({ source: recorded });
      storedRow(ctx, row);
      ctx.adapter.select.mockResolvedValue([row]);

      const result = await ctx.service.syncCodeFirstSingles([
        declared({ source: PLUGIN }),
      ]);

      expect(result.unchanged).toEqual(["site-settings"]);
    }
    expect(ctx.adapter.update).not.toHaveBeenCalled();
  });

  it("is not written where the declaration already owns it", async () => {
    storedRow(ctx, dbRow({ source: PLUGIN }));
    ctx.adapter.select.mockResolvedValue([dbRow({ source: PLUGIN })]);

    const result = await ctx.service.syncCodeFirstSingles([
      declared({ source: PLUGIN }),
    ]);

    expect(result.unchanged).toEqual(["site-settings"]);
    expect(ctx.adapter.update).not.toHaveBeenCalled();
  });

  it("is registered as the plugin's, and locked", async () => {
    storedRow(ctx, null);
    ctx.adapter.insert.mockResolvedValue(dbRow({ source: PLUGIN }));

    await ctx.service.syncCodeFirstSingles([declared({ source: PLUGIN })]);

    expect(ctx.adapter.insert.mock.calls[0][1]).toMatchObject({
      source: PLUGIN,
      locked: 1,
    });
  });

  it.each([
    ["code", 1],
    [PLUGIN, 1],
    ["ui", 0],
    ["built-in", 0],
  ] as const)(
    "is locked by default where code or a plugin owns it: %s",
    async (source, locked) => {
      const row = {
        slug: "site-settings",
        label: "Site Settings",
        tableName: "single_site_settings",
        fields,
        schemaHash: "hash",
        source,
      };
      storedRow(ctx, null);
      ctx.adapter.insert.mockResolvedValue(dbRow({ source }));
      await ctx.service.registerSingle(row);

      const tx = {
        selectOne: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue(dbRow({ source })),
      };
      await ctx.service.registerSingleInTransaction(tx as never, row);

      for (const insert of [ctx.adapter.insert, tx.insert]) {
        expect(insert.mock.calls[0][1]).toMatchObject({ source, locked });
      }
    }
  );

  it("is left as it is by migrate, which writes a plugin's locked row as the pipeline does", async () => {
    storedRow(ctx, dbRow({ source: PLUGIN }));
    ctx.adapter.update.mockResolvedValue([dbRow({ source: PLUGIN })]);

    const outcome = await ctx.service.writeRecordedSingle(
      declared({ source: "code", description: "Another description" }),
      { source: "code", locked: true }
    );

    expect(outcome).toBe("updated");
    expect(written()).not.toHaveProperty("source");
  });

  it("keeps a plugin's Single from a change outside code", async () => {
    storedRow(ctx, dbRow({ source: PLUGIN }));

    await expect(
      ctx.service.updateSingle(
        "site-settings",
        { label: "Other" },
        { source: "ui" }
      )
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      publicMessage: expect.stringContaining("defined in code"),
    });
    expect(ctx.adapter.update).not.toHaveBeenCalled();
  });
});
