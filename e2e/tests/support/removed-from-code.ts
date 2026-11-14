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
 * Move the stored schema version's `seq`, as every writer of registry rows
 * does once its rows are written: a migration file, `nextly migrate`, another
 * copy of the app. A server re-reads the registry it holds only when `seq`
 * moves (`domains/schema/stored-schema-seq.ts`), so rows written without it
 * would stay unseen by the running suite's server until it restarted, which
 * is what a deploy of the edited configuration does and this cannot.
 *
 * The statement a migration file carries for SQLite, as
 * `schemaVersionStoreSql` in `domains/schema/schema-version.ts` writes it.
 */
function moveSchemaSeq(db: DatabaseSync): void {
  const now = "CAST(strftime('%s', 'now') AS INTEGER)";
  const { changes } = db
    .prepare(
      `INSERT INTO "nextly_meta" ("key", "value", "updated_at") ` +
        `VALUES ('schema_version', '{"migration":null,"seq":1}', ${now}) ` +
        `ON CONFLICT ("key") DO UPDATE SET "value" = json_object(` +
        `'migration', json_extract("nextly_meta"."value", '$.migration'), ` +
        `'seq', COALESCE(json_extract("nextly_meta"."value", '$.seq'), 0) + 1), ` +
        `"updated_at" = ${now}`
    )
    .run();
  expect(changes, "moving the stored schema version").toBe(1);
}

/** The slugs the server lists in one registry, as the admin's lists read it. */
async function listedSlugs(
  api: APIRequestContext,
  registry: "collections" | "singles"
): Promise<string[]> {
  const listed = await api.get(`/admin/api/${registry}?limit=500`);
  await expectOk(listed, `listing the ${registry}`);
  const { items } = (await listed.json()) as {
    items: Array<{ slug?: string; name?: string }>;
  };
  return items.map(item => item.slug ?? item.name ?? "");
}

/**
 * Wait until the server lists every one of `slugs`. A server reads the stored
 * version at most every couple of seconds, so a list read straight after the
 * write can still be the one from before it, and an admin page drawn from
 * that list keeps it.
 */
async function untilListed(
  api: APIRequestContext,
  slugs: { collections: string[]; singles: string[] }
): Promise<void> {
  for (const registry of ["collections", "singles"] as const) {
    await expect
      .poll(
        async () => {
          const listed = await listedSlugs(api, registry);
          return slugs[registry].filter(slug => listed.includes(slug));
        },
        { message: `the staged ${registry} listed`, timeout: 15_000 }
      )
      .toEqual(slugs[registry]);
  }
}

/** The staged collections' and Singles' slugs. */
function slugsOf(staged: StagedRun): {
  collections: string[];
  singles: string[];
} {
  return {
    collections: staged.states.map(state => state.collection.slug),
    singles: staged.states.map(state => state.single.slug),
  };
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
    // Once every row is written, so a server that reads the moved version
    // reads all of them.
    moveSchemaSeq(db);
  } finally {
    db.close();
  }
  await untilListed(api, slugsOf(staged));
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
    // So the server forgets the rows too, rather than listing entities whose
    // tables are gone to the specs that run after this one.
    moveSchemaSeq(db);
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
