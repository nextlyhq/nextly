/**
 * A declared relation, queried through the real relational API.
 *
 * The chain under test is the whole C5 surface: the DSL declares a ref
 * column, the compiler emits the table and its auto one-edge, the registry
 * composes the edge into the schema-wide relations config, the adapter
 * builds the RQB instance from it, and a `with` query on a REAL database
 * returns the nested row. Anything weaker — a fake db, a hand-built
 * relations object — would prove the types line up, not that a plugin's
 * query works.
 *
 * @module domains/schema/extension/__tests__/relations-roundtrip.integration
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";

import { getDialectTables } from "../../../../database/index";
import { SchemaRegistry } from "../../../../database/schema-registry";

import { buildExtensionSchema } from "../build-extension-schema";
import { col, defineTable } from "../dsl";

const TEST_DB_DIR = mkdtempSync(join(tmpdir(), "nx-relations-"));
const TEST_DB_URL = `${TEST_DB_DIR}/relations.db`;

describe("extension relations round-trip (sqlite)", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let registry: SchemaRegistry;

  beforeAll(async () => {
    adapter = createSqliteAdapter({ url: TEST_DB_URL });
    await adapter.connect();

    const owners = defineTable("owners", {
      id: col.id(),
      label: col.shortText(),
    });
    const linked = defineTable("linked", {
      id: col.id(),
      ownerId: col.ref("fx__owners"),
    });
    const built = await buildExtensionSchema({
      dialect: "sqlite" as const,
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        {
          owner: { kind: "plugin" as const, id: "fx" },
          tables: [owners, linked],
        },
      ],
    });

    // The tables physically, matching the compiled specs.
    await adapter.executeQuery(
      `CREATE TABLE fx__owners (id TEXT PRIMARY KEY, label TEXT NOT NULL)`
    );
    await adapter.executeQuery(
      `CREATE TABLE fx__linked (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL)`
    );
    await adapter.executeQuery(
      `INSERT INTO fx__owners (id, label) VALUES ('o1', 'Owner One')`
    );
    await adapter.executeQuery(
      `INSERT INTO fx__linked (id, owner_id) VALUES ('l1', 'o1')`
    );

    // The registration path reload uses: statics, tables, edges.
    registry = new SchemaRegistry("sqlite");
    registry.registerStaticSchemas(getDialectTables("sqlite") as never);
    for (const [tableName, table] of Object.entries(built.drizzle)) {
      registry.registerDynamicSchema(
        tableName,
        table,
        built.relations.get(tableName)
      );
    }
    adapter.setTableResolver(registry as never);
  }, 60_000);

  afterAll(async () => {
    try {
      await adapter?.disconnect?.();
    } catch {
      // ignore teardown close errors
    }
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it("a with query returns the nested row through the declared edge", async () => {
    const rqb = adapter.getDrizzle<{
      query: Record<
        string,
        {
          findMany: (config?: {
            with?: Record<string, boolean>;
          }) => Promise<Array<Record<string, unknown>>>;
        }
      >;
    }>(registry.getRelations() as never);
    const rows = await rqb.query["fx__linked"].findMany({
      with: { ownerId: true },
    });
    expect(rows).toHaveLength(1);
    // The nested edge carries the owner row the foreign key points at.
    expect(rows[0]).toMatchObject({
      id: "l1",
      owner_id: "o1",
      ownerId: { id: "o1", label: "Owner One" },
    });
  });
});
