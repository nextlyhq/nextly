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
 * Runs against real SQLite (cheapest live DB, no container) so the foreign-key
 * behaviour under test is the database's, not a mock's. Follows the DDL and
 * setup pattern of `user-webhook-events.integration.test.ts`.
 */

import { existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import { NextlyError } from "../../../errors";
import { buildAuditLogWriter } from "../../audit/audit-log-writer";
import { eraseActorPersonalData } from "../../audit/erase-actor-personal-data";
import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { SchemaRegistry } from "../../../database/schema-registry";
import { splitStatements } from "../../../domains/schema/pipeline/sql-statement-utils";
import {
  activityLog as activityLogSqlite,
  auditLog as auditLogSqlite,
} from "../../../schemas/audit/sqlite";
import {
  roles as rolesSqlite,
  userRoles as userRolesSqlite,
} from "../../../schemas/rbac/sqlite";
import {
  accounts as accountsSqlite,
  users as usersSqlite,
} from "../../../schemas/users/sqlite";
import { nextlyEvents as eventsSqlite } from "../../../schemas/webhooks/sqlite";
import { ActivityLogService } from "../../../services/dashboard/activity-log-service";
import { allResources } from "../../../services/dashboard/readable-resources";
import { UserMutationService } from "../services/user-mutation-service";

const TEST_DB_DIR = join(
  tmpdir(),
  `nextly-user-delete-erasure-${process.pid}-${Date.now()}`
);
const TEST_DB_PATH = join(TEST_DB_DIR, "test.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

process.env.DB_DIALECT = "sqlite";
process.env.DATABASE_URL = TEST_DB_URL;

// Production DDL from the sqlite table definitions, never hand-copied — a
// hand-written CREATE TABLE here could quietly omit the very constraint the
// suite exists to check.
async function ddl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({
      users: usersSqlite,
      accounts: accountsSqlite,
      roles: rolesSqlite,
      userRoles: userRolesSqlite,
      activityLog: activityLogSqlite,
      auditLog: auditLogSqlite,
      // The mutation service records user.created / user.deleted to the outbox
      // whenever recording is active, and that gate is process-wide.
      nextlyEvents: eventsSqlite,
    })
  );
  return splitStatements(statements);
}

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

interface ActivityRow {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  collection: string;
  entry_title: string | null;
  identity_erased_at: number | null;
}

