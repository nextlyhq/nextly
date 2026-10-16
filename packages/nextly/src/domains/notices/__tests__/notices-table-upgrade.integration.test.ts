/**
 * The notices table reaches a fresh database and an existing one through
 * `migrateCore`, the core of `nextly migrate` and of both boot paths.
 *
 * The existing database is the current core schema without the table. The
 * migrate creates it, with its unique digest index — the index
 * once-per-occurrence rests on — and a second run changes nothing.
 *
 * Runs on every dialect with a database in this run, since the push that
 * creates the table is a different implementation per dialect.
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

const COLUMNS = [
  "created_at",
  "data",
  "dedupe_key",
  "id",
  "kind",
  "occurrence",
  "read_at",
  "subject_id",
  "subject_type",
  "user_id",
];

/** An app with no migration files, so only the core phase has work to do. */
const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-notices-");
afterAll(remove);

describe.each(availableDialects())(
  "the notices table through nextly migrate (%s)",
  dialect => {
    it("is created on a fresh database", async () => {
      await withFreshDatabase(dialect, "nextly_notices_fresh", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        expect((await fresh.columnsOf("nextly_notices")).sort()).toEqual(
          COLUMNS
        );
      });
    }, 180_000);

    it("is added to an existing database, unique on its digest, and a second run changes nothing", async () => {
      await withFreshDatabase(
        dialect,
        "nextly_notices_existing",
        async fresh => {
          await migrateFresh(fresh, NO_MIGRATIONS);
          await fresh.exec("DROP TABLE nextly_notices");
          expect(await fresh.columnsOf("nextly_notices")).toEqual([]);

          expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);
          expect((await fresh.columnsOf("nextly_notices")).sort()).toEqual(
            COLUMNS
          );

          const at =
            fresh.dialect === "sqlite" ? "1767225600" : "'2026-01-01 00:00:00'";
          // A notice belongs to an account: the person it is for exists.
          await fresh.exec(
            "INSERT INTO users (id, email, is_active, failed_login_attempts, created_at, updated_at) " +
              `VALUES ('u1', 'u1@example.com', ${fresh.dialect === "sqlite" ? 1 : "true"}, 0, ${at}, ${at})`
          );
          const row = (id: string, userId = "u1", digest = "same-digest") =>
            "INSERT INTO nextly_notices (id, user_id, kind, subject_type, subject_id, occurrence, dedupe_key, created_at) " +
            `VALUES ('${id}', '${userId}', 'test.kind', 'thing', 't1', '1', '${digest}', ${at})`;
          // The digest is unique on the upgraded table too: a second row with
          // the same digest is refused by the database itself.
          await fresh.exec(row("a"));
          await expect(fresh.exec(row("b"))).rejects.toThrow();
          // And the person is held to an account: a notice for nobody is
          // refused, so the upgrade brought the foreign key with the table.
          await expect(
            fresh.exec(row("c", "nobody", "another-digest"))
          ).rejects.toThrow();

          expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
        }
      );
    }, 180_000);
  }
);
