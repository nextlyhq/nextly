/**
 * The locked write path, on MySQL.
 *
 * `logActivity` takes a shared lock and writes inside a transaction on both
 * MVCC dialects, and the two drivers do not have to agree about a locking
 * clause. Covering only Postgres is what let a dialect-specific defect through
 * once already — a CASE whose untyped branches Postgres could not infer a
 * parameter type for, which failed every write silently because this method
 * swallows its own errors. The same class of failure on MySQL would be just as
 * quiet, so the path is exercised here too.
 *
 * The lock-blocking assertion lives in the Postgres suite; what matters here is
 * that the statement the driver actually emits runs at all, and decides the
 * identity correctly in both directions.
 */

import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import { getMySQLDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { SchemaRegistry } from "../../../database/schema-registry";
import { splitStatements } from "../../../domains/schema/pipeline/sql-statement-utils";
import { activityLog as activityLogMysql } from "../../../schemas/audit/mysql";
import { users as usersMysql } from "../../../schemas/users/mysql";
import { ActivityLogService } from "../../../services/dashboard/activity-log-service";

const URL = process.env.TEST_MYSQL_URL;

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Distinctive actors so the suite touches only its own rows: `users` and
 * `activity_log` are fixed-name system tables and cannot be prefixed, and the
 * sequential integration run is what keeps files independent.
 */
const LIVE_ACTOR = "mysql-activity-live-actor";
const GONE_ACTOR = "mysql-activity-gone-actor";

const describeMaybe = URL ? describe : describe.skip;

describeMaybe("the locked activity write on MySQL", () => {
  let adapter: ReturnType<typeof createMySqlAdapter>;
  let activity: ActivityLogService;

  beforeAll(async () => {
    adapter = createMySqlAdapter({ url: URL as string });
    await adapter.connect();

    const kit = await getMySQLDrizzleKit();
    const applyDdl = async (name: string, table: unknown): Promise<void> => {
      const statements = await kit.generateMigration(
        await kit.generateDrizzleJson({}),
        await kit.generateDrizzleJson({ [name]: table })
      );
      for (const stmt of splitStatements(statements)) {
        await adapter.executeQuery(stmt);
      }
    };

    // `users` is shared with other suites in this sequential run, so it is
    // only created when genuinely absent.
    if (!(await adapter.tableExists("users"))) {
      await applyDdl("users", usersMysql);
    }

    // `activity_log` is rebuilt outright. The MySQL test database is long-lived
    // and a table left by an older revision of this schema is missing the
    // columns under test — which surfaces as a query error rather than a
    // failed assertion, and says nothing about the code.
    await adapter.executeQuery("DROP TABLE IF EXISTS activity_log");
    await applyDdl("activity_log", activityLogMysql);

    for (const id of [LIVE_ACTOR, GONE_ACTOR]) {
      await adapter.executeQuery("DELETE FROM activity_log WHERE user_id = ?", [
        id,
      ]);
      await adapter.executeQuery("DELETE FROM users WHERE id = ?", [id]);
    }

    const registry = new SchemaRegistry("mysql");
    registry.registerStaticSchemas(getDialectTables("mysql"));
    adapter.setTableResolver(registry);

    await adapter.executeQuery(
      `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, NOW(), NOW())`,
      [LIVE_ACTOR, "mysql-live@test.local", "Live Actor"]
    );

    activity = new ActivityLogService(adapter, silentLogger);
  });

  afterAll(async () => {
    try {
      for (const id of [LIVE_ACTOR, GONE_ACTOR]) {
        await adapter?.executeQuery(
          "DELETE FROM activity_log WHERE user_id = ?",
          [id]
        );
        await adapter?.executeQuery("DELETE FROM users WHERE id = ?", [id]);
      }
      await adapter?.disconnect?.();
    } catch {
      // ignore teardown errors
    }
  });

  it("keeps the author's identity while the account still exists", async () => {
    await activity.logActivity({
      userId: LIVE_ACTOR,
      userName: "Live Actor",
      userEmail: "mysql-live@test.local",
      action: "create",
      collection: "mysql_posts",
      entryTitle: "While Alive",
    });

    const rows = await adapter.executeQuery<{
      user_name: string | null;
      actor_deleted_at: Date | null;
    }>(
      `SELECT user_name, actor_deleted_at FROM activity_log WHERE user_id = ?`,
      [LIVE_ACTOR]
    );
    // A write that silently failed would leave this empty, which is exactly
    // how the Postgres defect presented.
    expect(rows).toHaveLength(1);
    expect(rows[0].user_name).toBe("Live Actor");
    expect(rows[0].actor_deleted_at).toBeNull();
  });

  it("writes an entry erased when its author is already gone", async () => {
    // The premise: no such account, so this exercises the erased path.
    const account = await adapter.executeQuery<{ id: string }>(
      "SELECT id FROM users WHERE id = ?",
      [GONE_ACTOR]
    );
    expect(account).toHaveLength(0);

    await activity.logActivity({
      userId: GONE_ACTOR,
      userName: "Already Gone",
      userEmail: "mysql-gone@test.local",
      action: "update",
      collection: "mysql_posts",
      entryTitle: "Landed After Deletion",
    });

    const rows = await adapter.executeQuery<{
      user_name: string | null;
      user_email: string | null;
      entry_title: string | null;
      actor_deleted_at: Date | null;
    }>(
      `SELECT user_name, user_email, entry_title, actor_deleted_at
         FROM activity_log WHERE user_id = ?`,
      [GONE_ACTOR]
    );
    expect(rows).toHaveLength(1);
    // The audit fact survives; the identity does not.
    expect(rows[0].entry_title).toBe("Landed After Deletion");
    expect(rows[0].user_name).toBeNull();
    expect(rows[0].user_email).toBeNull();
    expect(rows[0].actor_deleted_at).not.toBeNull();
  });
});
