/**
 * The code-first component projection (`toCodeFirstComponentConfig`) and the
 * writer `nextly migrate` brings a component's registry row to a recorded
 * declaration with (`writeRecordedComponent`).
 *
 * The writer shares its decision and its columns with
 * `syncCodeFirstComponents`, so these tests pin what it writes and, as
 * importantly, what it leaves: where the row came from (source, lock, config
 * path, creator).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The adapter double holds no stored schema version: registry writes run as
// they are (`unversionedRegistryWrites`).
vi.mock("../../schema/schema-version", async importOriginal =>
  (
    await import("../../../__tests__/helpers/unversioned-registry-writes")
  ).unversionedRegistryWrites(await importOriginal())
);

// What clears a `diverged` mark; each case that needs it says how it ends.
vi.mock("../services/field-group-reconcile-service", () => ({
  reconcileFieldGroup: vi.fn(async () => ({})),
}));

import { loadDialectTables } from "../../../database/dialect-tables";
import type { FieldGroupConfig } from "../../../field-groups/config/types";
import { calculateSchemaHash } from "../../schema/services/schema-hash";
import { reconcileFieldGroup } from "../services/field-group-reconcile-service";
import {
  FieldGroupRegistryService,
  toCodeFirstComponentConfig,
  type CodeFirstComponentConfig,
} from "../services/field-group-registry-service";

import {
  createMockAdapter,
  createSilentLogger,
} from "./field-group-test-helpers";

// The postgresql tables the registry reads; the unit setup loads only the
// run's own dialect, as an app's adapter would.
beforeAll(async () => {
  await loadDialectTables("postgresql");
});

type Ctx = {
  service: FieldGroupRegistryService;
  adapter: ReturnType<typeof createMockAdapter>;
};

function createCtx(): Ctx {
  const adapter = createMockAdapter();
  const service = new FieldGroupRegistryService(
    adapter as unknown as ConstructorParameters<
      typeof FieldGroupRegistryService
    >[0],
    createSilentLogger()
  );
  return { service, adapter };
}

// Typed as the registry types it, so the literal `type` is not widened.
const fields: CodeFirstComponentConfig["fields"] = [
  { name: "metaTitle", type: "text" },
];

/** A stored row that matches `declared()` exactly. */
function dbRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "comp-1",
    slug: "seo",
    label: "SEO",
    table_name: "comp_seo",
    description: "Search metadata",
    fields: JSON.stringify(fields),
    admin: JSON.stringify({ category: "Meta" }),
    source: "code",
    locked: 1,
    localized: 0,
    config_path: "components/seo.ts",
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
  overrides: Partial<CodeFirstComponentConfig> = {}
): CodeFirstComponentConfig {
  return {
    slug: "seo",
    source: "code",
    label: "SEO",
    fields,
    description: "Search metadata",
    admin: { category: "Meta" },
    configPath: "components/other-path.ts",
    localized: false,
    ...overrides,
  };
}

function updateData(ctx: Ctx): Record<string, unknown> {
  return ctx.adapter.update.mock.calls[0][1] as Record<string, unknown>;
}

describe("toCodeFirstComponentConfig", () => {
  it("projects a config entry as the start's sync has always written it", () => {
    const fieldGroup = {
      slug: "seo",
      label: { singular: "SEO Metadata" },
      fields: [{ name: "metaTitle", type: "text" }],
      description: "Search metadata",
      admin: { category: "Meta", icon: "Search" },
      localized: true,
    } satisfies FieldGroupConfig;

    expect(toCodeFirstComponentConfig(fieldGroup, "code")).toEqual({
      source: "code",
      slug: "seo",
      label: "SEO Metadata",
      fields: [{ name: "metaTitle", type: "text" }],
      description: "Search metadata",
      admin: { category: "Meta", icon: "Search" },
      // Derived from the slug, not read from the entry.
      configPath: "components/seo.ts",
      localized: true,
    });
  });

  it("titles the slug when no label is declared, splitting on `-` and `_`", () => {
    const fieldGroup = {
      slug: "hero-banner_v2",
      fields: [],
    } satisfies FieldGroupConfig;

    expect(toCodeFirstComponentConfig(fieldGroup, "code")).toEqual({
      source: "code",
      slug: "hero-banner_v2",
      label: "Hero Banner V2",
      fields: [],
      description: undefined,
      admin: undefined,
      configPath: "components/hero-banner_v2.ts",
      localized: false,
    });
  });
});