describe("deleting a user erases them from the activity log without erasing the log (real SQLite)", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let users: UserMutationService;
  let activity: ActivityLogService;
  let auditWriter: ReturnType<typeof buildAuditLogWriter>;

  beforeAll(async () => {
    if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
    adapter = createSqliteAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    for (const stmt of await ddl()) {
      await adapter.executeQuery(stmt);
    }
    // A sentinel user so createLocalUser's "first user ever" branch (which
    // needs more of the RBAC wiring) is never taken.
    const nowEpoch = Math.floor(Date.now() / 1000);
    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["sentinel", "sentinel@test.local", "Sentinel", 1, nowEpoch, nowEpoch]
    );
    // The adapter resolves a table name through a SchemaRegistry, which boot
    // normally installs. ActivityLogService writes by name, so without this its
    // inserts fail — and it swallows its own failures, so they would fail
    // silently and leave every assertion below testing an empty table.
    const registry = new SchemaRegistry("sqlite");
    registry.registerStaticSchemas(getDialectTables("sqlite"));
    adapter.setTableResolver(registry);

    users = new UserMutationService(adapter, silentLogger);
    activity = new ActivityLogService(adapter, silentLogger);
    // The production writer, resolved against this adapter, so the columns
    // under test are the ones the auth handlers actually fill.
    auditWriter = buildAuditLogWriter((name: string) => {
      if (name === "adapter") return adapter;
      throw NextlyError.internal({
        logContext: { service: name },
      });
    });
  });

  afterAll(async () => {
    try {
      await adapter?.disconnect?.();
    } catch {
      // ignore teardown close errors
    }
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  // Ids are `string | number` on the service surface (the column is text, but
  // the type allows either), so normalise here rather than at every call site.
  async function rowsFor(userId: string | number): Promise<ActivityRow[]> {
    return adapter.executeQuery<ActivityRow>(
      `SELECT id, user_id, user_name, user_email, collection, entry_title,
              identity_erased_at
         FROM activity_log WHERE user_id = ? ORDER BY collection`,
      [String(userId)]
    );
  }

  interface AuditRow {
    kind: string;
    actor_user_id: string | null;
    ip_address: string | null;
    user_agent: string | null;
    identity_erased_at: number | null;
  }

  async function auditRowsFor(userId: string | number): Promise<AuditRow[]> {
    return adapter.executeQuery<AuditRow>(
      `SELECT kind, actor_user_id, ip_address, user_agent, identity_erased_at
         FROM audit_log WHERE actor_user_id = ? ORDER BY kind`,
      [String(userId)]
    );
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
      userId: String(actor.id),
      userName: "No Audit",
      userEmail: "no-audit-table@test.local",
      action: "create",
      collection: "posts",
      entryId: "p-1",
      entryTitle: "Kept",
    });
    await adapter.executeQuery(
      "ALTER TABLE audit_log RENAME TO audit_log_gone"
    );

    try {
      await users.deleteUser(actor.id);

      const after = await rowsFor(actor.id);
      expect(after).toHaveLength(1);
      // The activity erasure still ran, despite the other table being missing.
      expect(after[0].user_name).toBeNull();
      expect(after[0].identity_erased_at).not.toBeNull();
    } finally {
      await adapter.executeQuery(
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
    await adapter.executeQuery(
      "ALTER TABLE audit_log DROP COLUMN identity_erased_at"
    );

    try {
      await users.deleteUser(actor.id);
    } finally {
      // Restored before reading back: the schema the reader builds its SELECT
      // from carries the column, so the row cannot be read while the database
      // is missing it. The erasure under test has already happened by here.
      await adapter.executeQuery(
        "ALTER TABLE audit_log ADD COLUMN identity_erased_at TEXT"
      );
    }

    const rows = await auditRowsFor(actor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].ip_address).toBeNull();
    expect(rows[0].user_agent).toBeNull();
    // The stamp is the one thing a schema with nowhere to put it cannot record.
    expect(rows[0].identity_erased_at).toBeNull();
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
    expect(before[0].ip_address).toBe("203.0.113.7");
    expect(before[0].identity_erased_at).toBeNull();

    await users.deleteUser(actor.id);

    const after = await auditRowsFor(actor.id);
    // The record survives, still attributed and still saying what happened.
    expect(after).toHaveLength(1);
    expect(after[0].kind).toBe("password-changed");
    expect(after[0].actor_user_id).toBe(String(actor.id));
    // The person is gone from it.
    expect(after[0].ip_address).toBeNull();
    expect(after[0].user_agent).toBeNull();
    expect(after[0].identity_erased_at).not.toBeNull();
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
    expect(before[0].user_name).toBe("Ada Author");
    expect(before[0].identity_erased_at).toBeNull();

    await users.deleteUser(author.id);

    const after = await rowsFor(author.id);
    // Survival: the row the cascade used to destroy is still here.
    expect(after).toHaveLength(1);
    // Attribution: still tied to the account that acted, and still says what
    // happened.
    expect(after[0].user_id).toBe(author.id);
    expect(after[0].collection).toBe("posts");
    expect(after[0].entry_title).toBe("Q3 Report");
    // Erasure: nothing identifying the human is left.
    expect(after[0].user_name).toBeNull();
    expect(after[0].user_email).toBeNull();
    expect(after[0].identity_erased_at).not.toBeNull();

    // The account itself really is gone — otherwise the assertions above would
    // hold for a delete that never happened.
    const survivors = await adapter.executeQuery<{ id: string }>(
      "SELECT id FROM users WHERE id = ?",
      [author.id]
    );
    expect(survivors).toHaveLength(0);
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
    const account = await adapter.executeQuery<{ id: string }>(
      "SELECT id FROM users WHERE id = ?",
      [String(gone.id)]
    );
    expect(account).toHaveLength(0);

    await activity.logActivity({
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
    expect(rows[0].entry_title).toBe("Landed After Deletion");
    // The identity does not.
    expect(rows[0].user_name).toBeNull();
    expect(rows[0].user_email).toBeNull();
    expect(rows[0].identity_erased_at).not.toBeNull();
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
    await adapter.executeQuery(
      "UPDATE activity_log SET created_at = ? WHERE entry_title = ?",
      [1000, "older"]
    );
    await adapter.executeQuery(
      "UPDATE activity_log SET created_at = ? WHERE entry_title = ?",
      [2000, "newer"]
    );

    const feed = await activity.getRecentActivity({
      userId: String(author.id),
      scope: allResources(),
    });
    expect(feed.activities.map(a => a.entryTitle)).toEqual(["newer", "older"]);
    // The count query reads the same filter through its own spelling.
    expect(feed.total).toBe(2);
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
      userId: String(author.id),
      userName: "Stamped",
      userEmail: "erasure-stamp@test.local",
      action: "create",
      collection: "stamp_posts",
    });

    await users.deleteUser(author.id);
    const erased = (await rowsFor(author.id))[0];
    expect(erased.user_name).toBeNull();
    expect(erased.identity_erased_at).not.toBeNull();

    // A recognisable stamp, far enough in the past that a pass which rewrites
    // the row cannot land on the same value.
    await adapter.executeQuery(
      "UPDATE activity_log SET identity_erased_at = ? WHERE user_id = ?",
      [1000, String(author.id)]
    );

    await eraseActorPersonalData(
      adapter.getDrizzle() as Parameters<typeof eraseActorPersonalData>[0],
      getDialectTables("sqlite") as Parameters<
        typeof eraseActorPersonalData
      >[1],
      String(author.id),
      new Date()
    );

    // Untouched: the row records when the identity was actually erased, not
    // when some later sweep happened to run over it again.
    const afterSweep = (await rowsFor(author.id))[0];
    expect(afterSweep.identity_erased_at).toBe(1000);
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
    expect(untouched[0].user_name).toBe("Staying");
    expect(untouched[0].user_email).toBe("erasure-staying@test.local");
    expect(untouched[0].identity_erased_at).toBeNull();
  });
});
