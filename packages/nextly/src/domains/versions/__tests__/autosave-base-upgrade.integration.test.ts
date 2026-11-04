/**
 * The recovery point's base columns reach a fresh database and an existing
 * one through `migrateCore`, the core of `nextly migrate` and of both boot
 * paths. They are added the way `revision` was: declared in the three Drizzle
 * schemas and pushed by the core reconcile, with no migration file. An
 * existing database is the current core schema without them; the migrate has
 * to add both, and a second run must change nothing.
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

const BASE_COLUMNS = ["base_version_no", "base_draft_revision"];

/** An app with no migration files, so only the core phase has work to do. */
const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-asb-");
afterAll(remove);

describe.each(availableDialects())(
  "a recovery point's base columns through nextly migrate (%s)",
  dialect => {
    it("creates them on a fresh database", async () => {
      await withFreshDatabase(dialect, "nextly_asb_fresh", async fresh => {
        await migrate(fresh, NO_MIGRATIONS);
        const columns = await fresh.columnsOf("nextly_versions");
        for (const column of BASE_COLUMNS) expect(columns).toContain(column);
      });
    }, 180_000);

    it("adds them to an existing database, and a second run changes nothing", async () => {
      await withFreshDatabase(dialect, "nextly_asb_existing", async fresh => {
        await migrate(fresh, NO_MIGRATIONS);
        for (const column of BASE_COLUMNS) {
          await fresh.exec(`ALTER TABLE nextly_versions DROP COLUMN ${column}`);
        }
        const before = await fresh.columnsOf("nextly_versions");
        for (const column of BASE_COLUMNS) expect(before).not.toContain(column);

        expect(await migrate(fresh, NO_MIGRATIONS)).toBe(true);

        const after = await fresh.columnsOf("nextly_versions");
        for (const column of BASE_COLUMNS) expect(after).toContain(column);
        expect(await migrate(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
