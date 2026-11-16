/**
 * A version's field sources column reaches a fresh database and an existing
 * one through `migrateCore`, the core of `nextly migrate` and of both boot
 * paths. It is added the way the recovery point's base columns were: declared
 * in the three Drizzle schemas and pushed by the core reconcile, with no
 * migration file. An existing database is the current core schema without it;
 * the migrate has to add it, and a second run must change nothing.
 *
 * Runs on every dialect with a database in this run, since the push that adds
 * a column is a different implementation per dialect.
 */
import { afterAll, describe, expect, it } from "vitest";

import {
  availableDialects,
  withFreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import {
  migrateFresh as migrate,
  noMigrationsDir,
} from "../../../__tests__/helpers/migrate-core";

const COLUMN = "field_sources";

/** An app with no migration files, so only the core phase has work to do. */
const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-fsrc-");
afterAll(remove);

describe.each(availableDialects())(
  "a version's field sources column through nextly migrate (%s)",
  dialect => {
    it("creates it on a fresh database", async () => {
      await withFreshDatabase(dialect, "nextly_fsrc_fresh", async fresh => {
        await migrate(fresh, NO_MIGRATIONS);
        expect(await fresh.columnsOf("nextly_versions")).toContain(COLUMN);
      });
    }, 180_000);

    it("adds it to an existing database, and a second run changes nothing", async () => {
      await withFreshDatabase(dialect, "nextly_fsrc_existing", async fresh => {
        await migrate(fresh, NO_MIGRATIONS);
        await fresh.exec(`ALTER TABLE nextly_versions DROP COLUMN ${COLUMN}`);
        expect(await fresh.columnsOf("nextly_versions")).not.toContain(COLUMN);

        expect(await migrate(fresh, NO_MIGRATIONS)).toBe(true);

        expect(await fresh.columnsOf("nextly_versions")).toContain(COLUMN);
        expect(await migrate(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
