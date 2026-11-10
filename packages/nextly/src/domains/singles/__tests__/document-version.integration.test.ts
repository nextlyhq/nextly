/**
 * A Single carries a version that every save changes and no read does,
 * returned with the document from every read and write.
 *
 * The same contract as a collection entry's, on the Single's own write paths:
 * the update, the held working draft, publish-all, and the read that creates
 * the default document. The oracle is the counter in the table, read raw.
 *
 * @module domains/singles/__tests__/document-version.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { statementsOf } from "../../../database/__tests__/integration/helpers/count-statements";
import { discardWorkingDraft } from "../../versions/discard-working-draft";
import type { SingleEntryService } from "../services/single-entry-service";

/** The statement that reads translation counters on their own. */
const COUNTER_READ =
  /select\s+[`"]?_parent[`"]?,\s*[`"]?_locale[`"]?,\s*[`"]?_revision[`"]?\s+from/i;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Draft/Published, held drafts, two languages. */
const PREFS = "prefs";
/** No lifecycle and no languages. */
const PLAIN = "plain";
/** Translated, but with no translated field, so with no translation table. */
const UNTRANSLATED = "untranslated_single";

const OPEN = {
  read: () => true,
  update: () => true,
  publish: () => true,
  unpublish: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: PREFS,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: OPEN,
        fields: [
          text({ name: "siteName", localized: true }),
          text({ name: "contact", localized: false }),
        ],
      }),
      defineSingle({
        slug: PLAIN,
        access: OPEN,
        fields: [text({ name: "notice" })],
      }),
      defineSingle({
        slug: UNTRANSLATED,
        localized: true,
        access: OPEN,
        fields: [text({ name: "code", localized: false })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite proves nothing.
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");

function revOf(result: unknown): string {
  const data = (result as { data?: Record<string, unknown> } | null)?.data;
  const rev = data?._rev;
  if (typeof rev !== "string") {
    throw new Error(`no _rev on ${JSON.stringify(result)}`);
  }
  return rev;
}

async function mainRow(
  t: TestNextly,
  slug: string
): Promise<Record<string, unknown>> {
  const rows = await t.adapter.select<Record<string, unknown>>(
    `single_${slug}`,
    {}
  );
  if (rows.length !== 1) throw new Error(`${rows.length} rows for ${slug}`);
  return rows[0];
}

/**
 * A translation row, read by a statement that names its columns: the
 * translation table's runtime model does not declare the per-document
 * columns, so the adapter's own select would not return them.
 */
async function languageRow(
  t: TestNextly,
  locale: string
): Promise<Record<string, unknown>> {
  const q = (name: string) =>
    t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const p = t.adapter.dialect === "postgresql" ? "$1" : "?";
  const [row] = await t.adapter.executeQuery<Record<string, unknown>>(
    `SELECT * FROM ${q(`single_${PREFS}_locales`)} WHERE ${q("_locale")} = ${p}`,
    [locale]
  );
  if (!row) throw new Error(`no ${locale} row`);
  return row;
}

const mainCounter = async (t: TestNextly, slug: string) =>
  Number((await mainRow(t, slug))._revision);

async function readRev(
  t: TestNextly,
  slug: string,
  locale?: string
): Promise<unknown> {
  const doc = (await t.nextly.findSingle({
    slug: slug as never,
    overrideAccess: true,
    status: "all",
    ...(locale ? { locale } : {}),
  } as never)) as Record<string, unknown> | null;
  return doc?._rev;
}

describe.each(getConfiguredTestDialects())(
  "the version of a Single (%s)",
  dialect => {
    it("a read that creates the Single returns version 1, and the next read the same", async () => {
      const t = await boot(dialect);
      // The default document is inserted, not saved through the update path:
      // an insert that went through it would read 2.
      expect(await readRev(t, PLAIN)).toBe("1");
      expect(await readRev(t, PLAIN)).toBe("1");
      expect(await mainCounter(t, PLAIN)).toBe(1);
    });

    it("the read that creates a translated Single takes its translation counters before its translated content", async () => {
      const t = await boot(dialect);
      const statements = await statementsOf(dialect, () =>
        t.nextly.findSingle({
          slug: PREFS as never,
          locale: "en",
          overrideAccess: true,
          status: "all",
        } as never)
      );
      const reads = statements
        .map((statement, at) => ({ statement, at }))
        .filter(
          ({ statement }) =>
            statement.includes(`single_${PREFS}_locales`) &&
            /^\s*select/i.test(statement)
        );
      // The counter read names only the keys and the counter; the joined
      // read made before the Single existed names it beside the content.
      const counters = reads.filter(({ statement }) =>
        COUNTER_READ.test(statement)
      );
      const content = reads.find(
        ({ statement }) =>
          !statement.includes("_revision") &&
          !/select\s+1\s+from/i.test(statement)
      );
      expect(counters).toHaveLength(1);
      expect(content).toBeDefined();
      expect(counters[0].at).toBeLessThan(content!.at);
    });

    it("a read that does not create writes nothing", async () => {
      const t = await boot(dialect);
      expect(
        await t.nextly.findSingle({ slug: PLAIN, createIfMissing: false })
      ).toBeNull();
      expect((await t.adapter.select(`single_${PLAIN}`, {})).length).toBe(0);
    });

    it("gives two saves within one second different versions, equal to the next read's", async () => {
      const t = await boot(dialect);
      await readRev(t, PLAIN);
      const first = revOf(
        await singlesOf(t).update(
          PLAIN,
          { notice: "a", _overwrite: true },
          { overrideAccess: true }
        )
      );
      const second = revOf(
        await singlesOf(t).update(
          PLAIN,
          { notice: "b", _rev: first },
          { overrideAccess: true }
        )
      );
      expect([first, second]).toEqual(["2", "3"]);
      expect(await readRev(t, PLAIN)).toBe("3");
      expect(await mainCounter(t, PLAIN)).toBe(3);
    });

    it("gives each of two concurrent saves its own version", async () => {
      const t = await boot(dialect);
      await readRev(t, PLAIN);
      const revs = await Promise.all([
        singlesOf(t)
          .update(
            PLAIN,
            { notice: "x", _overwrite: true },
            { overrideAccess: true }
          )
          .then(revOf),
        singlesOf(t)
          .update(
            PLAIN,
            { notice: "y", _overwrite: true },
            { overrideAccess: true }
          )
          .then(revOf),
      ]);
      expect([...revs].sort()).toEqual(["2", "3"]);
      expect(await mainCounter(t, PLAIN)).toBe(3);
    });

    it("changes only the saved language's version, and the all-languages one", async () => {
      const t = await boot(dialect);
      await singlesOf(t).update(
        PREFS,
        { siteName: "Site", contact: "c", _overwrite: true },
        { locale: "en", overrideAccess: true }
      );
      const english = await readRev(t, PREFS, "en");
      const main = await mainCounter(t, PREFS);
      const englishCounter = Number((await languageRow(t, "en"))._revision);
      expect(english).toBe(`${main}.en:${englishCounter}`);
      expect(await readRev(t, PREFS, "*")).toBe(
        `${main}.en:${englishCounter},es:0`
      );

      const spanish = await singlesOf(t).update(
        PREFS,
        { siteName: "Sitio", _overwrite: true },
        { locale: "es", overrideAccess: true }
      );
      expect(revOf(spanish)).toBe(`${main}.es:1`);
      expect(await readRev(t, PREFS, "en")).toBe(english);
      expect(await readRev(t, PREFS, "*")).toBe(
        `${main}.en:${englishCounter},es:1`
      );
    });

    it("changes the version on a held draft of a published Single, leaving updated_at alone", async () => {
      const t = await boot(dialect);
      await singlesOf(t).update(
        PREFS,
        {
          siteName: "Live",
          contact: "c",
          status: "published",
          _overwrite: true,
        },
        { locale: "en", overrideAccess: true }
      );
      const before = await mainRow(t, PREFS);

      const held = await singlesOf(t).update(
        PREFS,
        { contact: "held edit", _overwrite: true },
        { locale: "en", overrideAccess: true }
      );

      const after = await mainRow(t, PREFS);
      expect(Number(after._revision)).toBe(Number(before._revision) + 1);
      expect(after.contact).toBe("c");
      expect(String(after.updated_at)).toBe(String(before.updated_at));
      expect(revOf(held)).toBe(await readRev(t, PREFS, "en"));

      // Discarding it changes what a reader of the draft sees.
      await singlesOf(t).discardWorkingDraft({
        slug: PREFS,
        locale: "en",
        version: { _rev: revOf(held) },
      });
      expect(Number((await mainRow(t, PREFS))._revision)).toBe(
        Number(after._revision) + 1
      );
    });

    it("answers a discard with the version it produced, the one a read then gives", async () => {
      const t = await boot(dialect);
      await singlesOf(t).update(
        PREFS,
        {
          siteName: "Live",
          contact: "c",
          status: "published",
          _overwrite: true,
        },
        { locale: "en", overrideAccess: true }
      );
      const held = revOf(
        await singlesOf(t).update(
          PREFS,
          { contact: "held edit", _overwrite: true },
          { locale: "en", overrideAccess: true }
        )
      );
      // As the discard route makes it: the live document read first, then
      // the draft removed under the Single's lock.
      const { document, removed } = await discardWorkingDraft({
        scopeKind: "single",
        slug: PREFS,
        entryId: String((await mainRow(t, PREFS)).id),
        locale: "en",
        user: { id: "system-check", roles: ["super-admin"] } as never,
        version: { _rev: held },
      });
      expect(removed).toBe(1);
      const answered = (document as Record<string, unknown>)._rev;
      expect(answered).not.toBe(held);
      expect(answered).toBe(await readRev(t, PREFS, "en"));
    });

    it("gives a translated Single with no translation table a version that names no language", async () => {
      const t = await boot(dialect);
      expect(await readRev(t, UNTRANSLATED, "en")).toBe("1");
      const saved = await singlesOf(t).update(
        UNTRANSLATED,
        { code: "b", _overwrite: true },
        { locale: "en", overrideAccess: true }
      );
      expect(revOf(saved)).toBe("2");
      expect(await readRev(t, UNTRANSLATED, "*")).toBe("2");
    });

    it("keeps the version and the last changer out of every recorded version", async () => {
      const t = await boot(dialect);
      await singlesOf(t).update(
        PREFS,
        {
          siteName: "Site",
          contact: "c",
          status: "published",
          _overwrite: true,
        },
        {
          locale: "en",
          overrideAccess: true,
          actor: { type: "user", id: "writer" },
        }
      );
      await singlesOf(t).update(
        PREFS,
        { contact: "held", _overwrite: true },
        {
          locale: "en",
          overrideAccess: true,
          actor: { type: "user", id: "writer" },
        }
      );
      await singlesOf(t).publishAllLocales(PREFS, {
        overrideAccess: true,
        data: { _overwrite: true },
      });
      const rows = await t.adapter.select<{ snapshot?: unknown }>(
        "nextly_versions",
        {}
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const snapshot =
          typeof row.snapshot === "string"
            ? row.snapshot
            : JSON.stringify(row.snapshot);
        expect(snapshot).not.toContain("_changed_by");
        expect(snapshot).not.toContain("_changed_at");
        expect(snapshot).not.toContain("_revision");
        expect(snapshot).not.toContain('"_rev"');
      }
    });

    it("publish all changes the version and returns the all-languages form", async () => {
      const t = await boot(dialect);
      await singlesOf(t).update(
        PREFS,
        { siteName: "Site", contact: "c", _overwrite: true },
        { locale: "en", overrideAccess: true }
      );
      await singlesOf(t).update(
        PREFS,
        { siteName: "Sitio", _overwrite: true },
        { locale: "es", overrideAccess: true }
      );
      const before = await readRev(t, PREFS, "*");

      const published = await singlesOf(t).publishAllLocales(PREFS, {
        overrideAccess: true,
        data: { _rev: before },
      });

      const after = await readRev(t, PREFS, "*");
      expect(after).not.toBe(before);
      expect(revOf(published)).toBe(after);
    });

    it("a save that sends back `_rev` doesn't fail", async () => {
      const t = await boot(dialect);
      const read = (await t.nextly.findSingle({
        slug: PLAIN,
        overrideAccess: true,
      } as never)) as Record<string, unknown>;
      const saved = await singlesOf(t).update(
        PLAIN,
        { ...read, notice: "after" },
        { overrideAccess: true }
      );
      expect(saved).toMatchObject({ success: true });
      expect(revOf(saved)).toBe("2");
    });

    it("stores the counter's own value whatever version an update carries", async () => {
      const t = await boot(dialect);
      const read = (await t.nextly.findSingle({
        slug: PLAIN,
        overrideAccess: true,
      } as never)) as Record<string, unknown>;
      expect(read._rev).toBe("1");

      const resaved = await singlesOf(t).update(
        PLAIN,
        { ...read, notice: "a", _revision: 999 },
        { overrideAccess: true }
      );
      expect(revOf(resaved)).toBe("2");
      expect(await mainCounter(t, PLAIN)).toBe(2);

      await t.nextly.updateSingle({
        slug: PLAIN,
        data: { notice: "b", _rev: "2", _revision: 999 },
        overrideAccess: true,
      } as never);
      expect(await mainCounter(t, PLAIN)).toBe(3);
    });

    it("records who changed each row last, with ids only, and never publishes it", async () => {
      const t = await boot(dialect);
      await singlesOf(t).update(
        PREFS,
        { siteName: "Site", contact: "c", _overwrite: true },
        {
          locale: "en",
          overrideAccess: true,
          actor: { type: "user", id: "editor" },
        }
      );
      await singlesOf(t).update(
        PREFS,
        { siteName: "Sitio", _overwrite: true },
        {
          locale: "es",
          overrideAccess: true,
          actor: { type: "apiKey", id: "key-1" },
        }
      );

      const main = await mainRow(t, PREFS);
      expect([main._changed_by_kind, main._changed_by_id]).toEqual([
        "person",
        "editor",
      ]);
      const spanish = await languageRow(t, "es");
      expect([spanish._changed_by_kind, spanish._changed_by_id]).toEqual([
        "apiKey",
        "key-1",
      ]);

      const read = (await t.nextly.findSingle({
        slug: PREFS,
        overrideAccess: true,
        status: "all",
      } as never)) as Record<string, unknown>;
      expect(
        Object.keys(read).filter(
          key =>
            key.includes("changed_by") ||
            key.includes("changedBy") ||
            key.includes("changed_at") ||
            key.includes("changedAt")
        )
      ).toEqual([]);
      expect(read._revision).toBeUndefined();
    });
  }
);
