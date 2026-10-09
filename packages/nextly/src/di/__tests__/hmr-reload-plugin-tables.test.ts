/**
 * A plugin's tables follow an HMR reload of its config without a restart.
 *
 * Everything that reaches a plugin table reads the active extension schema
 * per call. A reload that did not recompile that schema left it describing
 * boot's tables, so a table the plugin gained in the reload was never created
 * or published, and one it dropped was still offered.
 *
 * Driven end to end on an in-memory SQLite: a real boot, the real reload with
 * only the config loader replaced (it reads `nextly.config.ts` from disk), and
 * the real push pipeline.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAdapter } from "../../database/factory";
import { getActiveExtensionSchema } from "../../domains/schema/extension/active-schema";
import { col, defineTable } from "../../domains/schema/extension/dsl";
import type { PromptDispatcher } from "../../domains/schema/pipeline/pushschema-pipeline-interfaces";
import type { PluginDefinition } from "../../plugins/plugin-context";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));

vi.mock("../../cli/utils/config-loader", () => ({
  loadConfig: async () => ({ config: loaded.config }),
  clearConfigCache: () => undefined,
}));
vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices, shutdownServices } = await import("../register");
const { reloadNextlyConfig } = await import("../../init/reload-config");

const notes = defineTable("notes", { id: col.id(), body: col.text() });
const tags = defineTable("tags", { id: col.id(), label: col.text() });

/** The plugin at one point in its life, declaring `tables`. */
function notesPlugin(
  tables: ReturnType<typeof defineTable>[]
): PluginDefinition {
  return {
    name: "@acme/notes",
    version: "1.0.0",
    nextly: "*",
    contributes: { schema: { tables } },
  } as unknown as PluginDefinition;
}

/** The SQL name of the published table the plugin authored as `authored`. */
function publishedTable(authored: string): string | undefined {
  return getActiveExtensionSchema("sqlite")?.tables.find(
    table => table.authored === authored
  )?.name;
}

/**
 * Proceeds with no renames and no resolutions: this test's reloads add and
 * drop a whole table, and whether the pipeline asks is not its subject.
 */
const confirmAll: PromptDispatcher = {
  dispatch: async () => ({
    confirmedRenames: [],
    resolutions: [],
    proceed: true,
  }),
};

afterEach(async () => {
  await shutdownServices();
  vi.unstubAllEnvs();
});

describe("plugin tables across an HMR reload", () => {
  it("creates and publishes a table the reload added, and unpublishes one it dropped", async () => {
    vi.stubEnv("DB_DIALECT", "sqlite");
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    await registerServices({
      adapter,
      plugins: [notesPlugin([notes])],
    } as unknown as Parameters<typeof registerServices>[0]);

    // Before the reload the table is not declared, so nothing publishes it.
    const kept = publishedTable("notes");
    expect(kept).toBeDefined();
    expect(publishedTable("tags")).toBeUndefined();

    loaded.config = {
      collections: [],
      plugins: [notesPlugin([notes, tags])],
    };
    await reloadNextlyConfig({ dispatcher: confirmAll });

    // Published by the reload, and created by its push: a row written to it
    // reads back.
    const added = publishedTable("tags");
    expect(added).toBeDefined();
    await adapter.executeQuery(
      `INSERT INTO "${String(added)}" ("id", "label") VALUES ('t1', 'x')`
    );
    expect(
      await adapter.executeQuery(`SELECT "id", "label" FROM "${String(added)}"`)
    ).toEqual([expect.objectContaining({ id: "t1", label: "x" })]);

    // A reload that drops the table takes it out of the published schema, so
    // nothing reading the active schema reaches it as a table the plugin
    // still has.
    loaded.config = {
      collections: [],
      plugins: [notesPlugin([notes])],
    };
    await reloadNextlyConfig({ dispatcher: confirmAll });

    expect(publishedTable("tags")).toBeUndefined();
    // The table the plugin kept is still published and still there.
    expect(publishedTable("notes")).toBe(kept);
    expect(await adapter.tableExists(String(kept))).toBe(true);
  });
});
