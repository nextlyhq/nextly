// Phase 7 Task 4 — the "existing user upgrades" simulation.
//
// Every current Nextly user has a database whose DDL was emitted by
// drizzle-kit 0.31 (drizzle-orm 0.45). The nightmare upgrade: they update
// Nextly, boot, and v1's differ sees PHANTOM differences in their untouched
// schema and proposes changes on every run, forever.
//
// fixtures-045/*.json hold the EXACT statements 0.31 emitted for the full
// static core schema + one dynamic collection (captured from an origin/main
// scratch worktree; MySQL via generateMigration because 0.31's MySQL
// pushSchema returned empty lists — the W1 bug). This test replays them into
// a fresh database and pins the upgrade contract per dialect:
//
//   PostgreSQL — v1 proposes NOTHING. Strict zero (spike 1.4,
//     institutionalized).
//   MySQL — ONE reconcile: 0.31-era schema defs baked module-load-time
//     literal datetime defaults (a Date-object default, latent main bug the
//     broken 0.31 MySQL differ never surfaced). The v1-branch defs normalize
//     to DEFAULT CURRENT_TIMESTAMP (D4), so the first pass emits only
//     metadata `MODIFY COLUMN … DEFAULT CURRENT_TIMESTAMP` statements; after
//     apply, the second pass is ZERO and data survives.
//   SQLite — ONE reconcile: 0.31 emitted standalone UNIQUE indexes where v1
//     represents inline UNIQUE, so the first pass rebuilds the affected
//     metadata tables via the data-preserving __new_ block (which the
//     destructive-statement scanner must NOT flag); after apply, the second
//     pass is ZERO and data survives.
//
// Re-runs on every future Drizzle pin bump — wording/convention drift in a
// new version shows up here before any user hits it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool } from "mysql2";
import { Pool } from "pg";
import { is } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import { PgTable } from "drizzle-orm/pg-core";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import {
  getMySQLDrizzleKit,
  getPgDrizzleKit,
  getSQLiteDrizzleKit,
} from "../../../../../database/drizzle-kit-lazy";
import * as mysqlTables from "../../../../../schemas/_dialect-bundles/mysql";
import * as pgTables from "../../../../../schemas/_dialect-bundles/postgres";
import * as sqliteTables from "../../../../../schemas/_dialect-bundles/sqlite";
import {
  generateRuntimeSchema,
  type FieldDefinition,
} from "../../../services/runtime-schema-generator";
import { findUnexpectedDestructiveStatements } from "../../filter-unsafe-statements";
import { isIdempotencyError } from "../../sql-statement-utils";

interface Fixture {
  capturedFrom: string;
  dynamicFields: FieldDefinition[];
  statements: string[];
}

function loadFixture(dialect: string): Fixture {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures-045", `${dialect}.json`), "utf-8")
  ) as Fixture;
}

// The bundles are pure table modules since Phase 4, but keep the guard so a
// future re-export of something non-table doesn't silently join the diff.
// Symbol-based (drizzle's is()) rather than name-based: a helper export
// whose name doesn't say "relations" must still be excluded.
function onlyTables(bundle: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bundle)) {
    if (is(v, PgTable) || is(v, MySqlTable) || is(v, SQLiteTable)) out[k] = v;
  }
  return out;
}

