/**
 * A release that adds a core table reaches a site that already holds content,
 * through `migrateCore`, the core of `nextly migrate`, on its FIRST run.
 *
 * The existing database is the current core schema without one core table
 * (`nextly_cache_tag_expiries`, the last one added), plus two content tables
 * made the way a collection's table is made:
 *
 * - `dc_posts`, an ordinary collection with rows.
 * - `dc_tag_expiries`, with exactly the columns of the missing core table and
 *   rows of its own: the closest a live table can come to looking like the
 *   missing one renamed.
 *
 * On MySQL the core push used to introspect the whole database, so it read the
 * content tables as dropped and the core table as added, paired them as a
 * possible rename and crashed in drizzle-kit's resolver. Its recovery replayed
 * every `ADD CONSTRAINT` of the core schema against a database that already had
 * them, and the first migrate failed on a duplicate foreign key name.
 *
 * What separates a correct reconcile from the plausible broken ones: the first
 * run succeeds; the core table is created NEW (empty, its own index) rather
 * than made from the look-alike content table; both content tables keep every
 * row; and the core foreign keys are the same ones, by name and shape, as
 * before the run.
 *
 * Runs on every dialect with a database in this run.
 */
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  availableDialects,
  withFreshDatabase,
  type FreshDatabase,
} from "../../../../__tests__/helpers/fresh-database";
import {
  migrateFresh,
  noMigrationsDir,
} from "../../../../__tests__/helpers/migrate-core";
import { getDialectTablesForPush } from "../../../../database/index";
import { emitDdl } from "../../pipeline/ddl-emitter";
import { buildDesiredTableFromFields } from "../../pipeline/diff/build-from-fields";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { freshPushSchema } from "../../pipeline/fresh-push";

const ADDED = "nextly_cache_tag_expiries";
const POSTS = "dc_posts";
const LOOK_ALIKE = "dc_tag_expiries";

/** Rows, read with a raw statement through the drizzle instance under test. */
async function rows(
  fresh: FreshDatabase,
  statement: string
): Promise<Array<Record<string, unknown>>> {
  const query = sql.raw(statement);
  if (fresh.dialect === "sqlite") {
    return (
      fresh.db as { all: (q: unknown) => Array<Record<string, unknown>> }
    ).all(query);
  }
  const result = await (
    fresh.db as { execute: (q: unknown) => Promise<unknown> }
  ).execute(query);
  return fresh.dialect === "postgresql"
    ? (result as { rows: Array<Record<string, unknown>> }).rows
    : (result as [Array<Record<string, unknown>>])[0];
}

/**
 * Every foreign key in the database, one line each: its name, table and
 * columns, what it references, and its actions. SQLite keeps no name for one,
 * so there the line is everything else.
 */
async function foreignKeys(fresh: FreshDatabase): Promise<string[]> {
  if (fresh.dialect === "postgresql") {
    return (
      await rows(
        fresh,
        `SELECT con.conname || ' on ' || cl.relname || ': ' || pg_get_constraintdef(con.oid) AS fk
           FROM pg_constraint con
           JOIN pg_class cl ON cl.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = cl.relnamespace
          WHERE con.contype = 'f' AND n.nspname = current_schema()
          ORDER BY 1`
      )
    ).map(row => String(row.fk));
  }
  if (fresh.dialect === "mysql") {
    return (
      await rows(
        fresh,
        `SELECT CONCAT(rc.CONSTRAINT_NAME, ' on ', rc.TABLE_NAME, ' (',
                  (SELECT GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION)
                     FROM information_schema.KEY_COLUMN_USAGE k
                    WHERE k.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
                      AND k.TABLE_NAME = rc.TABLE_NAME
                      AND k.CONSTRAINT_NAME = rc.CONSTRAINT_NAME),
                  ') references ', rc.REFERENCED_TABLE_NAME,
                  ' on delete ', rc.DELETE_RULE, ' on update ', rc.UPDATE_RULE) AS fk
           FROM information_schema.REFERENTIAL_CONSTRAINTS rc
          WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
          ORDER BY 1`
      )
    ).map(row => String(row.fk));
  }
  const tables = await rows(
    fresh,
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  );
  const lines: string[] = [];
  for (const { name } of tables) {
    for (const fk of await rows(
      fresh,
      `SELECT * FROM pragma_foreign_key_list('${String(name)}')`
    )) {
      lines.push(
        `${String(name)}.${String(fk.from)} references ${String(fk.table)}.${String(fk.to)} on delete ${String(fk.on_delete)} on update ${String(fk.on_update)}`
      );
    }
  }
  return lines.sort();
}

/** A collection's table, made by the code that makes one for a real collection. */
async function createPosts(fresh: FreshDatabase): Promise<void> {
  const spec = buildDesiredTableFromFields(
    POSTS,
    [{ name: "body", type: "text" }],
    fresh.dialect,
    { builtBy: "collection" }
  );
  for (const statement of emitDdl(
    [{ type: "add_table", table: spec }],
    fresh.dialect
  )) {
    await fresh.exec(statement);
  }
  for (const n of [1, 2]) {
    await fresh.exec(
      `INSERT INTO ${POSTS} (id, title, slug, body) VALUES ('post-${n}', 'Post ${n}', 'post-${n}', 'Body ${n}')`
    );
  }
}

