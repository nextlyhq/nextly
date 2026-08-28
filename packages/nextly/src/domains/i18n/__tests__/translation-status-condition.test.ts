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
         _updated_at INTEGER,
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
    state: TranslationFilterState,
    options: { hasUpdatedAt?: boolean; locale?: string } = {}
  ): Promise<boolean> {
    const condition = buildTranslationStatusCondition({
      companionTableName: COMPANION,
      mainIdColumn: sql`${entryId}`,
      localizedColumns: LOCALIZED,
      hasStatus: true,
      hasUpdatedAt: options.hasUpdatedAt ?? true,
      defaultLocale: "en",
      filter: { locale: options.locale ?? "fr", state },
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

  /**
   * i18n B2 — "translated, but the source moved since".
   *
   * 🔴 `stale` is NOT a sibling of the four states above, and the assertions
   * below are written to hold that line. The others are mutually exclusive
   * classifications of one locale; staleness is ORTHOGONAL to all of them — a
   * stale translation is still translated, and still published if it was
   * published. So each case asserts the PAIR: that `stale` answers what it
   * should AND that it did not quietly consume the state the document was
   * already in. A test asserting `stale` alone passes while the worklist
   * silently drops a published document out of its "Published" tab.
   *
   * The one exclusion that IS required is against `missing`, and it is the same
   * defect this file was opened for: a row with no content must not appear
   * under both "Not translated" and "Needs review".
   */
  describe("stale", () => {
    /** Seed one locale row: content, and when that locale was last written. */
    async function seed(
      entryId: string,
      locale: string,
      title: string | null,
      updatedAt: number | null,
      status = "published"
    ): Promise<void> {
      await testDb.adapter.executeQuery(
        `INSERT INTO ${COMPANION} (_parent, _locale, _status, _updated_at, title, body) VALUES (?,?,?,?,?,?)`,
        [entryId, locale, status, updatedAt, title, null]
      );
    }

    it("reports a translation whose SOURCE was written afterwards", async () => {
      await seed("e1", "en", "Hello again", 2000);
      await seed("e1", "fr", "Bonjour", 1000);

      expect(await matches("e1", "stale")).toBe(true);
      // 🔴 And it is STILL translated and STILL published. Staleness is a
      // second fact about the same locale, not a replacement for its state —
      // the language remains live, and a worklist that moved it out of
      // "Published" would be reporting the site as having less content than it
      // serves.
      expect(await matches("e1", "translated")).toBe(true);
      expect(await matches("e1", "published")).toBe(true);
      expect(await matches("e1", "missing")).toBe(false);
    });

    it("does NOT report one written after its source", async () => {
      await seed("e2", "en", "Hello", 1000);
      await seed("e2", "fr", "Bonjour", 2000);

      // The control that stops "always stale" from passing the case above.
      expect(await matches("e2", "stale")).toBe(false);
      expect(await matches("e2", "translated")).toBe(true);
    });

    it("does NOT report a tie", async () => {
      await seed("e3", "en", "Hello", 1000);
      await seed("e3", "fr", "Bonjour", 1000);

      // 🔴 `>`, not `>=`. Equal stamps are a translation saved alongside its
      // source, and on SQLite they are also two writes inside one second, since
      // the column stores whole epoch seconds. `>=` would report every
      // same-second pair on the site as needing review.
      expect(await matches("e3", "stale")).toBe(false);
    });

    it("treats an unstamped TARGET as unknown, not as stale", async () => {
      await seed("e4", "en", "Hello again", 2000);
      await seed("e4", "fr", "Bonjour", null);

      // A row written before `_updated_at` existed. Nothing is known about when
      // it was translated, and UNKNOWN must not be rendered as a finding: a
      // warning that fires on every pre-migration row is one people switch off,
      // taking the true ones with it.
      expect(await matches("e4", "stale")).toBe(false);
      expect(await matches("e4", "translated")).toBe(true);
    });

    it("treats an unstamped SOURCE as unknown, not as stale", async () => {
      await seed("e5", "en", "Hello", null);
      await seed("e5", "fr", "Bonjour", 1000);

      expect(await matches("e5", "stale")).toBe(false);
    });

    it("does not report staleness when there is no source row at all", async () => {
      await seed("e6", "fr", "Bonjour", 1000);

      // No default-locale companion row means no source timestamp to compare
      // against. The correlated subquery must yield nothing rather than
      // degenerating into a comparison of the target against itself.
      expect(await matches("e6", "stale")).toBe(false);
    });

    it("is NOT both untranslated and needing review", async () => {
      await seed("e7", "en", "Hello again", 2000);
      await seed("e7", "fr", "", 1000);

      const missing = await matches("e7", "missing");
      const stale = await matches("e7", "stale");

      // 🔴 The same pairing this file was opened for, applied to the new state.
      // A blank row carrying a stamp satisfies the timestamp comparison
      // perfectly, so without the content test it would appear under BOTH "Not
      // translated" and "Needs review" — and "review" is the wrong instruction
      // for a translation that was never written.
      expect([missing, stale]).not.toEqual([true, true]);
      expect(missing).toBe(true);
      expect(stale).toBe(false);
    });

    it("matches NOTHING when the companion has no `_updated_at` column", async () => {
      await seed("e8", "en", "Hello again", 2000);
      await seed("e8", "fr", "Bonjour", 1000);

      // 🔴 The most dangerous branch in this arm, because its wrong answer is
      // the confident one. A companion predating B2 cannot answer the question
      // — and the `undefined` that the `draft`/`published` arms return for an
      // unanswerable filter means "no restriction", which here would put EVERY
      // document of that collection under "Needs review" with nothing on screen
      // to suggest the collection was the problem. `1=0` is the honest answer:
      // nothing here is KNOWN to be stale.
      expect(await matches("e8", "stale", { hasUpdatedAt: false })).toBe(false);
      // The control: the same rows DO report stale once the column is there, so
      // the false above is the missing column and not the fixture.
      expect(await matches("e8", "stale")).toBe(true);
    });

    it("never reports the source locale as stale against itself", async () => {
      await seed("e9", "en", "Hello", 2000);

      // The default locale IS the source. Comparing it with itself can never be
      // greater, but relying on that would leave the answer to an accident of
      // the SQL; refusing by locale states it.
      expect(await matches("e9", "stale", { locale: "en" })).toBe(false);
    });
  });
});
