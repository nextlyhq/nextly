/**
 * `_updated_at` against a real database (i18n B2 — "changed since translated").
 *
 * 🔴 Driven through a real `SqliteAdapter` rather than a spy, because every claim here is about
 * what the DATABASE does with the statement and a spy can only confirm what the statement says.
 * Three of the four properties below are invisible to a spy:
 *
 *  - a `Date` is not a value better-sqlite3 accepts. It works only because the adapter converts it
 *    in `sanitizeSqliteValue`, and that conversion is applied in two separate places — the
 *    adapter's `executeQuery` and a transaction's `execute`. A spy asserting "a Date was bound"
 *    passes identically whether the driver would have taken it or thrown.
 *  - the column has to EXIST, with a type that stores what is written. The production DDL is what
 *    decides that, so the DDL is what the fixture runs.
 *  - the back-fill is a correlated UPDATE across two tables. Whether it selects the right row per
 *    locale is a property of the join, not of the string.
 *
 * Every read-back is a RAW `SELECT` of the physical column rather than a read through the
 * companion read path. A dropped write and a dropped read look identical through an API, and only
 * the raw read says which half is broken.
 *
 * @module domains/i18n/runtime/__tests__/companion-updated-at.test
 */

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VERSIONS_TABLE } from "../../../../schemas/versions/types";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { splitStatements } from "../../../schema/pipeline/sql-statement-utils";
import { COMPANION_UPDATED_AT_COLUMN } from "../../companion-columns";
import { buildCompanionReconcileStatements } from "../../migration/reconcile-companion";
import {
  companionContentStamp,
  companionWriteVia,
  upsertCompanionRow,
} from "../companion-io";

const MAIN = "dc_posts";
const COMPANION = `${MAIN}_locales`;

type Adapter = ReturnType<typeof createSqliteAdapter>;

/** The physical `_updated_at` for one locale, read straight from the column. */
async function readStamp(
  adapter: Adapter,
  parent: string,
  locale: string
): Promise<number | null> {
  const rows = await adapter.executeQuery<Record<string, number | null>>(
    `SELECT "${COMPANION_UPDATED_AT_COLUMN}" AS stamp FROM "${COMPANION}" ` +
      `WHERE "_parent" = ? AND "_locale" = ?`,
    [parent, locale]
  );
  return rows[0]?.stamp ?? null;
}

