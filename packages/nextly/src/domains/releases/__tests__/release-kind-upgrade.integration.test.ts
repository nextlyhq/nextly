/**
 * A release's kind, and the slot that holds a single release to one member,
 * reach an existing database through `migrateCore`, the core of `nextly
 * migrate` and of both boot paths.
 *
 * The existing database is the current core schema without them, holding a
 * release and a member written before they existed. The migrate adds both
 * columns and the slot's unique index, and rewrites no row: the old release
 * reads as an ordinary one by the column's default, the old member has no
 * slot, and a second run changes nothing. That the index arrived is shown by
 * what it refuses, not by its name.
 *
 * Runs on every dialect with a database in this run, since the push that adds
 * them is a different implementation per dialect.
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

const SLOT_INDEX = "nextly_release_members_single_uidx";
const LEGACY_RELEASE = "00000000-0000-4000-8000-0000000000a1";

interface Db {
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
}

/** An install from before the kind: the current schema without it. */
async function removeKindSchema(fresh: FreshDatabase): Promise<void> {
  await fresh.exec(
    fresh.dialect === "mysql"
      ? `DROP INDEX ${SLOT_INDEX} ON nextly_release_members`
      : `DROP INDEX ${SLOT_INDEX}`
  );
  await fresh.exec(
    "ALTER TABLE nextly_release_members DROP COLUMN single_slot"
  );
  await fresh.exec("ALTER TABLE nextly_releases DROP COLUMN kind");
}

/** An instant as each dialect's timestamp column stores it, by statement. */
function writtenAt(fresh: FreshDatabase): string {
  // Whole seconds on SQLite, where the columns are `mode: "timestamp"`.
  return fresh.dialect === "sqlite" ? "1767225600" : "'2026-01-01 00:00:00'";
}

/** A member row by statement, so a test can name its slot. */
function memberInsert(
  fresh: FreshDatabase,
  id: string,
  entryId: string,
  slot: "1" | null
): string {
  const columns =
    "id, release_id, scope_kind, scope_slug, entry_id, action, member_key, created_at" +
    (slot === null ? "" : ", single_slot");
  const values =
    `'${id}', '${LEGACY_RELEASE}', 'collection', 'posts', '${entryId}', 'publish', 'key-${id}', ${writtenAt(fresh)}` +
    (slot === null ? "" : `, ${slot}`);
  return `INSERT INTO nextly_release_members (${columns}) VALUES (${values})`;
}

/** An app with no migration files, so only the core phase has work to do. */
const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-rk-");
afterAll(remove);

describe.each(availableDialects())(
  "a release's kind through nextly migrate (%s)",
  dialect => {
    it("adds the kind and the slot to an existing database, leaving its rows as they were", async () => {
      await withFreshDatabase(dialect, "nextly_rk_existing", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        await removeKindSchema(fresh);
        expect(await fresh.columnsOf("nextly_releases")).not.toContain("kind");

        // Written before the columns, by statement: an insert built from the
        // current schema would name the columns this install lacks.
        await fresh.exec(
          "INSERT INTO nextly_releases (id, title, state, created_at, updated_at, revision) " +
            `VALUES ('${LEGACY_RELEASE}', 'Spring launch', 'draft', ${writtenAt(fresh)}, ${writtenAt(fresh)}, 0)`
        );
        await fresh.exec(memberInsert(fresh, "legacy-member", "post-1", null));

        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);

        expect(await fresh.columnsOf("nextly_releases")).toContain("kind");
        expect(await fresh.columnsOf("nextly_release_members")).toContain(
          "single_slot"
        );
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
          state: "draft",
          kind: "release",
        });
        const [member] = await db
          .select()
          .from(nextlyReleaseMembers)
          .where(eq(nextlyReleaseMembers.id as never, "legacy-member"));
        expect(member).toMatchObject({ entryId: "post-1", singleSlot: null });

        // The index arrived: a second slot in one release is refused, while
        // any number of unslotted members are not.
        await fresh.exec(memberInsert(fresh, "slotted-1", "post-2", "1"));
        await expect(
          fresh.exec(memberInsert(fresh, "slotted-2", "post-3", "1"))
        ).rejects.toThrow();
        await fresh.exec(memberInsert(fresh, "unslotted", "post-4", null));

        // Nothing left to add.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
