/**
 * A development reload on a site keeping every translatable field per language: a collection that
 * is not marked translatable keeps its translatable values in its companion across reloads,
 * rather than having them restored to its main table as a collection whose translation was turned
 * off would. Drives `reloadNextlyConfig` itself against SQLite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, number, text } from "../../config";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import { reloadNextlyConfig } from "../reload-config";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "",
    dependencies: [],
  }),
}));

const config = defineConfig({
  experimental: { perLanguageStorage: true },
  collections: [
    defineCollection({
      slug: "rlnotes",
      fields: [text({ name: "headline" }), number({ name: "views" })],
    }),
  ],
});

describe("a reload on a site keeping every translatable field per language", () => {
  let handle: TestNextly;

  beforeEach(async () => {
    handle = await createTestNextly({ perLanguageStorage: true });
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await handle?.destroy();
  });

  async function columns(table: string): Promise<string[]> {
    const snapshot = await introspectLiveSnapshot(
      handle.adapter.getDrizzle(),
      handle.adapter.dialect,
      [table]
    );
    return (
      snapshot.tables
        .find(t => t.name === table)
        ?.columns.map(column => column.name) ?? []
    );
  }

  it("keeps a collection's translatable values in its companion, reload after reload", async () => {
    loaded.config = config;
    await reloadNextlyConfig();
    expect(await columns("dc_rlnotes")).not.toContain("headline");
    expect(await columns("dc_rlnotes_locales")).toContain("headline");

    const created = await handle.nextly.create({
      collection: "rlnotes",
      data: { headline: "Kept", views: 1 },
    });
    const id = (created.item as { id: string }).id;

    // The same config again: nothing was turned off, so nothing is restored to the main table.
    await reloadNextlyConfig();
    expect(await columns("dc_rlnotes")).not.toContain("headline");
    expect(
      await handle.nextly.findByID({ collection: "rlnotes", id })
    ).toMatchObject({ headline: "Kept", views: 1 });
  });
});
