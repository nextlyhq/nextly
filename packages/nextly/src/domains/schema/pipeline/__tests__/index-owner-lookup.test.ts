/**
 * Resolving which table a DROP INDEX targets.
 *
 * The owner used to be guessed by walking underscore prefixes of the index
 * name, which only fits Postgres's `<table>_<col>_idx` convention. Nextly
 * emits `idx_<table>_<col>`, so the walk produced `idx_dc_city`, `idx_dc`,
 * `idx` and never `dc_city` — every Nextly index failed to resolve and its
 * drop was blocked. Introspection already knows the true owner.
 */
import { describe, expect, it, vi } from "vitest";

import { buildIndexOwnerMap } from "../diff/index-util";
import { filterUnsafeStatements } from "../filter-unsafe-statements";

const snapshot = {
  tables: [
    {
      name: "dc_city",
      indexes: [
        { name: "idx_dc_city_slug", columns: ["slug"], unique: false },
        { name: "my_handwritten_lookup", columns: ["name"], unique: false },
      ],
    },
    {
      name: "dc_removed",
      indexes: [
        { name: "idx_dc_removed_slug", columns: ["slug"], unique: false },
      ],
    },
  ],
};

describe("buildIndexOwnerMap", () => {
  it("maps every index to its owning table", () => {
    const owners = buildIndexOwnerMap(snapshot);
    expect(owners.get("idx_dc_city_slug")).toBe("dc_city");
    expect(owners.get("my_handwritten_lookup")).toBe("dc_city");
    expect(owners.get("idx_dc_removed_slug")).toBe("dc_removed");
  });

  it("tolerates a table with no index data", () => {
    expect(buildIndexOwnerMap({ tables: [{ name: "t" }] }).size).toBe(0);
  });
});

describe("filterUnsafeStatements with a live owner map", () => {
  it("allows dropping a Nextly-named index whose table is still desired", () => {
    // The regression: this exact statement was blocked on every db:sync,
    // because the prefix walk can never yield "dc_city" from this name.
    const out = filterUnsafeStatements(
      ['DROP INDEX "idx_dc_city_slug";'],
      ["dc_city"],
      buildIndexOwnerMap(snapshot)
    );
    expect(out).toHaveLength(1);
  });

  it("allows dropping an index whose name follows no convention at all", () => {
    const out = filterUnsafeStatements(
      ['DROP INDEX "my_handwritten_lookup";'],
      ["dc_city"],
      buildIndexOwnerMap(snapshot)
    );
    expect(out).toHaveLength(1);
  });

  it("still blocks an index whose owning table is NOT desired", () => {
    // The guard must keep working: dc_removed is gone from the desired
    // schema, so dropping its index is an orphan drop, not a safe one.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = filterUnsafeStatements(
      ['DROP INDEX "idx_dc_removed_slug";'],
      ["dc_city"],
      buildIndexOwnerMap(snapshot)
    );
    expect(out).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back to the name walk when no owner map is supplied", () => {
    // fresh-push has no snapshot; the Postgres-suffix convention must still
    // resolve there.
    const out = filterUnsafeStatements(
      ['DROP INDEX "dc_city_slug_idx";'],
      ["dc_city"]
    );
    expect(out).toHaveLength(1);
  });

  it("falls back to the name walk for an index absent from the snapshot", () => {
    const out = filterUnsafeStatements(
      ['DROP INDEX "dc_city_title_idx";'],
      ["dc_city"],
      buildIndexOwnerMap(snapshot)
    );
    expect(out).toHaveLength(1);
  });

  it("leaves DROP SEQUENCE on the name walk, which has no snapshot equivalent", () => {
    const out = filterUnsafeStatements(
      ['DROP SEQUENCE "dc_city_id_seq";'],
      ["dc_city"],
      buildIndexOwnerMap(snapshot)
    );
    expect(out).toHaveLength(1);
  });
});
