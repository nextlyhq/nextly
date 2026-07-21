/**
 * Folding Schema-Builder collections into a config-derived desired schema.
 *
 * A desired schema built from `nextly.config.ts` alone omits every collection
 * created through the Schema Builder, and on SQLite/MySQL the diff introspects
 * the whole database, so those omissions come back as orphan DROPs.
 */
import { describe, expect, it, vi } from "vitest";

import {
  mergeRegisteredCollections,
  mergeRegisteredCollectionsSafely,
  type RegisteredCollectionRow,
} from "../registered-collections";
import type { DesiredCollection } from "../types";

function configCollection(slug: string): DesiredCollection {
  return {
    slug,
    tableName: `dc_${slug}`,
    fields: [],
  } as DesiredCollection;
}

describe("mergeRegisteredCollections", () => {
  it("keeps a registry-only collection that the config never mentions", () => {
    // The bug this exists to prevent: `db:sync` proposed dropping dc_city,
    // dc_fan and dc_test1 because they were created by clicking, not in code.
    const merged = mergeRegisteredCollections(
      { posts: configCollection("posts") },
      [{ slug: "city", tableName: "dc_city", fields: [] }]
    );

    expect(Object.keys(merged).sort()).toEqual(["city", "posts"]);
    expect(merged.city.tableName).toBe("dc_city");
  });

  it("lets the config win over a registry row for the same slug", () => {
    // Otherwise a field deleted from the config would be resurrected from the
    // registry row that still carries it, and the removal would never apply.
    const fromConfig = configCollection("posts");
    const merged = mergeRegisteredCollections({ posts: fromConfig }, [
      { slug: "posts", tableName: "dc_stale_name", fields: [{ name: "gone" }] },
    ]);

    expect(merged.posts).toBe(fromConfig);
    expect(merged.posts.tableName).toBe("dc_posts");
  });

  it("carries the localized flag so translatable columns stay in the companion table", () => {
    const merged = mergeRegisteredCollections({}, [
      { slug: "city", tableName: "dc_city", fields: [], localized: true },
    ]);
    expect(merged.city.localized).toBe(true);
  });

  it("skips rows too incomplete to diff", () => {
    const merged = mergeRegisteredCollections({}, [
      { slug: "no-table" },
      { tableName: "dc_no_slug" },
      {} as RegisteredCollectionRow,
    ]);
    expect(merged).toEqual({});
  });

  it("does not mutate the caller's config map", () => {
    const fromConfig = { posts: configCollection("posts") };
    mergeRegisteredCollections(fromConfig, [
      { slug: "city", tableName: "dc_city", fields: [] },
    ]);
    expect(Object.keys(fromConfig)).toEqual(["posts"]);
  });
});

describe("mergeRegisteredCollectionsSafely", () => {
  it("merges when the registry reads cleanly", async () => {
    const merged = await mergeRegisteredCollectionsSafely(
      { posts: configCollection("posts") },
      async () => [{ slug: "city", tableName: "dc_city", fields: [] }]
    );
    expect(Object.keys(merged).sort()).toEqual(["city", "posts"]);
  });

  it("falls back to the config schema and warns when the registry cannot be read", async () => {
    // Refusing to sync at all would be worse than syncing a subset, but the
    // consequence (Schema-Builder collections may be flagged for drop) is not
    // visible from the output unless it is said out loud.
    const warn = vi.fn();
    const merged = await mergeRegisteredCollectionsSafely(
      { posts: configCollection("posts") },
      () => Promise.reject(new Error("no such column: localized")),
      { warn }
    );

    expect(Object.keys(merged)).toEqual(["posts"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("no such column: localized");
    expect(warn.mock.calls[0][0]).toContain("flagged for drop");
  });

  it("survives an unreadable registry with no logger attached", async () => {
    await expect(
      mergeRegisteredCollectionsSafely({}, () =>
        Promise.reject(new Error("boom"))
      )
    ).resolves.toEqual({});
  });
});
