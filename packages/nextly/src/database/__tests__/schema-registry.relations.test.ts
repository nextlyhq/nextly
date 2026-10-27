// Tests for SchemaRegistry.getRelations() — the central drizzle v2
// relations assembly (static bundle edges + dynamic-entity edges) that
// powers `drizzle({ relations })` / `db.query`.
//
// The invalidation tests pin the second-cache variant of the
// "500s until restart" bug class: relations close over table objects,
// so a re-registered (rebuilt) table must produce a NEW assembled
// config that references the NEW table object.

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { describe, it, expect, beforeAll } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { getDialectTables } from "../index";
import { SchemaRegistry } from "../schema-registry";
import { loadDialectTables } from "../dialect-tables";

// The postgresql tables this file reads; the unit setup loads only
// the run's own dialect, as an app's adapter would.
beforeAll(async () => {
  await Promise.all(["postgresql"].map(d => loadDialectTables(d)));
});

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

    expect(Object.keys(relations.users?.relations ?? {})).toContain(
      "refreshTokens"
    );
    expect(Object.keys(relations.roles?.relations ?? {})).toContain(
      "childInherits"
    );
  });

  it("caches the assembled config between calls", () => {
    const registry = makeRegistry();
    expect(registry.getRelations()).toBe(registry.getRelations());
  });

  it("stays on the static fast path while no dynamic table is registered", () => {
    // Both hand back the dialect's prebuilt config itself, so the adapters'
    // per-relations Drizzle instance is shared rather than rebuilt.
    expect(makeRegistry().getRelations()).toBe(makeRegistry().getRelations());
  });

  it("puts a dynamic table WITHOUT edges in the query namespace", () => {
    // `db.query` is built from the tables handed to defineRelations. Returning
    // the static config because no dynamic table had an edge left every such
    // table — a plugin's, a collection's — out of `db.query` entirely.
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"));
    const relations = registry.getRelations() as unknown as RelationsShape;
    expect(Object.keys(relations)).toContain("dc_posts");
    // Static edges survive the re-assembly.
    expect(Object.keys(relations.users?.relations ?? {})).toContain(
      "refreshTokens"
    );
  });

  it("composes dynamic edges over the merged namespace", () => {
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "author", fromColumn: "authorId", targetTable: "users" },
    ]);

    const relations = registry.getRelations() as unknown as RelationsShape;

    // Static edges survive composition…
    expect(Object.keys(relations.users?.relations ?? {})).toContain(
      "refreshTokens"
    );
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

  it("builds a many edge as a many relation, joined on the target's column", () => {
    // The reference lives on the TARGET for a many-edge. Built as a one, the
    // same two columns would read a single row object instead of a list.
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_authors", makeDcTable("dc_authors"), [
      {
        key: "posts",
        kind: "many",
        fromColumn: "id",
        targetTable: "dc_posts",
        toColumn: "authorId",
      },
    ]);
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"));

    const edge = registry.getRelations().dc_authors?.relations.posts;
    expect(edge?.relationType).toBe("many");
    expect(edge?.targetTableName).toBe("dc_posts");
    expect(edge?.sourceColumns.map(column => column.name)).toEqual(["id"]);
    expect(edge?.targetColumns.map(column => column.name)).toEqual([
      "author_id",
    ]);
  });

  it("keeps an edge with no kind a one relation", () => {
    // Collections contribute edges without a kind; they are all one-edges.
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "author", fromColumn: "authorId", targetTable: "users" },
    ]);
    expect(
      registry.getRelations().dc_posts?.relations.author?.relationType
    ).toBe("one");
  });

  it("fails FAST on a many edge that names no target column, rather than joining on id", () => {
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_authors", makeDcTable("dc_authors"), [
      { key: "posts", kind: "many", fromColumn: "id", targetTable: "dc_posts" },
    ]);
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"));
    expect(() => registry.getRelations()).toThrow(NextlyError);
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
    expect(Object.keys(relations.users?.relations ?? {})).toContain(
      "refreshTokens"
    );
  });
});

