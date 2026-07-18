/**
 * Versions-config persistence tests for SingleRegistryService.
 *
 * Locks the contract that the resolved content-versioning config round-trips
 * through the registry:
 *  - registerSingle JSON-serializes `data.versions` into the `versions` column
 *    (null when unversioned).
 *  - updateSingle writes the new `data.versions` when defined and leaves the
 *    column untouched when undefined.
 *  - deserializeRecord parses the stored JSON back into a config object.
 *
 * Without these, the mutation service cannot read `collection.versions` back to
 * decide whether to capture a version snapshot on write.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { resolveVersionsConfig } from "../../versions/resolve-config";
import { SingleRegistryService } from "../services/single-registry-service";

import { createMockAdapter, createSilentLogger } from "./single-test-helpers";

function createCtx() {
  const adapter = createMockAdapter();
  const logger = createSilentLogger();
  const service = new SingleRegistryService(
    adapter as unknown as Parameters<typeof SingleRegistryService>[0],
    logger
  );
  return { service, adapter };
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
    fields: JSON.stringify([]),
    admin: null,
    access_rules: null,
    source: "code",
    locked: 1,
    status: 0,
    versions: null,
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

// A real resolved config so the test exercises the shape the mutation service
// actually reads, not a hand-rolled stand-in.
const resolved = resolveVersionsConfig(true);

describe("SingleRegistryService.registerSingle — versions persistence", () => {
  let ctx: ReturnType<typeof createCtx>;

  beforeEach(() => {
    ctx = createCtx();
  });

  it("JSON-serializes data.versions into the versions column", async () => {
    ctx.adapter.selectOne.mockResolvedValue(null);
    ctx.adapter.insert.mockResolvedValue(dbRow());

    await ctx.service.registerSingle({
      slug: "site-settings",
      label: "Site Settings",
      tableName: "single_site_settings",
      fields: [],
      source: "code",
      schemaHash: "hash-1",
      versions: resolved,
    });

    const row = ctx.adapter.insert.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof row.versions).toBe("string");
    expect(JSON.parse(row.versions as string)).toEqual(resolved);
  });

  it("writes null when versions is undefined (unversioned)", async () => {
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

    const row = ctx.adapter.insert.mock.calls[0][1] as Record<string, unknown>;
    expect(row.versions).toBeNull();
  });
});

describe("SingleRegistryService.updateSingle — versions persistence", () => {
  let ctx: ReturnType<typeof createCtx>;

  beforeEach(() => {
    ctx = createCtx();
  });

  function mockSelectOne(singleRow: Record<string, unknown> | null) {
    ctx.adapter.selectOne.mockImplementation(async (table: string) => {
      if (table === "dynamic_singles") return singleRow;
      return null;
    });
  }

  it("writes the serialized versions when the caller provides it", async () => {
    mockSelectOne(dbRow({ locked: 0 }));
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    await ctx.service.updateSingle("site-settings", { versions: resolved });

    const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(JSON.parse(updateData.versions as string)).toEqual(resolved);
  });

  it("writes null when the caller explicitly disables versioning", async () => {
    mockSelectOne(dbRow({ locked: 0, versions: JSON.stringify(resolved) }));
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    await ctx.service.updateSingle("site-settings", { versions: null });

    const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(updateData.versions).toBeNull();
  });

  it("omits versions from the update when the caller does not send it", async () => {
    mockSelectOne(dbRow({ locked: 0 }));
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    await ctx.service.updateSingle("site-settings", { label: "New Label" });

    const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect("versions" in updateData).toBe(false);
  });
});

describe("SingleRegistryService — versions read-back", () => {
  it("parses the stored JSON config on getSingleBySlug", async () => {
    const ctx = createCtx();
    ctx.adapter.selectOne.mockImplementation(async (table: string) =>
      table === "dynamic_singles"
        ? dbRow({ versions: JSON.stringify(resolved) })
        : null
    );

    const record = await ctx.service.getSingleBySlug("site-settings");
    expect(record?.versions).toEqual(resolved);
  });

  it("returns null versions for an unversioned single", async () => {
    const ctx = createCtx();
    ctx.adapter.selectOne.mockImplementation(async (table: string) =>
      table === "dynamic_singles" ? dbRow({ versions: null }) : null
    );

    const record = await ctx.service.getSingleBySlug("site-settings");
    expect(record?.versions).toBeNull();
  });
});
