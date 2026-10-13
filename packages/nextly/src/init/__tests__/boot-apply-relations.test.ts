/**
 * The development boot asks whether every relation resolves only after its
 * own steps have registered what migrations created, and reports a relation
 * it cannot resolve by name, without stopping the dev server.
 *
 * In development a Builder-made table that arrives through a migration is
 * registered by this apply, after `registerServices` returns, so this is where
 * the question can first be asked without refusing a relation to it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";

/** The order the apply's steps and the relation check ran in. */
const steps: string[] = [];
/** The registry the container hands the apply. */
let registry: { assertRelationsResolve(): void } = {
  assertRelationsResolve: () => {
    steps.push("assertRelationsResolve");
  },
};

const appAdapter = {
  dialect: "sqlite",
  getDrizzle: () => ({}),
  executeQuery: async () => [],
  tableExists: async () => true,
  disconnect: async () => {},
};

vi.mock("../../cli/utils/config-loader", () => ({
  loadConfig: async () => ({
    config: { db: { migrationsDir: "migrations" }, plugins: [] },
    deferredExtends: [],
  }),
}));
vi.mock("../../cli/commands/migrate", () => ({ migrateCore: vi.fn() }));
vi.mock("../../cli/utils/adapter", () => ({
  validateDatabaseEnv: () => ({ valid: true, errors: [] }),
}));
vi.mock("../../di/container", () => ({
  container: {
    has: () => true,
    get: (name: string) => (name === "schemaRegistry" ? registry : appAdapter),
  },
}));
vi.mock("../reload-dynamic-tables", () => ({
  reloadDynamicTables: async () => {
    steps.push("reloadDynamicTables");
  },
}));
vi.mock("../reload-config", () => ({
  reloadNextlyConfig: async () => {
    steps.push("reloadNextlyConfig");
  },
}));

import { runBootTimeApplyIfDev } from "../boot-apply";

/** A registry holding a declared table whose relation names a misspelled table. */
function registryWithAMisspelledRelation(): SchemaRegistry {
  const real = new SchemaRegistry("sqlite");
  real.registerStaticSchemas(getDialectTables("sqlite"));
  real.registerDynamicSchema(
    "cf__refs",
    sqliteTable("cf__refs", {
      id: text("id").primaryKey(),
      postId: text("post_id"),
    }),
    [{ key: "post", fromColumn: "postId", targetTable: "dc_psots" }]
  );
  return real;
}

describe("the development boot's relation check", () => {
  let root = "";

  beforeEach(() => {
    // No migrations directory, so the apply's own steps have nothing to do
    // and only their order and the check remain.
    root = mkdtempSync(join(tmpdir(), "nextly-boot-apply-relations-"));
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.stubEnv("NODE_ENV", "development");
    steps.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("asks the registry after the registry and the config are reloaded", async () => {
    registry = {
      assertRelationsResolve: () => {
        steps.push("assertRelationsResolve");
      },
    };
    await runBootTimeApplyIfDev();
    expect(steps).toEqual([
      "reloadDynamicTables",
      "reloadNextlyConfig",
      "assertRelationsResolve",
    ]);
  });

  it("names a relation it cannot resolve, and does not stop the dev server", async () => {
    registry = registryWithAMisspelledRelation();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(runBootTimeApplyIfDev()).resolves.toBeUndefined();

    const reported = warn.mock.calls.map(call => String(call[0])).join("\n");
    expect(reported).toContain('The relation "post" on "cf__refs"');
    expect(reported).toContain('"dc_psots"');
  });

  it("throws the refusal when asked to fail loudly", async () => {
    registry = registryWithAMisspelledRelation();
    vi.stubEnv("NEXTLY_BOOT_APPLY_FAIL_LOUDLY", "1");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runBootTimeApplyIfDev()).rejects.toMatchObject({
      code: "NEXTLY_SCHEMA_RELATION_UNRESOLVED",
    });
  });
});
