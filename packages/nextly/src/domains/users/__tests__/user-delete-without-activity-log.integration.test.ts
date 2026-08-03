/**
 * Deleting a user still works on a database that has no activity trail.
 *
 * Databases in this state exist in the wild: the SQLite fallback bootstrap in
 * earlier releases created a subset of the core tables, and nothing repairs an
 * existing database afterwards — first-run setup returns as soon as its probe
 * table is present and only warns, and `ensureCoreTables` returns as soon as
 * `users` is present. Erasing unconditionally inside the delete transaction
 * would therefore have made user deletion impossible on those installations,
 * which is a worse regression than the defect being fixed.
 *
 * Skipping is correct rather than merely tolerable here: with no `activity_log`
 * there is no trail, so there is no identifying data left behind and the
 * invariant the erasure protects holds by itself. That is why the check is a
 * positive "is the table there" probe and not a swallowed error — a genuine
 * erasure failure must still take the deletion down with it.
 */

import { existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import {
  LEGACY_ACTIVITY_LOG_SQLITE,
  ERASURE_COLUMNS,
} from "../../audit/__tests__/legacy-activity-log-fixture";
import { splitStatements } from "../../../domains/schema/pipeline/sql-statement-utils";
import {
  roles as rolesSqlite,
  userRoles as userRolesSqlite,
} from "../../../schemas/rbac/sqlite";
import {
  accounts as accountsSqlite,
  users as usersSqlite,
} from "../../../schemas/users/sqlite";
import { nextlyEvents as eventsSqlite } from "../../../schemas/webhooks/sqlite";
import { UserMutationService } from "../services/user-mutation-service";

const TEST_DB_DIR = join(
  tmpdir(),
  `nextly-user-delete-no-activity-${process.pid}-${Date.now()}`
);
const TEST_DB_PATH = join(TEST_DB_DIR, "test.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

process.env.DB_DIALECT = "sqlite";
process.env.DATABASE_URL = TEST_DB_URL;

// Deliberately WITHOUT activityLog — that absence is the condition under test.
async function ddl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({
      users: usersSqlite,
      accounts: accountsSqlite,
      roles: rolesSqlite,
      userRoles: userRolesSqlite,
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

describe("deleting a user on a database with no activity_log (real SQLite)", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let users: UserMutationService;

  beforeAll(async () => {
    if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
    adapter = createSqliteAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    for (const stmt of await ddl()) {
      await adapter.executeQuery(stmt);
    }
    const nowEpoch = Math.floor(Date.now() / 1000);
    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["sentinel", "sentinel@test.local", "Sentinel", 1, nowEpoch, nowEpoch]
    );
    users = new UserMutationService(adapter, silentLogger);
  });

  afterAll(async () => {
    try {
      await adapter?.disconnect?.();
    } catch {
      // ignore teardown close errors
    }
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it("removes the account on a database still holding the pre-erasure shape", async () => {
    // The other way the erasure cannot run. An upgrade does not always reach
    // `activity_log`: the core reconcile pushes only the static tables, and
    // drizzle-kit's SQLite entrypoint takes no table filter, so an ordinary
    // `dc_*` table reads as an orphan and trips its rename resolver — after
    // which the recovery pass creates missing tables but never alters an
    // existing one. `core-reconcile-activity-actor.integration.test.ts` pins
    // that. Failing every deletion on those installations would be a worse
    // regression than the defect the erasure fixes.
    await adapter.executeQuery(LEGACY_ACTIVITY_LOG_SQLITE);
    // A fresh service, because the previous case cached its answer for a
    // database that had no table at all.
    const legacyUsers = new UserMutationService(adapter, silentLogger);

    // The premise: the table is present but predates the erasure columns.
    expect(await adapter.tableExists("activity_log")).toBe(true);
    const columns = await adapter.executeQuery<{ name: string }>(
      `SELECT name FROM pragma_table_info('activity_log')`
    );
    for (const column of ERASURE_COLUMNS) {
      expect(columns.map(c => c.name)).not.toContain(column);
    }

    const doomed = await legacyUsers.createLocalUser({
      email: "legacy-activity-log@test.local",
      name: "Legacy Shape",
      password: "TestPassword123!",
      isActive: true,
    });

    await expect(legacyUsers.deleteUser(doomed.id)).resolves.toBeUndefined();

    const survivors = await adapter.executeQuery<{ id: string }>(
      "SELECT id FROM users WHERE id = ?",
      [String(doomed.id)]
    );
    expect(survivors).toHaveLength(0);

    await adapter.executeQuery(`DROP TABLE "activity_log"`);
  });

  it("removes the account instead of failing on the missing table", async () => {
    // The premise. If a later change starts provisioning the table here, this
    // suite would silently stop exercising the case it exists for.
    expect(await adapter.tableExists("activity_log")).toBe(false);

    const doomed = await users.createLocalUser({
      email: "no-activity-log@test.local",
      name: "No Trail",
      password: "TestPassword123!",
      isActive: true,
    });

    await expect(users.deleteUser(doomed.id)).resolves.toBeUndefined();

    const survivors = await adapter.executeQuery<{ id: string }>(
      "SELECT id FROM users WHERE id = ?",
      [String(doomed.id)]
    );
    expect(survivors).toHaveLength(0);
  });
});