describe("companion `_updated_at`", () => {
  let adapter: Adapter;

  beforeEach(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();

    // The production generator, never a hand-copied CREATE TABLE: a fixture that spells its own
    // DDL drifts from the shape Nextly actually creates, and the test then exercises a layout no
    // real database has.
    const schemaService = new DynamicCollectionSchemaService(
      undefined,
      "sqlite"
    );
    for (const statement of splitStatements([
      schemaService.generateMigrationSQL(MAIN, [] as never),
    ])) {
      await adapter.executeQuery(statement);
    }
    await adapter.executeQuery(
      `INSERT INTO "${MAIN}" ("id", "title", "slug") VALUES ('p1', 'Hello', 'p1')`
    );
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  /**
   * Create the companion through the production reconcile path.
   *
   * `withStatus` builds the per-locale `_status` column, which only a Draft/Published entity has.
   * The lifecycle tests need it; the rest do not, and creating it unconditionally would have them
   * exercising a shape their entity does not carry.
   */
  async function createCompanion(withStatus = false): Promise<void> {
    for (const statement of buildCompanionReconcileStatements({
      slug: "posts",
      tableName: MAIN,
      oldLocalized: [],
      newLocalized: [{ name: "title", type: "text", localized: true }],
      dialect: "sqlite",
      status: withStatus,
      builtBy: "codeFirst",
      companionExists: false,
    })) {
      await adapter.executeQuery(statement);
    }
  }

  it("creates the column, and a write lands a readable timestamp in it", async () => {
    await createCompanion();
    const now = new Date("2026-08-28T09:15:00.000Z");

    await upsertCompanionRow(
      adapter,
      COMPANION,
      "p1",
      "fr",
      { title: "Bonjour" },
      undefined,
      { now }
    );

    // 🔴 The value, not merely "not null". SQLite stores whatever it is handed regardless of the
    // declared type, so an ISO string would land in this column without complaint and only fail
    // on the way back out, where the timestamp decoder reads it as a number and yields an Invalid
    // Date. Asserting the epoch proves the adapter's Date conversion actually ran.
    expect(await readStamp(adapter, "p1", "fr")).toBe(
      Math.floor(now.getTime() / 1000)
    );
  });

  it("MOVES the stamp on a second write to the same locale", async () => {
    await createCompanion();
    const first = new Date("2026-08-28T09:00:00.000Z");
    const second = new Date("2026-08-28T10:00:00.000Z");

    await upsertCompanionRow(
      adapter,
      COMPANION,
      "p1",
      "fr",
      { title: "Bonjour" },
      undefined,
      { now: first }
    );
    await upsertCompanionRow(
      adapter,
      COMPANION,
      "p1",
      "fr",
      { title: "Salut" },
      undefined,
      { now: second }
    );

    // 🔴 This is the conflict arm, and it is a distinct failure from the insert arm. Named in the
    // INSERT but omitted from `DO UPDATE SET`, the first write to a locale is stamped and no later
    // one is -- so a translation brought up to date after its source moved keeps reading as stale
    // forever, and re-saving it never clears the warning.
    expect(await readStamp(adapter, "p1", "fr")).toBe(
      Math.floor(second.getTime() / 1000)
    );
  });

  it("stamps a write made inside a transaction, which is the collection path", async () => {
    await createCompanion();
    const now = new Date("2026-08-28T11:00:00.000Z");

    await adapter.transaction(async tx => {
      await upsertCompanionRow(
        companionWriteVia(tx, "sqlite"),
        COMPANION,
        "p1",
        "de",
        { title: "Hallo" },
        undefined,
        { now }
      );
    });

    // 🔴 The transaction is a SECOND surface with its own parameter handling, and it is the one
    // the main collection write path uses. A stamp that worked only on the adapter surface would
    // leave every locale written through a collection save unstamped -- reading as UNKNOWN, so
    // never reported stale. Nobody notices a warning that never fires.
    expect(await readStamp(adapter, "p1", "de")).toBe(
      Math.floor(now.getTime() / 1000)
    );
  });

  it("does NOT stamp a write that only changes the lifecycle status", async () => {
    await createCompanion(true);
    const written = new Date("2026-08-28T09:00:00.000Z");
    const published = new Date("2026-08-28T15:00:00.000Z");

    await upsertCompanionRow(
      adapter,
      COMPANION,
      "p1",
      "fr",
      { title: "Bonjour" },
      undefined,
      { now: written }
    );

    // Publishing. `_status` travels INSIDE `companionData` on the ordinary update path, which is
    // why the test sends it that way rather than through the `status` argument.
    await upsertCompanionRow(
      adapter,
      COMPANION,
      "p1",
      "fr",
      { _status: "published" },
      undefined,
      { now: published }
    );

    // 🔴 `_updated_at` answers "when was this language last WRITTEN", and a lifecycle transition
    // writes no language. Stamping it would move the SOURCE past every target on a publish that
    // changed not one word, reporting the whole site as needing review; and publishing a stale
    // TARGET would clear its warning while the translation still says what it said.
    expect(await readStamp(adapter, "p1", "fr")).toBe(
      Math.floor(written.getTime() / 1000)
    );
  });

  it("stamps a write that changes content AND status together", async () => {
    await createCompanion(true);
    const first = new Date("2026-08-28T09:00:00.000Z");
    const second = new Date("2026-08-28T15:00:00.000Z");

    await upsertCompanionRow(
      adapter,
      COMPANION,
      "p1",
      "fr",
      { title: "Bonjour" },
      undefined,
      { now: first }
    );
    await upsertCompanionRow(
      adapter,
      COMPANION,
      "p1",
      "fr",
      { title: "Salut", _status: "published" },
      undefined,
      { now: second }
    );

    // The control that stops "never stamp when `_status` is present" from passing the case above.
    // Save-and-publish in one write IS a content change, and must move the timestamp.
    expect(await readStamp(adapter, "p1", "fr")).toBe(
      Math.floor(second.getTime() / 1000)
    );
  });

  describe("the shared stamp rule", () => {
    // 🔴 Tested directly, because THREE call sites depend on it and only two of them go through
    // `upsertCompanionRow`. The collection CREATE path inserts the companion row itself and
    // spreads this in; a rule restated there would be one edit away from disagreeing, and the
    // disagreement is silent — the forgotten path leaves NULL, which reads as UNKNOWN and is
    // never reported stale.

    it("stamps a write carrying translated content", () => {
      const now = new Date("2026-08-28T09:00:00.000Z");
      // The ENCODED value, which on SQLite is epoch seconds -- what the INTEGER
      // column stores. Asserting the raw `Date` would pass on a value that
      // reaches the driver unencoded, which is the defect this guards.
      expect(
        companionContentStamp({ title: "Bonjour" }, COMPANION, "sqlite", now)
      ).toEqual({
        [COMPANION_UPDATED_AT_COLUMN]: Math.floor(now.getTime() / 1000),
      });
    });

    it("stamps nothing for a lifecycle-only write", () => {
      expect(
        companionContentStamp({ _status: "published" }, COMPANION, "sqlite")
      ).toEqual({});
    });

    it("stamps nothing for an empty write", () => {
      expect(companionContentStamp({}, COMPANION, "sqlite")).toEqual({});
    });

    it("stamps when content and status travel together", () => {
      // The control. "No stamp whenever `_status` is present" satisfies the two cases above and
      // breaks save-and-publish, which IS a content change.
      const now = new Date("2026-08-28T09:00:00.000Z");
      expect(
        companionContentStamp(
          { title: "Salut", _status: "published" },
          COMPANION,
          "sqlite",
          now
        )
      ).toEqual({
        [COMPANION_UPDATED_AT_COLUMN]: Math.floor(now.getTime() / 1000),
      });
    });
  });

  it("stamps a row inserted by the CREATE path's own statement", async () => {
    await createCompanion();
    const now = new Date("2026-08-28T09:30:00.000Z");

    // 🔴 The collection create path does NOT call `upsertCompanionRow` — it builds its own INSERT
    // on the open transaction, because the parent row was created in the same statement batch and
    // there is no conflict to resolve. This reproduces that shape: the shared rule spread into a
    // plain insert. A test that called the upsert here would pass while the real create path left
    // every new document unstamped, which is exactly what it did before this fix.
    const stamp = companionContentStamp(
      { title: "Bonjour" },
      COMPANION,
      "sqlite",
      now
    );
    const stampColumns = Object.keys(stamp);
    const cols = ["_parent", "_locale", "title", ...stampColumns];
    await adapter.executeQuery(
      `INSERT INTO "${COMPANION}" (${cols.map(c => `"${c}"`).join(", ")}) ` +
        `VALUES (${cols.map(() => "?").join(", ")})`,
      [
        "p1",
        "fr",
        "Bonjour",
        // The stamp is a `Date`, which is what every dialect's driver takes and what the SQLite
        // adapter converts to epoch seconds. Narrowed here rather than spread as `unknown`, so
        // this reads as the same bind the real create path performs.
        ...stampColumns.map(column => stamp[column] as number),
      ]
    );

    expect(await readStamp(adapter, "p1", "fr")).toBe(
      Math.floor(now.getTime() / 1000)
    );
  });

  it("leaves a REPLAYED translation's chronology unknown rather than dating it now", async () => {
    await createCompanion();

    // What `restoreI18nArchive` does when localization is re-enabled: it replays archived
    // per-field values through this seam. The archive stores `field`/`value` rows and never held
    // the original `_updated_at`, so there is nothing to put back.
    await upsertCompanionRow(
      adapter,
      COMPANION,
      "p1",
      "fr",
      { title: "Bonjour" },
      undefined,
      { updatedAt: "clear" }
    );

    // 🔴 NULL, not the replay time. Stamping would fabricate a chronology in the dangerous
    // direction: source content edited after re-enabling but before the replay would look OLDER
    // than the archived translation, so a genuinely stale target would be reported current.
    expect(await readStamp(adapter, "p1", "fr")).toBeNull();
  });

  it("CLEARS an existing stamp on replay, rather than leaving it standing", async () => {
    await createCompanion();
    const translated = new Date("2026-08-28T12:00:00.000Z");

    // Someone translates this locale after localization is re-enabled...
    await upsertCompanionRow(
      adapter,
      COMPANION,
      "p1",
      "fr",
      { title: "Bonjour (new)" },
      undefined,
      { now: translated }
    );
    expect(await readStamp(adapter, "p1", "fr")).toBe(
      Math.floor(translated.getTime() / 1000)
    );

    // ...and `i18n:restore` then replays the OLDER archived text over it.
    await upsertCompanionRow(
      adapter,
      COMPANION,
      "p1",
      "fr",
      { title: "Bonjour (archived)" },
      undefined,
      { updatedAt: "clear" }
    );

    // 🔴 "omit" and "clear" look interchangeable and are not. The conflict clause updates only the
    // columns NAMED, so omitting would leave the recent stamp standing over content that has just
    // been replaced with something older -- and the restored translation would read as current.
    // Writing NULL says what is true: this row's chronology is unknown.
    expect(await readStamp(adapter, "p1", "fr")).toBeNull();
    const rows = await adapter.executeQuery<{ title: string }>(
      `SELECT "title" FROM "${COMPANION}" WHERE "_parent" = ? AND "_locale" = ?`,
      ["p1", "fr"]
    );
    // The content really was replaced, so the NULL above is the replay's doing and not a write
    // that silently did nothing.
    expect(rows[0]?.title).toBe("Bonjour (archived)");
  });

  it("leaves the column NULL for a row written before it existed", async () => {
    await createCompanion();

    // A companion row that predates the column: written with the stamp suppressed, exactly as a
    // write against a not-yet-reconciled companion behaves.
    await upsertCompanionRow(
      adapter,
      COMPANION,
      "p1",
      "es",
      { title: "Hola" },
      undefined,
      { updatedAt: "omit" }
    );

    // 🔴 NULL, never a default. This is the assertion the whole design turns on: a seeded
    // `CURRENT_TIMESTAMP` would give every pre-existing row the same value, source and target
    // would compare EQUAL, and every stale translation on the site would read as fresh on the
    // first run after the migration.
    expect(await readStamp(adapter, "p1", "es")).toBeNull();
  });

  it("clears the stamp when a surviving companion's source locale is refreshed from main", async () => {
    await createCompanion();
    const translated = new Date("2026-08-28T12:00:00.000Z");
    await upsertCompanionRow(
      adapter,
      COMPANION,
      "p1",
      "en",
      { title: "Hello" },
      undefined,
      { now: translated }
    );
    expect(await readStamp(adapter, "p1", "en")).toBe(
      Math.floor(translated.getTime() / 1000)
    );

    const { refreshDefaultLocaleFromMain } = await import("../companion-copy");
    await refreshDefaultLocaleFromMain(adapter, {
      tableName: MAIN,
      companionTableName: COMPANION,
      fields: [{ name: "title", type: "text", localized: true }],
      dialect: "sqlite",
      locale: "en",
      columns: ["title"],
    });

    // 🔴 Re-enabling localization over a companion that survived a disable copies the SOURCE
    // locale's columns back from the now-authoritative main table. Leaving the stamp alone would
    // attach the old chronology to new content, so a target that really is stale would compare
    // newer than its source and never be reported. NULL says what is true: unknown.
    expect(await readStamp(adapter, "p1", "en")).toBeNull();
  });

  describe("the refresh that re-enables localization over a surviving companion", () => {
    /** The runtime key/value table the transition claim lives in. */
    async function createMeta(): Promise<void> {
      await adapter.executeQuery(
        `CREATE TABLE "nextly_meta" (` +
          `"key" TEXT PRIMARY KEY, "value" TEXT, "updated_at" INTEGER NOT NULL)`
      );
    }

    async function claim(key: string, value: string): Promise<void> {
      await adapter.executeQuery(
        `INSERT INTO "nextly_meta" ("key", "value", "updated_at") VALUES (?,?,?)`,
        [key, value, 0]
      );
    }

    async function refresh(guard?: {
      key: string;
      value: string;
    }): Promise<void> {
      const { refreshDefaultLocaleFromMain } = await import(
        "../companion-copy"
      );
      await refreshDefaultLocaleFromMain(adapter, {
        tableName: MAIN,
        companionTableName: COMPANION,
        fields: [{ name: "title", type: "text", localized: true }],
        dialect: "sqlite",
        locale: "en",
        columns: ["title"],
        ...(guard ? { guard } : {}),
      });
    }

    it("clears the source stamp when the claim is still held", async () => {
      await createCompanion();
      await createMeta();
      await claim("i18n.claim", "token-1");
      const written = new Date("2026-08-28T12:00:00.000Z");
      await upsertCompanionRow(
        adapter,
        COMPANION,
        "p1",
        "en",
        { title: "Hello" },
        undefined,
        { now: written }
      );

      await refresh({ key: "i18n.claim", value: "token-1" });

      // The content came from main and its chronology is unknown, so the stamp must not stay.
      expect(await readStamp(adapter, "p1", "en")).toBeNull();
    });

    it("clears NOTHING when the claim has been superseded", async () => {
      await createCompanion();
      await createMeta();
      await claim("i18n.claim", "token-2");
      const written = new Date("2026-08-28T12:00:00.000Z");
      await upsertCompanionRow(
        adapter,
        COMPANION,
        "p1",
        "en",
        { title: "Hello" },
        undefined,
        { now: written }
      );

      // A worker whose claim has moved on.
      await refresh({ key: "i18n.claim", value: "token-1" });

      // 🔴 This statement is not the harmless one it looks like. It clears the stamp on EVERY row
      // of the locale, and the locale it is called for is the SOURCE -- one half of every
      // comparison in the collection. A superseded worker running it unguarded would erase the
      // whole collection's chronology and hide every stale translation in it until each source row
      // was rewritten, which is far larger than the one row it appears to touch.
      expect(await readStamp(adapter, "p1", "en")).toBe(
        Math.floor(written.getTime() / 1000)
      );
    });
  });

  describe("the back-fill", () => {
    /** The companion as it stands on a database that predates B2: no `_updated_at`. */
    async function createLegacyCompanion(): Promise<void> {
      await adapter.executeQuery(
        `CREATE TABLE "${COMPANION}" (` +
          `"_parent" TEXT NOT NULL, "_locale" VARCHAR(20) NOT NULL, "title" TEXT, ` +
          `PRIMARY KEY ("_parent", "_locale"), ` +
          `FOREIGN KEY ("_parent") REFERENCES "${MAIN}" ("id") ON DELETE CASCADE)`
      );
      await adapter.executeQuery(
        `INSERT INTO "${COMPANION}" ("_parent", "_locale", "title") ` +
          `VALUES ('p1', 'fr', 'Bonjour'), ('p1', 'de', 'Hallo'), ('p1', 'es', 'Hola')`
      );
    }

    async function createVersions(): Promise<void> {
      // `version_no` is NULL on a working draft and on an autosave, and NOT NULL on a durable
      // version. The back-fill reads only durable rows, so the column has to be here or the
      // fixture cannot express the distinction the statement turns on.
      await adapter.executeQuery(
        `CREATE TABLE "${VERSIONS_TABLE}" (` +
          `"id" TEXT PRIMARY KEY, "scope_kind" TEXT NOT NULL, "scope_slug" TEXT NOT NULL, ` +
          `"entry_id" TEXT NOT NULL, "locale" TEXT, "version_no" INTEGER, ` +
          `"created_at" INTEGER NOT NULL)`
      );
    }

    /** Insert version rows. A `null` version number is a working draft or an autosave. */
    async function seedVersions(
      rows: [
        id: string,
        slug: string,
        kind: string,
        entry: string,
        locale: string,
        versionNo: number | null,
        createdAt: number,
      ][]
    ): Promise<void> {
      for (const [
        id,
        slug,
        kind,
        entry,
        locale,
        versionNo,
        createdAt,
      ] of rows) {
        await adapter.executeQuery(
          `INSERT INTO "${VERSIONS_TABLE}" ` +
            `("id", "scope_kind", "scope_slug", "entry_id", "locale", "version_no", "created_at") ` +
            `VALUES (?,?,?,?,?,?,?)`,
          [id, kind, slug, entry, locale, versionNo, createdAt]
        );
      }
    }

    /**
     * Run the reconcile's own statements against the database.
     *
     * `companionHasUpdatedAt` is the caller's INTROSPECTION result, so a second sync passes
     * `true` — the column is there by then. Defaulting it to false in both calls would emit a
     * second `ADD COLUMN` and fail on the duplicate, which is the fixture lying rather than the
     * code misbehaving.
     */
    async function reconcile(hasUpdatedAt = false): Promise<void> {
      for (const statement of buildCompanionReconcileStatements({
        slug: "posts",
        tableName: MAIN,
        oldLocalized: [{ name: "title", type: "text", localized: true }],
        newLocalized: [{ name: "title", type: "text", localized: true }],
        dialect: "sqlite",
        status: false,
        builtBy: "codeFirst",
        companionExists: true,
        companionHasUpdatedAt: hasUpdatedAt,
        versionScope: "collection",
      })) {
        await adapter.executeQuery(statement);
      }
    }

    it("seeds each locale from ITS OWN version history, not one value for all", async () => {
      await createLegacyCompanion();
      await createVersions();
      await seedVersions([
        ["v1", "posts", "collection", "p1", "fr", 1, 1000],
        ["v2", "posts", "collection", "p1", "fr", 2, 3000],
        ["v3", "posts", "collection", "p1", "de", 1, 2000],
      ]);

      await reconcile();

      // 🔴 The separating property, and the reason version history is the only usable source.
      // `DEFAULT CURRENT_TIMESTAMP` and a copy of `main.updated_at` both satisfy "the column is
      // populated" while giving every locale the SAME value -- which makes source and target
      // compare equal and reports every stale translation as fresh. Two locales landing on two
      // DIFFERENT timestamps is what distinguishes a truthful back-fill from either of them.
      expect(await readStamp(adapter, "p1", "fr")).toBe(3000);
      expect(await readStamp(adapter, "p1", "de")).toBe(2000);

      // No history for this locale, so nothing is known about it. UNKNOWN is the honest answer and
      // it is not the same as up to date.
      expect(await readStamp(adapter, "p1", "es")).toBeNull();
    });

    it("takes the LATEST version per locale, not an arbitrary one", async () => {
      await createLegacyCompanion();
      await createVersions();
      // Inserted oldest-last, so a query taking whichever row it meets first gets 1000.
      await seedVersions([
        ["v1", "posts", "collection", "p1", "fr", 2, 5000],
        ["v2", "posts", "collection", "p1", "fr", 1, 1000],
      ]);

      await reconcile();

      // "When was this locale last written" is a MAX. Anything else understates the target's
      // timestamp, which makes the source look newer than it is -- reporting a current
      // translation as needing review.
      expect(await readStamp(adapter, "p1", "fr")).toBe(5000);
    });

    it("does not read another collection's or another entry's history", async () => {
      await createLegacyCompanion();
      await createVersions();
      await seedVersions([
        ["v1", "posts", "collection", "p1", "fr", 1, 4000],
        ["v2", "authors", "collection", "p1", "fr", 1, 9000],
        ["v3", "posts", "single", "p1", "fr", 1, 8000],
        ["v4", "posts", "collection", "p2", "fr", 1, 7000],
      ]);

      await reconcile();

      // Every decoy is NEWER than the real row, so a join missing any one of the three predicates
      // produces a larger number rather than an error. A correct back-fill is the only one that
      // returns 4000.
      expect(await readStamp(adapter, "p1", "fr")).toBe(4000);
    });

    it("RE-ISSUES the back-fill when the column already exists", async () => {
      // 🔴 The failure this replaces was mine, and the test that used to sit here could not see
      // it: it replayed the back-fill STATEMENT by hand and concluded the reconcile recovers.
      // The reconcile did not. Pairing the ADD with the back-fill made the column's PRESENCE
      // stand for the back-fill having run — so if the ADD committed and the UPDATE did not,
      // every later run saw the column, concluded the companion was in step, and left the rows
      // unknown permanently. Staleness would silently never fire for that collection.
      //
      // This asserts the RECONCILE's own output, which is the thing that recovers.
      await createLegacyCompanion();
      await createVersions();
      await seedVersions([["v1", "posts", "collection", "p1", "fr", 1, 4000]]);

      // The half-applied state: the column landed, the back-fill did not.
      await adapter.executeQuery(
        `ALTER TABLE "${COMPANION}" ADD COLUMN "${COMPANION_UPDATED_AT_COLUMN}" INTEGER`
      );
      expect(await readStamp(adapter, "p1", "fr")).toBeNull();

      // Now the reconcile runs again and introspects the column as PRESENT.
      const statements = buildCompanionReconcileStatements({
        slug: "posts",
        tableName: MAIN,
        oldLocalized: [{ name: "title", type: "text", localized: true }],
        newLocalized: [{ name: "title", type: "text", localized: true }],
        dialect: "sqlite",
        status: false,
        builtBy: "codeFirst",
        companionExists: true,
        companionHasUpdatedAt: true,
        versionScope: "collection",
      });
      // It must not try to ADD a column that is there, and it must still seed.
      expect(statements.some(st => st.includes("ADD COLUMN"))).toBe(false);
      for (const statement of statements) await adapter.executeQuery(statement);

      expect(await readStamp(adapter, "p1", "fr")).toBe(4000);
    });

    it("never moves a stamp a real write has already set", async () => {
      // What makes re-issuing safe in every state. `WHERE _updated_at IS NULL` is monotonic: the
      // statement can only fill an absent value, never move one. Without that, a routine sync
      // would drag a live translation's timestamp back to its version-history value and
      // resurrect a staleness warning the translator had already cleared.
      await createLegacyCompanion();
      await createVersions();
      await seedVersions([["v1", "posts", "collection", "p1", "fr", 1, 4000]]);
      await reconcile();

      await upsertCompanionRow(
        adapter,
        COMPANION,
        "p1",
        "fr",
        { title: "Bonjour!" },
        undefined,
        { now: new Date(6_000_000) }
      );
      expect(await readStamp(adapter, "p1", "fr")).toBe(6000);

      // A later sync re-issues the back-fill against a row that now has a value.
      await reconcile(true);
      expect(await readStamp(adapter, "p1", "fr")).toBe(6000);
    });

    it("ignores working drafts and autosaves, which never reached the companion", async () => {
      // 🔴 The write path gates its companion upsert on `!storeAsWorkingDraft`, so a held draft
      // leaves a version row behind and writes NOTHING to the companion. Counting those rows here
      // would seed the source from an edit the companion never received — and a target translated
      // before that draft would be reported stale by the migration while an identical draft made
      // AFTER the migration reports nothing. Same facts, different answer depending on when the
      // upgrade happened to run.
      await createLegacyCompanion();
      await createVersions();
      await seedVersions([
        ["v1", "posts", "collection", "p1", "fr", 1, 1000],
        // Newer, but not durable: a working draft and an autosave.
        ["v2", "posts", "collection", "p1", "fr", null, 9000],
        ["v3", "posts", "collection", "p1", "fr", null, 8000],
      ]);

      await reconcile();

      // 1000, not 9000. Both decoys are newer, so a missing `version_no IS NOT NULL` returns a
      // larger number rather than an error.
      expect(await readStamp(adapter, "p1", "fr")).toBe(1000);
    });

    it("emits no back-fill for an entity kind with no version history", async () => {
      const statements = buildCompanionReconcileStatements({
        slug: "seo",
        tableName: "comp_seo",
        oldLocalized: [{ name: "title", type: "text", localized: true }],
        newLocalized: [{ name: "title", type: "text", localized: true }],
        dialect: "sqlite",
        status: false,
        builtBy: "codeFirst",
        companionExists: true,
        companionHasUpdatedAt: false,
      });

      // The column is still added -- writes from now on are stamped. Only the history is
      // unavailable, and inventing one would be worse than leaving it unknown.
      expect(statements.some(s => s.includes("ADD COLUMN"))).toBe(true);
      expect(statements.some(s => s.includes(VERSIONS_TABLE))).toBe(false);
    });
  });
});
