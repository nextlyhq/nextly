/**
 * P8 — `loadDynamicSlugs` reads the slugs of Builder/UI (and previously-synced)
 * entities from the `dynamic_*` registry tables. This is the DB half of the
 * runtime Builder-lane finalize (register.ts): plugin extend/relation targets
 * that point at Builder-made collections resolve against these slugs once the DB
 * is reachable. Real in-memory SQLite adapter.
 */
import { afterEach, describe, expect, it } from "vitest";

import { createAdapter } from "../database/factory";

import { loadDynamicSlugs } from "./load-dynamic-tables";

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

async function memoryAdapter(): Promise<TestAdapter> {
  process.env.DB_DIALECT = "sqlite";
  return createAdapter({
    type: "sqlite",
    memory: true,
  } as Parameters<typeof createAdapter>[0]);
}

describe("loadDynamicSlugs (P8)", () => {
  let adapter: TestAdapter | undefined;
  afterEach(async () => {
    await adapter?.disconnect();
    adapter = undefined;
  });

  it("collects collection slugs (for relations) and all entity slugs (for extends)", async () => {
    adapter = await memoryAdapter();
    await adapter.executeQuery("CREATE TABLE dynamic_collections (slug TEXT)");
    await adapter.executeQuery("CREATE TABLE dynamic_singles (slug TEXT)");
    await adapter.executeQuery("CREATE TABLE dynamic_components (slug TEXT)");
    await adapter.executeQuery(
      "INSERT INTO dynamic_collections (slug) VALUES ('pages'), ('authors')"
    );
    await adapter.executeQuery(
      "INSERT INTO dynamic_singles (slug) VALUES ('site-config')"
    );
    await adapter.executeQuery(
      "INSERT INTO dynamic_components (slug) VALUES ('hero')"
    );

    const slugs = await loadDynamicSlugs(adapter);

    // Only collections are valid relationTo targets.
    expect([...slugs.collections].sort()).toEqual(["authors", "pages"]);
    // Any dynamic entity is a valid extend target.
    expect([...slugs.all].sort()).toEqual([
      "authors",
      "hero",
      "pages",
      "site-config",
    ]);
  });

  it("returns empty sets on a fresh DB where the dynamic tables don't exist", async () => {
    adapter = await memoryAdapter();
    const slugs = await loadDynamicSlugs(adapter);
    expect(slugs.all.size).toBe(0);
    expect(slugs.collections.size).toBe(0);
  });
});
