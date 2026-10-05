/**
 * A plugin's `ctx.db`, captured at `init()`, follows an HMR reload of its
 * tables without a restart.
 *
 * The surface reads its tables, owners and relations per call, from the active
 * extension schema and the registry. A reload that did not recompile that
 * schema left it describing boot's tables, so a table the plugin gained in the
 * reload was refused as undeclared and one it dropped was still offered.
 *
 * Driven end to end on an in-memory SQLite: a real boot, the real reload with
 * only the config loader replaced (it reads `nextly.config.ts` from disk), the
 * real push pipeline, and the `ctx.db` the plugin was handed at `init`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAdapter } from "../../database/factory";
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

/** The plugin at one point in its life, handing its `ctx.db` to `into`. */
function notesPlugin(
  tables: ReturnType<typeof defineTable>[],
  into: { db?: unknown }
): PluginDefinition {
  return {
    name: "@acme/notes",
    version: "1.0.0",
    nextly: "*",
    contributes: { schema: { tables } },
    init: async (ctx: { db: unknown }) => {
      into.db = ctx.db;
    },
  } as unknown as PluginDefinition;
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

type Db = {
  insert: (table: unknown, values: Record<string, unknown>) => Promise<unknown>;
  select: (table: unknown) => { all: () => Promise<unknown[]> };
};

afterEach(async () => {
  await shutdownServices();
  vi.unstubAllEnvs();
});

describe("ctx.db across an HMR reload", () => {
  it("reaches a table the reload added, through the handle taken at init", async () => {
    vi.stubEnv("DB_DIALECT", "sqlite");
    const captured: { db?: unknown } = {};
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    await registerServices({
      adapter,
      plugins: [notesPlugin([notes], captured)],
    } as unknown as Parameters<typeof registerServices>[0]);
    const db = captured.db as Db;

    // Before the reload the table is not declared, so it is refused.
    await expect(
      db.insert(tags, { id: "t1", label: "x" })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      logContext: expect.objectContaining({ reason: "table-not-declared" }),
    });

    loaded.config = {
      collections: [],
      plugins: [notesPlugin([notes, tags], {})],
    };
    await reloadNextlyConfig({ dispatcher: confirmAll });

    await db.insert(tags, { id: "t1", label: "x" });
    expect(await db.select(tags).all()).toEqual([
      expect.objectContaining({ id: "t1", label: "x" }),
    ]);

    // And a reload that drops the table takes it away from the same handle:
    // it is refused as undeclared, not reached as a table the plugin no
    // longer has.
    loaded.config = {
      collections: [],
      plugins: [notesPlugin([notes], {})],
    };
    await reloadNextlyConfig({ dispatcher: confirmAll });

    // `select` refuses when it resolves the table, before any query, so the
    // call is wrapped to observe that refusal as a rejection.
    await expect((async () => db.select(tags).all())()).rejects.toMatchObject({
      code: "FORBIDDEN",
      logContext: expect.objectContaining({ reason: "table-not-declared" }),
    });
    // The table the plugin kept is still reachable.
    await expect(db.select(notes).all()).resolves.toEqual([]);
  });
});
