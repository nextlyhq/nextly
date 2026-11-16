/**
 * The Activity reads' schema reaches an existing installation through the
 * real core reconcile (`migrateCore`, as `nextly migrate` and the boot run
 * it), on every configured dialect: a populated `email_deliveries` gains its
 * template index and a populated `email_queue` its `template_slug` column, in
 * place, with their rows untouched. A queued email from before reads as
 * having no template recorded.
 */
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

const TEMPLATE_INDEX = "email_deliveries_template_idx";
const QUEUE_INDEXES = {
  email_queue_created_idx: ["created_at", "id"],
  email_queue_template_idx: ["template_slug", "created_at"],
};
const DELIVERY_ID = "00000000-0000-4000-8000-0000000000d1";
const QUEUED_ID = "00000000-0000-4000-8000-0000000000q1";

/** The delivery log's indexes this change adds, with their columns. */
const DELIVERY_INDEXES = {
  [TEMPLATE_INDEX]: ["template_slug", "status", "created_at"],
  email_deliveries_provider_type_idx: ["provider_type", "created_at"],
  email_deliveries_queued_idx: ["queued_id"],
};

/** The delivery log's columns this change adds, none of them required. */
const DELIVERY_COLUMNS = [
  "queued_id",
  "template_owner",
  "template_overridden",
  "template_digest",
  "failure_kind",
  "failure_status",
];

/** The two tables as an installation before the Activity reads has them. */
async function removeActivitySchema(fresh: FreshDatabase): Promise<void> {
  for (const index of Object.keys(DELIVERY_INDEXES)) {
    await fresh.exec(
      fresh.dialect === "mysql"
        ? `DROP INDEX ${index} ON email_deliveries`
        : `DROP INDEX ${index}`
    );
  }
  for (const index of Object.keys(QUEUE_INDEXES)) {
    await fresh.exec(
      fresh.dialect === "mysql"
        ? `DROP INDEX ${index} ON email_queue`
        : `DROP INDEX ${index}`
    );
  }
  await fresh.exec(`ALTER TABLE email_queue DROP COLUMN template_slug`);
  for (const column of DELIVERY_COLUMNS) {
    await fresh.exec(`ALTER TABLE email_deliveries DROP COLUMN ${column}`);
  }
}

/** A delivery and a settled queued email, as an older release stored them. */
async function insertLegacyRows(fresh: FreshDatabase): Promise<void> {
  const deliveredAt =
    fresh.dialect === "sqlite" ? "1760000000000" : "'2026-10-01 09:00:00'";
  await fresh.exec(
    `INSERT INTO email_deliveries (id, provider_type, template_slug, recipient_hash, recipient_kind, status, attempt_count, retention_class, created_at) VALUES ('${DELIVERY_ID}', 'smtp', 'welcome', '${"a".repeat(64)}', 'to', 'sent', 1, 'default', ${deliveredAt})`
  );
  await fresh.exec(
    `INSERT INTO email_queue (id, scope, state, job_id, message, failure, created_at, updated_at, settled_at) VALUES ('${QUEUED_ID}', 'site', 'sent', NULL, NULL, NULL, 1760000000000, 1760000000000, 1760000000000)`
  );
}

const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-eda-");
afterAll(remove);

describe.each(availableDialects())(
  "the Activity reads' schema on an existing database (%s)",
  dialect => {
    it("adds the template index, the queued template column and its indexes in place, keeping the rows", async () => {
      await withFreshDatabase(dialect, "nextly_eda_existing", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        await removeActivitySchema(fresh);
        expect(await fresh.indexesOf("email_deliveries")).not.toContain(
          TEMPLATE_INDEX
        );
        expect(await fresh.columnsOf("email_queue")).not.toContain(
          "template_slug"
        );
        await insertLegacyRows(fresh);

        // The production reconcile adds both.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);
        expect(await fresh.indexesOf("email_deliveries")).toContain(
          TEMPLATE_INDEX
        );
        expect(
          await fresh.indexColumnsOf("email_deliveries", TEMPLATE_INDEX)
        ).toEqual(["template_slug", "status", "created_at"]);
        expect(await fresh.columnsOf("email_queue")).toContain("template_slug");
        expect(await fresh.columnsOf("email_deliveries")).toEqual(
          expect.arrayContaining(DELIVERY_COLUMNS)
        );
        for (const [index, columns] of Object.entries(DELIVERY_INDEXES)) {
          expect(await fresh.indexColumnsOf("email_deliveries", index)).toEqual(
            columns
          );
        }
        for (const [index, columns] of Object.entries(QUEUE_INDEXES)) {
          expect(await fresh.indexColumnsOf("email_queue", index)).toEqual(
            columns
          );
        }

        // The rows are untouched, and the older queued email has no
        // template recorded.
        const db = fresh.db as unknown as {
          select: () => {
            from: (table: unknown) => Promise<Record<string, unknown>[]>;
          };
        };
        const deliveries = await db.select().from(fresh.tables.emailDeliveries);
        expect(deliveries).toEqual([
          expect.objectContaining({
            id: DELIVERY_ID,
            templateSlug: "welcome",
            status: "sent",
            // Written before versions were recorded: it reads as not
            // recorded, with no failure and no queued email.
            templateOwner: null,
            failureKind: null,
            queuedId: null,
          }),
        ]);
        const queued = await db.select().from(fresh.tables.emailQueue);
        expect(queued).toEqual([
          expect.objectContaining({
            id: QUEUED_ID,
            state: "sent",
            templateSlug: null,
          }),
        ]);

        // Nothing left to add.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