describe("SchemaRegistry.assertRelationsResolve", () => {
  /** The refusal's code and the edges it names, or none when it resolved. */
  function refusalOf(registry: SchemaRegistry): {
    code?: string;
    relations?: unknown;
    logMessage?: string;
  } {
    try {
      registry.assertRelationsResolve();
      return {};
    } catch (error) {
      expect(error).toBeInstanceOf(NextlyError);
      const refusal = error as NextlyError;
      return {
        code: refusal.code,
        relations: refusal.logContext?.relations,
        logMessage: refusal.logMessage,
      };
    }
  }

  it("resolves a relation to a registered Builder-made collection, and keeps the assembly (control)", () => {
    // A Builder-made collection reaches the registry at runtime, from its
    // registry row, and no compiler ever sees it: only the registry can say
    // the relation resolves.
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_products", makeDcTable("dc_products"));
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "product", fromColumn: "title", targetTable: "dc_products" },
    ]);

    expect(refusalOf(registry)).toEqual({});
    // Kept, so the first query does not assemble a second time.
    const assembled = registry.getRelations();
    expect(assembled.dc_posts?.relations.product?.targetTableName).toBe(
      "dc_products"
    );
    expect(registry.getRelations()).toBe(assembled);
  });

  it("refuses a relation to a table that is not registered, naming the edge", () => {
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "product", fromColumn: "title", targetTable: "dc_prodcuts" },
    ]);
    const refusal = refusalOf(registry);
    expect(refusal.code).toBe("NEXTLY_SCHEMA_RELATION_UNRESOLVED");
    expect(refusal.relations).toEqual(["dc_posts.product"]);
    expect(refusal.logMessage).toContain('"dc_prodcuts"');
  });

  it("refuses a relation joining from a column its own table does not have", () => {
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "author", fromColumn: "writerId", targetTable: "users" },
    ]);
    const refusal = refusalOf(registry);
    expect(refusal.relations).toEqual(["dc_posts.author"]);
    expect(refusal.logMessage).toContain('"writerId"');
  });

  it("refuses a relation joining to a column its target does not have", () => {
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_authors", makeDcTable("dc_authors"), [
      {
        key: "posts",
        kind: "many",
        fromColumn: "id",
        targetTable: "dc_posts",
        toColumn: "writerId",
      },
    ]);
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"));
    const refusal = refusalOf(registry);
    expect(refusal.relations).toEqual(["dc_authors.posts"]);
    expect(refusal.logMessage).toContain('"writerId"');
    expect(refusal.logMessage).toContain('"dc_posts"');
  });

  it("names every edge it cannot resolve, not only the first", () => {
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "product", fromColumn: "title", targetTable: "dc_prodcuts" },
      { key: "author", fromColumn: "authorId", targetTable: "users" },
      { key: "editor", fromColumn: "editorId", targetTable: "users" },
    ]);
    expect(refusalOf(registry).relations).toEqual([
      "dc_posts.product",
      "dc_posts.editor",
    ]);
  });

  it("leaves the query path failing fast as it did, as an internal error", () => {
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "product", fromColumn: "title", targetTable: "dc_prodcuts" },
    ]);
    expect(() => registry.getRelations()).toThrow(
      expect.objectContaining({ code: "INTERNAL_ERROR" })
    );
  });
});

describe("SchemaRegistry.assertRelationsResolve, after it refuses", () => {
  function withOneBadEdge() {
    const registry = makeRegistry();
    registry.registerDynamicSchema("dc_products", makeDcTable("dc_products"));
    registry.registerDynamicSchema("dc_posts", makeDcTable("dc_posts"), [
      { key: "product", fromColumn: "title", targetTable: "dc_products" },
      { key: "ghost", fromColumn: "title", targetTable: "dc_prodcuts" },
    ]);
    return registry;
  }

  it("keeps the relations that resolve, so the query path serves them", () => {
    // Development reports the edge and carries on; every other relation has
    // to keep working, rather than each query failing on the edge named.
    const registry = withOneBadEdge();
    expect(() => registry.assertRelationsResolve()).toThrow(NextlyError);

    const relations = registry.getRelations() as unknown as RelationsShape;
    expect(Object.keys(relations.dc_posts?.relations ?? {})).toEqual([
      "product",
    ]);
  });

  it("refuses again when asked again, though an assembly is kept", () => {
    const registry = withOneBadEdge();
    expect(() => registry.assertRelationsResolve()).toThrow(NextlyError);
    expect(() => registry.assertRelationsResolve()).toThrow(
      expect.objectContaining({ code: "NEXTLY_SCHEMA_RELATION_UNRESOLVED" })
    );
  });

  it("asks afresh once a registration replaces the assembly", () => {
    // The table the edge names arrives later, as a migration's Builder table
    // does in development: the next question finds it.
    const registry = withOneBadEdge();
    expect(() => registry.assertRelationsResolve()).toThrow(NextlyError);
    registry.registerDynamicSchema("dc_prodcuts", makeDcTable("dc_prodcuts"));
    expect(() => registry.assertRelationsResolve()).not.toThrow();
  });
});
