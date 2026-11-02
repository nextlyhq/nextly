// Tests for the lazy drizzle-kit per-dialect accessor.
// What: verifies the async accessors return functions and cache correctly.
// Why: drizzle-kit-lazy.ts is the single chokepoint between Nextly and
// drizzle-kit v1's payload/* per-dialect modules. The caches must survive
// across calls (single load per dialect per process) so callers can rely
// on fast subsequent lookups under Turbopack HMR.
//
// Note: this test loads the real drizzle-kit payload modules (no mocks).
// drizzle-kit is a regular dependency, so createRequire resolves cleanly
// in Node-based vitest.

import { describe, it, expect, beforeEach } from "vitest";

import {
  getPgDrizzleKit,
  getMySQLDrizzleKit,
  getSQLiteDrizzleKit,
  getDrizzleKitForDialect,
  scopeMysqlIntrospection,
} from "../drizzle-kit-lazy";

// Why typed cache shape: the lazy module stashes its caches on globalThis
// so they survive Turbopack HMR module re-execution. Tests inspect the
// cache slots to confirm the load-once invariant. v1 loads one module PER
// DIALECT (payload/postgres, payload/mysql, payload/sqlite) instead of the
// removed pre-v1 single-module kit API.
type DrizzleKitCacheSlots = {
  __nextly_drizzleKitPg?: unknown;
  __nextly_drizzleKitMySQL?: unknown;
  __nextly_drizzleKitSQLite?: unknown;
};