// Core tables that did not exist when fixtures-045 was captured, so an
// existing user upgrading legitimately gets them created. Their creation is
// additive/non-destructive; every OTHER table must still diff to zero. After
// applying the additive statements, a second pass must be zero too, which is
// what proves these new tables themselves round-trip cleanly (no phantom diffs
// forever, the same contract the pre-existing tables are held to).
const POST_045_TABLES = [
  "nextly_events",
  "nextly_webhooks",
  "nextly_webhook_deliveries",
  "nextly_versions",
  // Absent from this list for as long as the upgrade did not actually create
  // it: it was declared in getCoreSchema, which the diff reads, but missing
  // from the dialect bundle, which the apply pushes, so it was proposed on
  // every reconcile and emitted by none. Now that the bundle carries it the
  // upgrade creates it like any other post-0.45 table — and the pass-2
  // assertion below is what proves it then round-trips to silence rather than
  // being re-proposed forever.
  "nextly_i18n_archive",
  // A post-0.45 table like the others: the upgrade emits its CREATE TABLE, its
  // indexes and (on PostgreSQL) its foreign key, and this list is what marks
  // those statements legitimate rather than phantom diffs.
  "email_deliveries",
  // The field-group migration's lock. It was created on demand by the migration
  // and invisible to the pipeline until it was declared in the core schema and
  // the dialect bundles; from that point an existing install legitimately gains
  // it on upgrade, exactly like the tables above. Listing it here is not a
  // waiver — the pass-2 assertion below is what proves the declaration then
  // round-trips to silence instead of being re-proposed on every reconcile.
  "nextly_field_group_lock",
  // The release tables, post-0.45 like the others: an existing install gains
  // them on upgrade, so their CREATE TABLE and indexes are legitimate rather
  // than phantom. Both are named because the members table is a separate
  // object, and a list carrying only the parent would leave every statement
  // touching the child reading as a phantom diff.
  "nextly_releases",
  "nextly_release_members",
  // The durable job queue, post-0.45 like the tables above: an existing install
  // gains it on upgrade, so its CREATE TABLE and its indexes are legitimate
  // rather than phantom. The pass-2 assertion below is what proves the
  // declaration reaches the dialect bundles as well as the core schema — a
  // table present in only one of the two is re-proposed on every reconcile
  // instead of round-tripping to silence.
  "nextly_jobs",
  // The document soft lock, post-0.45 like the tables above: an existing
  // install gains it on upgrade, so its CREATE TABLE and its two indexes are
  // legitimate rather than phantom. The pass-2 assertion below is what proves
  // the declaration round-trips — this table is reached through the core
  // schema, the dialect bundles AND the SQLite bootstrap DDL, and a shape that
  // disagrees between any two of them is re-proposed on every reconcile rather
  // than settling to silence.
  "nextly_document_lock",
  // One reader's dashboard arrangement, post-0.45 like the tables above: an
  // existing install gains it on upgrade, so its CREATE TABLE is legitimate
  // rather than phantom. The pass-2 assertion below is what proves the
  // declaration round-trips — this table is reached through the core schema,
  // the dialect bundles AND the SQLite bootstrap DDL, and a shape that
  // disagrees between any two of them is re-proposed on every reconcile
  // instead of settling to silence. It declares no index, so the CREATE TABLE
  // is the whole of what an upgrade emits for it.
  "nextly_widget_layout",
];

// The post-045 names are static identifiers, but escape defensively so the
// generated RegExp can never carry a metacharacter (also silences the
// variable-in-regex lint).
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-identifier match tolerant of the per-dialect quoting drizzle-kit emits
// ("pg" / `mysql` / bare), so a table whose name merely contains an allowlisted
// name cannot slip through on a substring.
const namesPost045Table = (stmt: string): boolean =>
  POST_045_TABLES.some(t =>
    new RegExp(`[\`"\\s(]${escapeRegExp(t)}[\`"\\s)(]`).test(stmt)
  );

// Only additive DDL is acceptable in the upgrade sim: CREATE TABLE, CREATE
// [UNIQUE] INDEX, or ALTER TABLE ... ADD (the shape drizzle-kit emits for a
// new table's FK constraints). A destructive statement (DROP/RENAME/ALTER
// COLUMN) never starts with one of these prefixes, so the positive allowlist
// rejects it without a separate blocklist -- which also avoids false-flagging
// the word DELETE inside a legitimate `... ADD CONSTRAINT ... ON DELETE ...`.
const ADDITIVE_STATEMENT =
  /^(CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX|ALTER TABLE .+ ADD\b)/i;

const isPost045TableStatement = (stmt: string): boolean =>
  ADDITIVE_STATEMENT.test(stmt.trim()) && namesPost045Table(stmt);

