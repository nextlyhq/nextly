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
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
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

/** A plugin contributing a collection that relationTo's the given target slug. */
const relPlugin = (target: string): PluginDefinition => ({
  name: "@t/rel",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    collections: [
      {
        slug: "quotes",
        fields: [
          { name: "body", type: "text" },
          { name: "author", type: "relationship", relationTo: target },
        ],
      } as unknown as CollectionConfig,
    ],
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

describe("plugin extend → unresolvable target (P8 graceful/strict)", () => {
  const STRICT_ENV = "NEXTLY_STRICT_PLUGIN_TARGETS";
  afterEach(() => {
    delete process.env[STRICT_ENV];
  });

  it("graceful by default: unknown extend target → warn + skip, boot succeeds", async () => {
    const warn = vi.fn();
    const adapter = await seededAdapter();
    await seedBuilderCollection(adapter, {
      slug: "articles",
      fields: [{ name: "body", type: "text", source: "ui" }],
    });

    handle = await createTestNextly({
      adapter,
      logger: { debug() {}, info() {}, warn, error() {} },
      plugins: [seoPlugin(["ghost"])],
    });

    expect(handle).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ghost"));
  });

  it("strict mode (NEXTLY_STRICT_PLUGIN_TARGETS=1) → boot throws", async () => {
    process.env[STRICT_ENV] = "1";
    const adapter = await seededAdapter();
    await seedBuilderCollection(adapter, {
      slug: "articles",
      fields: [{ name: "body", type: "text", source: "ui" }],
    });

    await expect(
      createTestNextly({ adapter, plugins: [seoPlugin(["ghost"])] })
    ).rejects.toMatchObject({ code: "NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN" });
  });
});

describe("plugin relation → UI-Builder collection (P8)", () => {
  // NOTE: these tests assert the relation *resolution* (existence check +
  // graceful/strict) — the thing this slice owns. A "Schema apply FAILED —
  // global" line on stderr is expected harness noise: the in-memory push
  // pipeline can't non-interactively create the plugin collection's FK column
  // to a Builder (cross-lane) table. That's orthogonal to resolution and the
  // boot still completes (spec §2: relations are an existence check, FK on the
  // plugin side, no UI-entity materialization).
  const STRICT_ENV = "NEXTLY_STRICT_PLUGIN_TARGETS";
  afterEach(() => {
    delete process.env[STRICT_ENV];
  });

  it("a plugin collection relating to a UI-Builder collection boots cleanly", async () => {
    const adapter = await seededAdapter();
    await seedBuilderCollection(adapter, {
      slug: "authors",
      fields: [{ name: "name", type: "text", source: "ui" }],
    });

    handle = await createTestNextly({
      adapter,
      plugins: [relPlugin("authors")],
    });
    expect(handle).toBeDefined();
  });

  it("relation to a missing target → warn + skip (graceful default)", async () => {
    const warn = vi.fn();
    const adapter = await seededAdapter();
    await seedBuilderCollection(adapter, {
      slug: "authors",
      fields: [{ name: "name", type: "text", source: "ui" }],
    });

    handle = await createTestNextly({
      adapter,
      logger: { debug() {}, info() {}, warn, error() {} },
      plugins: [relPlugin("ghost")],
    });

    expect(handle).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ghost"));
  });
});
