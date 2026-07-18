// Targeted tests for CollectionFileManager.invalidateSchema(slug).
// invalidateSchema is the post-rename/drop hook the dispatcher calls
// to drop the cached runtime Drizzle schema so the next loadDynamicSchema
// rebuilds against the freshly-written `dynamic_collections.fields` JSON.

import { describe, expect, it } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { CollectionFileManager } from "../collection-file-manager";
import type { DatabaseInstance } from "../../types/database-operations";

function makeFileManager(): CollectionFileManager {
  // The methods under test only touch the in-memory schemaRegistry,
  // so a stub db is sufficient.
  return new CollectionFileManager({} as DatabaseInstance, {
    schemasDir: "/tmp/test-schemas",
    migrationsDir: "/tmp/test-migrations",
  });
}

describe("CollectionFileManager.loadCompanionSchema (i18n M4)", () => {
  function localizedFm(): CollectionFileManager {
    const fm = makeFileManager();
    fm.setAdapter({ dialect: "sqlite" } as unknown as DrizzleAdapter);
    fm.setMetadataFetcher(async () => ({
      fields: [
        { name: "body", type: "longText", localized: true },
        { name: "price", type: "number" },
      ] as never,
      tableName: "dc_pages",
      localized: true,
    }));
    return fm;
  }

  it("returns the companion table + localized field names for a localized collection", async () => {
    const companion = await localizedFm().loadCompanionSchema("pages");
    expect(companion).not.toBeNull();
    expect(companion!.companionTableName).toBe("dc_pages_locales");
    expect(companion!.localizedFields).toEqual([{ name: "body", column: "body" }]);
    expect(companion!.table).toBeDefined();
  });

  it("caches the companion table (same object on the second call)", async () => {
    const fm = localizedFm();
    const first = await fm.loadCompanionSchema("pages");
    const second = await fm.loadCompanionSchema("pages");
    expect(first!.table).toBe(second!.table);
  });

  it("returns null for a non-localized collection", async () => {
    const fm = makeFileManager();
    fm.setAdapter({ dialect: "sqlite" } as unknown as DrizzleAdapter);
    fm.setMetadataFetcher(async () => ({
      fields: [{ name: "price", type: "number" }] as never,
      tableName: "dc_pages",
      localized: false,
    }));
    expect(await fm.loadCompanionSchema("pages")).toBeNull();
  });
});

describe("CollectionFileManager.invalidateSchema", () => {
  it("removes a previously registered schema so loadDynamicSchema can no longer return it from cache", async () => {
    const fm = makeFileManager();

    fm.registerSchemas({ dc_job: { __marker: "old" } });

    // Confirm cache is warm.
    const cached = await fm.loadDynamicSchema("job");
    expect(cached).toEqual({ __marker: "old" });

    fm.invalidateSchema("job");

    // No adapter / metadataFetcher set, so a cache miss now throws
    // the "not found in registry" guard. That is the correct signal
    // that invalidation cleared the entry.
    await expect(fm.loadDynamicSchema("job")).rejects.toThrow(
      /not found in registry/
    );
  });

  it("uses the same dc_<slug> key shape registerSchema uses (hyphens collapsed to underscores)", async () => {
    const fm = makeFileManager();

    // Register under hyphen-collapsed key the same way registerSchema does.
    fm.registerSchemas({ dc_blog_posts: { __marker: "registered" } });

    // Confirm hyphen-form slug resolves to the same key.
    const cached = await fm.loadDynamicSchema("blog-posts");
    expect(cached).toEqual({ __marker: "registered" });

    fm.invalidateSchema("blog-posts");

    await expect(fm.loadDynamicSchema("blog-posts")).rejects.toThrow(
      /not found in registry/
    );
  });

  it("is a no-op when the slug was never registered (does not throw)", () => {
    const fm = makeFileManager();
    expect(() => fm.invalidateSchema("never-registered")).not.toThrow();
  });

  it("only invalidates the targeted slug — unrelated entries stay cached", async () => {
    const fm = makeFileManager();

    fm.registerSchemas({
      dc_job: { __marker: "job" },
      dc_event: { __marker: "event" },
    });

    fm.invalidateSchema("job");

    // job evicted, event still cached.
    await expect(fm.loadDynamicSchema("job")).rejects.toThrow(
      /not found in registry/
    );
    expect(await fm.loadDynamicSchema("event")).toEqual({ __marker: "event" });
  });
});
