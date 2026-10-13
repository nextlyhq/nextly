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

import {
  checkRelationsBeforePlugins,
  runBootTimeApplyIfDev,
} from "../boot-apply";

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

describe("checkRelationsBeforePlugins", () => {
  it("refuses where the boot refuses", () => {
    expect(() =>
      checkRelationsBeforePlugins(registryWithAMisspelledRelation(), {
        refuse: true,
        warn: () => {},
      })
    ).toThrow(
      expect.objectContaining({ code: "NEXTLY_SCHEMA_RELATION_UNRESOLVED" })
    );
  });

  it("in development reports the relation by name, and leaves the others queryable", () => {
    // A plugin's `init` runs next and may query relationally: it must reach
    // the relations that resolve, not fail on the one just reported.
    const registry = registryWithAMisspelledRelation();
    registry.registerDynamicSchema(
      "cf__notes",
      sqliteTable("cf__notes", { id: text("id").primaryKey() })
    );
    const warnings: string[] = [];

    checkRelationsBeforePlugins(registry, {
      refuse: false,
      warn: message => warnings.push(message),
    });

    expect(warnings.join("\n")).toContain('The relation "post" on "cf__refs"');
    expect(() => registry.getRelations()).not.toThrow();
    expect(Object.keys(registry.getRelations())).toContain("cf__notes");
  });

  it("does not swallow anything but an unresolved relation", () => {
    const failing = {
      assertRelationsResolve: () => {
        throw new Error("the registry is broken");
      },
    };
    expect(() =>
      checkRelationsBeforePlugins(failing, { refuse: false, warn: () => {} })
    ).toThrow("the registry is broken");
  });
});