/**
 * A content table with exactly the core table's columns: the core table's own
 * live shape, read back by the pipeline's introspection and created under
 * another name by the same emitter. Its index is renamed, since an index name
 * is unique across the whole database on PostgreSQL and SQLite.
 */
async function createLookAlike(fresh: FreshDatabase): Promise<void> {
  const [core] = (
    await introspectLiveSnapshot(fresh.db, fresh.dialect, [ADDED])
  ).tables;
  expect(core?.columns.map(column => column.name).sort()).toEqual([
    "expired_at",
    "id",
    "tag",
  ]);
  const table = {
    ...core!,
    name: LOOK_ALIKE,
    indexes: (core!.indexes ?? []).map(index => ({
      ...index,
      name: `${LOOK_ALIKE}_${index.name}`,
    })),
  };
  for (const statement of emitDdl(
    [{ type: "add_table", table }],
    fresh.dialect
  )) {
    await fresh.exec(statement);
  }
  for (const n of [1, 2]) {
    await fresh.exec(
      `INSERT INTO ${LOOK_ALIKE} (id, tag, expired_at) VALUES ('look-${n}', 'tag-${n}', ${1000 + n})`
    );
  }
}

/** Every row of a table, in a fixed order. */
const allRows = (fresh: FreshDatabase, table: string) =>
  rows(fresh, `SELECT * FROM ${table} ORDER BY id`);

/**
 * An installed site from before the core table: migrated once, given its
 * content, then without the core table.
 */
async function siteFromBeforeTheTable(fresh: FreshDatabase): Promise<void> {
  await migrateFresh(fresh, NO_MIGRATIONS);
  await createPosts(fresh);
  await createLookAlike(fresh);
  await fresh.exec(`DROP TABLE ${ADDED}`);
  expect(await fresh.columnsOf(ADDED)).toEqual([]);
}

/** An app with no migration files, so only the core phase has work to do. */
const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-ctab-");
afterAll(remove);

describe.each(availableDialects())(
  "a core table added beside existing content (%s)",
  dialect => {
    it("is created on the first migrate, and the content and foreign keys are left as they were", async () => {
      await withFreshDatabase(dialect, "nextly_ctab_migrate", async fresh => {
        await siteFromBeforeTheTable(fresh);
        const keysBefore = await foreignKeys(fresh);
        // The core schema has foreign keys; with none, "unchanged" would hold
        // of a reconcile that dropped them all.
        expect(keysBefore.length).toBeGreaterThan(0);
        const postsBefore = await allRows(fresh, POSTS);
        const lookAlikeBefore = await allRows(fresh, LOOK_ALIKE);
        expect(postsBefore).toHaveLength(2);
        expect(lookAlikeBefore).toHaveLength(2);

        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);

        // Created new: its own columns and index, and none of the look-alike's
        // rows, which a rename would have carried over.
        expect((await fresh.columnsOf(ADDED)).sort()).toEqual([
          "expired_at",
          "id",
          "tag",
        ]);
        expect(
          await fresh.indexColumnsOf(ADDED, "ncte_expired_at_idx")
        ).toEqual(["expired_at"]);
        expect(await allRows(fresh, ADDED)).toEqual([]);
        // The content tables, every row and column as before.
        expect(await allRows(fresh, POSTS)).toEqual(postsBefore);
        expect(await allRows(fresh, LOOK_ALIKE)).toEqual(lookAlikeBefore);
        // The same foreign keys: names, columns, targets and actions.
        expect(await foreignKeys(fresh)).toEqual(keysBefore);

        // Nothing left to do.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);

    // The mechanism, observed directly: PostgreSQL and MySQL limit the core
    // push to the core tables, so the content tables never reach drizzle-kit's
    // rename resolver and its recovery pass is not taken. SQLite's push takes
    // no such limit; it recovers through that pass, which the test above
    // covers by its outcome.
    it.skipIf(dialect === "sqlite")(
      "pushes the core schema without reaching the recovery pass",
      async () => {
        await withFreshDatabase(dialect, "nextly_ctab_push", async fresh => {
          await siteFromBeforeTheTable(fresh);

          const result = await freshPushSchema(
            dialect,
            fresh.db,
            getDialectTablesForPush(dialect, {})
          );

          expect(
            result.hints.filter(h => h.hint.includes("rename-resolver crash"))
          ).toEqual([]);
          expect(await fresh.columnsOf(ADDED)).not.toEqual([]);
          // Scoped to the core tables, the push emits nothing about content.
          expect(
            result.statementsExecuted.filter(
              s => s.includes(POSTS) || s.includes(LOOK_ALIKE)
            )
          ).toEqual([]);
        });
      },
      180_000
    );
  }
);
