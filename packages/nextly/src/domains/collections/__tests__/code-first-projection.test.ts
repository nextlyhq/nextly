/**
 * The registry-sync payload every route builds for a code-first collection.
 *
 * Boot, HMR reload and `db:sync` share `toCodeFirstCollectionConfig`, so what
 * it projects is what the registry row records on all three. Two values are
 * pinned here because leaving them undefined changed what the row said:
 *
 * - the table name is the one the schema pipeline creates, from
 *   `resolveCollectionTableName`, including for slugs whose `-`/`_` runs the
 *   registry's own normalisation would collapse;
 * - `timestamps` defaults to true, so an update writes the default instead of
 *   keeping whatever an earlier config stored.
 */
import { describe, expect, it } from "vitest";

import { resolveCollectionTableName } from "../../schema/utils/resolve-table-name";
import { toCodeFirstCollectionConfig } from "../services/collection-sync-service";

describe("the code-first registry projection", () => {
  it.each([
    ["posts", undefined],
    ["blog-posts", undefined],
    ["a__b", undefined],
    ["tags-", undefined],
    ["posts", "legacy_posts"],
    ["posts", "dc_legacy"],
  ])("names the pipeline's table for %s (dbName %s)", (slug, dbName) => {
    const projected = toCodeFirstCollectionConfig({ slug, fields: [], dbName });
    expect(projected.tableName).toBe(resolveCollectionTableName(slug, dbName));
  });

  it("keeps the runs of - and _ the pipeline keeps", () => {
    expect(
      toCodeFirstCollectionConfig({ slug: "a__b", fields: [] }).tableName
    ).toBe("dc_a__b");
  });

  it("defaults timestamps to true, and keeps an explicit false", () => {
    expect(
      toCodeFirstCollectionConfig({ slug: "a", fields: [] }).timestamps
    ).toBe(true);
    expect(
      toCodeFirstCollectionConfig({ slug: "a", fields: [], timestamps: false })
        .timestamps
    ).toBe(false);
  });
});