describe("drizzle-kit-lazy", () => {
  beforeEach(() => {
    // Reset caches between tests so each starts clean. Without this, the
    // first test loads the modules and subsequent tests cannot verify
    // load-once behavior.
    const g = globalThis as DrizzleKitCacheSlots;
    g.__nextly_drizzleKitPg = undefined;
    g.__nextly_drizzleKitMySQL = undefined;
    g.__nextly_drizzleKitSQLite = undefined;
  });

  describe("getPgDrizzleKit (PostgreSQL)", () => {
    it("returns pushSchema function", async () => {
      const kit = await getPgDrizzleKit();
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns generateDrizzleJson function", async () => {
      const kit = await getPgDrizzleKit();
      expect(typeof kit.generateDrizzleJson).toBe("function");
    });

    it("returns generateMigration function", async () => {
      const kit = await getPgDrizzleKit();
      expect(typeof kit.generateMigration).toBe("function");
    });

    it("does NOT expose upSnapshot (dropped per D-2.1 — zero production callers)", async () => {
      const kit = await getPgDrizzleKit();
      expect(kit).not.toHaveProperty("upSnapshot");
    });
  });

  describe("getMySQLDrizzleKit", () => {
    it("returns pushSchema function for MySQL", async () => {
      const kit = await getMySQLDrizzleKit();
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns generateDrizzleJson function for MySQL", async () => {
      const kit = await getMySQLDrizzleKit();
      expect(typeof kit.generateDrizzleJson).toBe("function");
    });

    it("returns generateMigration function for MySQL", async () => {
      const kit = await getMySQLDrizzleKit();
      expect(typeof kit.generateMigration).toBe("function");
    });
  });

  describe("getSQLiteDrizzleKit", () => {
    it("returns pushSchema function for SQLite", async () => {
      const kit = await getSQLiteDrizzleKit();
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns generateDrizzleJson function for SQLite", async () => {
      const kit = await getSQLiteDrizzleKit();
      expect(typeof kit.generateDrizzleJson).toBe("function");
    });

    it("returns generateMigration function for SQLite", async () => {
      const kit = await getSQLiteDrizzleKit();
      expect(typeof kit.generateMigration).toBe("function");
    });
  });

  describe("getDrizzleKitForDialect", () => {
    it("returns PostgreSQL kit for 'postgresql'", async () => {
      const kit = await getDrizzleKitForDialect("postgresql");
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns MySQL kit for 'mysql'", async () => {
      const kit = await getDrizzleKitForDialect("mysql");
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns SQLite kit for 'sqlite'", async () => {
      const kit = await getDrizzleKitForDialect("sqlite");
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("dispatches to the same instance as the dedicated accessor", async () => {
      // Why: confirms the dispatcher is a thin wrapper, not a parallel
      // load path. If the dispatcher reloaded drizzle-kit independently,
      // the returned objects would be distinct.
      const viaDispatcher = await getDrizzleKitForDialect("postgresql");
      const viaDirect = await getPgDrizzleKit();
      expect(viaDispatcher).toBe(viaDirect);
    });
  });

  describe("globalThis cache behavior", () => {
    it("caches the PG kit so repeated calls return the same instance", async () => {
      const a = await getPgDrizzleKit();
      const b = await getPgDrizzleKit();
      expect(a).toBe(b);
    });

    it("caches the MySQL kit", async () => {
      const a = await getMySQLDrizzleKit();
      const b = await getMySQLDrizzleKit();
      expect(a).toBe(b);
    });

    it("caches the SQLite kit", async () => {
      const a = await getSQLiteDrizzleKit();
      const b = await getSQLiteDrizzleKit();
      expect(a).toBe(b);
    });

    it("loads each per-dialect module exactly once and only on demand", async () => {
      // Why: v1 splits the kit per dialect; a consumer app has ONE dialect,
      // so accessing PG must not load the mysql/sqlite modules (they pull
      // dialect-specific dep trees).
      // The wrapper slot is the ONLY cache level (the raw-module slots were
      // removed as redundant state) — its presence proves the module loaded,
      // its absence proves on-demand laziness.
      const g = globalThis as DrizzleKitCacheSlots;
      await getPgDrizzleKit();
      expect(g.__nextly_drizzleKitPg).toBeDefined();
      expect(g.__nextly_drizzleKitMySQL).toBeUndefined();
      expect(g.__nextly_drizzleKitSQLite).toBeUndefined();

      await getMySQLDrizzleKit();
      await getSQLiteDrizzleKit();
      expect(g.__nextly_drizzleKitMySQL).toBeDefined();
      expect(g.__nextly_drizzleKitSQLite).toBeDefined();
    });

    it("populates the per-dialect cache slot on first access", async () => {
      const g = globalThis as DrizzleKitCacheSlots;
      expect(g.__nextly_drizzleKitPg).toBeUndefined();
      await getPgDrizzleKit();
      expect(g.__nextly_drizzleKitPg).toBeDefined();
    });
  });
});

// A raw MySQL client answering one statement at a time, recording each.
function recordingClient(answer: (sql: string) => unknown[]) {
  const seen: string[] = [];
  return {
    seen,
    client: {
      query: <T>(sql: string): Promise<T[]> => {
        seen.push(sql);
        return Promise.resolve(answer(sql) as T[]);
      },
    },
  };
}

describe("scopeMysqlIntrospection", () => {
  const listing = [
    { TABLE_NAME: "users", TABLE_TYPE: "BASE TABLE" },
    { TABLE_NAME: "dc_posts", TABLE_TYPE: "BASE TABLE" },
    { TABLE_NAME: "posts_view", TABLE_TYPE: "VIEW" },
  ];

  it("keeps only the given tables in the table and view listings", async () => {
    const { client } = recordingClient(() => listing);
    const scoped = scopeMysqlIntrospection(client, ["users"]);

    expect(
      await scoped.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES")
    ).toEqual([listing[0]]);
    expect(
      await scoped.query(
        "SELECT TABLE_NAME\n\t\t\tFROM information_schema.views WHERE 1"
      )
    ).toEqual([listing[0]]);
  });

  it("passes every other read through whole", async () => {
    // The kit narrows these itself, to the tables the listing returned; a
    // read that only resembles a listing must not lose rows here.
    const { client, seen } = recordingClient(() => listing);
    const scoped = scopeMysqlIntrospection(client, ["users"]);
    for (const statement of [
      "SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS",
      "SELECT * FROM INFORMATION_SCHEMA.STATISTICS",
      "SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME IN ('users')",
    ]) {
      expect(await scoped.query(statement)).toEqual(listing);
    }
    expect(seen).toHaveLength(3);
  });

  it("refuses a listing row it cannot name rather than reading an empty database", async () => {
    const { client } = recordingClient(() => [{ table_name: "users" }]);
    const scoped = scopeMysqlIntrospection(client, ["users"]);
    await expect(
      scoped.query("SELECT table_name FROM INFORMATION_SCHEMA.TABLES")
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      logContext: {
        reason: expect.stringContaining("has no TABLE_NAME"),
      },
    });
  });
});

describe("MySQL pushSchema with a tables filter (real drizzle-kit)", () => {
  // The live database: one core table and one content table. The desired
  // schema keeps the core table and ADDS another, which is the shape that
  // sends the kit's rename resolver looking for a pair.
  function liveDatabase() {
    return recordingClient(sql => {
      if (/INFORMATION_SCHEMA\.TABLES\b/i.test(sql)) {
        return [
          {
            TABLE_NAME: "users",
            TABLE_TYPE: "BASE TABLE",
            CREATE_TIME: "2026-01-01 00:00:00",
          },
          {
            TABLE_NAME: "dc_posts",
            TABLE_TYPE: "BASE TABLE",
            CREATE_TIME: "2026-01-02 00:00:00",
          },
        ];
      }
      if (/INFORMATION_SCHEMA\.SCHEMATA\b/i.test(sql)) {
        return [
          {
            DEFAULT_CHARACTER_SET_NAME: "utf8mb4",
            DEFAULT_COLLATION_NAME: "utf8mb4_0900_ai_ci",
          },
        ];
      }
      return [];
    });
  }

  async function desiredSchema() {
    const { mysqlTable, varchar } = await import("drizzle-orm/mysql-core");
    return {
      users: mysqlTable("users", {
        id: varchar("id", { length: 36 }).primaryKey(),
      }),
      added: mysqlTable("nextly_added_core", {
        id: varchar("id", { length: 36 }).primaryKey(),
      }),
    };
  }

  // A drizzle instance as the wrapper reads one: the raw client on `$client`,
  // answering `[rows, fields]`.
  const asDrizzle = (client: {
    query: (sql: string) => Promise<unknown[]>;
  }) => ({
    $client: {
      query: async (sql: string) => [await client.query(sql), []],
    },
  });

  it("crashes in the rename resolver without one (the fixture reaches the mechanism)", async () => {
    const kit = await getMySQLDrizzleKit();
    const { client } = liveDatabase();
    await expect(
      kit.pushSchema(await desiredSchema(), asDrizzle(client), "site")
    ).rejects.toThrow(/HintsHandler/);
  });

  it("plans the added table and nothing about the content table with one", async () => {
    const kit = await getMySQLDrizzleKit();
    const { client } = liveDatabase();
    const result = await kit.pushSchema(
      await desiredSchema(),
      asDrizzle(client),
      "site",
      { tables: ["users", "nextly_added_core"] }
    );
    expect(
      result.sqlStatements.filter(s => s.startsWith("CREATE TABLE"))
    ).toEqual([expect.stringContaining("`nextly_added_core`")]);
    expect(result.sqlStatements.filter(s => s.includes("dc_posts"))).toEqual(
      []
    );
  });
});
