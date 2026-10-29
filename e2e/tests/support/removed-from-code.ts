/**
 * Collections and Singles removed from code, staged in the suite's own
 * database, for the removed-from-code spec.
 *
 * An entity is removed from code when its registry row says the app's code
 * defines it and the running configuration does not declare its slug. No
 * request makes one: the configuration is fixed for the whole run, and
 * changing it would restart the server under every other spec. So a removed
 * entity is staged as a deploy leaves one, by copying a declared entity's
 * registry row under a slug the configuration does not declare, with the
 * tables, migration files and ledger rows each state needs:
 *
 * - `kept`: its tables exist and no migration drops it;
 * - `pending`: its tables exist and an unapplied migration file drops it;
 * - `half`: an applied migration dropped its main table (the ledger records
 *   the file as applied, the table is gone) and its registry row remains.
 *
 * The guard rails, as in `release-states.ts`: it writes only to the suite's
 * throwaway `e2e.db` and to migration files named by this run, every write is
 * checked to have changed what it meant to, and {@link unstageRemovedEntities}
 * removes all of it.
 *
 * @module e2e/tests/support/removed-from-code
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { expect, type APIRequestContext } from "@playwright/test";

import { createEntry, expectOk } from "./runtime-collection";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The suite's own database, never the one `pnpm dev:app` uses. */
const E2E_DB = path.resolve(HERE, "../../../apps/playground/data/e2e.db");

/** The playground's `db.migrationsDir`, which the server reads per request. */
const MIGRATIONS_DIR = path.resolve(
  HERE,
  "../../../apps/playground/src/db/migrations"
);

export type RemovedState = "kept" | "pending" | "half";

export const REMOVED_STATES: readonly RemovedState[] = [
  "kept",
  "pending",
  "half",
];

export interface StagedEntity {
  slug: string;
  /** The name the admin shows for it. */
  label: string;
  table: string;
}

export interface StagedState {
  state: RemovedState;
  collection: StagedEntity & { entryId: string };
  single: StagedEntity;
  /** The migration file dropping both, for `pending` and `half`. */
  migration?: string;
}

export interface StagedRun {
  states: StagedState[];
  /** Everything to remove afterwards. */
  files: string[];
  eventIds: string[];
  /**
   * The outermost folder staging created on the way to the migrations folder,
   * if any, to remove again with what it made inside it.
   */
  createdDir: string | undefined;
}

