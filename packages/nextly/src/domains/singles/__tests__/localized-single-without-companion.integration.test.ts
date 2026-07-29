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
  type TestNextly,
} from "../../../plugins/test-nextly";

let dir: string;
let dbPath: string;
let current: TestNextly | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-single-window-"));
  dbPath = join(dir, "test.db");
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
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
});
