/**
 * Plugin access to UI-Builder entities — end-to-end dev-push boot.
 *
 * Proves the runtime (dev-push) path now materialises a plugin `extend` onto a
 * collection that exists ONLY because the user created it in the Builder — the
 * thing that previously needed `migrate`. The harness pre-seeds a real adapter
 * with the `dynamic_collections` row + `dc_*` table (via `seedBuilderCollection`,
 * after `ensureFirstRunSetup` creates the system tables), then boots Nextly over
 * that adapter with the plugin — no `migrate` is ever run.
 */
import { afterEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../database/factory";
import { clearServices } from "../../di/register";
import { ensureFirstRunSetup } from "../../init/first-run";
import type { Logger } from "../../services/shared";
import type { PluginDefinition } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

import { seedBuilderCollection } from "./seed-builder-entity";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const textField = (name: string) => ({ name, type: "text" });

/** A minimal SEO-like plugin that extends the given target slugs with meta_title. */
const seoPlugin = (targets: string[]): PluginDefinition => ({
  name: "@t/seo",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    extend: targets.map(target => ({
      target,
      fields: [textField("meta_title")],
    })),
  },
});

/** Fresh in-memory SQLite adapter with the system tables already created. */
async function seededAdapter(): Promise<
  Awaited<ReturnType<typeof createAdapter>>
> {
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    memory: true,
  } as Parameters<typeof createAdapter>[0]);
  await ensureFirstRunSetup({ adapter, logger: silentLogger });
  return adapter;
}

/** Column names of a physical table (SQLite introspection). */
async function columnsOf(
  adapter: Awaited<ReturnType<typeof createAdapter>>,
  table: string
): Promise<string[]> {
  const rows = await adapter.executeQuery<{ name: string }>(
    `PRAGMA table_info(${table})`
  );
  return rows.map(r => r.name);
}

/** Parsed `fields` JSON for a Builder collection row. */
async function registryFields(
  adapter: Awaited<ReturnType<typeof createAdapter>>,
  slug: string
): Promise<
  Array<{ name: string; source?: string; owner?: string; locked?: boolean }>
> {
  const rows = await adapter.executeQuery<{ fields: string }>(
    `SELECT fields FROM dynamic_collections WHERE slug='${slug}'`
  );
  return JSON.parse(rows[0].fields);
}

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

describe("plugin extend → UI-Builder collection (dev-push, P8)", () => {
  it("materialises the plugin field onto the dc_ table + tags the registry row", async () => {
    const adapter = await seededAdapter();
    await seedBuilderCollection(adapter, {
      slug: "articles",
      fields: [{ name: "body", type: "text", source: "ui" }],
    });

    handle = await createTestNextly({
      adapter,
      plugins: [seoPlugin(["articles"])],
    });

    // (a) the column was materialised on the physical Builder table
    expect(await columnsOf(adapter, "dc_articles")).toContain("meta_title");

    // (b) the registry row now lists meta_title tagged as a plugin field
    const fields = await registryFields(adapter, "articles");
    const meta = fields.find(f => f.name === "meta_title");
    expect(meta).toMatchObject({ source: "plugin", locked: true });

    // (c) the user's own field survives, still source:"ui"
    expect(fields.find(f => f.name === "body")?.source).toBe("ui");
  });

  it("is idempotent — a second boot adds no duplicate column or field", async () => {
    const adapter = await seededAdapter();
    await seedBuilderCollection(adapter, {
      slug: "articles",
      fields: [{ name: "body", type: "text", source: "ui" }],
    });

    handle = await createTestNextly({
      adapter,
      plugins: [seoPlugin(["articles"])],
    });
    // Reset DI WITHOUT disconnecting the in-memory adapter (shutdownServices
    // would drop the DB), then re-boot the SAME adapter — system tables, seeded
    // row, and the already-materialised column all persist.
    clearServices();
    handle = await createTestNextly({
      adapter,
      plugins: [seoPlugin(["articles"])],
    });

    const cols = await columnsOf(adapter, "dc_articles");
    expect(cols.filter(c => c === "meta_title")).toHaveLength(1);
    const fields = await registryFields(adapter, "articles");
    expect(fields.filter(f => f.name === "meta_title")).toHaveLength(1);
  });
});
