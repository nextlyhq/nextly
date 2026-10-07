/**
 * `email_verified_via` reaches a fresh database and an existing one through
 * `migrateCore`, the core of `nextly migrate` and of both boot paths, and an
 * existing one comes out with every previously verified address marked
 * `"legacy"`.
 *
 * The existing database is the current core schema without the column, holding
 * accounts written before it existed: one verified, one not. The migrate has
 * to add the column AND mark the verified one, because a null beside a
 * verified address would read the same as "nothing recorded yet". A row a
 * current path wrote must never be relabelled, and a second run must change
 * nothing.
 *
 * Runs on every dialect with a database in this run, since the push that adds
 * the column is a different implementation per dialect.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  availableDialects,
  withFreshDatabase,
  type FreshDatabase,
} from "../../../../__tests__/helpers/fresh-database";
import { migrateCore } from "../../../../cli/commands/migrate";
import { getSchemaEventsDdl } from "../../events/schema-events-ddl";

interface Db {
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
  insert: (table: unknown) => { values: (v: unknown) => Promise<unknown> };
}

/** A logger for `migrateCore` that prints nothing. */
const silent = {
  header: () => {},
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  keyValue: () => {},
  divider: () => {},
  newline: () => {},
  item: () => {},
  table: () => {},
  spinner: () => ({ stop: () => {} }),
  setOptions: () => {},
  getOptions: () => ({}),
} as unknown as Parameters<typeof migrateCore>[0]["logger"];

/**
 * `nextly migrate` without its command-line shell: the same `migrateCore` the
 * CLI and both boot paths call, under its lock, with an app that has no
 * migration files of its own. Reports whether the core phase changed anything.
 */
async function migrate(
  fresh: FreshDatabase,
  migrationsDir: string
): Promise<boolean> {
  const { coreChanged } = await migrateCore({
    // A config that declares no schema hooks: the run is core-only.
    extensionSchema: undefined,
    dialect: fresh.dialect,
    db: fresh.db,
    // The shape the dev boot path hands over: a wrapper carrying the one
    // raw-statement method the core needs.
    adapter: {
      dialect: fresh.dialect,
      connect: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
      isConnected: () => true,
      getCapabilities: () => ({ dialect: fresh.dialect }),
      executeQuery: (statement: string) => fresh.exec(statement),
    } as unknown as Parameters<typeof migrateCore>[0]["adapter"],
    migrationsDir,
    logger: silent,
    lockMode: "fail-fast",
    // How the CLI bootstraps the ledger: only when it is absent.
    ensureLedger: async () => {
      if ((await fresh.columnsOf("nextly_schema_events")).length > 0) return;
      for (const statement of getSchemaEventsDdl(fresh.dialect)) {
        await fresh.exec(statement);
      }
    },
  });
  return coreChanged;
}

/** A timestamp literal each dialect's column takes. */
function at(fresh: FreshDatabase, iso: string): string {
  return fresh.dialect === "sqlite"
    ? String(Math.floor(new Date(iso).getTime() / 1000))
    : `'${iso.replace("T", " ").replace("Z", "")}'`;
}

/** An account as an install from before the column wrote it. */
async function insertLegacyUser(
  fresh: FreshDatabase,
  id: string,
  verified: boolean
): Promise<void> {
  const now = at(fresh, "2026-01-01T00:00:00Z");
  await fresh.exec(
    `INSERT INTO users (id, email, email_verified, is_active, failed_login_attempts, created_at, updated_at) ` +
      `VALUES ('${id}', '${id}@example.com', ${verified ? now : "NULL"}, ${fresh.dialect === "postgresql" ? "true" : "1"}, 0, ${now}, ${now})`
  );
}

async function via(fresh: FreshDatabase, id: string): Promise<unknown> {
  const { users } = fresh.tables;
  const [row] = await (fresh.db as unknown as Db)
    .select()
    .from(users)
    .where(eq(users.id, id));
  return row?.emailVerifiedVia;
}

/** An app with no migration files, so only the core phase has work to do. */
const NO_MIGRATIONS = mkdtempSync(join(tmpdir(), "nextly-evv-"));
afterAll(() => rmSync(NO_MIGRATIONS, { recursive: true, force: true }));

describe.each(availableDialects())(
  "email_verified_via through nextly migrate (%s)",
  dialect => {
    it("creates the column on a fresh database", async () => {
      await withFreshDatabase(dialect, "nextly_evv_fresh", async fresh => {
        expect(await fresh.columnsOf("users")).toEqual([]);

        await migrate(fresh, NO_MIGRATIONS);

        expect(await fresh.columnsOf("users")).toContain("email_verified_via");
      });
    }, 180_000);

    it("adds the column to an existing database and marks its verified addresses legacy", async () => {
      await withFreshDatabase(dialect, "nextly_evv_existing", async fresh => {
        await migrate(fresh, NO_MIGRATIONS);
        // An install from before the column: the same schema without it.
        await fresh.exec("ALTER TABLE users DROP COLUMN email_verified_via");
        expect(await fresh.columnsOf("users")).not.toContain(
          "email_verified_via"
        );
        await insertLegacyUser(fresh, "verified-before", true);
        await insertLegacyUser(fresh, "never-verified", false);

        expect(await migrate(fresh, NO_MIGRATIONS)).toBe(true);

        expect(await fresh.columnsOf("users")).toContain("email_verified_via");
        expect(await via(fresh, "verified-before")).toBe("legacy");
        // Not verified, so nothing to say how.
        expect(await via(fresh, "never-verified")).toBeNull();

        // A row a current path wrote keeps what it recorded.
        const { users } = fresh.tables;
        await (fresh.db as unknown as Db).insert(users).values({
          id: "verified-by-link",
          email: "verified-by-link@example.com",
          emailVerified: new Date("2026-02-01T00:00:00Z"),
          emailVerifiedVia: "link",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // The schema is now current, so this run takes the "up to date"
        // path: a verified row written with no provenance (by something
        // outside Nextly's paths) is still marked there.
        await insertLegacyUser(fresh, "written-outside", true);
        expect(await migrate(fresh, NO_MIGRATIONS)).toBe(true);
        expect(await via(fresh, "written-outside")).toBe("legacy");

        // Nothing left to fill, so nothing changes, and nothing is relabelled.
        expect(await migrate(fresh, NO_MIGRATIONS)).toBe(false);

        expect(await via(fresh, "verified-by-link")).toBe("link");
        expect(await via(fresh, "verified-before")).toBe("legacy");
        expect(await via(fresh, "never-verified")).toBeNull();
      });
    }, 180_000);
  }
);
