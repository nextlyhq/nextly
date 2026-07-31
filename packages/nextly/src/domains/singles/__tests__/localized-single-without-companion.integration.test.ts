/**
 * A localized Single whose companion table is missing must still persist a write in the
 * DEFAULT language.
 *
 * While the companion is absent, translatable values belong on the main table — the same
 * pre-migration fallback collections use. But a localized Single's registered runtime table is
 * generated WITHOUT its translatable columns (`runtime-schema-generator` skips them as
 * companion-owned), so keeping those values in the main payload writes them through a schema
 * that does not declare them. If the ORM drops such keys, the update reports success while
 * saving nothing, and the submitted content is gone with no error anywhere.
 *
 * The physical read is the point: the runtime schema omits the column, so an API read cannot
 * distinguish "saved" from "silently dropped".
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";

import type { SingleEntryService } from "../services/single-entry-service";

let dir: string;
let dbPath: string;
let current: TestNextly | undefined;
// The harness snapshots DB_DIALECT when IT creates an adapter. These tests build
// their own first, so the snapshot captures the already-overwritten "sqlite" and
// never puts the real dialect back — which, in a single-fork run, would make every
// later file resolve environment-backed schema behaviour as SQLite.
let previousDialect: string | undefined;

beforeEach(() => {
  previousDialect = process.env.DB_DIALECT;
  dir = mkdtempSync(join(tmpdir(), "nextly-single-window-"));
  dbPath = join(dir, "test.db");
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  rmSync(dir, { recursive: true, force: true });
});

const localization = { locales: ["en", "es"], defaultLocale: "en" };

const settings = (localized: boolean) =>
  defineSingle({
    slug: "swin_settings",
    localized,
    fields: [text({ name: "headline", localized: true })],
  });

async function boot(localized: boolean): Promise<TestNextly> {
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    url: `file:${dbPath}`,
  } as Parameters<typeof createAdapter>[0]);
  return createTestNextly({
    adapter,
    singles: [settings(localized)],
    localization,
  });
}

describe("localized single without a companion table (integration)", () => {
  it("persists a default-language write to the main table", async () => {
    // Boot 1: not localized, so `headline` is an ordinary main-table column.
    current = await boot(false);
    await current.nextly.updateSingle({
      slug: "swin_settings",
      data: { headline: "Original" },
    } as Parameters<typeof current.nextly.updateSingle>[0]);

    // Re-open localized, then remove the companion to recreate the window.
    await current.destroy();
    current = await boot(true);
    await current.adapter.executeQuery(
      "DROP TABLE IF EXISTS single_swin_settings_locales"
    );

    await current.nextly.updateSingle({
      slug: "swin_settings",
      data: { headline: "Edited while the companion was missing" },
      locale: "en",
    } as Parameters<typeof current.nextly.updateSingle>[0]);

    const rows = await current.adapter.executeQuery<{ headline: string }>(
      "SELECT headline FROM single_swin_settings"
    );
    expect(rows[0]?.headline).toBe("Edited while the companion was missing");
  });

  it("refuses a default-language write when the main table never had the column", async () => {
    // Localized from creation, so `headline` only ever existed on the companion and the
    // main table has no column to fall back to. The case above cannot show this: there
    // the Single started life unlocalized, so its legacy main column is still present and
    // the fallback genuinely works.
    current = await boot(true);
    await current.adapter.executeQuery(
      "DROP TABLE IF EXISTS single_swin_settings_locales"
    );

    await expect(
      current.nextly.updateSingle({
        slug: "swin_settings",
        data: { headline: "Edited while the companion was missing" },
        locale: "en",
      } as Parameters<typeof current.nextly.updateSingle>[0])
    ).rejects.toThrow(/Translations are not ready/);
  });
});

/**
 * The same refusal, on a real server, for a Single localized from creation — the case the
 * SQLite pair above cannot cover, because there the Single starts life unlocalized and so
 * keeps a usable main column.
 *
 * This pins the refusal down to an actionable 409 on every dialect. It asserts the status
 * code rather than the message because the message is the weaker signal: when a
 * `NextlyError` reaches an adapter's `classifyError` it is rewrapped, but the original
 * `message` is copied onto the wrapper, so the text alone cannot tell a clean refusal from
 * a rewrapped one.
 *
 * Note what this does NOT cover: the write path also resolves this before opening its
 * transaction, so the probe cannot wait on a connection the transaction itself holds. That
 * matters only on a single-connection pool, where the symptom is a hang rather than a
 * wrong value, so it is left to the pool's own configuration rather than pinned here.
 */
describe.each(getConfiguredTestDialects())(
  "localized single without a companion table on %s (integration)",
  dialect => {
    it("refuses a default-language write with an actionable 409", async () => {
      current = await createTestNextly({
        dialect,
        singles: [settings(true)],
        localization,
      });

      await current.adapter.executeQuery(
        `DROP TABLE IF EXISTS ${dialect === "mysql" ? "`single_swin_settings_locales`" : '"single_swin_settings_locales"'}`
      );

      const result = await current
        .getService<SingleEntryService>("singleEntryService")
        .update(
          "swin_settings",
          { headline: "Edited while the companion was missing" },
          { locale: "en" }
        );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(409);
      expect(result.message).toMatch(/Translations are not ready/);
    });

    it("does not put the driver's own words on the wire when a companion read fails", async () => {
      // The companion reads no longer swallow a failure — deciding existence by catching one is
      // what aborted PostgreSQL transactions. Propagating is right, but it made a path that
      // previously could not throw start throwing, and the result builder puts a bare Error's
      // message straight onto the response: companion table and column names with it.
      current = await createTestNextly({
        dialect,
        singles: [settings(true)],
        localization,
      });
      const service =
        current.getService<SingleEntryService>("singleEntryService");

      // A successful read first, so the companion is established as present and the failure below
      // is a genuine read fault rather than a missing table.
      await service.get("swin_settings", { locale: "en" });

      // Break the companion while leaving the table in place, which is what a schema drift or a
      // permission fault looks like from the read's point of view.
      const q = (id: string) => (dialect === "mysql" ? `\`${id}\`` : `"${id}"`);
      await current.adapter.executeQuery(
        `ALTER TABLE ${q("single_swin_settings_locales")} DROP COLUMN ${q("headline")}`
      );

      const result = await service.get("swin_settings", { locale: "en" });

      expect(result.success).toBe(false);
      // The canonical envelope, not the driver's text.
      expect(result.message).not.toMatch(/headline|_locales|column|relation/i);
    });
  }
);
