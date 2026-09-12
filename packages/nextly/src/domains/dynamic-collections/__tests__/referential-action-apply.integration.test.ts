/**
 * Does a referential-action edit actually reach a real server?
 *
 * Every other test for this feature reads the SQL this generator produces. That
 * is the wrong end to stop at, and stopping there is what let a defect ship:
 * the statements were correct and MySQL never ran them. The runner splits a
 * migration on `--> statement-breakpoint` and hands each chunk to the driver
 * WHOLE, and the MySQL adapter sets `multipleStatements = false`, so a chunk
 * carrying a semicolon-joined DROP and ADD was rejected outright. PostgreSQL
 * and SQLite tolerate a compound statement, so every suite that ran stayed
 * green while the edit did nothing at all on MySQL.
 *
 * So this suite applies what the generator emits, the way the runner applies
 * it, and then asks the SERVER what the key now does — `information_schema`,
 * not the string that was sent. A generator that stops emitting, emits the
 * wrong action, or emits something the driver refuses all fail here, and none
 * of them can be papered over by reading the SQL back.
 *
 * One file, both legs: `DB_DIALECT` is validated and cached on the first read
 * of any env property in a worker, and each CI leg configures only its own URL,
 * so the other leg self-skips. Follows `outbox-preimage-lock.integration.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { createAdapter } from "../../../database/factory";
import { DynamicCollectionSchemaService } from "../services/dynamic-collection-schema-service";

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;
type Dialect = "postgresql" | "mysql";

interface Leg {
  name: string;
  dialect: Dialect;
  url: string;
}

const LEGS: Leg[] = [
  {
    name: "postgres",
    dialect: "postgresql",
    url: process.env.TEST_POSTGRES_URL ?? "",
  },
  { name: "mysql", dialect: "mysql", url: process.env.TEST_MYSQL_URL ?? "" },
];

// Dedicated names so reruns against the shared test database are idempotent.
// `generateMigrationSQL` derives the constraint name from the table name, and
// a relationship's target resolves to `dc_<target>`, so the parent table's name
// and the field's target have to agree.
const AUTHORS_TABLE = "dc_ra_gate_authors";
const POSTS_TABLE = "dc_ra_gate_posts";
const FK = `fk_${POSTS_TABLE}_author`;

const authorRelation = (
  options: Record<string, unknown>,
  required = false
): FieldDefinition =>
  ({
    name: "author",
    type: "relationship",
    required,
    options: {
      relationType: "manyToOne",
      target: "ra_gate_authors",
      ...options,
    },
  }) as unknown as FieldDefinition;

async function connect(leg: Leg): Promise<TestAdapter> {
  // env.ts validates DATABASE_URL against DB_DIALECT on the first read of any
  // env property in this worker and caches the result, so both must be set on
  // process.env — passing `url` to createAdapter alone does not satisfy it.
  process.env.DB_DIALECT = leg.dialect;
  process.env.DATABASE_URL = leg.url;
  const adapter = await createAdapter({
    type: leg.dialect,
    url: leg.url,
  } as Parameters<typeof createAdapter>[0]);
  await adapter.executeQuery("SELECT 1");
  return adapter;
}

/**
 * Apply a migration the way `CollectionFileManager.runMigration` applies one:
 * split on the breakpoint marker, drop standalone comment lines, and execute
 * each remaining chunk AS ONE QUERY.
 *
 * Deliberately not a `;` split. The runner does not do one — a lexical split on
 * semicolons corrupts string literals — so a test that split on `;` would run
 * statements the product cannot, and would have passed against the defect this
 * suite exists to catch.
 */
