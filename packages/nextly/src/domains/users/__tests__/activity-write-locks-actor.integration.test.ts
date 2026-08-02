/**
 * An activity write holds the account row for as long as it takes to commit.
 *
 * One statement is not enough on a dialect with snapshots. The subquery that
 * decides whether the author still exists is answered when the statement
 * STARTS, and the row becomes visible to everyone else when it COMMITS. An
 * insert whose snapshot precedes the deletion's commit still sees the account,
 * and an insert that commits after the deletion's post-commit sweep is
 * invisible to that sweep — both can be true of one statement, and the deleted
 * author's name would then survive in a durable row that nothing revisits.
 *
 * The lock is what removes that overlap: `deleteUser` takes an EXCLUSIVE lock
 * on the account row before it erases anything, so the two cannot be in flight
 * at once. This suite asserts the lock is genuinely taken, by holding the row
 * from another connection and watching the write wait for it — the observable
 * consequence, and the thing that disappears if the lock is removed.
 *
 * Postgres only, and self-skipping without `TEST_POSTGRES_URL`: the property
 * under test is row-level locking, which SQLite does not have and does not
 * need (its single writer cannot interleave with the deletion at all).
 */

import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import { getPgDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { SchemaRegistry } from "../../../database/schema-registry";
import { splitStatements } from "../../../domains/schema/pipeline/sql-statement-utils";
import { activityLog as activityLogPg } from "../../../schemas/audit/postgres";
import { users as usersPg } from "../../../schemas/users/postgres";
import { ActivityLogService } from "../../../services/dashboard/activity-log-service";

const URL = process.env.TEST_POSTGRES_URL;

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * A distinctive actor so the suite touches only its own rows.
 *
 * `users` and `activity_log` are fixed-name system tables and cannot be
 * prefixed; the sequential integration run is what keeps files independent.
 */
const ACTOR_ID = "activity-lock-probe-actor";

/** How long the write is given to prove it is NOT waiting. */
const BLOCKED_FOR_MS = 400;

const describeMaybe = URL ? describe : describe.skip;

describeMaybe(
  "an activity write locks the account it names (real Postgres)",
  () => {
    let adapter: ReturnType<typeof createPostgresAdapter>;
    let activity: ActivityLogService;
    const actorId = ACTOR_ID;

    beforeAll(async () => {
      adapter = createPostgresAdapter({ url: URL as string });
      await adapter.connect();

      // Production DDL, applied only for a table that is genuinely missing —
      // another suite in the same sequential run may already have created it.
      const kit = await getPgDrizzleKit();
      for (const [name, table] of [
        ["users", usersPg],
        ["activity_log", activityLogPg],
      ] as const) {
        if (await adapter.tableExists(name)) continue;
        const statements = await kit.generateMigration(
          await kit.generateDrizzleJson({}),
          await kit.generateDrizzleJson({ [name]: table })
        );
        for (const stmt of splitStatements(statements)) {
          await adapter.executeQuery(stmt);
        }
      }
      await adapter.executeQuery(
        `DELETE FROM activity_log WHERE user_id = $1`,
        [actorId]
      );
      await adapter.executeQuery(`DELETE FROM users WHERE id = $1`, [actorId]);

      const registry = new SchemaRegistry("postgresql");
      registry.registerStaticSchemas(getDialectTables("postgresql"));
      adapter.setTableResolver(registry);

      await adapter.executeQuery(
        `INSERT INTO users (id, email, name, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, true, now(), now())`,
        [actorId, "locked@test.local", "Locked Actor"]
      );

      activity = new ActivityLogService(adapter, silentLogger);
    });

    afterAll(async () => {
      try {
        await adapter?.executeQuery(
          `DELETE FROM activity_log WHERE user_id = $1`,
          [actorId]
        );
        await adapter?.executeQuery(`DELETE FROM users WHERE id = $1`, [
          actorId,
        ]);
        await adapter?.disconnect?.();
      } catch {
        // ignore teardown errors
      }
    });

    it("writes an entry erased when its author is already gone", async () => {
      // The equivalent SQLite assertion lives in the erasure suite, and running
      // ONLY there is how a Postgres-specific defect survived: the identity was
      // once decided by a CASE whose untyped branches Postgres cannot infer a
      // parameter type for, so every write failed — silently, because this
      // method swallows its own errors.
      const goneId = `${ACTOR_ID}-gone`;
      await adapter.executeQuery(
        `DELETE FROM activity_log WHERE user_id = $1`,
        [goneId]
      );
      // The premise: no such account exists, so this exercises the erased path.
      const account = await adapter.executeQuery<{ id: string }>(
        `SELECT id FROM users WHERE id = $1`,
        [goneId]
      );
      expect(account).toHaveLength(0);

      await activity.logActivity({
        userId: goneId,
        userName: "Already Gone",
        userEmail: "gone@test.local",
        action: "update",
        collection: "gone_posts",
        entryTitle: "Landed After Deletion",
      });

      const rows = await adapter.executeQuery<{
        user_name: string | null;
        user_email: string | null;
        entry_title: string | null;
        actor_deleted_at: Date | null;
      }>(
        `SELECT user_name, user_email, entry_title, actor_deleted_at
         FROM activity_log WHERE user_id = $1`,
        [goneId]
      );
      // The audit fact survives; the identity does not.
      expect(rows).toHaveLength(1);
      expect(rows[0].entry_title).toBe("Landed After Deletion");
      expect(rows[0].user_name).toBeNull();
      expect(rows[0].user_email).toBeNull();
      expect(rows[0].actor_deleted_at).not.toBeNull();

      await adapter.executeQuery(
        `DELETE FROM activity_log WHERE user_id = $1`,
        [goneId]
      );
    });

    it("keeps the author's identity while the account still exists", async () => {
      // The other half, so the test above cannot pass by erasing everything.
      await activity.logActivity({
        userId: actorId,
        userName: "Locked Actor",
        userEmail: "locked@test.local",
        action: "create",
        collection: "live_posts",
        entryTitle: "While Alive",
      });

      const rows = await adapter.executeQuery<{
        user_name: string | null;
        actor_deleted_at: Date | null;
      }>(
        `SELECT user_name, actor_deleted_at FROM activity_log
        WHERE user_id = $1 AND entry_title = $2`,
        [actorId, "While Alive"]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].user_name).toBe("Locked Actor");
      expect(rows[0].actor_deleted_at).toBeNull();
    });

    it("waits for a conflicting hold on the account row, then commits", async () => {
      const db = adapter.getDrizzle() as {
        transaction: (
          fn: (tx: {
            execute: (q: unknown) => Promise<unknown>;
          }) => Promise<void>
        ) => Promise<void>;
      };
      const { sql: sqlTag } = await import("drizzle-orm");

      let settled = false;
      let release!: () => void;
      const held = new Promise<void>(resolve => {
        release = resolve;
      });

      // Hold the account row exclusively on another connection. A shared lock
      // request cannot be granted while this is held.
      const holder = db.transaction(async tx => {
        await tx.execute(
          sqlTag.raw(`SELECT id FROM users WHERE id = '${actorId}' FOR UPDATE`)
        );
        await held;
      });

      const write = activity
        .logActivity({
          userId: actorId,
          userName: "Locked Actor",
          userEmail: "locked@test.local",
          action: "create",
          collection: "locked_posts",
          entryTitle: "Waits For The Lock",
        })
        .then(() => {
          settled = true;
        });

      await new Promise(resolve => setTimeout(resolve, BLOCKED_FOR_MS));
      // The assertion that fails when the lock is removed: without it the write
      // is an ordinary insert that never touches the account row and finishes
      // immediately.
      expect(settled).toBe(false);

      release();
      await holder;
      await write;
      expect(settled).toBe(true);

      // And the entry it was holding the lock for really landed.
      // Scoped to this entry: sibling cases in this suite write for the same
      // actor, and a bare user_id match would count theirs too.
      const rows = await adapter.executeQuery<{ user_name: string | null }>(
        `SELECT user_name FROM activity_log WHERE user_id = $1 AND entry_title = $2`,
        [actorId, "Waits For The Lock"]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].user_name).toBe("Locked Actor");
    });
  }
);
