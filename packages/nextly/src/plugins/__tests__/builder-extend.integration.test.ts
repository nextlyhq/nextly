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

import {
  seedBuilderCollection,
  seedBuilderComponent,
  seedBuilderSingle,
} from "./seed-builder-entity";

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

/** Bare in-memory SQLite adapter (no system tables yet). */
async function freshAdapter(): Promise<
  Awaited<ReturnType<typeof createAdapter>>
> {
  process.env.DB_DIALECT = "sqlite";
  return createAdapter({
    type: "sqlite",
    memory: true,
  } as Parameters<typeof createAdapter>[0]);
}

/**
 * Fresh in-memory SQLite adapter with the system tables already created via
 * `ensureFirstRunSetup`. Lets a single-boot test seed a UI **collection**
 * before boot (the collection registry inserts via direct Drizzle refs, so it
 * needs no table resolver). Singles/components seed two-phase instead — their
 * registry services insert through the resolver, which only a boot sets up.
 */
async function seededAdapter(): Promise<
  Awaited<ReturnType<typeof createAdapter>>
> {
  const adapter = await freshAdapter();
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

type StoredField = {
  name: string;
  source?: string;
  owner?: string;
  locked?: boolean;
};

/** Parsed `fields` JSON for a row in one of the dynamic_* registry tables. */
async function registryFieldsIn(
  adapter: Awaited<ReturnType<typeof createAdapter>>,
  table: "dynamic_collections" | "dynamic_singles" | "dynamic_components",
  slug: string
): Promise<StoredField[]> {
  const rows = await adapter.executeQuery<{ fields: string }>(
    `SELECT fields FROM ${table} WHERE slug='${slug}'`
  );
  return JSON.parse(rows[0].fields);
}

/** Parsed `fields` JSON for a Builder collection row. */
async function registryFields(
  adapter: Awaited<ReturnType<typeof createAdapter>>,
  slug: string
): Promise<StoredField[]> {
  return registryFieldsIn(adapter, "dynamic_collections", slug);
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

  it("reads/writes the materialised plugin field via the runtime services (round-trip)", async () => {
    const adapter = await seededAdapter();
    await seedBuilderCollection(adapter, {
      slug: "articles",
      fields: [{ name: "body", type: "text", source: "ui" }],
    });

    handle = await createTestNextly({
      adapter,
      plugins: [seoPlugin(["articles"])],
    });

    // The runtime Drizzle table was re-registered with the merged fields, so a
    // write/read through the direct API round-trips the plugin column.
    const created = await handle.nextly.create({
      collection: "articles",
      data: { title: "T", body: "hello", meta_title: "My Meta" },
    });
    const id = (created.item as { id: string }).id;
    const got = await handle.nextly.findByID({ collection: "articles", id });
    expect((got as { meta_title?: string } | null)?.meta_title).toBe("My Meta");
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

describe("plugin extend → UI-Builder single + component parity", () => {
  // Two-phase: boot once (no plugins) so the table resolver is set, seed the
  // UI single/component through its registry service, reset DI without dropping
  // the in-memory DB, then boot with the plugin so reconcile materialises.
  it("materialises the plugin field onto a UI-Builder single", async () => {
    const adapter = await freshAdapter();
    handle = await createTestNextly({ adapter });
    await seedBuilderSingle(adapter, {
      slug: "settings",
      fields: [{ name: "body", type: "text", source: "ui" }],
    });
    clearServices();

    handle = await createTestNextly({
      adapter,
      plugins: [seoPlugin(["settings"])],
    });

    expect(await columnsOf(adapter, "single_settings")).toContain("meta_title");
    const fields = await registryFieldsIn(
      adapter,
      "dynamic_singles",
      "settings"
    );
    expect(fields.find(f => f.name === "meta_title")).toMatchObject({
      source: "plugin",
      locked: true,
    });
  });

  it("materialises the plugin field onto a UI-Builder component", async () => {
    const adapter = await freshAdapter();
    handle = await createTestNextly({ adapter });
    await seedBuilderComponent(adapter, {
      slug: "hero",
      fields: [{ name: "body", type: "text", source: "ui" }],
    });
    clearServices();

    handle = await createTestNextly({
      adapter,
      plugins: [seoPlugin(["hero"])],
    });

    expect(await columnsOf(adapter, "comp_hero")).toContain("meta_title");
    const fields = await registryFieldsIn(
      adapter,
      "dynamic_components",
      "hero"
    );
    expect(fields.find(f => f.name === "meta_title")).toMatchObject({
      source: "plugin",
      locked: true,
    });
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

describe("plugin removal → orphan column (P8 §7, data-safe)", () => {
  it("drops the field from the registry but keeps the column + data when the plugin is removed", async () => {
    const adapter = await seededAdapter();
    await seedBuilderCollection(adapter, {
      slug: "articles",
      fields: [{ name: "body", type: "text", source: "ui" }],
    });

    // Boot WITH the plugin → materialise meta_title, then write a value.
    handle = await createTestNextly({
      adapter,
      plugins: [seoPlugin(["articles"])],
    });
    await adapter.executeQuery(
      `INSERT INTO dc_articles (id, title, slug, body, meta_title) VALUES ('1', 'T', 'article-1', 'hello', 'my meta')`
    );

    // Re-boot WITHOUT the plugin (same in-memory DB; do not disconnect).
    clearServices();
    handle = await createTestNextly({ adapter, plugins: [] });

    // (a) the registry row no longer lists the plugin field
    const fields = await registryFields(adapter, "articles");
    expect(fields.some(f => f.name === "meta_title")).toBe(false);

    // (b) the physical column is kept (orphaned, never dropped)
    expect(await columnsOf(adapter, "dc_articles")).toContain("meta_title");

    // (c) the previously-written value is intact
    const rows = await adapter.executeQuery<{ meta_title: string }>(
      `SELECT meta_title FROM dc_articles WHERE id='1'`
    );
    expect(rows[0].meta_title).toBe("my meta");
  });
});

describe("plugin relation → UI-Builder collection", () => {
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
