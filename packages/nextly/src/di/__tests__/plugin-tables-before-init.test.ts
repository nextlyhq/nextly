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

/**
 * A plugin owning one `notes` table, before and after an upgrade that adds a
 * nullable `title` with an index (and, when `required`, a NOT NULL `slug`
 * with no default). Its `init` records which new columns exist, and writes
 * `title` when asked to.
 */
function notesPlugin(opts: {
  withTitle: boolean;
  required?: boolean;
  seedRow?: boolean;
  adapter?: Awaited<ReturnType<typeof adapterFor>>;
  written?: string[];
  seen?: Record<string, boolean>;
}): PluginDefinition {
  const columns = {
    id: col.id(),
    ...(opts.withTitle ? { title: col.text({ nullable: true }) } : {}),
    ...(opts.required ? { slug: col.text() } : {}),
  };
  return {
    name: "@acme/notes",
    version: opts.withTitle ? "2.0.0" : "1.0.0",
    nextly: "*",
    contributes: {
      schema: {
        tables: [
          defineTable(
            "notes",
            columns,
            opts.withTitle ? { indexes: [{ columns: ["title"] }] } : {}
          ),
        ],
      },
    },
    init: async () => {
      const [spec] = getActiveExtensionSchema("sqlite")?.specs ?? [];
      if (!spec) throw new Error("the notes table was not compiled");
      const adapter = opts.adapter;
      if (!adapter) return;
      if (opts.seedRow) await adapter.insert(spec.name, { id: "existing" });
      if (opts.seen) {
        const { introspectLiveSnapshot } = await import(
          "../../domains/schema/pipeline/diff/introspect-live"
        );
        const live = await introspectLiveSnapshot(
          adapter.getDrizzle(),
          "sqlite",
          [spec.name]
        );
        const names = new Set(live.tables[0]?.columns.map(c => c.name));
        opts.seen.title = names.has("title");
        opts.seen.slug = names.has("slug");
      }
      if (opts.written) {
        await adapter.insert(spec.name, { id: "n1", title: "seeded" });
        const row = await adapter.selectOne<{ title?: string }>(spec.name, {});
        opts.written.push(String(row?.title));
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

  it("finds a column its upgrade added already on its existing table", async () => {
    const file = join(dir, "nextly.db");
    // The plugin's first version, which creates the table without the column.
    await registerServices({
      adapter: await adapterFor(file),
      plugins: [notesPlugin({ withTitle: false })],
    } as unknown as Parameters<typeof registerServices>[0]);
    await shutdownServices();

    // The upgrade adds a column and an index, and its `init` writes the
    // column: it failed the boot when only missing tables were created.
    const adapter = await adapterFor(file);
    const written: string[] = [];
    await registerServices({
      adapter,
      plugins: [notesPlugin({ withTitle: true, adapter, written })],
    } as unknown as Parameters<typeof registerServices>[0]);

    expect(written).toEqual(["seeded"]);
  });

  it("leaves a table with a change that needs a decision to the push", async () => {
    // A column existing rows cannot satisfy (NOT NULL, no default) is the
    // push's to prompt for, so this pass adds nothing to that table — not
    // even the nullable column beside it.
    const file = join(dir, "nextly.db");
    const first = await adapterFor(file);
    await registerServices({
      adapter: first,
      plugins: [
        notesPlugin({ withTitle: false, seedRow: true, adapter: first }),
      ],
    } as unknown as Parameters<typeof registerServices>[0]);
    await shutdownServices();

    const adapter = await adapterFor(file);
    const seen: Record<string, boolean> = {};
    await registerServices({
      adapter,
      plugins: [
        notesPlugin({ withTitle: true, required: true, adapter, seen }),
      ],
    } as unknown as Parameters<typeof registerServices>[0]);

    expect(seen).toEqual({ title: false, slug: false });
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
});
