/**
 * The audit trail's columns for a plugin-defined person, and the
 * deleted-people table, reach a fresh database and an existing one through
 * `migrateCore`, the core of `nextly migrate` and of both boot paths.
 *
 * The existing database is the current core schema without them, holding an
 * audit row written before they existed. The migrate adds them and rewrites
 * no row: the old row reads as it did, with nothing in the new columns, and a
 * second run changes nothing.
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
} from "../../../../__tests__/helpers/fresh-database";
import {
  migrateFresh,
  noMigrationsDir,
} from "../../../../__tests__/helpers/migrate-core";

const PERSON_COLUMNS = [
  "actor_kind",
  "actor_principal_kind",
  "actor_principal_id",
  "target_principal_kind",
  "target_principal_id",
];
const PERSON_INDEXES = [
  "audit_log_actor_principal_idx",
  "audit_log_target_principal_idx",
];
/** The email delivery log's columns naming the person a send went to. */
const DELIVERY_PERSON_COLUMNS = ["principal_kind", "principal_id"];
const LEGACY_DELIVERY_ID = "00000000-0000-4000-8000-000000000001";

interface Db {
  select: () => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
}

/** An install from before the columns: the current schema without them. */
async function removePersonSchema(fresh: FreshDatabase): Promise<void> {
  for (const index of PERSON_INDEXES) {
    await fresh.exec(
      fresh.dialect === "mysql"
        ? `DROP INDEX ${index} ON audit_log`
        : `DROP INDEX ${index}`
    );
  }
  for (const column of PERSON_COLUMNS) {
    await fresh.exec(`ALTER TABLE audit_log DROP COLUMN ${column}`);
  }
  await fresh.exec("DROP TABLE nextly_deleted_principals");
  await fresh.exec(
    fresh.dialect === "mysql"
      ? "DROP INDEX email_deliveries_principal_idx ON email_deliveries"
      : "DROP INDEX email_deliveries_principal_idx"
  );
  for (const column of DELIVERY_PERSON_COLUMNS) {
    await fresh.exec(`ALTER TABLE email_deliveries DROP COLUMN ${column}`);
  }
}

/** A delivery recorded before the person columns, by statement. */
async function insertLegacyDelivery(fresh: FreshDatabase): Promise<void> {
  // Milliseconds on SQLite, where the column is `timestamp_ms`.
  const writtenAt =
    fresh.dialect === "sqlite" ? "1767225600000" : "'2026-01-01 00:00:00'";
  await fresh.exec(
    "INSERT INTO email_deliveries (id, provider_type, recipient_hash, recipient_kind, status, attempt_count, retention_class, created_at) " +
      `VALUES ('${LEGACY_DELIVERY_ID}', 'smtp', 'legacy-digest', 'to', 'sent', 1, 'operational', ${writtenAt})`
  );
}

/** An app with no migration files, so only the core phase has work to do. */
const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-pac-");
afterAll(remove);

describe.each(availableDialects())(
  "audit columns for a plugin-defined person through nextly migrate (%s)",
  dialect => {
    it("creates the columns and the deleted-people table on a fresh database", async () => {
      await withFreshDatabase(dialect, "nextly_pac_fresh", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);

        expect(await fresh.columnsOf("audit_log")).toEqual(
          expect.arrayContaining(PERSON_COLUMNS)
        );
        expect(
          (await fresh.columnsOf("nextly_deleted_principals")).sort()
        ).toEqual(["deleted_at", "digest"]);
        expect(await fresh.columnsOf("email_deliveries")).toEqual(
          expect.arrayContaining(DELIVERY_PERSON_COLUMNS)
        );
      });
    }, 180_000);

    it("adds them to an existing database and leaves its rows as they were", async () => {
      await withFreshDatabase(dialect, "nextly_pac_existing", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        await removePersonSchema(fresh);
        expect(await fresh.columnsOf("audit_log")).not.toContain("actor_kind");
        expect(await fresh.columnsOf("nextly_deleted_principals")).toEqual([]);

        // A row written before the columns, by statement: an insert built
        // from the current schema would name the columns this install lacks.
        const writtenAt =
          fresh.dialect === "sqlite" ? "1767225600" : "'2026-01-01 00:00:00'";
        await fresh.exec(
          "INSERT INTO audit_log (id, kind, actor_user_id, ip_address, user_agent, created_at) " +
            `VALUES ('legacy-row', 'login-succeeded', 'legacy-user', '203.0.113.9', 'legacy-browser/1.0', ${writtenAt})`
        );
        await insertLegacyDelivery(fresh);
        const { auditLog, emailDeliveries } = fresh.tables as unknown as {
          auditLog: { id: unknown };
          emailDeliveries: { id: unknown };
        };
        const db = fresh.db as unknown as Db;

        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);

        expect(await fresh.columnsOf("audit_log")).toEqual(
          expect.arrayContaining(PERSON_COLUMNS)
        );
        expect(
          (await fresh.columnsOf("nextly_deleted_principals")).sort()
        ).toEqual(["deleted_at", "digest"]);
        const [row] = await db
          .select()
          .from(auditLog)
          .where(eq(auditLog.id as never, "legacy-row"));
        expect(row).toMatchObject({
          actorUserId: "legacy-user",
          ipAddress: "203.0.113.9",
          userAgent: "legacy-browser/1.0",
          actorKind: null,
          actorPrincipalKind: null,
          actorPrincipalId: null,
          targetPrincipalKind: null,
          targetPrincipalId: null,
        });

        expect(await fresh.columnsOf("email_deliveries")).toEqual(
          expect.arrayContaining(DELIVERY_PERSON_COLUMNS)
        );
        const [delivery] = await db
          .select()
          .from(emailDeliveries)
          .where(eq(emailDeliveries.id as never, LEGACY_DELIVERY_ID));
        expect(delivery).toMatchObject({
          recipientHash: "legacy-digest",
          status: "sent",
          principalKind: null,
          principalId: null,
        });

        // Nothing left to add.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
