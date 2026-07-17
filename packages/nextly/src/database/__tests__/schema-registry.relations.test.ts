// Tests for SchemaRegistry.getRelations() — the central drizzle v2
// relations assembly (static bundle edges + dynamic-entity edges) that
// powers `drizzle({ relations })` / `db.query`.
//
// The invalidation tests pin the second-cache variant of the
// "500s until restart" bug class: relations close over table objects,
// so a re-registered (rebuilt) table must produce a NEW assembled
// config that references the NEW table object.

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { describe, it, expect } from "vitest";

import { getDialectTables } from "../index";
import { SchemaRegistry } from "../schema-registry";

function makeRegistry() {
  const registry = new SchemaRegistry("sqlite");
  registry.registerStaticSchemas(getDialectTables("sqlite"));
  return registry;
}

function makeDcTable(name: string) {
  return sqliteTable(name, {
    id: text("id").primaryKey(),
    title: text("title"),
    authorId: integer("author_id"),
  });
}

type RelationsShape = Record<string, { relations?: Record<string, unknown> }>;

describe("SchemaRegistry.getRelations", () => {
  it("returns the static bundle relations when no dynamic edges exist", () => {
    const registry = makeRegistry();
    const relations = registry.getRelations() as unknown as RelationsShape;

    expect(Object.keys(relations.users?.relations ?? {})).toContain("sessions");
    expect(Object.keys(relations.roles?.relations ?? {})).toContain(
      "childInherits"
    );
  });

  it("caches the assembled config between calls", () => {
    const registry = makeRegistry();
    expect(registry.getRelations()).toBe(registry.getRelations());
  });

  it("stays on the static fast path when dynamic tables register WITHOUT edges", () => {
    const registry = makeRegistry();
    const staticRelations = registry.getRelations();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"));
    // Cache invalidated but re-assembly lands back on the prebuilt object.
    expect(registry.getRelations()).toBe(staticRelations);
  });

  it("composes dynamic edges over the merged namespace", () => {
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "author", fromColumn: "authorId", targetTable: "users" },
    ]);

    const relations = registry.getRelations() as unknown as RelationsShape;

    // Static edges survive composition…
    expect(Object.keys(relations.users?.relations ?? {})).toContain("sessions");
    // …and the dynamic table gained its edge.
    expect(Object.keys(relations.dc_posts?.relations ?? {})).toEqual([
      "author",
    ]);
  });

  it("invalidates and re-assembles when a dynamic table is re-registered (rebuilt table object)", () => {
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "author", fromColumn: "authorId", targetTable: "users" },
    ]);
    const before = registry.getRelations();

    // Simulate the pipeline rebuilding the table after a schema change.
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "author", fromColumn: "authorId", targetTable: "users" },
    ]);
    const after = registry.getRelations();

    expect(after).not.toBe(before);
    expect(
      Object.keys(
        (after as unknown as RelationsShape).dc_posts?.relations ?? {}
      )
    ).toEqual(["author"]);
  });

  it("fails FAST when an edge references an unregistered target table", () => {
    // The assembled relations are cached, so a silently-skipped edge would
    // surface far away at query time — malformed registration metadata must
    // throw at assembly instead.
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "ghost", fromColumn: "authorId", targetTable: "not_a_table" },
    ]);
    expect(() => registry.getRelations()).toThrow();
  });

  it("fails FAST when an edge references an unknown column", () => {
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "author", fromColumn: "no_such_column", targetTable: "users" },
    ]);
    expect(() => registry.getRelations()).toThrow();
  });

  it("clear() drops dynamic edges and returns to the static fast path", () => {
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "author", fromColumn: "authorId", targetTable: "users" },
    ]);
    registry.getRelations();
    registry.clear();

    const relations = registry.getRelations() as unknown as RelationsShape;
    expect(relations.dc_posts).toBeUndefined();
    expect(Object.keys(relations.users?.relations ?? {})).toContain("sessions");
  });
});
