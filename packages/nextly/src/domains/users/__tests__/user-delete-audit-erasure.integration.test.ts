/**
 * Deleting an account must not delete what it did.
 *
 * `activity_log.user_id` used to carry `ON DELETE CASCADE`, so removing a user
 * destroyed every activity row they produced — an audit trail the subject can
 * erase by being deleted. Dropping the cascade alone would swing the defect the
 * other way and keep a deleted person's name and email forever, so the two
 * halves are proven together: the rows SURVIVE, and the identity on them is
 * gone.
 *
 * Run on every configured dialect, against a real database each time, so the
 * foreign-key behaviour under test is the database's, not a mock's. The
 * erasure reads each dialect's catalogue to find which tables and columns
 * exist, and on PostgreSQL a failed statement aborts the transaction it ran
 * in, so a path that is safe on SQLite need not be safe there.
 */

import { asc, eq, inArray, or } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import { NextlyError } from "../../../errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  bindParam,
  createHostAccountsTable,
  createRetiredAuthTables,
  dropRetiredAuthTables,
  insertRow,
} from "../../../init/__tests__/retired-auth-tables-fixture";
import { ActivityLogService } from "../../../services/dashboard/activity-log-service";
import { allResources } from "../../../services/dashboard/readable-resources";
import { buildAuditLogWriter } from "../../audit/audit-log-writer";
import { eraseActorPersonalData } from "../../audit/erase-actor-personal-data";
import { UserMutationService } from "../services/user-mutation-service";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** The slice of the Drizzle handle these tests read and write through. */
interface TestDb {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<Record<string, unknown>[]> & {
        orderBy: (...columns: unknown[]) => Promise<Record<string, unknown>[]>;
      };
    };
  };
  insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
  update: (table: unknown) => {
    set: (values: Record<string, unknown>) => {
      where: (condition: unknown) => Promise<unknown>;
    };
  };
}

interface ActivityRow {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  collection: string;
  entryTitle: string | null;
  identityErasedAt: Date | null;
}

interface AuditRow {
  kind: string;
  actorUserId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  identityErasedAt: Date | null;
}

/** The type the erasure stamp column has on each dialect. */
const STAMP_COLUMN_TYPE: Record<TestDialect, string> = {
  sqlite: "INTEGER",
  postgresql: "TIMESTAMP",
  mysql: "DATETIME",
};