describe("FieldGroupRegistryService.writeRecordedComponent", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = createCtx();
  });

  it("registers a missing component with the origin it is given", async () => {
    ctx.adapter.selectOne.mockResolvedValue(null);
    ctx.adapter.insert.mockResolvedValue(dbRow());

    const outcome = await ctx.service.writeRecordedComponent(declared(), {
      source: "ui",
      locked: false,
    });

    expect(outcome).toBe("created");
    expect(ctx.adapter.insert).toHaveBeenCalledTimes(1);
    const row = ctx.adapter.insert.mock.calls[0][1] as Record<string, unknown>;
    expect(row).toMatchObject({
      slug: "seo",
      label: "SEO",
      table_name: "comp_seo",
      description: "Search metadata",
      fields: JSON.stringify(fields),
      admin: JSON.stringify({ category: "Meta" }),
      source: "ui",
      locked: 0,
      localized: 0,
      schema_hash: calculateSchemaHash(fields),
    });
    // The config path is the projection's, as a start gives the row it
    // creates; source and lock are the origin's.
    expect(row.config_path).toBe("components/other-path.ts");
  });

  it("writes nothing when the row already matches", async () => {
    ctx.adapter.selectOne.mockResolvedValue(dbRow());

    const outcome = await ctx.service.writeRecordedComponent(declared(), {
      source: "code",
      locked: true,
    });

    expect(outcome).toBe("unchanged");
    expect(ctx.adapter.update).not.toHaveBeenCalled();
    expect(ctx.adapter.insert).not.toHaveBeenCalled();
  });

  it("writes a field change through, past the lock of a row defined in code", async () => {
    ctx.adapter.selectOne.mockResolvedValue(dbRow());
    ctx.adapter.update.mockResolvedValue([dbRow()]);
    const changed: CodeFirstComponentConfig["fields"] = [
      ...fields,
      { name: "metaDescription", type: "text" },
    ];

    const outcome = await ctx.service.writeRecordedComponent(
      declared({ fields: changed, label: "Search" }),
      { source: "ui", locked: false }
    );

    expect(outcome).toBe("updated");
    expect(updateData(ctx)).toMatchObject({
      label: "Search",
      description: "Search metadata",
      fields: JSON.stringify(changed),
      admin: JSON.stringify({ category: "Meta" }),
      schema_hash: calculateSchemaHash(changed),
      schema_version: 4,
      migration_status: "pending",
      localized: 0,
    });
  });

  it("writes an admin-only change without touching the fields or the migration columns", async () => {
    ctx.adapter.selectOne.mockResolvedValue(dbRow());
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    const outcome = await ctx.service.writeRecordedComponent(
      declared({ admin: { category: "Search" } }),
      { source: "code", locked: true }
    );

    expect(outcome).toBe("updated");
    const data = updateData(ctx);
    expect(data.admin).toBe(JSON.stringify({ category: "Search" }));
    expect("fields" in data).toBe(false);
    expect("schema_version" in data).toBe(false);
    expect("migration_status" in data).toBe(false);
  });

  // A label or description edit alone is a change of the row, as it is for a
  // collection and a Single: written without a schema change beside it.
  it.each([
    ["label", { label: "Search" }, { label: "Search" }],
    ["description", { description: "Meta tags" }, { description: "Meta tags" }],
  ] as const)(
    "writes a %s-only change without touching the fields",
    async (_name, change, written) => {
      ctx.adapter.selectOne.mockResolvedValue(dbRow());
      ctx.adapter.update.mockResolvedValue([dbRow()]);

      const outcome = await ctx.service.writeRecordedComponent(
        declared(change),
        { source: "code", locked: true }
      );

      expect(outcome).toBe("updated");
      const data = updateData(ctx);
      expect(data).toMatchObject(written);
      expect("fields" in data).toBe(false);
    }
  );

  // A Builder field group's own row names its table, which its slug can spell
  // differently from the code-first derivation (`a__b` keeps its doubled
  // `_`, the derivation folds it): the row is held to that table, and found
  // matching rather than diverged.
  it("holds a Builder field group to the table its own row names", async () => {
    ctx.adapter.selectOne.mockResolvedValue(
      dbRow({ slug: "a__b", table_name: "comp_a__b", source: "ui", locked: 0 })
    );

    const outcome = await ctx.service.writeRecordedComponent(
      declared({ slug: "a__b", configPath: undefined }),
      { source: "ui", locked: false },
      { tableName: "comp_a__b" }
    );

    expect(outcome).toBe("unchanged");
    expect(ctx.adapter.update).not.toHaveBeenCalled();
  });

  it("gives a code-first row it creates the config path a start gives it", async () => {
    ctx.adapter.selectOne.mockResolvedValue(null);
    ctx.adapter.insert.mockResolvedValue(dbRow());

    await ctx.service.writeRecordedComponent(
      declared({ configPath: "components/seo.ts" }),
      { source: "code", locked: true }
    );

    const row = ctx.adapter.insert.mock.calls[0][1] as Record<string, unknown>;
    expect(row.config_path).toBe("components/seo.ts");
  });

  // A declaration that no longer says a description or admin options clears
  // them, rather than leaving what an earlier declaration said.
  it("clears a description and admin options the declaration no longer has", async () => {
    ctx.adapter.selectOne.mockResolvedValue(dbRow());
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    const outcome = await ctx.service.writeRecordedComponent(
      declared({ description: undefined, admin: undefined }),
      { source: "code", locked: true }
    );

    expect(outcome).toBe("updated");
    expect(updateData(ctx)).toMatchObject({ description: null, admin: null });
  });

  it("leaves where the row came from as it is on an update", async () => {
    // A Builder row: unlocked, from the UI, with a creator and a config path.
    ctx.adapter.selectOne.mockResolvedValue(
      dbRow({ source: "ui", locked: 0, schema_hash: "older-hash" })
    );
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    await ctx.service.writeRecordedComponent(declared(), {
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
    ctx.adapter.selectOne.mockResolvedValue(
      dbRow({ schema_hash: "older-hash" })
    );
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    await ctx.service.writeRecordedComponent(declared(), {
      source: "code",
      locked: true,
    });

    const data = updateData(ctx);
    expect("hooks" in data).toBe(false);
    expect("access" in data).toBe(false);
    expect("access_rules" in data).toBe(false);
  });

  it("refuses, writing nothing, when the stored table differs from the derived one", async () => {
    // The sync's own refusal: storage is not repointed while the stored table
    // still exists.
    ctx.adapter.selectOne.mockResolvedValue(
      dbRow({ table_name: "comp_seo_legacy" })
    );
    ctx.adapter.tableExists.mockResolvedValue(true);

    await expect(
      ctx.service.writeRecordedComponent(declared(), {
        source: "code",
        locked: true,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(ctx.adapter.update).not.toHaveBeenCalled();
  });
});

describe("who owns a field group's row", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = createCtx();
  });

  const PLUGIN = "plugin:@acme/shop" as const;

  it.each([
    ["the app's own, now a plugin's", "code", PLUGIN],
    ["a plugin's, now the app's own", PLUGIN, "code"],
    ["a plugin's, now another plugin's", "plugin:@acme/old", PLUGIN],
  ] as const)(
    "moves with the declaration: %s, its owner alone",
    async (_case, recorded, declares) => {
      ctx.adapter.selectOne.mockResolvedValue(
        dbRow({ source: recorded, locked: 0 })
      );
      ctx.adapter.update.mockResolvedValue([dbRow({ source: declares })]);

      const result = await ctx.service.syncCodeFirstComponents([
        declared({ source: declares }),
      ]);

      expect(result.updated).toEqual(["seo"]);
      expect(updateData(ctx)).toMatchObject({ source: declares, locked: 1 });
      // No column it stores changed, so nothing is left to migrate.
      expect(updateData(ctx)).not.toHaveProperty("schema_version");
      expect(updateData(ctx)).not.toHaveProperty("migration_status");
    }
  );

  it("stays the Schema Builder's under any declaration", async () => {
    ctx.adapter.selectOne.mockResolvedValue(dbRow({ source: "ui" }));

    const result = await ctx.service.syncCodeFirstComponents([
      declared({ source: PLUGIN }),
    ]);

    expect(result.unchanged).toEqual(["seo"]);
    expect(ctx.adapter.update).not.toHaveBeenCalled();
  });

  it("is not written where the declaration already owns it", async () => {
    ctx.adapter.selectOne.mockResolvedValue(dbRow({ source: PLUGIN }));

    const result = await ctx.service.syncCodeFirstComponents([
      declared({ source: PLUGIN }),
    ]);

    expect(result.unchanged).toEqual(["seo"]);
    expect(ctx.adapter.update).not.toHaveBeenCalled();
  });

  it.each([
    ["a table the sync does not repoint", { table_name: "comp_elsewhere" }],
    [
      "a mark it cannot clear",
      { migration_status: "diverged", table_name: "comp_seo" },
    ],
  ])(
    "moves with the declaration where the rest of the row stays as it is: %s",
    async (_case, row) => {
      ctx.adapter.selectOne.mockResolvedValue(
        dbRow({ source: "code", ...row })
      );
      ctx.adapter.tableExists.mockResolvedValue(true);
      ctx.adapter.update.mockResolvedValue([dbRow({ source: PLUGIN, ...row })]);
      vi.mocked(reconcileFieldGroup).mockRejectedValueOnce(
        new Error("ambiguous tables")
      );

      const result = await ctx.service.syncCodeFirstComponents([
        declared({ source: PLUGIN }),
      ]);

      expect(result.errors).toHaveLength(1);
      expect(ctx.adapter.update).toHaveBeenCalledTimes(1);
      expect(updateData(ctx)).toMatchObject({ source: PLUGIN, locked: 1 });
      expect(updateData(ctx)).not.toHaveProperty("table_name");
      expect(updateData(ctx)).not.toHaveProperty("fields");
    }
  );

  it("is registered as the plugin's, and locked", async () => {
    ctx.adapter.selectOne.mockResolvedValue(null);
    ctx.adapter.insert.mockResolvedValue(dbRow({ source: PLUGIN }));

    await ctx.service.syncCodeFirstComponents([declared({ source: PLUGIN })]);

    expect(ctx.adapter.insert.mock.calls[0][1]).toMatchObject({
      source: PLUGIN,
      locked: 1,
    });
  });

  it("is left as it is by migrate, which writes a plugin's locked row as the pipeline does", async () => {
    ctx.adapter.selectOne.mockResolvedValue(dbRow({ source: PLUGIN }));
    ctx.adapter.update.mockResolvedValue([dbRow({ source: PLUGIN })]);

    const outcome = await ctx.service.writeRecordedComponent(
      declared({ source: "code", description: "Another description" }),
      { source: "code", locked: true }
    );

    expect(outcome).toBe("updated");
    expect(updateData(ctx)).not.toHaveProperty("source");
  });

  it("keeps a plugin's field group from a change outside code", async () => {
    ctx.adapter.selectOne.mockResolvedValue(dbRow({ source: PLUGIN }));

    await expect(
      ctx.service.updateComponent("seo", { label: "Other" }, { source: "ui" })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      publicMessage: expect.stringContaining("defined in code"),
    });
    expect(ctx.adapter.update).not.toHaveBeenCalled();
  });
});
