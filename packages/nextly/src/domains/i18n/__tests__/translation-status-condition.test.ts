/**
 * The translation-state filter, run against a real database.
 *
 * These conditions decide which tab of the worklist a document appears under,
 * and the states are presented to a translator as alternatives. So the property
 * worth testing is not that each condition matches something — it is that they
 * do not BOTH match the same document. A test asserting each state in isolation
 * passes happily while two of them overlap.
 *
 * Executed as SQL rather than compared as text: the defect below lived in the
 * relationship between two conditions, which a string assertion cannot see.
 *
 * @module domains/i18n/__tests__/translation-status-condition.test
 */
import { sql } from "drizzle-orm";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import {
  buildTranslationStatusCondition,
  type TranslationFilterState,
} from "../companion-join";

const COMPANION = "dc_posts_locales";
const LOCALIZED = ["title", "body"];

describe("buildTranslationStatusCondition", () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    await testDb.adapter.executeQuery(
      `CREATE TABLE ${COMPANION} (
         _parent TEXT NOT NULL,
         _locale TEXT NOT NULL,
         _status TEXT,
         title TEXT,
         body TEXT,
         PRIMARY KEY (_parent, _locale)
       )`
    );
  });

  afterEach(async () => {
    await testDb.close();
  });

  /**
   * Does the entry match this state's condition, per the database?
   *
   * The condition is handed to Drizzle to render and run, rather than
   * reconstructed as text here. A hand-rolled renderer is its own source of
   * bugs, and a test that mis-renders the thing it is checking reports on
   * itself.
   */
  async function matches(
    entryId: string,
    state: TranslationFilterState
  ): Promise<boolean> {
    const condition = buildTranslationStatusCondition({
      companionTableName: COMPANION,
      mainIdColumn: sql`${entryId}`,
      localizedColumns: LOCALIZED,
      hasStatus: true,
      defaultLocale: "en",
      filter: { locale: "fr", state },
    });
    if (!condition) return true; // a no-op filter keeps everything
    const rows = testDb.db.all<{ hit: number }>(
      sql`SELECT 1 AS hit WHERE ${condition}`
    );
    return (await Promise.resolve(rows)).length > 0;
  }

  it("a status with no content is NOT both untranslated and draft", async () => {
    // The defect. A companion row can carry `_status` while every localized
    // column is still blank — a lifecycle stamp arrives before any text does.
    // `draft` matched on `_status` alone while `missing` asks whether any
    // column is non-blank, so this row satisfied BOTH: the same document
    // appeared under "Not translated" AND "Draft", and nothing told the
    // translator which tab was wrong.
    await testDb.adapter.executeQuery(
      `INSERT INTO ${COMPANION} (_parent, _locale, _status, title, body) VALUES (?,?,?,?,?)`,
      ["entry-1", "fr", "draft", "", null]
    );

    const missing = await matches("entry-1", "missing");
    const draft = await matches("entry-1", "draft");

    // Asserted as a pair. Either alone passes while the overlap exists.
    expect([missing, draft]).not.toEqual([true, true]);
    // And the direction: no content means untranslated, per the blank rule the
    // rest of this function follows.
    expect(missing).toBe(true);
    expect(draft).toBe(false);
  });

  it("a draft WITH content is a draft, and not missing", async () => {
    // The control. A fix that simply made `draft` never match would satisfy the
    // case above and break the feature.
    await testDb.adapter.executeQuery(
      `INSERT INTO ${COMPANION} (_parent, _locale, _status, title, body) VALUES (?,?,?,?,?)`,
      ["entry-2", "fr", "draft", "Bonjour", null]
    );

    expect(await matches("entry-2", "draft")).toBe(true);
    expect(await matches("entry-2", "missing")).toBe(false);
  });

  it("a published row with content is published, not draft", async () => {
    // The states stay distinguishable from each other, not merely from missing.
    await testDb.adapter.executeQuery(
      `INSERT INTO ${COMPANION} (_parent, _locale, _status, title, body) VALUES (?,?,?,?,?)`,
      ["entry-3", "fr", "published", "Bonjour", null]
    );

    expect(await matches("entry-3", "published")).toBe(true);
    expect(await matches("entry-3", "draft")).toBe(false);
    expect(await matches("entry-3", "missing")).toBe(false);
  });
});
