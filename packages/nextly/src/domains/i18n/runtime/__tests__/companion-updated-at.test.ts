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
import { companionWriteVia, upsertCompanionRow } from "../companion-io";

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

  /** Create the companion through the production reconcile path. */
  async function createCompanion(): Promise<void> {
    for (const statement of buildCompanionReconcileStatements({
      slug: "posts",
      tableName: MAIN,
      oldLocalized: [],
      newLocalized: [{ name: "title", type: "text", localized: true }],
      dialect: "sqlite",
      status: false,
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
      { stampUpdatedAt: false }
    );

    // 🔴 NULL, never a default. This is the assertion the whole design turns on: a seeded
    // `CURRENT_TIMESTAMP` would give every pre-existing row the same value, source and target
    // would compare EQUAL, and every stale translation on the site would read as fresh on the
    // first run after the migration.
    expect(await readStamp(adapter, "p1", "es")).toBeNull();
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
      await adapter.executeQuery(
        `CREATE TABLE "${VERSIONS_TABLE}" (` +
          `"id" TEXT PRIMARY KEY, "scope_kind" TEXT NOT NULL, "scope_slug" TEXT NOT NULL, ` +
          `"entry_id" TEXT NOT NULL, "locale" TEXT, "created_at" INTEGER NOT NULL)`
      );
    }

    /** Run ADD COLUMN + back-fill exactly as the reconcile emits them. */
    async function reconcile(): Promise<void> {
      for (const statement of buildCompanionReconcileStatements({
        slug: "posts",
        tableName: MAIN,
        oldLocalized: [{ name: "title", type: "text", localized: true }],
        newLocalized: [{ name: "title", type: "text", localized: true }],
        dialect: "sqlite",
        status: false,
        builtBy: "codeFirst",
        companionExists: true,
        companionHasUpdatedAt: false,
        versionScope: "collection",
      })) {
        await adapter.executeQuery(statement);
      }
    }

    it("seeds each locale from ITS OWN version history, not one value for all", async () => {
      await createLegacyCompanion();
      await createVersions();
      await adapter.executeQuery(
        `INSERT INTO "${VERSIONS_TABLE}" ` +
          `("id", "scope_kind", "scope_slug", "entry_id", "locale", "created_at") VALUES ` +
          `('v1', 'collection', 'posts', 'p1', 'fr', 1000), ` +
          `('v2', 'collection', 'posts', 'p1', 'fr', 3000), ` +
          `('v3', 'collection', 'posts', 'p1', 'de', 2000)`
      );

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
      await adapter.executeQuery(
        `INSERT INTO "${VERSIONS_TABLE}" ` +
          `("id", "scope_kind", "scope_slug", "entry_id", "locale", "created_at") VALUES ` +
          `('v1', 'collection', 'posts', 'p1', 'fr', 5000), ` +
          `('v2', 'collection', 'posts', 'p1', 'fr', 1000)`
      );

      await reconcile();

      // "When was this locale last written" is a MAX. Anything else understates the target's
      // timestamp, which makes the source look newer than it is -- reporting a current
      // translation as needing review.
      expect(await readStamp(adapter, "p1", "fr")).toBe(5000);
    });

    it("does not read another collection's or another entry's history", async () => {
      await createLegacyCompanion();
      await createVersions();
      await adapter.executeQuery(
        `INSERT INTO "${VERSIONS_TABLE}" ` +
          `("id", "scope_kind", "scope_slug", "entry_id", "locale", "created_at") VALUES ` +
          `('v1', 'collection', 'posts',  'p1', 'fr', 4000), ` +
          `('v2', 'collection', 'authors','p1', 'fr', 9000), ` +
          `('v3', 'single',     'posts',  'p1', 'fr', 8000), ` +
          `('v4', 'collection', 'posts',  'p2', 'fr', 7000)`
      );

      await reconcile();

      // Every decoy is NEWER than the real row, so a join missing any one of the three predicates
      // produces a larger number rather than an error. A correct back-fill is the only one that
      // returns 4000.
      expect(await readStamp(adapter, "p1", "fr")).toBe(4000);
    });

    it("is idempotent, so a half-applied reconcile finishes on the next run", async () => {
      await createLegacyCompanion();
      await createVersions();
      await adapter.executeQuery(
        `INSERT INTO "${VERSIONS_TABLE}" ` +
          `("id", "scope_kind", "scope_slug", "entry_id", "locale", "created_at") VALUES ` +
          `('v1', 'collection', 'posts', 'p1', 'fr', 4000)`
      );

      await reconcile();
      // A real write lands after the migration and must survive the next reconcile.
      await upsertCompanionRow(
        adapter,
        COMPANION,
        "p1",
        "fr",
        { title: "Bonjour!" },
        undefined,
        { now: new Date(6_000_000) }
      );

      // 🔴 The back-fill alone, replayed. This is what makes the pair safe to run unattended --
      // and `WHERE _updated_at IS NULL` is what makes it so. Without that guard a replay would
      // overwrite the live stamp with the version-history value, silently moving a translation
      // backwards in time and resurrecting a staleness warning that was already cleared.
      for (const statement of buildCompanionReconcileStatements({
        slug: "posts",
        tableName: MAIN,
        oldLocalized: [{ name: "title", type: "text", localized: true }],
        newLocalized: [{ name: "title", type: "text", localized: true }],
        dialect: "sqlite",
        status: false,
        builtBy: "codeFirst",
        companionExists: true,
        companionHasUpdatedAt: false,
        versionScope: "collection",
      }).filter(s => !s.includes("ADD COLUMN"))) {
        await adapter.executeQuery(statement);
      }

      expect(await readStamp(adapter, "p1", "fr")).toBe(6000);
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
