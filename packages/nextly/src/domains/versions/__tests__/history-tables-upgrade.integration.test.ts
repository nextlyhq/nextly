/**
 * The two history tables a release adds, version pins and "last looked at"
 * markers, reach an existing database through `migrateCore`, the core of
 * `nextly migrate` and of both boot paths.
 *
 * The existing database is the current core schema without the table. The
 * migrate creates it with its indexes, the unique one each table's
 * one-row-per-key rule rests on included, and a second run changes nothing.
 * A document delete sweeps both tables, so a database that never received
 * them cannot delete documents: this is the upgrade that prevents that.
 *
 * Runs on every dialect with a database in this run, since the push that
 * creates a table is a different implementation per dialect.
 */
import { afterAll, describe, expect, it } from "vitest";

import {
  availableDialects,
  withFreshDatabase,
  type FreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import {
  migrateFresh,
  noMigrationsDir,
} from "../../../__tests__/helpers/migrate-core";

interface HistoryTable {
  table: string;
  columns: string[];
  /** Each index the table must carry, with the columns it covers in order. */
  indexes: Record<string, string[]>;
  /** The unique index's key column. */
  keyColumn: string;
  /** An insert of one row with the given id and key. */
  row: (fresh: FreshDatabase, id: string, key: string) => string;
}

function at(fresh: FreshDatabase): string {
  return fresh.dialect === "sqlite" ? "1767225600" : "'2026-01-01 00:00:00'";
}

const TABLES: HistoryTable[] = [
  {
    table: "nextly_version_pins",
    columns: [
      "created_at",
      "entry_id",
      "holder",
      "id",
      "pin_key",
      "scope_kind",
      "scope_slug",
      "slot",
      "updated_at",
      "version_no",
    ],
    indexes: {
      nextly_version_pins_key_uidx: ["pin_key"],
      nextly_version_pins_doc_idx: ["scope_kind", "scope_slug", "entry_id"],
    },
    keyColumn: "pin_key",
    row: (fresh, id, key) =>
      "INSERT INTO nextly_version_pins (id, scope_kind, scope_slug, entry_id, holder, slot, version_no, pin_key, created_at, updated_at) " +
      `VALUES ('${id}', 'collection', 'posts', 'e1', 'test', 'slot', 1, '${key}', ${at(fresh)}, ${at(fresh)})`,
  },
  {
    table: "nextly_version_views",
    columns: [
      "created_at",
      "entry_id",
      "id",
      "part",
      "previous_version_no",
      "scope_kind",
      "scope_slug",
      "user_id",
      "version_no",
      "view_key",
      "viewed_at",
      "visit_started_at",
    ],
    indexes: {
      nextly_version_views_key_uidx: ["view_key"],
      nextly_version_views_doc_idx: ["scope_kind", "scope_slug", "entry_id"],
      nextly_version_views_user_idx: ["user_id"],
    },
    keyColumn: "view_key",
    row: (fresh, id, key) =>
      "INSERT INTO nextly_version_views (id, user_id, scope_kind, scope_slug, entry_id, part, view_key, version_no, viewed_at, visit_started_at, created_at) " +
      `VALUES ('${id}', 'u1', 'collection', 'posts', 'e1', NULL, '${key}', 1, ${at(fresh)}, ${at(fresh)}, ${at(fresh)})`,
  },
];

/** An app with no migration files, so only the core phase has work to do. */
const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-history-");
afterAll(remove);

async function expectShape(fresh: FreshDatabase, spec: HistoryTable) {
  expect((await fresh.columnsOf(spec.table)).sort()).toEqual(spec.columns);
  const present = await fresh.indexesOf(spec.table);
  for (const [index, columns] of Object.entries(spec.indexes)) {
    expect(present).toContain(index);
    expect(await fresh.indexColumnsOf(spec.table, index)).toEqual(columns);
  }
}

describe.each(availableDialects())(
  "the history tables through nextly migrate (%s)",
  dialect => {
    it.each(TABLES.map(spec => [spec.table, spec] as const))(
      "creates %s on a fresh database",
      async (table, spec) => {
        await withFreshDatabase(dialect, `${table}_fresh`, async fresh => {
          await migrateFresh(fresh, NO_MIGRATIONS);
          await expectShape(fresh, spec);
        });
      },
      180_000
    );

    it.each(TABLES.map(spec => [spec.table, spec] as const))(
      "adds %s to an existing database, unique on its key, and a second run changes nothing",
      async (table, spec) => {
        await withFreshDatabase(dialect, `${table}_existing`, async fresh => {
          await migrateFresh(fresh, NO_MIGRATIONS);
          await fresh.exec(`DROP TABLE ${table}`);
          expect(await fresh.columnsOf(table)).toEqual([]);

          expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);
          await expectShape(fresh, spec);

          // The key is unique on the upgraded table too: a second row with the
          // same key is refused by the database itself.
          await fresh.exec(spec.row(fresh, "a", "same-key"));
          await expect(
            fresh.exec(spec.row(fresh, "b", "same-key"))
          ).rejects.toThrow();
          await fresh.exec(spec.row(fresh, "c", "another-key"));

          expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
        });
      },
      180_000
    );
  }
);