// The `created_by` system owner column is nullable with no default, so on a
// schema captured before it existed the v1 upgrade legitimately emits one
// additive `ADD COLUMN created_by` per pre-existing collection table (the
// zero-backfill upgrade the feature promises). That add names a table outside
// the post-0.45 allowlist, so it is accepted here explicitly rather than being
// mistaken for a phantom diff. Tolerant of pg ("created_by") and MySQL
// (`created_by`) quoting and the optional COLUMN keyword.
// `plugin_options` is the same shape as `created_by`: a nullable column with no
// default, added to a system table that predates this fixture. A contributed
// field type's own options have no column of their own, so the row carries them
// whole; an install upgrading across this change legitimately gains the column,
// and the pass-2 assertion is what proves it then round-trips to silence.
const addsPluginOptionsColumn = (stmt: string): boolean =>
  /^ALTER TABLE .+ ADD (COLUMN )?[`"]?plugin_options[`"]?\b/i.test(stmt.trim());

const addsOwnerColumn = (stmt: string): boolean =>
  /^ALTER TABLE .+ ADD (COLUMN )?[`"]?created_by[`"]?\b/i.test(stmt.trim());

// The `versions` config column is additive (nullable) on the pre-existing
// dynamic_collections / dynamic_singles registry tables, so a v1 upgrade of a
// schema captured before it emits one additive `ADD COLUMN versions` per table.
// Accept it like the owner column above rather than mistaking it for a phantom
// diff. Scoped to the two registry tables (versions is added nowhere else) so
// an unrelated `ADD versions` on some other table can't mask a regression.
// Tolerant of pg/MySQL quoting and the optional COLUMN keyword.
const addsVersionsColumn = (stmt: string): boolean =>
  /^ALTER TABLE [`"]?(dynamic_collections|dynamic_singles)[`"]? ADD (COLUMN )?[`"]?versions[`"]?\b/i.test(
    stmt.trim()
  );

// The `revalidate` config column is additive (nullable) on the pre-existing
// dynamic_collections / dynamic_singles registry tables, exactly like
// `versions` above, so a v1 upgrade of a schema captured before it emits one
// additive `ADD COLUMN revalidate` per table. Accept it rather than mistaking
// it for a phantom diff. Scoped to the two registry tables (revalidate is added
// nowhere else). Tolerant of pg/MySQL quoting and the optional COLUMN keyword.
const addsRevalidateColumn = (stmt: string): boolean =>
  /^ALTER TABLE [`"]?(dynamic_collections|dynamic_singles)[`"]? ADD (COLUMN )?[`"]?revalidate[`"]?\b/i.test(
    stmt.trim()
  );

// The `webhooks` recording-policy column is additive (nullable) on the
// pre-existing dynamic_collections / dynamic_singles registry tables, exactly
// like `revalidate` above, so a v1 upgrade of a schema captured before it emits
// one additive `ADD COLUMN webhooks` per table. Accept it rather than mistaking
// it for a phantom diff. Scoped to the two registry tables (webhooks is added
// nowhere else). Tolerant of pg/MySQL quoting and the optional COLUMN keyword.
const addsWebhooksColumn = (stmt: string): boolean =>
  /^ALTER TABLE [`"]?(dynamic_collections|dynamic_singles)[`"]? ADD (COLUMN )?[`"]?webhooks[`"]?\b/i.test(
    stmt.trim()
  );

// The `preview_token_generation` column is additive on `site_settings`, which
// predates this fixture, so a v1 upgrade of a schema captured before it emits
// one `ADD COLUMN`. It is NOT NULL with a default of 0, which is data-preserving
// on an existing row: 0 is the generation every preview link minted before any
// revoke already carries, so the backfill leaves those links working rather than
// refusing them all. Scoped to `site_settings` and to that column, so an
// unrelated NOT NULL addition cannot ride in behind it. Tolerant of pg/MySQL
// quoting and the optional COLUMN keyword.
const addsPreviewGenerationColumn = (stmt: string): boolean =>
  /^ALTER TABLE [`"]?site_settings[`"]? ADD (COLUMN )?[`"]?preview_token_generation[`"]?\b/i.test(
    stmt.trim()
  );

// `activity_log` carried `user_id` with a cascading foreign key when this
// fixture was captured, which meant deleting a user destroyed their entire
// activity trail. Undoing that is a one-time migration on a table that predates
// the fixture, so it lands outside every allowlist above: the key is dropped,
// the two identity columns become nullable so a deleted account's name and
// email can be erased without deleting the row, and `identity_erased_at` is
// added. Every one of those is data-preserving — nothing here drops a column or
// a row — and the pass-2 assertion is what proves the new shape then
// round-trips to silence rather than being re-proposed forever.
//
// Scoped to `activity_log` and to those exact columns, so an unrelated
// constraint drop or a widening of some other table cannot ride in behind it.
// Tolerant of pg ("x") and MySQL (`x`) quoting, of the optional COLUMN keyword,
// and of the three ways the dialects spell these edits. Making a column
// nullable: pg emits `ALTER COLUMN ... DROP NOT NULL`, MySQL restates the whole
// column with `MODIFY COLUMN`. Dropping the key: pg emits `DROP CONSTRAINT`,
// MySQL emits `DROP FOREIGN KEY` and additionally drops the index it maintains
// behind every foreign key — a standalone `DROP INDEX ... ON activity_log`
// naming that same constraint, which is part of removing the key rather than a
// loss of a real index.
const ACTIVITY_LOG_FK = "activity_log_user_id_users_id_fk";

const migratesActivityLogActor = (stmt: string): boolean => {
  const s = stmt.trim();

  // MySQL's companion index drop is the one edit that does not start with
  // ALTER TABLE, so it is matched on its own, still pinned to both the table
  // and the exact constraint name.
  if (
    new RegExp(
      `^DROP INDEX [\`"]?${ACTIVITY_LOG_FK}[\`"]? ON [\`"]?activity_log[\`"]?`,
      "i"
    ).test(s)
  ) {
    return true;
  }

  if (!/^ALTER TABLE [`"]?activity_log[`"]? /i.test(s)) return false;
  return (
    // The cascade goes.
    new RegExp(
      `\\bDROP (CONSTRAINT|FOREIGN KEY) [\`"]?${ACTIVITY_LOG_FK}[\`"]?`,
      "i"
    ).test(s) ||
    // The identity columns become erasable.
    /\bALTER COLUMN [`"]?(user_name|user_email)[`"]? DROP NOT NULL/i.test(s) ||
    /\bMODIFY COLUMN [`"]?(user_name|user_email)[`"]?\s+\w+(\([^)]*\))?\s*;?$/i.test(
      s
    ) ||
    // The marker that says an identity was erased, and when.
    /\bADD (COLUMN )?[`"]?identity_erased_at[`"]?\b/i.test(s)
  );
};

/**
 * The auth log gains the same erasure marker the activity log has, and for the
 * same reason: `ip_address` and `user_agent` are nullable for rows that never
 * carried them, so a bare NULL cannot say whether a person was erased.
 *
 * Pinned to the table AND the column rather than allowing any ALTER on it, so a
 * future unintended change to `audit_log` still fails as a phantom diff.
 */
const addsAuditLogErasureStamp = (stmt: string): boolean => {
  const s = stmt.trim().replace(/;$/, "");
  // The WHOLE statement must be the single ADD, not merely contain one. A
  // substring match would admit `ALTER TABLE audit_log ADD identity_erased_at
  // ..., DROP COLUMN ip_address` — a destructive change riding through the
  // guard on the additive clause beside it.
  return /^ALTER TABLE [`"]?audit_log[`"]? ADD (COLUMN )?[`"]?identity_erased_at[`"]?[^,]*$/i.test(
    s
  );
};

/**
 * The activity log gains the LANGUAGE a mutation was made in.
 *
 * The feed authorizes each row's document as the caller, and a stored `custom`
 * read rule is a predicate over the collection's own fields — which answer
 * differently per translation. Without the column a row is judged against the
 * default language, so an edit made in a language the rule denies could still
 * show its title.
 *
 * Pinned to the table AND the column, and required to be the WHOLE statement,
 * for the reason the erasure stamp above gives: a substring match would admit a
 * destructive clause riding through beside the additive one.
 */
const addsActivityLocaleColumn = (stmt: string): boolean => {
  const s = stmt.trim().replace(/;$/, "");
  return /^ALTER TABLE [`"]?activity_log[`"]? ADD (COLUMN )?[`"]?locale[`"]?[^,]*$/i.test(
    s
  );
};

// Positive guard: the sim must actually create each new table (an empty first
// pass would otherwise satisfy the additive-only check vacuously).
const hasCreateTableFor = (stmts: string[], table: string): boolean =>
  stmts.some(s =>
    // Trailing `[\s(]` requires a real identifier boundary after the name, so
    // `nextly_webhooks` does not match `CREATE TABLE nextly_webhooks_archive`.
    new RegExp(
      `^CREATE TABLE\\s+(IF NOT EXISTS\\s+)?[\`"]?${escapeRegExp(table)}[\`"]?[\\s(]`,
      "i"
    ).test(s.trim())
  );

describe("existing-user upgrade sim (0.45 DDL → v1)", () => {
  it("sqlite: one data-preserving reconcile, then zero", async () => {
    const fixture = loadFixture("sqlite");
    const sqlite = new Database(":memory:");
    try {
      for (const stmt of fixture.statements) sqlite.exec(stmt);
      // Data that must survive the reconcile rebuild.
      sqlite
        .prepare(
          `INSERT INTO dynamic_collections
             (id, slug, labels, table_name, fields, schema_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "dc-1",
          "articles",
          "{}",
          "dc_upgrade_articles",
          "[]",
          "hash",
          1700000000,
          1700000000
        );

      const db = drizzleSqlite({ client: sqlite });
      const kit = await getSQLiteDrizzleKit();
      const { schemaRecord } = generateRuntimeSchema(
        "dc_upgrade_articles",
        fixture.dynamicFields,
        "sqlite"
      );
      const desired = { ...onlyTables(sqliteTables as never), ...schemaRecord };

      // Pass 1: the documented reconcile. Only data-preserving rebuild
      // blocks + index statements are acceptable — the scanner is the
      // arbiter of "data-preserving".
      const first = await kit.pushSchema(desired, db);
      expect(findUnexpectedDestructiveStatements(first.sqlStatements)).toEqual(
        []
      );
      expect(first.hints).toEqual([]);
      await first.apply();

      // Data survived the rebuild.
      const row = sqlite
        .prepare("SELECT slug FROM dynamic_collections WHERE id = 'dc-1'")
        .get() as { slug: string } | undefined;
      expect(row?.slug).toBe("articles");

      // Pass 2: silence.
      const second = await kit.pushSchema(desired, db);
      expect(second.sqlStatements).toEqual([]);
      expect(second.hints).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it.skipIf(!process.env.TEST_POSTGRES_URL)(
    "postgres: only additive new-table creates, then zero",
    async () => {
      const fixture = loadFixture("postgres");
      const admin = new Pool({
        connectionString: process.env.TEST_POSTGRES_URL,
      });
      await admin.query("DROP DATABASE IF EXISTS nextly_upgrade_v1");
      await admin.query("CREATE DATABASE nextly_upgrade_v1");
      const url = new URL(process.env.TEST_POSTGRES_URL as string);
      url.pathname = "/nextly_upgrade_v1";
      const pool = new Pool({ connectionString: url.toString() });
      try {
        for (const stmt of fixture.statements) await pool.query(stmt);
        const db = drizzlePg({ client: pool });
        const kit = await getPgDrizzleKit();
        const { schemaRecord } = generateRuntimeSchema(
          "dc_upgrade_articles",
          fixture.dynamicFields,
          "postgresql"
        );
        const desired = { ...onlyTables(pgTables as never), ...schemaRecord };

        // Pass 1: v1 proposes NOTHING for the pre-existing 0.31 schema — the
        // only statements are the additive creates for tables added after the
        // fixture was captured. Any statement touching an untouched table is a
        // phantom diff and fails here.
        const first = await kit.pushSchema(desired, db, {
          schemas: ["public"],
        });
        for (const s of first.sqlStatements) {
          expect(
            isPost045TableStatement(s) ||
              addsOwnerColumn(s) ||
              addsPluginOptionsColumn(s) ||
              addsVersionsColumn(s) ||
              addsRevalidateColumn(s) ||
              addsWebhooksColumn(s) ||
              migratesActivityLogActor(s) ||
              addsAuditLogErasureStamp(s) ||
              addsActivityLocaleColumn(s) ||
              addsPreviewGenerationColumn(s),
            `phantom diff: ${s}`
          ).toBe(true);
        }
        for (const t of POST_045_TABLES) {
          expect(
            hasCreateTableFor(first.sqlStatements, t),
            `missing CREATE TABLE for ${t}`
          ).toBe(true);
        }
        expect(first.hints).toEqual([]);
        await first.apply();

        // Pass 2: silence — the new tables round-trip with no phantom diffs.
        const second = await kit.pushSchema(desired, db, {
          schemas: ["public"],
        });
        expect(second.sqlStatements).toEqual([]);
        expect(second.hints).toEqual([]);
      } finally {
        await pool.end();
        await admin.query("DROP DATABASE IF EXISTS nextly_upgrade_v1");
        await admin.end();
      }
    }
  );

  it.skipIf(!process.env.TEST_MYSQL_URL)(
    "mysql: one metadata-only default reconcile, then zero",
    async () => {
      const fixture = loadFixture("mysql");
      const bootstrap = createPool({ uri: process.env.TEST_MYSQL_URL });
      await bootstrap
        .promise()
        .query("DROP DATABASE IF EXISTS nextly_upgrade_v1");
      await bootstrap.promise().query("CREATE DATABASE nextly_upgrade_v1");
      const url = new URL(process.env.TEST_MYSQL_URL as string);
      url.pathname = "/nextly_upgrade_v1";
      const pool = createPool({ uri: url.toString() });
      try {
        const p = pool.promise();
        for (const stmt of fixture.statements) await p.query(stmt);
        // Data that must survive the reconcile.
        await p.query(
          "INSERT INTO roles (id, name, slug, level) VALUES ('r-1', 'Upgrader', 'upgrader', 5)"
        );

        const db = drizzleMysql({ client: pool });
        const kit = await getMySQLDrizzleKit();
        const { schemaRecord } = generateRuntimeSchema(
          "dc_upgrade_articles",
          fixture.dynamicFields,
          "mysql"
        );
        const desired = {
          ...onlyTables(mysqlTables as never),
          ...schemaRecord,
        };

        // Pass 1: the literal-default → CURRENT_TIMESTAMP MODIFYs (metadata
        // only; instant; non-destructive), plus the additive creates for
        // tables added after the fixture was captured. Nothing else.
        const first = await kit.pushSchema(desired, db, "nextly_upgrade_v1");
        expect(first.hints).toEqual([]);
        for (const s of first.sqlStatements) {
          const isDefaultReconcile =
            /^ALTER TABLE `[^`]+` MODIFY COLUMN `[^`]+` datetime DEFAULT \(?CURRENT_TIMESTAMP\)? NOT NULL;?$/.test(
              s
            );
          expect(
            isDefaultReconcile ||
              isPost045TableStatement(s) ||
              addsOwnerColumn(s) ||
              addsPluginOptionsColumn(s) ||
              addsVersionsColumn(s) ||
              addsRevalidateColumn(s) ||
              addsWebhooksColumn(s) ||
              migratesActivityLogActor(s) ||
              addsAuditLogErasureStamp(s) ||
              addsActivityLocaleColumn(s) ||
              addsPreviewGenerationColumn(s),
            `unexpected reconcile statement shape: ${s}`
          ).toBe(true);
        }
        for (const t of POST_045_TABLES) {
          expect(
            hasCreateTableFor(first.sqlStatements, t),
            `missing CREATE TABLE for ${t}`
          ).toBe(true);
        }
        // Applied statement by statement with the SAME tolerance the product
        // uses, not through the kit's own `apply()`. No upgrade path calls
        // that: `freshPushSchema` executes the statements itself and skips the
        // ones a reconcile has already satisfied. The distinction is load-
        // bearing on MySQL, where removing a foreign key emits both a
        // `DROP CONSTRAINT` and a `DROP INDEX` for the index the server keeps
        // behind that key — the first statement removes both, so the second
        // reports the key already gone. Applying via the kit here would fail
        // the sim on a migration real users complete.
        for (const stmt of first.sqlStatements) {
          try {
            await p.query(stmt);
          } catch (err) {
            if (!isIdempotencyError(err)) throw err;
          }
        }

        const [rows] = (await p.query(
          "SELECT slug FROM roles WHERE id = 'r-1'"
        )) as unknown as [Array<{ slug: string }>];
        expect(rows[0]?.slug).toBe("upgrader");

        // Pass 2: silence.
        const second = await kit.pushSchema(desired, db, "nextly_upgrade_v1");
        expect(second.sqlStatements).toEqual([]);
        expect(second.hints).toEqual([]);
      } finally {
        await new Promise<void>(res => pool.end(() => res()));
        await bootstrap
          .promise()
          .query("DROP DATABASE IF EXISTS nextly_upgrade_v1");
        await new Promise<void>(res => bootstrap.end(() => res()));
      }
    }
  );
});
