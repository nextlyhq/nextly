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
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Draft/Published, held drafts, two languages. */
const PREFS = "prefs";
/** No lifecycle and no languages. */
const PLAIN = "plain";

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
          { notice: "a" },
          { overrideAccess: true }
        )
      );
      const second = revOf(
        await singlesOf(t).update(
          PLAIN,
          { notice: "b" },
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
          .update(PLAIN, { notice: "x" }, { overrideAccess: true })
          .then(revOf),
        singlesOf(t)
          .update(PLAIN, { notice: "y" }, { overrideAccess: true })
          .then(revOf),
      ]);
      expect([...revs].sort()).toEqual(["2", "3"]);
      expect(await mainCounter(t, PLAIN)).toBe(3);
    });

    it("changes only the saved language's version, and the all-languages one", async () => {
      const t = await boot(dialect);
      await singlesOf(t).update(
        PREFS,
        { siteName: "Site", contact: "c" },
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
        { siteName: "Sitio" },
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
        { siteName: "Live", contact: "c", status: "published" },
        { locale: "en", overrideAccess: true }
      );
      const before = await mainRow(t, PREFS);

      const held = await singlesOf(t).update(
        PREFS,
        { contact: "held edit" },
        { locale: "en", overrideAccess: true }
      );

      const after = await mainRow(t, PREFS);
      expect(Number(after._revision)).toBe(Number(before._revision) + 1);
      expect(after.contact).toBe("c");
      expect(String(after.updated_at)).toBe(String(before.updated_at));
      expect(revOf(held)).toBe(await readRev(t, PREFS, "en"));
    });

    it("publish all changes the version and returns the all-languages form", async () => {
      const t = await boot(dialect);
      await singlesOf(t).update(
        PREFS,
        { siteName: "Site", contact: "c" },
        { locale: "en", overrideAccess: true }
      );
      await singlesOf(t).update(
        PREFS,
        { siteName: "Sitio" },
        { locale: "es", overrideAccess: true }
      );
      const before = await readRev(t, PREFS, "*");

      const published = await singlesOf(t).publishAllLocales(PREFS, {
        overrideAccess: true,
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
        { ...read, notice: "a", _rev: "999", _revision: 999 },
        { overrideAccess: true }
      );
      expect(revOf(resaved)).toBe("2");
      expect(await mainCounter(t, PLAIN)).toBe(2);

      await t.nextly.updateSingle({
        slug: PLAIN,
        data: { notice: "b", _rev: "999", _revision: 999 },
        overrideAccess: true,
      } as never);
      expect(await mainCounter(t, PLAIN)).toBe(3);
    });

    it("records who changed each row last, with ids only, and never publishes it", async () => {
      const t = await boot(dialect);
      await singlesOf(t).update(
        PREFS,
        { siteName: "Site", contact: "c" },
        {
          locale: "en",
          overrideAccess: true,
          actor: { type: "user", id: "editor" },
        }
      );
      await singlesOf(t).update(
        PREFS,
        { siteName: "Sitio" },
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
          key => key.includes("changed_by") || key.includes("changedBy")
        )
      ).toEqual([]);
      expect(read._revision).toBeUndefined();
    });
  }
);
