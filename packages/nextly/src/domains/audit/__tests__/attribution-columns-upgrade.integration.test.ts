/**
 * The attribution columns reach a fresh database and an existing one through
 * `migrateCore`, the core of `nextly migrate` and of both boot paths: on the
 * activity log and the audit log, the agent, door, credential, session,
 * approval, grant, undo and deployment; on the record of content events, the
 * agent's name beside the person who acted; and the activity log's indexes
 * for reading one agent's or one session's rows.
 *
 * The existing database is the current core schema without them, holding a
 * row in each table written before they existed. The migrate adds them and
 * rewrites no row: each old row reads as it did, with nothing in the new
 * columns, and a second run changes nothing.
 *
 * Runs on every dialect with a database in this run, since the push that adds
 * the columns is a different implementation per dialect.
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

/** The columns both trails gain, by their stored names. */
const ATTRIBUTION_COLUMNS = [
  "agent_name",
  "agent_session_id",
  "door",
  "credential_id",
  "approval_request_id",
  "approved_by_user_id",
  "approved_via",
  "grant_id",
  "undoes_session_id",
  "deployment_host",
  "deployment_commit",
];
const ACTIVITY_INDEXES = [
  "idx_activity_log_agent_name",
  "idx_activity_log_agent_session",
];
const EVENT_COLUMN = "actor_agent_name";

/** Every attribution field, read back as nothing. */
const NOTHING_ATTRIBUTED = {
  agentName: null,
  agentSessionId: null,
  door: null,
  credentialId: null,
  approvalRequestId: null,
  approvedByUserId: null,
  approvedVia: null,
  grantId: null,
  undoesSessionId: null,
  deploymentHost: null,
  deploymentCommit: null,
};

interface Db {
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
}

/** An install from before the columns: the current schema without them. */
async function removeAttributionSchema(fresh: FreshDatabase): Promise<void> {
  for (const index of ACTIVITY_INDEXES) {
    await fresh.exec(
      fresh.dialect === "mysql"
        ? `DROP INDEX ${index} ON activity_log`
        : `DROP INDEX ${index}`
    );
  }
  for (const table of ["activity_log", "audit_log"]) {
    for (const column of ATTRIBUTION_COLUMNS) {
      await fresh.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
  }
  await fresh.exec(
    `ALTER TABLE nextly_content_events DROP COLUMN ${EVENT_COLUMN}`
  );
}

/** One row in each table, written by statement before the columns existed. */
async function insertLegacyRows(fresh: FreshDatabase): Promise<void> {
  // An insert built from the current schema would name the columns this
  // install lacks, so each is a statement naming only the old ones. Seconds
  // on SQLite, where these columns are integer timestamps.
  const at =
    fresh.dialect === "sqlite" ? "1767225600" : "'2026-01-01 00:00:00'";
  await fresh.exec(
    "INSERT INTO audit_log (id, kind, actor_user_id, created_at) " +
      `VALUES ('legacy-audit', 'login-succeeded', 'legacy-user', ${at})`
  );
  await fresh.exec(
    "INSERT INTO activity_log (id, user_id, actor_type, user_name, action, collection, entry_id, created_at) " +
      `VALUES ('legacy-activity', 'legacy-user', 'user', 'Legacy Person', 'update', 'posts', 'post-1', ${at})`
  );
  await fresh.exec(
    "INSERT INTO nextly_content_events (id, subject_kind, subject_slug, subject_id, kind, actor_kind, actor_id, actor_name, occurred_at) " +
      `VALUES ('legacy-event', 'collection', 'posts', 'post-1', 'created', 'person', 'legacy-user', 'Legacy Person', ${at})`
  );
}

/** An app with no migration files, so only the core phase has work to do. */
const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-attr-");
afterAll(remove);

describe.each(availableDialects())(
  "attribution columns through nextly migrate (%s)",
  dialect => {
    it("creates the columns and indexes on a fresh database", async () => {
      await withFreshDatabase(dialect, "nextly_attr_fresh", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);

        for (const table of ["activity_log", "audit_log"]) {
          expect(await fresh.columnsOf(table)).toEqual(
            expect.arrayContaining(ATTRIBUTION_COLUMNS)
          );
        }
        expect(await fresh.columnsOf("nextly_content_events")).toContain(
          EVENT_COLUMN
        );
      });
    }, 180_000);

    it("adds them to an existing database and leaves its rows as they were", async () => {
      await withFreshDatabase(dialect, "nextly_attr_existing", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        await removeAttributionSchema(fresh);
        expect(await fresh.columnsOf("activity_log")).not.toContain(
          "agent_name"
        );
        expect(await fresh.columnsOf("nextly_content_events")).not.toContain(
          EVENT_COLUMN
        );
        await insertLegacyRows(fresh);

        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);

        const {
          auditLog,
          activityLog,
          nextlyContentEvents: contentEvents,
        } = fresh.tables as unknown as {
          auditLog: { id: unknown };
          activityLog: { id: unknown };
          nextlyContentEvents: { id: unknown };
        };
        const db = fresh.db as unknown as Db;

        const [audit] = await db
          .select()
          .from(auditLog)
          .where(eq(auditLog.id as never, "legacy-audit"));
        expect(audit).toMatchObject({
          kind: "login-succeeded",
          actorUserId: "legacy-user",
          ...NOTHING_ATTRIBUTED,
        });

        const [activity] = await db
          .select()
          .from(activityLog)
          .where(eq(activityLog.id as never, "legacy-activity"));
        expect(activity).toMatchObject({
          userId: "legacy-user",
          userName: "Legacy Person",
          action: "update",
          ...NOTHING_ATTRIBUTED,
        });

        const [event] = await db
          .select()
          .from(contentEvents)
          .where(eq(contentEvents.id as never, "legacy-event"));
        expect(event).toMatchObject({
          actorKind: "person",
          actorId: "legacy-user",
          actorName: "Legacy Person",
          actorAgentName: null,
        });

        // Nothing left to add: the indexes came back with the columns.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