function open(): DatabaseSync {
  const db = new DatabaseSync(E2E_DB);
  // The dev server holds the same file: wait for its lock rather than fail.
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** The registry row's table name for `slug`. */
function tableOf(db: DatabaseSync, registry: string, slug: string): string {
  const row = db
    .prepare(`SELECT table_name FROM ${registry} WHERE slug = ?`)
    .get(slug) as { table_name?: string } | undefined;
  expect(row?.table_name, `${registry} row for ${slug}`).toBeTruthy();
  return row!.table_name!;
}

/**
 * Copy `from`'s registry row as a new code-defined row, `overrides` replacing
 * columns by name. Every other column is copied as it is, so the row is one a
 * deploy of the earlier configuration would have written.
 */
function copyRegistryRow(
  db: DatabaseSync,
  registry: "dynamic_collections" | "dynamic_singles",
  from: string,
  overrides: Record<string, string | number | null>
): void {
  const columns = (
    db.prepare(`PRAGMA table_info(${registry})`).all() as Array<{
      name: string;
    }>
  ).map(column => column.name);
  const values: Array<string | number | null> = [];
  const select = columns.map(column => {
    if (column in overrides) {
      values.push(overrides[column]);
      return "?";
    }
    return quote(column);
  });
  const { changes } = db
    .prepare(
      `INSERT INTO ${registry} (${columns.map(quote).join(", ")}) ` +
        `SELECT ${select.join(", ")} FROM ${registry} WHERE slug = ?`
    )
    .run(...values, from);
  expect(changes, `copying the ${from} row`).toBe(1);
}

/**
 * Stage a collection and a Single removed from code in each state.
 *
 * The collection is a copy of `tags` holding one entry; the Single a copy of
 * `landing-page` holding its document, both with the row source `code`.
 */
export async function stageRemovedEntities(
  api: APIRequestContext,
  run: string
): Promise<StagedRun> {
  // The documents the copies start from: an entry, and the Single's document,
  // which its first read creates.
  const entryId = await createEntry(api, "tags", {
    title: `Removed tag ${run}`,
    slug: `removed-tag-${run}`,
  });
  await expectOk(
    await api.get("/admin/api/singles/landing-page?status=all"),
    "reading the landing page"
  );

  const staged: StagedRun = {
    states: [],
    files: [],
    eventIds: [],
    createdDir: await mkdir(MIGRATIONS_DIR, { recursive: true }),
  };
  const db = open();
  try {
    const tagsTable = tableOf(db, "dynamic_collections", "tags");
    const landingTable = tableOf(db, "dynamic_singles", "landing-page");

    for (const [index, state] of REMOVED_STATES.entries()) {
      const collection = {
        slug: `rfc_${state}_${run}`,
        // Ending in "s", so the list's plural of it is itself.
        label: `Removed ${state} ${run} pages`,
        table: `dc_rfc_${state}_${run}`,
        entryId,
      };
      const single = {
        slug: `rfc-${state}-banner-${run}`,
        label: `Removed ${state} ${run} banner`,
        table: `single_rfc_${state}_banner_${run}`,
      };
      copyRegistryRow(db, "dynamic_collections", "tags", {
        id: randomUUID(),
        slug: collection.slug,
        table_name: collection.table,
        labels: JSON.stringify({
          singular: collection.label,
          plural: collection.label,
        }),
        source: "code",
      });
      copyRegistryRow(db, "dynamic_singles", "landing-page", {
        id: randomUUID(),
        slug: single.slug,
        table_name: single.table,
        label: single.label,
        // Its title alone: the copy is about the notice, not the blocks field.
        fields: JSON.stringify([
          { type: "text", name: "title", label: "Title" },
        ]),
        admin: null,
        source: "code",
      });

      // The main tables, with the entry and the document, where the state has
      // them.
      if (state !== "half") {
        db.prepare(
          `CREATE TABLE ${quote(collection.table)} AS SELECT * FROM ${quote(tagsTable)} WHERE id = ?`
        ).run(entryId);
        db.exec(
          `CREATE TABLE ${quote(single.table)} AS SELECT * FROM ${quote(landingTable)}`
        );
      }

      let migration: string | undefined;
      if (state !== "kept") {
        // After every real migration, and unique to this run.
        migration = `29991231_00000${index}_e2e_removed_${state}_${run}.sql`;
        const file = path.join(MIGRATIONS_DIR, migration);
        await writeFile(
          file,
          [
            "-- UP",
            `DROP TABLE ${quote(collection.table)};`,
            `DROP TABLE ${quote(single.table)};`,
            "",
            "-- DOWN",
            "SELECT 1;",
            "",
          ].join("\n"),
          { flag: "wx" }
        );
        staged.files.push(file);
      }
      if (state === "half" && migration !== undefined) {
        const id = randomUUID();
        const now = Date.now();
        const { changes } = db
          .prepare(
            "INSERT INTO nextly_schema_events (id, event_type, status, source, filename, started_at, ended_at) " +
              "VALUES (?, 'file_apply', 'applied', 'cli-migrate', ?, ?, ?)"
          )
          .run(id, migration, now, now);
        expect(changes, "recording the drop as applied").toBe(1);
        staged.eventIds.push(id);
      }
      staged.states.push({ state, collection, single, migration });
    }
  } finally {
    db.close();
  }
  return staged;
}

/** Remove every row, table and file {@link stageRemovedEntities} made. */
export async function unstageRemovedEntities(
  staged: StagedRun | undefined
): Promise<void> {
  if (staged === undefined) return;
  for (const file of staged.files) await rm(file, { force: true });
  // Only folders this run made, innermost first, and only while empty.
  if (staged.createdDir !== undefined) {
    for (
      let dir = MIGRATIONS_DIR;
      dir.startsWith(staged.createdDir);
      dir = path.dirname(dir)
    ) {
      await rmdir(dir).catch(() => undefined);
    }
  }
  const db = open();
  try {
    for (const { collection, single } of staged.states) {
      db.prepare("DELETE FROM dynamic_collections WHERE slug = ?").run(
        collection.slug
      );
      db.prepare("DELETE FROM dynamic_singles WHERE slug = ?").run(single.slug);
      db.exec(`DROP TABLE IF EXISTS ${quote(collection.table)}`);
      db.exec(`DROP TABLE IF EXISTS ${quote(single.table)}`);
    }
    for (const id of staged.eventIds) {
      db.prepare("DELETE FROM nextly_schema_events WHERE id = ?").run(id);
    }
  } finally {
    db.close();
  }
}

/** The step the notice names for each state, as the admin reads it out. */
export function stepFor(staged: StagedState): string {
  switch (staged.state) {
    case "kept":
      return "To retire it, run nextly migrate:create, then nextly migrate.";
    case "pending":
      return `Run nextly migrate to apply ${staged.migration}.`;
    case "half":
      return "Run nextly prune, which lists what remains.";
  }
}
