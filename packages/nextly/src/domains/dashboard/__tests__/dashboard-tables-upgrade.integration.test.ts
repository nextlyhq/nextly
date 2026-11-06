/**
 * The dashboard pins and preferences tables reach a fresh database and an
 * existing one through `migrateCore`, the core of `nextly migrate` and of both
 * boot paths.
 *
 * The existing database is the current core schema without the two tables.
 * The migrate creates them, each with its unique index and its foreign key to
 * the reader, and a second run changes nothing.
 *
 * Runs on every dialect with a database in this run, since the push that
 * creates the tables is a different implementation per dialect.
 */
import { afterAll, describe, expect, it } from "vitest";

import {
  availableDialects,
  withFreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import {
  migrateFresh,
  noMigrationsDir,
} from "../../../__tests__/helpers/migrate-core";

const PINS = "nextly_dashboard_pins";
const PREFERENCES = "nextly_dashboard_preferences";
const PIN_COLUMNS = [
  "entry_id",
  "id",
  "pinned_at",
  "target_slug",
  "target_type",
  "user_id",
];
const PREFERENCE_COLUMNS = [
  "id",
  "preference_key",
  "updated_at",
  "user_id",
  "value",
];

/** An app with no migration files, so only the core phase has work to do. */
const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-dashboard-");
afterAll(remove);

describe.each(availableDialects())(
  "the dashboard tables through nextly migrate (%s)",
  dialect => {
    it("are created on a fresh database", async () => {
      await withFreshDatabase(
        dialect,
        "nextly_dashboard_fresh",
        async fresh => {
          await migrateFresh(fresh, NO_MIGRATIONS);
          expect((await fresh.columnsOf(PINS)).sort()).toEqual(PIN_COLUMNS);
          expect((await fresh.columnsOf(PREFERENCES)).sort()).toEqual(
            PREFERENCE_COLUMNS
          );
        }
      );
    }, 180_000);

    it("are added to an existing database, unique per reader, held to an account, and a second run changes nothing", async () => {
      await withFreshDatabase(
        dialect,
        "nextly_dashboard_existing",
        async fresh => {
          await migrateFresh(fresh, NO_MIGRATIONS);
          await fresh.exec(`DROP TABLE ${PINS}`);
          await fresh.exec(`DROP TABLE ${PREFERENCES}`);
          expect(await fresh.columnsOf(PINS)).toEqual([]);
          expect(await fresh.columnsOf(PREFERENCES)).toEqual([]);

          expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);
          expect((await fresh.columnsOf(PINS)).sort()).toEqual(PIN_COLUMNS);
          expect((await fresh.columnsOf(PREFERENCES)).sort()).toEqual(
            PREFERENCE_COLUMNS
          );

          const at =
            fresh.dialect === "sqlite" ? "1767225600" : "'2026-01-01 00:00:00'";
          // A pin and a preference belong to an account: the reader exists.
          await fresh.exec(
            "INSERT INTO users (id, email, is_active, failed_login_attempts, created_at, updated_at) " +
              `VALUES ('u1', 'u1@example.com', ${fresh.dialect === "sqlite" ? 1 : "true"}, 0, ${at}, ${at})`
          );
          const pin = (id: string, userId = "u1", entry = "e1") =>
            `INSERT INTO ${PINS} (id, user_id, target_type, target_slug, entry_id, pinned_at) ` +
            `VALUES ('${id}', '${userId}', 'collection', 'posts', '${entry}', ${at})`;
          const single = (id: string) =>
            `INSERT INTO ${PINS} (id, user_id, target_type, target_slug, entry_id, pinned_at) ` +
            `VALUES ('${id}', 'u1', 'single', 'home', '', ${at})`;
          const preference = (id: string, userId = "u1") =>
            `INSERT INTO ${PREFERENCES} (id, user_id, preference_key, value, updated_at) ` +
            `VALUES ('${id}', '${userId}', 'new-type', 'posts', ${at})`;

          // One pin per reader per target, on the upgraded table too: the
          // database itself refuses the second, for an entry and for a Single.
          await fresh.exec(pin("p1"));
          await expect(fresh.exec(pin("p2"))).rejects.toThrow();
          await fresh.exec(pin("p3", "u1", "e2"));
          await fresh.exec(single("s1"));
          await expect(fresh.exec(single("s2"))).rejects.toThrow();
          // One value per reader per key.
          await fresh.exec(preference("k1"));
          await expect(fresh.exec(preference("k2"))).rejects.toThrow();
          // And each is held to an account: a row for nobody is refused, so the
          // upgrade brought the foreign key with the table.
          await expect(fresh.exec(pin("p4", "nobody", "e9"))).rejects.toThrow();
          await expect(
            fresh.exec(preference("k3", "nobody"))
          ).rejects.toThrow();

          expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
        }
      );
    }, 180_000);
  }
);