describe.each(getConfiguredTestDialects())(
  "deleting a user erases them from the activity log without erasing the log (%s)",
  dialect => {
    let handle: TestNextly;
    let users: UserMutationService;
    let activity: ActivityLogService;
    let auditWriter: ReturnType<typeof buildAuditLogWriter>;
    const tables = getDialectTables(dialect);
    const db = () => handle.adapter.getDrizzle() as unknown as TestDb;
    /** The `n`th bound parameter of a hand-written statement. */
    const param = (n: number) => bindParam(dialect, n);

    beforeAll(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      // A sentinel user so createLocalUser's "first user ever" branch (which
      // needs more of the RBAC wiring) is never taken.
      const now = new Date();
      await db().insert(tables.users).values({
        id: "sentinel",
        email: "sentinel@test.local",
        name: "Sentinel",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      users = new UserMutationService(handle.adapter, silentLogger);
      activity = new ActivityLogService(handle.adapter, silentLogger);
      // The production writer, resolved against this adapter, so the columns
      // under test are the ones the auth handlers actually fill.
      auditWriter = buildAuditLogWriter((name: string) => {
        if (name === "adapter") return handle.adapter;
        throw NextlyError.internal({
          logContext: { service: name },
        });
      });
    });

    afterAll(async () => {
      await handle?.destroy();
    });

    // Ids are `string | number` on the service surface (the column is text, but
    // the type allows either), so normalise here rather than at every call site.
    async function rowsFor(userId: string | number): Promise<ActivityRow[]> {
      const { activityLog } = tables;
      return (await db()
        .select({
          id: activityLog.id,
          userId: activityLog.userId,
          userName: activityLog.userName,
          userEmail: activityLog.userEmail,
          collection: activityLog.collection,
          entryTitle: activityLog.entryTitle,
          identityErasedAt: activityLog.identityErasedAt,
        })
        .from(activityLog)
        .where(eq(activityLog.userId, String(userId)))
        .orderBy(asc(activityLog.collection))) as unknown as ActivityRow[];
    }

    async function auditRowsFor(userId: string | number): Promise<AuditRow[]> {
      const { auditLog } = tables;
      return (await db()
        .select({
          kind: auditLog.kind,
          actorUserId: auditLog.actorUserId,
          ipAddress: auditLog.ipAddress,
          userAgent: auditLog.userAgent,
          identityErasedAt: auditLog.identityErasedAt,
        })
        .from(auditLog)
        .where(eq(auditLog.actorUserId, String(userId)))
        .orderBy(asc(auditLog.kind))) as unknown as AuditRow[];
    }

    async function accountExists(userId: string | number): Promise<boolean> {
      const rows = await db()
        .select({ id: tables.users.id })
        .from(tables.users)
        .where(eq(tables.users.id, String(userId)));
      return rows.length > 0;
    }

    it("still deletes and erases when the auth log is absent entirely", async () => {
      // Databases like this exist: the SQLite fallback bootstrap created a subset
      // of the core tables, and nothing repairs an existing one. A missing auth
      // log must not fail the deletion, and — the part worth pinning — must not
      // suppress the activity erasure either, which is what asking about the two
      // tables together would have done.
      const actor = await users.createLocalUser({
        email: "no-audit-table@test.local",
        name: "No Audit",
        password: "TestPassword123!",
        isActive: true,
      });
      await activity.logActivity({
        actorType: "user",
        userId: String(actor.id),
        userName: "No Audit",
        userEmail: "no-audit-table@test.local",
        action: "create",
        collection: "posts",
        entryId: "p-1",
        entryTitle: "Kept",
      });
      await handle.adapter.executeQuery(
        "ALTER TABLE audit_log RENAME TO audit_log_gone"
      );

      try {
        await users.deleteUser(actor.id);

        const after = await rowsFor(actor.id);
        expect(after).toHaveLength(1);
        // The activity erasure still ran, despite the other table being missing.
        expect(after[0].userName).toBeNull();
        expect(after[0].identityErasedAt).not.toBeNull();
      } finally {
        await handle.adapter.executeQuery(
          "ALTER TABLE audit_log_gone RENAME TO audit_log"
        );
      }
    });

    it("still scrubs the auth log on a database that predates the stamp", async () => {
      // The stamp records WHEN an erasure happened; the erasure is the
      // obligation. Skipping it because the evidence column is missing keeps the
      // address and client forever — this table carries no cascading key, so
      // nothing else removes the row, and a later migration adds the column
      // without being able to revisit deletions that already happened.
      const actor = await users.createLocalUser({
        email: "legacy-auth-shape@test.local",
        name: "Legacy Shape",
        password: "TestPassword123!",
        isActive: true,
      });
      await auditWriter.write({
        kind: "password-changed",
        actorUserId: String(actor.id),
        ipAddress: "198.51.100.9",
        userAgent: "Mozilla/5.0 (legacy)",
      });

      // Put the table back on its pre-erasure shape.
      await handle.adapter.executeQuery(
        "ALTER TABLE audit_log DROP COLUMN identity_erased_at"
      );

      try {
        await users.deleteUser(actor.id);
      } finally {
        // Restored before reading back: the schema the reader builds its SELECT
        // from carries the column, so the row cannot be read while the database
        // is missing it. The erasure under test has already happened by here.
        await handle.adapter.executeQuery(
          `ALTER TABLE audit_log ADD COLUMN identity_erased_at ${STAMP_COLUMN_TYPE[dialect]}`
        );
      }

      const rows = await auditRowsFor(actor.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].ipAddress).toBeNull();
      expect(rows[0].userAgent).toBeNull();
      // The stamp is the one thing a schema with nowhere to put it cannot record.
      expect(rows[0].identityErasedAt).toBeNull();
      // The security fact survives, which is what the trail is for.
      expect(rows[0].kind).toBe("password-changed");
    });

    it("scrubs the request identifiers a deleted actor left in the auth log", async () => {
      // The auth log carries the two fields that identify a person by their
      // request rather than by their name: the address they connected from and
      // the client they used. Deleting the account has to remove those the same
      // way it removes a name, while leaving the security FACT — what happened,
      // to whom, when — in place.
      const actor = await users.createLocalUser({
        email: "audit-erasure@test.local",
        name: "Audit Actor",
        password: "TestPassword123!",
        isActive: true,
      });

      await auditWriter.write({
        kind: "password-changed",
        actorUserId: String(actor.id),
        ipAddress: "203.0.113.7",
        userAgent: "Mozilla/5.0 (test)",
      });

      const before = await auditRowsFor(actor.id);
      expect(before).toHaveLength(1);
      expect(before[0].ipAddress).toBe("203.0.113.7");
      expect(before[0].identityErasedAt).toBeNull();

      await users.deleteUser(actor.id);

      const after = await auditRowsFor(actor.id);
      // The record survives, still attributed and still saying what happened.
      expect(after).toHaveLength(1);
      expect(after[0].kind).toBe("password-changed");
      expect(after[0].actorUserId).toBe(String(actor.id));
      // The person is gone from it.
      expect(after[0].ipAddress).toBeNull();
      expect(after[0].userAgent).toBeNull();
      expect(after[0].identityErasedAt).not.toBeNull();
    });

    it("keeps the record and scrubs the person", async () => {
      const author = await users.createLocalUser({
        email: "erasure-author@test.local",
        name: "Ada Author",
        password: "TestPassword123!",
        isActive: true,
      });

      // Written through the production writer rather than a hand-built INSERT,
      // so the columns under test are the ones the product actually fills.
      await activity.logActivity({
        actorType: "user",
        userId: String(author.id),
        userName: "Ada Author",
        userEmail: "erasure-author@test.local",
        action: "create",
        collection: "posts",
        entryId: "post-1",
        entryTitle: "Q3 Report",
      });

      // The premise. logActivity swallows its own failures, so without this a
      // silently-empty table would let every assertion below pass vacuously.
      const before = await rowsFor(author.id);
      expect(before).toHaveLength(1);
      expect(before[0].userName).toBe("Ada Author");
      expect(before[0].identityErasedAt).toBeNull();

      await users.deleteUser(author.id);

      const after = await rowsFor(author.id);
      // Survival: the row the cascade used to destroy is still here.
      expect(after).toHaveLength(1);
      // Attribution: still tied to the account that acted, and still says what
      // happened.
      expect(after[0].userId).toBe(String(author.id));
      expect(after[0].collection).toBe("posts");
      expect(after[0].entryTitle).toBe("Q3 Report");
      // Erasure: nothing identifying the human is left.
      expect(after[0].userName).toBeNull();
      expect(after[0].userEmail).toBeNull();
      expect(after[0].identityErasedAt).not.toBeNull();

      // The account itself really is gone — otherwise the assertions above would
      // hold for a delete that never happened.
      expect(await accountExists(author.id)).toBe(false);
    });

    it("writes an entry erased when its author is already gone", async () => {
      // The erasure inside the delete transaction can only reach rows that exist
      // when it runs. An activity write still in flight lands afterwards, and
      // with no foreign key left to reject it, it would otherwise store the name
      // and email of an account that no longer exists — permanently, because
      // nothing sweeps it again. The writer decides what identity to store from
      // whether the account is actually there.
      const gone = await users.createLocalUser({
        email: "erasure-late@test.local",
        name: "Late Writer",
        password: "TestPassword123!",
        isActive: true,
      });

      await users.deleteUser(gone.id);

      // The premise: the account really is gone before the write is attempted,
      // so this exercises the post-deletion path and not the ordinary one.
      expect(await accountExists(gone.id)).toBe(false);

      await activity.logActivity({
        actorType: "user",
        userId: String(gone.id),
        userName: "Late Writer",
        userEmail: "erasure-late@test.local",
        action: "update",
        collection: "late_posts",
        entryTitle: "Landed After Deletion",
      });

      const rows = await rowsFor(gone.id);
      expect(rows).toHaveLength(1);
      // The audit fact survives — dropping the row instead would lose it.
      expect(rows[0].collection).toBe("late_posts");
      expect(rows[0].entryTitle).toBe("Landed After Deletion");
      // The identity does not.
      expect(rows[0].userName).toBeNull();
      expect(rows[0].userEmail).toBeNull();
      expect(rows[0].identityErasedAt).not.toBeNull();
    });

    it("reports the erased state through the query API the admin reads", async () => {
      // The raw-SQL assertions above prove what is STORED. They say nothing
      // about what `getRecentActivity` returns, and the adapter keys rows by the
      // Drizzle property (`identityErasedAt`) whenever a table object resolves and
      // by the column (`identity_erased_at`) when it falls back to raw SQL. Reading
      // one spelling only reports every erased row as live, and the admin then
      // renders a blank actor instead of the deleted-user placeholder.
      const author = await users.createLocalUser({
        email: "erasure-readpath@test.local",
        name: "Read Path",
        password: "TestPassword123!",
        isActive: true,
      });
      await activity.logActivity({
        actorType: "user",
        userId: String(author.id),
        userName: "Read Path",
        userEmail: "erasure-readpath@test.local",
        action: "create",
        collection: "readpath_posts",
        entryTitle: "Before Deletion",
      });

      // This suite exercises the erasure identity mechanism, not permission
      // scoping, so it asks for every resource explicitly -- an omitted scope
      // now fails closed and would return nothing, which is the correct
      // behaviour for a real caller but not what this assertion is about.
      const live = await activity.getRecentActivity({
        userId: String(author.id),
        scope: allResources(),
        // The feed authorizes each row's document as this caller and answers
        // EMPTY without one. These rows name no registered content, so the scope
        // decides them -- but the caller is still required, because "no caller"
        // is the fail-closed case rather than a permissive default.
        caller: { user: { id: "reader", roles: [] } },
      });
      expect(live.activities).toHaveLength(1);
      // The premise: every field the admin renders survives the mapping.
      expect(live.activities[0].userId).toBe(String(author.id));
      expect(live.activities[0].userName).toBe("Read Path");
      expect(live.activities[0].createdAt).not.toBe("undefined");
      expect(live.activities[0].identityErasedAt).toBeNull();

      await users.deleteUser(author.id);

      const erased = await activity.getRecentActivity({
        userId: String(author.id),
        scope: allResources(),
        // The feed authorizes each row's document as this caller and answers
        // EMPTY without one. These rows name no registered content, so the scope
        // decides them -- but the caller is still required, because "no caller"
        // is the fail-closed case rather than a permissive default.
        caller: { user: { id: "reader", roles: [] } },
      });
      expect(erased.activities).toHaveLength(1);
      expect(erased.activities[0].userName).toBeNull();
      expect(erased.activities[0].userEmail).toBeNull();
      // The field the admin branches on to render "[deleted user · …]".
      expect(erased.activities[0].identityErasedAt).not.toBeNull();
    });

    it("returns the feed newest first", async () => {
      // The ordering spec names a column too, and a name the Drizzle table does
      // not have is silently DROPPED rather than rejected — so "recent activity"
      // came back in arbitrary order while every other assertion still passed.
      const author = await users.createLocalUser({
        email: "erasure-order@test.local",
        name: "Orderly",
        password: "TestPassword123!",
        isActive: true,
      });
      for (const title of ["older", "newer"]) {
        await activity.logActivity({
          actorType: "user",
          userId: String(author.id),
          userName: "Orderly",
          userEmail: "erasure-order@test.local",
          action: "create",
          collection: "order_posts",
          entryTitle: title,
        });
      }
      // Stamped explicitly: two writes in the same second would tie, and a tie
      // cannot distinguish a working ORDER BY from a dropped one.
      for (const [title, createdAt] of [
        ["older", new Date("2001-01-01T00:00:00Z")],
        ["newer", new Date("2002-01-01T00:00:00Z")],
      ] as const) {
        await db()
          .update(tables.activityLog)
          .set({ createdAt })
          .where(eq(tables.activityLog.entryTitle, title));
      }

      const feed = await activity.getRecentActivity({
        userId: String(author.id),
        scope: allResources(),
        // The feed authorizes each row's document as this caller and answers
        // empty without one; these rows name no registered content, so the scope
        // decides them.
        caller: { user: { id: "reader", roles: [] } },
      });
      expect(feed.activities.map(a => a.entryTitle)).toEqual([
        "newer",
        "older",
      ]);
    });

    it("does not rewrite entries the erasure already handled", async () => {
      // The erasure runs twice per deletion: once inside the transaction and
      // once after it commits, to catch an entry that landed in between. Calling
      // it directly is what makes the second pass observable — a repeated
      // `deleteUser` throws NOT_FOUND before ever reaching the sweep, so a test
      // written that way passes whether the predicate is there or not.
      const author = await users.createLocalUser({
        email: "erasure-stamp@test.local",
        name: "Stamped",
        password: "TestPassword123!",
        isActive: true,
      });
      await activity.logActivity({
        actorType: "user",
        userId: String(author.id),
        userName: "Stamped",
        userEmail: "erasure-stamp@test.local",
        action: "create",
        collection: "stamp_posts",
      });

      await users.deleteUser(author.id);
      const erased = (await rowsFor(author.id))[0];
      expect(erased.userName).toBeNull();
      expect(erased.identityErasedAt).not.toBeNull();

      // A recognisable stamp, far enough in the past that a pass which rewrites
      // the row cannot land on the same value.
      const stamp = new Date("2001-01-01T00:00:00Z");
      await db()
        .update(tables.activityLog)
        .set({ identityErasedAt: stamp })
        .where(eq(tables.activityLog.userId, String(author.id)));

      await eraseActorPersonalData(
        handle.adapter.getDrizzle() as Parameters<
          typeof eraseActorPersonalData
        >[0],
        tables as Parameters<typeof eraseActorPersonalData>[1],
        String(author.id),
        new Date()
      );

      // Untouched: the row records when the identity was actually erased, not
      // when some later sweep happened to run over it again.
      const afterSweep = (await rowsFor(author.id))[0];
      expect(afterSweep.identityErasedAt?.getTime()).toBe(stamp.getTime());
    });

    it("leaves every other actor's entries untouched", async () => {
      const leaving = await users.createLocalUser({
        email: "erasure-leaving@test.local",
        name: "Leaving",
        password: "TestPassword123!",
        isActive: true,
      });
      const staying = await users.createLocalUser({
        email: "erasure-staying@test.local",
        name: "Staying",
        password: "TestPassword123!",
        isActive: true,
      });

      for (const [user, collection] of [
        [leaving, "leaving_posts"],
        [staying, "staying_posts"],
      ] as const) {
        await activity.logActivity({
          actorType: "user",
          userId: String(user.id),
          userName: user.name ?? "",
          userEmail: user.email,
          action: "update",
          collection,
        });
      }
      expect(await rowsFor(staying.id)).toHaveLength(1);

      await users.deleteUser(leaving.id);

      // The scrub is scoped to the removed account: a blanket UPDATE would erase
      // the whole log and still satisfy the previous test.
      const untouched = await rowsFor(staying.id);
      expect(untouched).toHaveLength(1);
      expect(untouched[0].userName).toBe("Staying");
      expect(untouched[0].userEmail).toBe("erasure-staying@test.local");
      expect(untouched[0].identityErasedAt).toBeNull();
    });

    it("clears a plugin row's metadata wherever the account is actor or target", async () => {
      // A plugin's metadata is what the plugin chose to keep within its declared
      // keys — an email, a provider subject — and a linked identity names its
      // person as the TARGET. Erasing only the actor's request identifiers left
      // both behind for as long as the row is retained.
      const leaving = await users.createLocalUser({
        email: "plugin-erasure-leaving@test.local",
        name: "Leaving",
        password: "TestPassword123!",
        isActive: true,
      });
      const admin = await users.createLocalUser({
        email: "plugin-erasure-admin@test.local",
        name: "Admin",
        password: "TestPassword123!",
        isActive: true,
      });
      const personal = { email: "leaving@example.test", subject: "1029384756" };
      await auditWriter.write({
        kind: "acme-auth.identity-linked" as never,
        actorUserId: String(leaving.id),
        metadata: personal,
      });
      await auditWriter.write({
        kind: "acme-auth.identity-unlinked" as never,
        actorUserId: String(admin.id),
        targetUserId: String(leaving.id),
        metadata: personal,
      });
      // Controls: core's own row keeps its metadata, and so does a plugin row
      // about someone else.
      await auditWriter.write({
        kind: "password-changed",
        actorUserId: String(leaving.id),
        metadata: { strategy: "password" },
      });
      await auditWriter.write({
        kind: "acme-auth.identity-linked" as never,
        actorUserId: String(admin.id),
        metadata: { email: "admin@example.test" },
      });

      await users.deleteUser(leaving.id);

      const { auditLog } = tables;
      const rows = await db()
        .select({
          kind: auditLog.kind,
          actorUserId: auditLog.actorUserId,
          metadata: auditLog.metadata,
        })
        .from(auditLog)
        .where(
          or(
            inArray(auditLog.actorUserId, [
              String(leaving.id),
              String(admin.id),
            ]),
            eq(auditLog.targetUserId, String(leaving.id))
          )
        );
      // Text on SQLite, a JSON column the driver parses on PostgreSQL and MySQL.
      const metadataOf = (kind: string, actor: string) => {
        const metadata = rows.find(
          r => r.kind === kind && r.actorUserId === actor
        )?.metadata;
        return metadata == null || typeof metadata === "string"
          ? metadata
          : JSON.stringify(metadata);
      };

      expect(
        metadataOf("acme-auth.identity-linked", String(leaving.id))
      ).toBeNull();
      expect(
        metadataOf("acme-auth.identity-unlinked", String(admin.id))
      ).toBeNull();
      expect(metadataOf("password-changed", String(leaving.id))).toContain(
        "password"
      );
      expect(
        metadataOf("acme-auth.identity-linked", String(admin.id))
      ).toContain("admin@example.test");
    });

    describe("the retired accounts and sessions tables", () => {
      afterEach(async () => {
        delete process.env.NEXTLY_ERASE_RETIRED_AUTH_TABLES;
        await dropRetiredAuthTables(handle.adapter);
      });

      it("erases the deleted user's rows from both, in Nextly's shape", async () => {
        // Named by the operator: the shape alone does not make them Nextly's.
        process.env.NEXTLY_ERASE_RETIRED_AUTH_TABLES = "accounts,sessions";
        await createRetiredAuthTables(handle.adapter, dialect);
        const leaving = await users.createLocalUser({
          email: "retired-tables-leaving@test.local",
          name: "Leaving",
          password: "TestPassword123!",
          isActive: true,
        });
        await insertRow(handle.adapter, dialect, "accounts", [
          "a-1",
          String(leaving.id),
          "oauth",
          "google",
          "g-1",
          "tok",
        ]);
        await insertRow(handle.adapter, dialect, "sessions", [
          "s-1",
          String(leaving.id),
          0,
        ]);

        await users.deleteUser(leaving.id);

        expect(
          await handle.adapter.executeQuery(
            `SELECT id FROM accounts WHERE user_id = ${param(1)}`,
            [String(leaving.id)]
          )
        ).toEqual([]);
        expect(
          await handle.adapter.executeQuery(
            `SELECT session_token FROM sessions WHERE user_id = ${param(1)}`,
            [String(leaving.id)]
          )
        ).toEqual([]);
      });

      it("leaves a host app's table of the same name alone, and still deletes", async () => {
        // The name alone used to decide: a DELETE ... WHERE user_id = ? ran
        // against a table with no such column, and every deletion failed.
        await createHostAccountsTable(handle.adapter, dialect);
        await insertRow(handle.adapter, dialect, "accounts", [
          "host-1",
          "someone",
          100,
        ]);
        const leaving = await users.createLocalUser({
          email: "host-accounts-leaving@test.local",
          name: "Leaving",
          password: "TestPassword123!",
          isActive: true,
        });

        await users.deleteUser(leaving.id);

        expect(
          await handle.adapter.executeQuery("SELECT id FROM accounts")
        ).toEqual([{ id: "host-1" }]);
        expect(await accountExists(leaving.id)).toBe(false);
      });
    });
  }
);
