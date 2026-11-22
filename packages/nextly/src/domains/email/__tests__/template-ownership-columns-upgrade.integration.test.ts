/**
 * The ownership columns reach an existing installation through the real core
 * reconcile (`migrateCore`, as `nextly migrate` and the boot run it), on every
 * configured dialect: an `email_templates` table without them gains them in
 * place, its rows untouched, and the ownership backfill then works on it.
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
import { serviceOver, storedRow } from "./template-ownership-fixture";

/** The columns this change adds, none of them indexed. */
const OWNERSHIP_COLUMNS = [
  "owner_kind",
  "owner_name",
  "overridden",
  "base_digest",
  "base_version",
  "description",
];
const LEGACY_ID = "00000000-0000-4000-8000-0000000000e1";

/** The table as an installation before ownership has it. */
async function removeOwnershipColumns(fresh: FreshDatabase): Promise<void> {
  for (const column of OWNERSHIP_COLUMNS) {
    await fresh.exec(`ALTER TABLE email_templates DROP COLUMN ${column}`);
  }
}

/** A core template its site reworded, stored as an older release stored it. */
async function insertLegacyRow(fresh: FreshDatabase): Promise<void> {
  const yes = fresh.dialect === "postgresql" ? "true" : "1";
  const now =
    fresh.dialect === "sqlite" ? "1760000000" : "'2026-10-01 09:00:00'";
  await fresh.exec(
    `INSERT INTO email_templates (id, name, slug, subject, html_content, kind, use_layout, is_active, created_at, updated_at) VALUES ('${LEGACY_ID}', 'Password reset', 'password-reset', 'Reset it now', '<p>Our own wording: {{resetLink}}</p>', 'template', ${yes}, ${yes}, ${now}, ${now})`
  );
}

const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-eto-");
afterAll(remove);

describe.each(availableDialects())(
  "email template ownership columns on an existing database (%s)",
  dialect => {
    it("adds them in place, keeps the rows, and the backfill then gives each its owner", async () => {
      await withFreshDatabase(dialect, "nextly_eto_existing", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        await removeOwnershipColumns(fresh);
        const before = await fresh.columnsOf("email_templates");
        for (const column of OWNERSHIP_COLUMNS) {
          expect(before).not.toContain(column);
        }
        await insertLegacyRow(fresh);

        // The production reconcile adds the columns.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);
        expect(await fresh.columnsOf("email_templates")).toEqual(
          expect.arrayContaining(OWNERSHIP_COLUMNS)
        );
        const row = await storedRow(fresh, LEGACY_ID);
        expect(row).toMatchObject({
          subject: "Reset it now",
          ownerKind: null,
          overridden: null,
        });

        // The ownership backfill works on the reconciled table: the site's
        // wording is kept, as an override of core's version.
        const service = serviceOver(fresh);
        service.configureOwnership({ plugins: [] });
        await service.ensureBuiltInTemplates();
        expect(await service.getTemplateBySlug("password-reset")).toMatchObject(
          {
            owner: { kind: "core" },
            overridden: true,
            subject: "Reset it now",
          }
        );

        // Nothing left to add.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
