/**
 * Boot-time migrations apply the configuration this boot runs, not the one
 * its caller passed in.
 *
 * A plugin `setup` transformer may add or replace a plugin, and everything
 * else in `registerServices` — including the schema-version gate right after
 * the migrations — reads the transformed list. The migrations read the raw
 * config instead, so a transformer-added plugin's modules were never applied
 * and the gate then refused the plugin as behind.
 *
 * Driven through `registerServices` against a real in-memory SQLite, with the
 * migration runner replaced by a recorder that stops the boot once it has
 * seen its arguments: what is under test is what registration HANDS the
 * runner, and everything after that point is somebody else's test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../config";
import { createAdapter } from "../../database/factory";
import { getActiveExtensionSchema } from "../../domains/schema/extension/active-schema";
import { col, defineTable } from "../../domains/schema/extension/dsl";
import type { PluginDefinition } from "../../plugins/plugin-context";
import type { PluginMigration } from "../../domains/schema/migrate/plugin/plugin-migration";

const recorded = vi.hoisted(() => ({
  args: undefined as unknown,
}));

/** Stops the boot at the migrations, having recorded what they were given. */
class StopAtMigrations extends Error {}

vi.mock("../../init/prod-migrations", () => ({
  runProdMigrationsIfEnabled: (args: unknown) => {
    recorded.args = args;
    throw new StopAtMigrations("stopped at boot migrations");
  },
}));
vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices, shutdownServices } = await import("../register");

/** A module only the transformer-added plugin ships. */
const addedModule = {
  name: "20260101_000000_init",
  schemaVersion: 1,
  checksum: "unused-by-the-recorder",
  dialects: {
    postgresql: { up: [], down: [] },
    mysql: { up: [], down: [] },
    sqlite: { up: [], down: [] },
  },
  snapshot: {
    postgresql: { tables: [] },
    mysql: { tables: [] },
    sqlite: { tables: [] },
  },
  before: {
    postgresql: { tables: [] },
    mysql: { tables: [] },
    sqlite: { tables: [] },
  },
} satisfies PluginMigration;

const added = {
  name: "@acme/added",
  version: "1.0.0",
  nextly: "*",
  schemaVersion: 1,
  contributes: {
    schema: {
      migrations: [addedModule],
      tables: [defineTable("widgets", { id: col.id() })],
    },
    collections: [
      defineCollection({
        slug: "acme-notes",
        fields: [text({ name: "title" })],
      }),
    ],
  },
};

/** A plugin whose `setup` adds another plugin to the list. */
const transformer = {
  name: "@acme/transformer",
  version: "1.0.0",
  nextly: "*",
  setup: (config: Record<string, unknown>) => ({
    ...config,
    plugins: [...((config.plugins as unknown[]) ?? []), added],
  }),
} as unknown as PluginDefinition;

afterEach(async () => {
  recorded.args = undefined;
  await shutdownServices();
});

describe("boot migrations read the transformed configuration", () => {
  it("hands the runner a plugin a setup transformer added", async () => {
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);

    await expect(
      registerServices({
        adapter,
        plugins: [transformer],
        db: {
          runMigrationsOnBoot: true,
          migrationsDir: "./migrations",
          uiSchemaFile: "./ui-schema.json",
        },
      } as unknown as Parameters<typeof registerServices>[0])
    ).rejects.toBeInstanceOf(StopAtMigrations);

    const args = recorded.args as {
      config: {
        db: { runMigrationsOnBoot?: boolean };
        plugins: PluginDefinition[];
        collections: Array<{ slug: string }>;
      };
    };
    expect(args.config.plugins.map(p => p.name)).toContain("@acme/added");
    expect(
      args.config.plugins.find(p => p.name === "@acme/added")?.contributes
        ?.schema?.migrations
    ).toEqual([addedModule]);
    // Its contributed collection too, folded in as the rest of the boot sees
    // it: the extension schema compiled for the migrations seeds its tables
    // from this list.
    expect(args.config.collections.map(c => c.slug)).toContain("acme-notes");
    // The decision stays on the raw block.
    expect(args.config.db.runMigrationsOnBoot).toBe(true);
  });

  it("compiles the extension schema from the transformed plugin list", async () => {
    // The schema the development push and `ctx.db` read is compiled before the
    // migrations run, so the boot stopping there has already published it. A
    // table the transformer-added plugin declares must be in it, exactly as
    // production migrations and the CLI create it.
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);

    await expect(
      registerServices({
        adapter,
        plugins: [transformer],
        db: {
          runMigrationsOnBoot: true,
          migrationsDir: "./migrations",
          uiSchemaFile: "./ui-schema.json",
        },
      } as unknown as Parameters<typeof registerServices>[0])
    ).rejects.toBeInstanceOf(StopAtMigrations);

    const tables = (getActiveExtensionSchema("sqlite")?.specs ?? []).map(
      table => table.name
    );
    expect(tables.some(name => name.endsWith("widgets"))).toBe(true);
  });

  it("compiles the transformed db.schema hooks, but decides to run from the raw flag", async () => {
    // A transformer may add an app-level schema hook; the migrations compile
    // what the boot compiled. Whether to run at all stays the deployment's.
    const hook = (): void => undefined;
    const hooking = {
      name: "@acme/hooking",
      version: "1.0.0",
      nextly: "*",
      setup: (config: Record<string, unknown>) => ({
        ...config,
        db: {
          ...(config.db as Record<string, unknown>),
          runMigrationsOnBoot: false,
          schema: { extend: [hook] },
        },
      }),
    } as unknown as PluginDefinition;
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);

    await expect(
      registerServices({
        adapter,
        plugins: [hooking],
        db: {
          runMigrationsOnBoot: true,
          migrationsDir: "./migrations",
          uiSchemaFile: "./ui-schema.json",
        },
      } as unknown as Parameters<typeof registerServices>[0])
    ).rejects.toBeInstanceOf(StopAtMigrations);

    const args = recorded.args as {
      config: {
        db: { runMigrationsOnBoot?: boolean; schema?: { extend?: unknown[] } };
      };
    };
    expect(args.config.db.schema?.extend).toEqual([hook]);
    expect(args.config.db.runMigrationsOnBoot).toBe(true);
  });
});
