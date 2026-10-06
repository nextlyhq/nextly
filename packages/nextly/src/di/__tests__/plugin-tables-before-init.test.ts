/**
 * In development, a plugin's own tables exist before its `init()` runs, on a
 * database that was set up before the plugin was added.
 *
 * First-run creates every extension table, but only on a FRESH database, and
 * the development push that creates them otherwise runs after
 * `registerServices` returns — after `initializePlugins`. So a plugin added to
 * an existing installation whose `init` seeds its own table failed the boot,
 * and the push that would have created the table never ran.
 *
 * Two boots against one file-backed SQLite: the first without the plugin sets
 * the database up, the second adds it. What `init` sees is recorded from
 * inside `init`, which is the moment the defect was about.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdapter } from "../../database/factory";
import { getActiveExtensionSchema } from "../../domains/schema/extension/active-schema";
import { SchemaOwnersRepository } from "../../domains/schema/ownership/schema-owners-repository";
import { col, defineTable } from "../../domains/schema/extension/dsl";
import type { PluginDefinition } from "../../plugins/plugin-context";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices, shutdownServices } = await import("../register");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-plugin-init-"));
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DB_DIALECT", "sqlite");
});

afterEach(async () => {
  await shutdownServices();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function adapterFor(file: string) {
  return createAdapter({
    type: "sqlite",
    url: `file:${file}`,
  } as Parameters<typeof createAdapter>[0]);
}

/** A plugin whose `init` records whether each of its compiled tables exists. */
function seedingPlugin(
  adapter: { tableExists: (name: string) => Promise<boolean> },
  seen: Record<string, boolean>
): PluginDefinition {
  return {
    name: "@acme/seeding",
    version: "1.0.0",
    nextly: "*",
    contributes: {
      schema: { tables: [defineTable("notes", { id: col.id() })] },
    },
    init: async () => {
      // The table names as compiled, read from the published schema rather
      // than spelled here, so the prefix rule is not restated.
      for (const spec of getActiveExtensionSchema("sqlite")?.specs ?? []) {
        seen[spec.name] = await adapter.tableExists(spec.name);
      }
    },
  } as unknown as PluginDefinition;
}

/** First boot without the plugin: sets the database up, as an earlier session did. */
async function setUpWithoutPlugin(file: string): Promise<void> {
  await registerServices({
    adapter: await adapterFor(file),
  } as unknown as Parameters<typeof registerServices>[0]);
  await shutdownServices();
}

describe("a plugin added to an existing development database", () => {
  it("finds its own table already created when its init runs", async () => {
    const file = join(dir, "nextly.db");
    await setUpWithoutPlugin(file);

    const adapter = await adapterFor(file);
    const seen: Record<string, boolean> = {};
    await registerServices({
      adapter,
      plugins: [seedingPlugin(adapter, seen)],
    } as unknown as Parameters<typeof registerServices>[0]);

    // The mechanism was reached: the plugin's table was compiled...
    expect(Object.keys(seen)).toHaveLength(1);
    // ...and existed by the time its init ran.
    expect(Object.values(seen)).toEqual([true]);
  });

  it("creates nothing when boot apply is switched off", async () => {
    // `NEXTLY_DISABLE_BOOT_APPLY=1` stops the development push; the same
    // opt-out has to stop this creation too, or the push is off in name only.
    const file = join(dir, "nextly.db");
    await setUpWithoutPlugin(file);
    vi.stubEnv("NEXTLY_DISABLE_BOOT_APPLY", "1");

    const adapter = await adapterFor(file);
    const seen: Record<string, boolean> = {};
    await registerServices({
      adapter,
      plugins: [seedingPlugin(adapter, seen)],
    } as unknown as Parameters<typeof registerServices>[0]);

    expect(Object.values(seen)).toEqual([false]);
  });

  it("does not recreate the tables of a plugin an uninstall removed", async () => {
    // The uninstalled-plugin refusal promises that a development boot will not
    // put back what an uninstall deliberately removed. It has to hold before
    // anything is created, not only by refusing afterwards.
    const file = join(dir, "nextly.db");
    const first = await adapterFor(file);
    await registerServices({
      adapter: first,
      plugins: [seedingPlugin(first, {})],
    } as unknown as Parameters<typeof registerServices>[0]);
    const [table] = (getActiveExtensionSchema("sqlite")?.specs ?? []).map(
      spec => spec.name
    );
    expect(table).toBeDefined();
    // What `plugins uninstall` leaves: the table dropped, and the plugin's
    // owner row marked uninstalled.
    await first.executeQuery(`DROP TABLE "${table}"`);
    await new SchemaOwnersRepository(first.getDrizzle(), "sqlite").upsert([
      {
        tableName: table,
        ownerKind: "plugin",
        ownerId: "@acme/seeding",
        migratedBy: "plugin:@acme/seeding",
        ownerVersion: "1.0.0",
        schemaVersion: null,
        state: "uninstalled",
      },
    ]);
    await shutdownServices();

    const adapter = await adapterFor(file);
    await expect(
      registerServices({
        adapter,
        plugins: [seedingPlugin(adapter, {})],
      } as unknown as Parameters<typeof registerServices>[0])
    ).rejects.toThrow(/uninstalled/);
    expect(await adapter.tableExists(table)).toBe(false);
    await adapter.disconnect();
  });
});
