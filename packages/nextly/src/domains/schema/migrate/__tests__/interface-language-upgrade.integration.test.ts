/**
 * `interface_language` reaches a fresh database and an existing one through
 * `migrateCore`, the core of `nextly migrate` and of both boot paths, without
 * the flag meant for data loss and without rewriting a row.
 *
 * The existing database is the current core schema without the column,
 * holding accounts written before it existed. The migrate has to add the
 * column, every one of those accounts reads null (follow the browser, then
 * English, as today), and a second run changes nothing.
 *
 * Runs on every dialect with a database in this run, since the push that adds
 * the column is a different implementation per dialect.
 */
import { afterAll, describe, expect, it } from "vitest";

import {
  availableDialects,
  withFreshDatabase,
  type FreshDatabase,
} from "../../../../__tests__/helpers/fresh-database";
import {
  migrateFresh as migrate,
  noMigrationsDir,
} from "../../../../__tests__/helpers/migrate-core";

interface Db {
  select: () => {
    from: (table: unknown) => Promise<Record<string, unknown>[]>;
  };
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
  id: string
): Promise<void> {
  const now = at(fresh, "2026-01-01T00:00:00Z");
  await fresh.exec(
    `INSERT INTO users (id, email, is_active, failed_login_attempts, created_at, updated_at) ` +
      `VALUES ('${id}', '${id}@example.com', ${fresh.dialect === "postgresql" ? "true" : "1"}, 0, ${now}, ${now})`
  );
}

/** Each user's stored interface language, by id. */
async function languages(
  fresh: FreshDatabase
): Promise<Record<string, unknown>> {
  const rows = await (fresh.db as unknown as Db)
    .select()
    .from(fresh.tables.users);
  return Object.fromEntries(
    rows.map(row => [String(row.id), row.interfaceLanguage])
  );
}

/** An app with no migration files, so only the core phase has work to do. */
const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-il-");
afterAll(remove);

describe.each(availableDialects())(
  "interface_language through nextly migrate (%s)",
  dialect => {
    it("creates the column on a fresh database", async () => {
      await withFreshDatabase(dialect, "nextly_il_fresh", async fresh => {
        await migrate(fresh, NO_MIGRATIONS);

        expect(await fresh.columnsOf("users")).toContain("interface_language");
      });
    }, 180_000);

    it("adds the column to an existing database, every existing user reads null, and a second run changes nothing", async () => {
      await withFreshDatabase(dialect, "nextly_il_existing", async fresh => {
        await migrate(fresh, NO_MIGRATIONS);
        // An install from before the column: the same schema without it.
        await fresh.exec("ALTER TABLE users DROP COLUMN interface_language");
        expect(await fresh.columnsOf("users")).not.toContain(
          "interface_language"
        );
        await insertLegacyUser(fresh, "before-1");
        await insertLegacyUser(fresh, "before-2");

        // Added as the additive change it is: no destructive flag is set in
        // this run, so a migrate that called it destructive would refuse.
        expect(await migrate(fresh, NO_MIGRATIONS)).toBe(true);

        expect(await fresh.columnsOf("users")).toContain("interface_language");
        expect(await languages(fresh)).toEqual({
          "before-1": null,
          "before-2": null,
        });

        // Nothing left to add, so nothing changes.
        expect(await migrate(fresh, NO_MIGRATIONS)).toBe(false);
        expect(await languages(fresh)).toEqual({
          "before-1": null,
          "before-2": null,
        });
      });
    }, 180_000);
  }
);
