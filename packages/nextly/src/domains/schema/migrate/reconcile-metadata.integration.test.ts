/**
 * A row left `pending` by a production migrate becomes `applied` — on a real
 * database, on every dialect.
 *
 * 🔴 The unit suite beside this proves the sweep's decisions with a fake
 * adapter. It cannot prove the two calls the decision rests on actually work:
 * `getRecordsWithPendingMigrations` filters `migration_status IN
 * ('pending','generated')` through `adapter.select`, and `tableExists` is
 * implemented per dialect against three different catalogs. Both are exactly
 * the kind of thing that passes against a stub and fails against MySQL.
 *
 * The scenario is the production one, which is the only reason this task
 * existed: a collection is registered with its row `pending`, the DDL lands
 * separately (as `nextly migrate` applies it), and nothing ever reconciles the
 * two because the only writer sits behind `NODE_ENV === "development"`.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SchemaEventsRepository } from "../events/schema-events-repository";

import {
  createTestDatabase,
  type TestDatabase,
} from "../../../__tests__/database/setup";
import { reconcileCore } from "./core-reconcile";

import { reconcileMigrationMetadata } from "./reconcile-metadata";

type Dialect = "sqlite" | "postgresql" | "mysql";

const silent = { info: () => {}, warn: () => {}, debug: () => {} };

/**
 * Whether this leg has a database to talk to.
 *
 * 🔴 Reads the ENV VAR, not `getTestDatabaseUrl`. That helper falls back to a
 * default pointing at the conventional ports (5432, 3306), while this
 * repository's throwaway containers listen on 5435 and 3307 — so it returns a
 * usable-looking string whether or not anything is there, and a check written
 * against it never skips. The first version of this file did exactly that and
 * reported three connection refusals as test failures.
 *
 * SQLite is always available, in memory.
 */
function configured(type: Dialect): boolean {
  if (type === "sqlite") return true;
  const url =
    type === "postgresql"
      ? (process.env.TEST_POSTGRES_URL ?? process.env.TEST_DATABASE_URL)
      : process.env.TEST_MYSQL_URL;
  return Boolean(url);
}

/**
 * Test-owned table names, prefixed per file.
 *
 * The repository requires this of tables a suite creates itself: the
 * integration run is sequential and shares one database per dialect, so a
 * generic `dc_posts` would collide with any other suite that wanted the same
 * obvious name.
 */
const TABLE = {
  posts: "dc_reconcile_meta_posts",
  drafts: "dc_reconcile_meta_drafts",
  pages: "dc_reconcile_meta_pages",
  edited: "dc_reconcile_meta_edited",
} as const;

/**
 * Registry SLUGS owned by this file, prefixed for the same reason the tables
 * are.
 *
 * 🔴 Not `posts` / `pages`. The integration run is sequential against one
 * database per dialect, and this suite DELETES its slugs to stay repeatable —
 * so generic names meant deleting rows other suites had created. Measured: the
 * publish-enforcement suites passed alone and failed fifteen tests in a batch
 * run, entirely because of this cleanup.
 */
const SLUG = {
  posts: "reconcile_meta_posts",
  drafts: "reconcile_meta_drafts",
  pages: "reconcile_meta_pages",
  edited: "reconcile_meta_edited",
} as const;

const DIALECTS: Dialect[] = ["sqlite", "postgresql", "mysql"];

