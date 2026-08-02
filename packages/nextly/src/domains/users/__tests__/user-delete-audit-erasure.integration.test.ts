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
import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { SchemaRegistry } from "../../../database/schema-registry";
import { splitStatements } from "../../../domains/schema/pipeline/sql-statement-utils";
import { activityLog as activityLogSqlite } from "../../../schemas/audit/sqlite";
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
  actor_deleted_at: number | null;
}

describe("deleting a user erases them from the activity log without erasing the log (real SQLite)", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let users: UserMutationService;
  let activity: ActivityLogService;

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
              actor_deleted_at
         FROM activity_log WHERE user_id = ? ORDER BY collection`,
      [String(userId)]
    );
  }

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
    expect(before[0].actor_deleted_at).toBeNull();

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
    expect(after[0].actor_deleted_at).not.toBeNull();

    // The account itself really is gone — otherwise the assertions above would
    // hold for a delete that never happened.
    const survivors = await adapter.executeQuery<{ id: string }>(
      "SELECT id FROM users WHERE id = ?",
      [author.id]
    );
    expect(survivors).toHaveLength(0);
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
    expect(untouched[0].actor_deleted_at).toBeNull();
  });
});
