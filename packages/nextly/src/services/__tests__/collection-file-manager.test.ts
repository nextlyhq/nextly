// Targeted tests for CollectionFileManager.invalidateSchema(slug).
// invalidateSchema is the post-rename/drop hook the dispatcher calls
// to drop the cached runtime Drizzle schema so the next loadDynamicSchema
// rebuilds against the freshly-written `dynamic_collections.fields` JSON.

import { describe, expect, it } from "vitest";

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