describe.each(DIALECTS.filter(configured))(
  "reconcileMigrationMetadata on %s",
  type => {
    let testDb: TestDatabase;

    /**
     * A connected database with the core schema present.
     *
     * 🔴 Retried WITHOUT schema creation, because the Postgres and MySQL
     * containers are long-lived and shared: the integration run is sequential
     * against one database per dialect, so whichever suite runs first creates
     * the schema and every later `createSchema` collides on an index that is
     * already there (`relation "users_email_unique" already exists`). The
     * second attempt is the ordinary case on a warm container; the first is
     * what a fresh one needs.
     */
    /**
     * A connected database whose CORE tables exist.
     *
     * 🔴 Provisioned by `reconcileCore`, the same push `nextly migrate` runs in
     * Phase 1 — not by the fixture's `createSchema`. That path builds the whole
     * application schema and cannot do it on MySQL at all: it emits a TEXT
     * `session_token` inside a key, which MySQL refuses without a key length.
     * That limitation is the fixture's and predates this suite; going through
     * the production reconciler instead gets the one table this test needs, on
     * every dialect, from the code that really creates it.
     */
    beforeEach(async () => {
      testDb = await createTestDatabase({ type, createSchema: false });

      /*
       * 🔴 Provisioned ONLY when the registry table is genuinely absent, and
       * the guard is the whole point. `reconcileCore` is a schema PUSH: run
       * unconditionally against the long-lived Postgres and MySQL containers
       * this suite shares with every other integration file, it rewrites core
       * tables underneath them. Measured: running it in each `beforeEach` broke
       * twelve publish-enforcement tests that pass on a clean tree and pass
       * when this file runs alone — a fixture reaching outside its own subject.
       *
       * The fixture's own `createSchema` is not used instead, because it builds
       * the whole application schema and cannot do it on MySQL at all: it emits
       * a TEXT `session_token` inside a key, which MySQL refuses without a key
       * length. That limitation predates this suite.
       */
      /*
       * The ledger, provisioned on its own and only when absent.
       *
       * 🔴 Separate from the `reconcileCore` guard below, and not folded into
       * it. That guard asks about `dynamic_collections`, which the shared
       * Postgres container already has from whichever suite ran first — so the
       * push is skipped and `nextly_schema_events` is never created, which is
       * a table only the shape evidence needs. Widening the guard to run the
       * whole core push whenever the ledger is missing would rewrite core
       * tables underneath every other suite; the production DDL helper creates
       * exactly the one table and nothing else.
       */
      if (!(await testDb.adapter.tableExists("nextly_schema_events"))) {
        const { getSchemaEventsDdl } = await import(
          "../events/schema-events-ddl"
        );
        for (const stmt of getSchemaEventsDdl(
          testDb.adapter.dialect as never
        )) {
          // Unguarded: a ledger that cannot be created makes every shape
          // verdict `unknown`, which would leave the test passing for a reason
          // that has nothing to do with the code it names.
          await testDb.adapter.executeQuery(stmt);
        }
      }

      if (!(await testDb.adapter.tableExists("dynamic_collections"))) {
        await reconcileCore({
          db: testDb.adapter.getDrizzle(),
          dialect: testDb.adapter.dialect as never,
          logger: { info: () => {}, warn: () => {} },
        } as never);
      }
    });

    afterEach(async () => {
      // The test-owned tables are dropped explicitly: the database outlives the
      // run, so a table left standing makes the NEXT run's "table does not
      // exist" case silently untrue.
      for (const name of Object.values(TABLE)) {
        await testDb?.adapter
          .executeQuery(`DROP TABLE IF EXISTS ${name}`)
          .catch(() => {});
      }
      await testDb?.adapter
        .executeQuery(
          // Derived from SLUG rather than listed again: a name added to the
          // map above must not be able to outlive the run that created it.
          `DELETE FROM dynamic_collections WHERE slug IN (${Object.values(SLUG)
            .map(v => `'${v}'`)
            .join(",")})`
        )
        .catch(() => {});
      // Guarded: when `beforeEach` throws (an unreachable database, say),
      // `testDb` is undefined and an unguarded cleanup reports a TypeError that
      // buries the connection error underneath it.
      /*
       * 🔴 DISCONNECT, never `cleanup()`. That helper drops EVERY table on
       * Postgres and MySQL before disconnecting -- fine for a database a suite
       * owns, catastrophic for the long-lived containers this run shares
       * sequentially with a hundred other files. Measured: calling it here
       * destroyed the schema underneath the publish-enforcement suites and
       * failed twelve of their tests, which pass on a clean tree and pass when
       * this file runs alone.
       *
       * The rows and tables this file created are removed above, by name, which
       * is the amount of cleanup it is entitled to do.
       */
      await testDb?.adapter.disconnect().catch(() => {});
    });

    /**
     * A registry row that is already behind: registered, and still `pending`.
     *
     * 🔴 Inserted through the adapter rather than through
     * `registerCollection`, and the reason is worth stating. That path asserts
     * global slug availability across collections, singles AND field groups, so
     * it reads registry tables this test has no reason to care about -- the
     * first version failed on a missing `dynamic_singles` and the failure was
     * entirely the fixture's, not the sweep's. Writing the row directly keeps
     * the test pointed at what it names.
     */
    async function pendingCollection(
      slug: string,
      tableName: string
    ): Promise<void> {
      // Cleared BEFORE inserting, not only after. The database outlives the
      // run, so a row stranded by an earlier failure would fail this insert on
      // its primary key — reporting leftover state as a defect in the code
      // under test, which is exactly how a shared container wastes an
      // afternoon.
      await testDb.adapter
        .executeQuery(`DELETE FROM dynamic_collections WHERE slug = '${slug}'`)
        .catch(() => {});
      await testDb.adapter.insert("dynamic_collections", {
        id: `${slug}-id`,
        slug,
        labels: { singular: slug, plural: slug },
        tableName,
        fields: [],
        status: true,
        source: "ui",
        locked: false,
        schemaHash: "test",
        schemaVersion: 1,
        migrationStatus: "pending",
      } as never);
    }

    /**
     * A table that EXISTS. Nothing else about it is under test.
     *
     * 🔴 Deliberately not built through the production DDL generator, and the
     * reason is what the sweep asks. `markApplied` calls `tableExists(name)` and
     * reads no column, no key and no type — so this stands in for "the DDL
     * landed", not for a collection's physical table. A shape drifting from what
     * production creates cannot make this test wrong, because no assertion here
     * depends on the shape.
     *
     * The repository's rule against hand-copied DDL is about fixtures that MODEL
     * a real table and silently stop matching it; the guard against becoming
     * that is the sweep's own narrowness. If it ever inspects columns — verifying
     * a schema change rather than existence, which is the direction this is
     * heading — this must be built by the generator that creates the real thing,
     * because then the shape would be the subject.
     *
     * One column, portable across all three dialects, so the statement carries
     * no shape worth mistaking for a model of anything.
     */
    async function createStandInTable(name: string): Promise<void> {
      await testDb.adapter.executeQuery(
        `CREATE TABLE ${name} (id varchar(36) NOT NULL)`
      );
    }

    /** What the registry now says about one slug, read straight from the row. */
    async function statusOf(slug: string): Promise<string | undefined> {
      const rows = (await testDb.adapter.select("dynamic_collections", {
        where: { and: [{ column: "slug", op: "=", value: slug }] },
      })) as { migrationStatus?: string }[];
      return rows[0]?.migrationStatus;
    }

    it("moves a pending row to applied once its table exists", async () => {
      await pendingCollection(SLUG.posts, TABLE.posts);

      // The control: the row really is behind before the sweep runs, so a
      // reconcile that did nothing could not produce the assertion below.
      expect(await statusOf(SLUG.posts)).toBe("pending");

      // The DDL, as a migration file would have applied it.
      await createStandInTable(TABLE.posts);

      const result = await reconcileMigrationMetadata({
        adapter: testDb.adapter as never,
        dialect: testDb.adapter.dialect as never,
        migrationsDir: "/tmp/nextly-no-migrations",
        logger: silent,
      });

      expect(result.marked).toBeGreaterThanOrEqual(1);
      expect(await statusOf(SLUG.posts)).toBe("applied");
    });

    /*
     * 🔴 The row a migration has not reached yet is LEFT ALONE, on a real
     * database. `updateMigrationStatusWithVerification` would write `failed`
     * here, and after a migrate run "no table" cannot distinguish a migration
     * that failed from one that was never generated -- so condemning it turns a
     * collection still waiting for its DDL into one somebody has to repair by
     * hand.
     */
    it("leaves a pending row alone when its table does not exist", async () => {
      await pendingCollection(SLUG.drafts, TABLE.drafts);

      const result = await reconcileMigrationMetadata({
        adapter: testDb.adapter as never,
        dialect: testDb.adapter.dialect as never,
        migrationsDir: "/tmp/nextly-no-migrations",
        logger: silent,
      });

      expect(result.stillPending).toBeGreaterThanOrEqual(1);
      expect(await statusOf(SLUG.drafts)).toBe("pending");
    });

    it("is safe to run twice", async () => {
      // It runs on every invocation of `migrate`, so a second pass over an
      // already-applied row must be a no-op rather than an error or a rewrite.
      await pendingCollection(SLUG.pages, TABLE.pages);
      await createStandInTable(TABLE.pages);

      const deps = {
        adapter: testDb.adapter as never,
        dialect: testDb.adapter.dialect as never,
        migrationsDir: "/tmp/nextly-no-migrations",
        logger: silent,
      };
      await reconcileMigrationMetadata(deps);
      const second = await reconcileMigrationMetadata(deps);

      // Nothing left pending to mark, and the row is still applied.
      expect(second.marked).toBe(0);
      expect(await statusOf(SLUG.pages)).toBe("applied");
    });

    /*
     * 🔴 The case table existence cannot answer, end to end on a real database
     * with a real ledger. An edited entity keeps its old physical table, so the
     * existence check that governs every other test here says yes — and the row
     * must still be held back until the migration carrying its change has run.
     *
     * The migration is a real `.sql` file with a real entity header, and the
     * ledger rows go in through `recordStart`/`markApplied`, the same calls
     * `reconcileFile` makes — so the evidence this reads is the evidence
     * production writes.
     */
    it("holds a row an unapplied migration names, then promotes it", async () => {
      const dir = mkdtempSync(join(tmpdir(), "nextly-reconcile-header-"));
      writeFileSync(
        join(dir, "0002_edit_posts.sql"),
        [
          "-- Migration: edit_posts",
          `-- Collections: ${SLUG.edited}`,
          "-- Dialect: SQLite",
          "",
          "-- UP",
          `ALTER TABLE ${TABLE.edited} ADD COLUMN body text;`,
          "",
          "-- DOWN",
          "-- (none)",
        ].join("\n")
      );

      const events = new SchemaEventsRepository(
        testDb.adapter.getDrizzle(),
        testDb.adapter.dialect as never
      );
      const record = async (filename: string): Promise<void> => {
        const id = await events.recordStart({
          eventType: "file_apply",
          source: "cli-migrate",
          filename,
        });
        await events.markApplied(id, { uniqueFilename: filename });
      };

      try {
        await pendingCollection(SLUG.edited, TABLE.edited);
        await createStandInTable(TABLE.edited);

        const held = await reconcileMigrationMetadata({
          adapter: testDb.adapter as never,
          dialect: testDb.adapter.dialect as never,
          migrationsDir: dir,
          logger: silent,
        });

        // The table exists, so the OLD rule would have promoted it here.
        expect(await testDb.adapter.tableExists(TABLE.edited)).toBe(true);
        expect(held.awaitingMigration).toBeGreaterThanOrEqual(1);
        expect(await statusOf(SLUG.edited)).toBe("pending");

        // Now that migration runs.
        await record("0002_edit_posts.sql");
        const promoted = await reconcileMigrationMetadata({
          adapter: testDb.adapter as never,
          dialect: testDb.adapter.dialect as never,
          migrationsDir: dir,
          logger: silent,
        });

        expect(promoted.awaitingMigration).toBe(0);
        expect(await statusOf(SLUG.edited)).toBe("applied");
      } finally {
        rmSync(dir, { recursive: true, force: true });
        await testDb.adapter
          .executeQuery(
            `DELETE FROM nextly_schema_events WHERE filename = '0002_edit_posts.sql'`
          )
          .catch(() => {});
      }
    });
  }
);
