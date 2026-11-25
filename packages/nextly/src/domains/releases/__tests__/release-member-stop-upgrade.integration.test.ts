/**
 * A release member's field stop (`stop_reason`, `stop_field`, `stop_revision`) reaches an existing
 * database through `migrateCore`, the core of `nextly migrate` and of both boot paths.
 *
 * The existing database is the current core schema without the three columns, holding a release
 * and a member written before they existed. The migrate adds the three nullable columns and
 * rewrites no row: the old member reads as never stopped, every other value as it was, and a
 * second run changes nothing.
 *
 * Runs on every dialect with a database in this run, since the push that adds
 * it is a different implementation per dialect.
 */
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  availableDialects,
  withFreshDatabase,
  type FreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import {
  migrateFresh,
  noMigrationsDir,
} from "../../../__tests__/helpers/migrate-core";

const LEGACY_RELEASE = "00000000-0000-4000-8000-0000000000b2";
const STOP_COLUMNS = ["stop_reason", "stop_field", "stop_revision"];

interface Db {
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
}

/** An instant as each dialect's timestamp column stores it, by statement. */
function writtenAt(fresh: FreshDatabase): string {
  // Whole seconds on SQLite, where the columns are `mode: "timestamp"`.
  return fresh.dialect === "sqlite" ? "1767225600" : "'2026-01-01 00:00:00'";
}

/** An app with no migration files, so only the core phase has work to do. */
const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-ms-");
afterAll(remove);

describe.each(availableDialects())(
  "a release member's field stop through nextly migrate (%s)",
  dialect => {
    it("adds the three columns to an existing database, leaving its rows as they were", async () => {
      await withFreshDatabase(dialect, "nextly_ms_existing", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        // An install from before the stop: the current schema without it.
        // Dropped only where the install made them, so a schema that never
        // declares a column fails below, on the migrate, and not here.
        for (const column of STOP_COLUMNS) {
          if (
            (await fresh.columnsOf("nextly_release_members")).includes(column)
          ) {
            await fresh.exec(
              `ALTER TABLE nextly_release_members DROP COLUMN ${column}`
            );
          }
        }
        const before = await fresh.columnsOf("nextly_release_members");
        for (const column of STOP_COLUMNS) expect(before).not.toContain(column);

        // Written before the column, by statement: an insert built from the
        // current schema would name the column this install lacks.
        await fresh.exec(
          "INSERT INTO nextly_releases (id, title, state, kind, created_at, updated_at, revision) " +
            `VALUES ('${LEGACY_RELEASE}', 'Spring launch', 'scheduled', 'release', ${writtenAt(fresh)}, ${writtenAt(fresh)}, 3)`
        );
        await fresh.exec(
          "INSERT INTO nextly_release_members (id, release_id, scope_kind, scope_slug, entry_id, action, member_key, created_by, created_at) " +
            `VALUES ('legacy-member', '${LEGACY_RELEASE}', 'collection', 'posts', 'post-1', 'publish', 'key-legacy', 'author-1', ${writtenAt(fresh)})`
        );

        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);

        const after = await fresh.columnsOf("nextly_release_members");
        for (const column of STOP_COLUMNS) expect(after).toContain(column);
        const { nextlyReleases, nextlyReleaseMembers } =
          fresh.tables as unknown as {
            nextlyReleases: { id: unknown };
            nextlyReleaseMembers: { id: unknown };
          };
        const db = fresh.db as unknown as Db;
        const [release] = await db
          .select()
          .from(nextlyReleases)
          .where(eq(nextlyReleases.id as never, LEGACY_RELEASE));
        expect(release).toMatchObject({
          title: "Spring launch",
          state: "scheduled",
          revision: 3,
        });
        const [member] = await db
          .select()
          .from(nextlyReleaseMembers)
          .where(eq(nextlyReleaseMembers.id as never, "legacy-member"));
        // Never stopped, so it names no field stop, and keeps every other value.
        expect(member).toMatchObject({
          releaseId: LEGACY_RELEASE,
          entryId: "post-1",
          action: "publish",
          memberKey: "key-legacy",
          createdBy: "author-1",
          stopReason: null,
          stopField: null,
          stopRevision: null,
        });

        // Nothing left to add.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