async function applyLikeTheRunner(
  adapter: TestAdapter,
  migration: string
): Promise<void> {
  for (const chunk of migration.split("--> statement-breakpoint")) {
    const statement = chunk
      .split("\n")
      .filter(line => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (!statement) continue;
    // The trailing `;` is kept, because the runner keeps it: it hands the chunk
    // to the driver exactly as the generator wrote it. Stripping it here would
    // be a different program from the one that ships.
    await adapter.executeQuery(statement);
  }
}

/** Where this server keeps the schema a name resolves in. */
const currentSchema = (dialect: Dialect): string =>
  dialect === "mysql" ? "DATABASE()" : "current_schema()";

/** What the LIVE key does, read from the catalog rather than from the SQL. */
async function liveActions(
  adapter: TestAdapter,
  dialect: Dialect
): Promise<{ onDelete: string; onUpdate: string } | null> {
  // `referential_constraints` carries no table name on PostgreSQL, so the
  // constraint name plus its schema is the portable key.
  const rows = await adapter.executeQuery<{ dr: string; ur: string }>(
    `SELECT delete_rule AS dr, update_rule AS ur
       FROM information_schema.referential_constraints
      WHERE constraint_name = '${FK}'
        AND constraint_schema = ${currentSchema(dialect)}`
  );
  const row = rows[0];
  return row ? { onDelete: row.dr, onUpdate: row.ur } : null;
}

/** Whether the live column accepts nulls. */
async function columnAcceptsNull(
  adapter: TestAdapter,
  dialect: Dialect,
  column: string
): Promise<boolean> {
  const rows = await adapter.executeQuery<{ n: string }>(
    `SELECT is_nullable AS n
       FROM information_schema.columns
      WHERE table_name = '${POSTS_TABLE}'
        AND column_name = '${column}'
        AND table_schema = ${currentSchema(dialect)}`
  );
  return rows[0]?.n === "YES";
}

for (const leg of LEGS) {
  const describeLeg = describe.skipIf(!leg.url);

  describeLeg(`a referential-action edit reaches ${leg.name}`, () => {
    let adapter: TestAdapter | undefined;
    const schema = new DynamicCollectionSchemaService(undefined, leg.dialect);

    async function drop(): Promise<void> {
      if (!adapter) return;
      // Child first: MySQL refuses to drop a table an FK still references, and
      // its `DROP TABLE ... CASCADE` parses the keyword without cascading.
      for (const table of [POSTS_TABLE, AUTHORS_TABLE]) {
        try {
          await adapter.executeQuery(`DROP TABLE IF EXISTS ${table}`);
        } catch {
          // A leftover from a failed run may already be gone.
        }
      }
    }

    /** Build both tables with `author` in the given starting shape. */
    async function createFixture(field: FieldDefinition): Promise<void> {
      await applyLikeTheRunner(
        adapter!,
        schema.generateMigrationSQL(AUTHORS_TABLE, [])
      );
      await applyLikeTheRunner(
        adapter!,
        schema.generateMigrationSQL(POSTS_TABLE, [field])
      );
    }

    beforeAll(async () => {
      if (!leg.url) return;
      adapter = await connect(leg);
      await drop();
    });

    afterAll(async () => {
      await drop();
      if (adapter) await adapter.disconnect();
    });

    it("moves what the key does on delete, on the server", async () => {
      await drop();
      await createFixture(authorRelation({ onDelete: "cascade" }));
      expect(await liveActions(adapter!, leg.dialect)).toEqual({
        onDelete: "CASCADE",
        onUpdate: "NO ACTION",
      });

      await applyLikeTheRunner(
        adapter!,
        schema.generateAlterTableMigration(
          POSTS_TABLE,
          [authorRelation({ onDelete: "cascade" })],
          [authorRelation({ onDelete: "restrict" })]
        )
      );

      // The server's answer, not the generator's. On the pre-fix code the
      // statements above were rejected whole by MySQL and this still read
      // CASCADE.
      expect(await liveActions(adapter!, leg.dialect)).toEqual({
        onDelete: "RESTRICT",
        onUpdate: "NO ACTION",
      });
    });

    it("turning a link optional relaxes its column and nulls the child", async () => {
      await drop();
      await createFixture(authorRelation({}, true));
      expect(await columnAcceptsNull(adapter!, leg.dialect, "author")).toBe(
        false
      );
      expect((await liveActions(adapter!, leg.dialect))?.onDelete).toBe(
        "RESTRICT"
      );

      await applyLikeTheRunner(
        adapter!,
        schema.generateAlterTableMigration(
          POSTS_TABLE,
          [authorRelation({}, true)],
          [authorRelation({}, false)]
        )
      );

      // Both halves, because neither is sufficient: the column has to accept
      // nulls before SET NULL can be installed on it, and MySQL rejects the
      // pairing outright while PostgreSQL accepts it and fails on the first
      // delete instead.
      expect(await columnAcceptsNull(adapter!, leg.dialect, "author")).toBe(
        true
      );
      expect((await liveActions(adapter!, leg.dialect))?.onDelete).toBe(
        "SET NULL"
      );

      // What the whole feature claims, asked of the database: deleting the row
      // the link points at leaves the child standing with an empty link.
      await adapter!.executeQuery(
        `INSERT INTO ${AUTHORS_TABLE} (id, title, slug) VALUES ('ra-a1', 'Ada', 'ada')`
      );
      await adapter!.executeQuery(
        `INSERT INTO ${POSTS_TABLE} (id, title, slug, author) VALUES ('ra-p1', 'Hello', 'hello', 'ra-a1')`
      );
      await adapter!.executeQuery(
        `DELETE FROM ${AUTHORS_TABLE} WHERE id = 'ra-a1'`
      );

      const posts = await adapter!.executeQuery<{
        id: string;
        author: string | null;
      }>(`SELECT id, author FROM ${POSTS_TABLE} WHERE id = 'ra-p1'`);
      expect(posts).toHaveLength(1);
      expect(posts[0]?.author).toBeNull();
    });
  });
}
