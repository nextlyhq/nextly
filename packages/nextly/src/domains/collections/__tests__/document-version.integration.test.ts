/**
 * Every collection entry carries a version that every save changes and no
 * read does, returned with the entry from every read and write.
 *
 * The version is a stored counter, not a time: two saves within the same
 * second must still differ, and a save of one language must not change what a
 * reader of another language holds. The oracle throughout is the counter in
 * the table itself, read raw, against the `_rev` the service returned.
 *
 * @module domains/collections/__tests__/document-version.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { statementsOf } from "../../../database/__tests__/integration/helpers/count-statements";
import { discardWorkingDraft } from "../../versions/discard-working-draft";
import type { CollectionService } from "../services/collection-service";

/** The statement that reads translation counters on their own. */
const COUNTER_READ =
  /select\s+[`"]?_parent[`"]?,\s*[`"]?_locale[`"]?,\s*[`"]?_revision[`"]?\s+from/i;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Draft/Published, held drafts, two languages. */
const DOCS = "docs";
/** No lifecycle and no languages: the plainest entry there is. */
const NOTES = "notes";
/**
 * Translated, but with no translated field, so it has no translation table:
 * its values live on its own row, and its version names no language.
 */
const UNTRANSLATED = "untranslated";

const OPEN = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
  publish: () => true,
  unpublish: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({ slug: "note_box", fields: [text({ name: "label" })] }),
    ],
    collections: [
      defineCollection({
        slug: DOCS,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: OPEN,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "note", localized: false }),
        ],
      }),
      defineCollection({
        slug: UNTRANSLATED,
        localized: true,
        access: OPEN,
        fields: [text({ name: "code", localized: false })],
      }),
      defineCollection({
        slug: NOTES,
        access: OPEN,
        fields: [
          // A component alone can change: its values live in a table of
          // their own, and the main counter covers them.
          fieldGroup({ name: "box", component: "note_box" }),
          text({ name: "title" }),
          // Unique, so a save can be refused by the database itself, inside
          // the write's own transaction.
          text({ name: "code", unique: true }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // The leg must run the dialect it is named for: a PostgreSQL or MySQL leg
  // that silently booted SQLite would prove nothing about those databases.
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

const serviceOf = (t: TestNextly): CollectionService =>
  t.getService("collectionService") as unknown as CollectionService;

/** The `_rev` a service result carries, refusing a result without one. */
function revOf(result: unknown): string {
  const data = (result as { data?: Record<string, unknown> } | null)?.data;
  const rev = data?._rev;
  if (typeof rev !== "string") {
    throw new Error(`no _rev on ${JSON.stringify(result)}`);
  }
  return rev;
}

function idOf(result: unknown): string {
  const id = (result as { data?: { id?: unknown } }).data?.id;
  if (typeof id !== "string") throw new Error("no id");
  return id;
}

/** The stored row, read raw: the counter and who last changed it. */
async function rowOf(
  t: TestNextly,
  table: string,
  where: Record<string, string>
): Promise<Record<string, unknown>> {
  const row = await t.adapter.selectOne<Record<string, unknown>>(table, {
    where: {
      and: Object.entries(where).map(([column, value]) => ({
        column,
        op: "=" as const,
        value,
      })),
    },
  });
  if (!row) throw new Error(`no row in ${table} for ${JSON.stringify(where)}`);
  return row;
}

const mainCounter = async (t: TestNextly, slug: string, id: string) =>
  Number((await rowOf(t, `dc_${slug}`, { id }))._revision);

/**
 * A translation row, read by a statement that names its columns: the
 * translation table's runtime model does not declare the per-document
 * columns, so the adapter's own select would not return them.
 */
async function languageRow(
  t: TestNextly,
  id: string,
  locale: string
): Promise<Record<string, unknown>> {
  const q = (name: string) =>
    t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const p = (n: number) => (t.adapter.dialect === "postgresql" ? `$${n}` : "?");
  const [row] = await t.adapter.executeQuery<Record<string, unknown>>(
    `SELECT * FROM ${q(`dc_${DOCS}_locales`)} WHERE ${q("_parent")} = ${p(1)} AND ${q("_locale")} = ${p(2)}`,
    [id, locale]
  );
  if (!row) throw new Error(`no ${locale} row for ${id}`);
  return row;
}

const languageCounter = async (t: TestNextly, id: string, locale: string) =>
  Number((await languageRow(t, id, locale))._revision);

/** Every version snapshot recorded, as stored. */
async function recordedSnapshots(t: TestNextly): Promise<string[]> {
  const rows = await t.adapter.select<{ snapshot?: unknown }>(
    "nextly_versions",
    {}
  );
  return rows.map(row =>
    typeof row.snapshot === "string"
      ? row.snapshot
      : JSON.stringify(row.snapshot)
  );
}

/**
 * One read of `table`'s translation counters, sent before any read of its
 * translated content. An early read whose counters went unused would leave a
 * later one, and a counter read after the content could be newer than it.
 */
function expectCountersBeforeContent(
  statements: string[],
  table: string
): void {
  const reads = statements
    .map((statement, at) => ({ statement, at }))
    .filter(
      ({ statement }) =>
        statement.includes(table) && /^\s*select/i.test(statement)
    );
  // The counter read names only the keys and the counter; a joined read
  // names it beside the content columns.
  const counters = reads.filter(({ statement }) =>
    COUNTER_READ.test(statement)
  );
  const content = reads.find(
    ({ statement }) =>
      !statement.includes("_revision") && !/select\s+1\s+from/i.test(statement)
  );
  expect(counters).toHaveLength(1);
  expect(content).toBeDefined();
  expect(counters[0].at).toBeLessThan(content!.at);
}

/**
 * One read of `table`, taking each translation's counter in the same
 * statement as its translated content. One statement sees one snapshot, so
 * no counter it returns can be newer than the content beside it. A counter
 * read of its own, or a content read without the counter, fails this.
 */
function expectCountersWithContent(statements: string[], table: string): void {
  const reads = statements.filter(
    statement =>
      statement.includes(table) &&
      /^\s*select/i.test(statement) &&
      !/select\s+1\s+from/i.test(statement)
  );
  expect(reads.filter(statement => COUNTER_READ.test(statement))).toEqual([]);
  expect(reads).toHaveLength(1);
  expect(reads[0]).toContain("_revision");
}

/** A stored time as milliseconds, whatever the driver hands back. */
function timeOf(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value * 1000;
  if (typeof value === "string") return new Date(value).getTime();
  throw new Error(`no time in ${String(value)}`);
}

async function readRev(
  t: TestNextly,
  slug: string,
  id: string,
  locale?: string
): Promise<unknown> {
  const doc = (await t.nextly.findByID({
    collection: slug as never,
    id,
    overrideAccess: true,
    status: "all",
    ...(locale ? { locale } : {}),
  } as never)) as Record<string, unknown> | null;
  return doc?._rev;
}

async function createNote(t: TestNextly, data: Record<string, unknown>) {
  return handlerOf(t).createEntry(
    { collectionName: NOTES, overrideAccess: true },
    data
  );
}

async function updateNote(
  t: TestNextly,
  id: string,
  data: Record<string, unknown>
) {
  return handlerOf(t).updateEntry(
    { collectionName: NOTES, entryId: id, overrideAccess: true },
    data
  );
}

describe.each(getConfiguredTestDialects())(
  "the version of a collection entry (%s)",
  dialect => {
    it("starts at 1 and names each language a create writes", async () => {
      const t = await boot(dialect);
      expect(revOf(await createNote(t, { title: "a", code: "a" }))).toBe("1");

      const created = await handlerOf(t).createEntry(
        { collectionName: DOCS, overrideAccess: true, locale: "en" },
        { title: "hello", note: "n" }
      );
      expect(revOf(created)).toBe("1.en:1");
      expect(await mainCounter(t, DOCS, idOf(created))).toBe(1);
    });

    it("gives two saves within one second different versions", async () => {
      const t = await boot(dialect);
      const id = idOf(await createNote(t, { title: "a", code: "a" }));

      // Back to back, well inside one second: a version derived from
      // `updated_at` gives SQLite's whole seconds the same value twice.
      const first = revOf(
        await updateNote(t, id, { title: "b", _overwrite: true })
      );
      const second = revOf(
        await updateNote(t, id, { title: "c", _rev: first })
      );

      expect([first, second]).toEqual(["2", "3"]);
      expect(await mainCounter(t, NOTES, id)).toBe(3);
      // What a save returns is what the next read returns: neither a value
      // read before the save's own increment, nor one a later write produced.
      expect(await readRev(t, NOTES, id)).toBe(second);
    });

    it("changes the version on a save that changes no value", async () => {
      // No dirty check exists, so an unchanged save is still a save; a
      // client holding the earlier version holds a stale one.
      const t = await boot(dialect);
      const id = idOf(await createNote(t, { title: "a", code: "a" }));
      expect(
        revOf(await updateNote(t, id, { title: "a", _overwrite: true }))
      ).toBe("2");
    });

    it("leaves the version unchanged across reads, single and list", async () => {
      const t = await boot(dialect);
      const id = idOf(await createNote(t, { title: "a", code: "a" }));
      await updateNote(t, id, { title: "b", _overwrite: true });

      expect(await readRev(t, NOTES, id)).toBe("2");
      expect(await readRev(t, NOTES, id)).toBe("2");
      const list = (await t.nextly.find({
        collection: NOTES as never,
        overrideAccess: true,
      } as never)) as { items: Record<string, unknown>[] };
      expect(list.items.map(item => item._rev)).toEqual(["2"]);
      expect(await mainCounter(t, NOTES, id)).toBe(2);
    });

    it("gives each of two concurrent saves its own version", async () => {
      const t = await boot(dialect);
      const id = idOf(await createNote(t, { title: "a", code: "a" }));

      // A counter computed from a read made outside the row lock gives both
      // saves the same next value; the database must serialise them.
      const revs = await Promise.all([
        updateNote(t, id, { title: "x", _overwrite: true }).then(revOf),
        updateNote(t, id, { title: "y", _overwrite: true }).then(revOf),
      ]);

      expect([...revs].sort()).toEqual(["2", "3"]);
      expect(await mainCounter(t, NOTES, id)).toBe(3);
    });

    it("leaves the version as it was when the database refuses the save", async () => {
      const t = await boot(dialect);
      await createNote(t, { title: "a", code: "taken" });
      const id = idOf(await createNote(t, { title: "b", code: "free" }));

      // Refused by the database's unique index, inside the update statement.
      expect(
        await updateNote(t, id, { code: "taken", _overwrite: true })
      ).toMatchObject({
        success: false,
        statusCode: 409,
      });

      // The increment belongs to the refused statement's transaction, so it
      // is undone with it: a counter moved by a failed save would make a
      // client's correct version look stale.
      expect(await mainCounter(t, NOTES, id)).toBe(1);
      expect(await readRev(t, NOTES, id)).toBe("1");
    });

    it("changes only the saved language's version, and the all-languages one", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          { collectionName: DOCS, overrideAccess: true, locale: "en" },
          { title: "hello", note: "n" }
        )
      );
      const englishBefore = await readRev(t, DOCS, id, "en");
      const everyBefore = await readRev(t, DOCS, id, "*");
      expect(englishBefore).toBe("1.en:1");
      // A language with no translation yet counts as 0, so adding one
      // changes the all-languages version.
      expect(everyBefore).toBe("1.en:1,es:0");

      const spanish = await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "es",
        },
        { title: "hola", _overwrite: true }
      );

      // Only the translated field changed, so only the Spanish row's counter
      // moves: one counter per document would make every English reader
      // stale on a Spanish save.
      expect(revOf(spanish)).toBe("1.es:1");
      expect(await readRev(t, DOCS, id, "en")).toBe(englishBefore);
      expect(await readRev(t, DOCS, id, "*")).toBe("1.en:1,es:1");

      await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "es",
        },
        { title: "hola otra vez", _overwrite: true }
      );
      expect(await languageCounter(t, id, "es")).toBe(2);
      expect(await languageCounter(t, id, "en")).toBe(1);
      expect(await mainCounter(t, DOCS, id)).toBe(1);
    });

    it("changes the main version when a shared field changes", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          { collectionName: DOCS, overrideAccess: true, locale: "en" },
          { title: "hello", note: "n" }
        )
      );
      const saved = await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { note: "shared edit", _overwrite: true }
      );
      expect(revOf(saved)).toBe("2.en:1");
      expect(await mainCounter(t, DOCS, id)).toBe(2);
    });

    it("changes the version on a held draft of a published entry, leaving updated_at alone", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          { collectionName: DOCS, overrideAccess: true, locale: "en" },
          { title: "live", note: "n", status: "published" }
        )
      );
      const before = await rowOf(t, `dc_${DOCS}`, { id });

      // No status: a published entry holds this edit as a working draft and
      // writes nothing to its own row but the counter. The edit is a change
      // a second editor must not overwrite unseen.
      const held = await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { note: "held edit", _overwrite: true }
      );

      const after = await rowOf(t, `dc_${DOCS}`, { id });
      expect(Number(after._revision)).toBe(Number(before._revision) + 1);
      expect(after.note).toBe("n");
      expect(String(after.updated_at)).toBe(String(before.updated_at));
      // The version shown with the held draft is the live row's, never one
      // copied from the draft's snapshot.
      expect(revOf(held)).toBe(`${String(after._revision)}.en:1`);
      expect(await readRev(t, DOCS, id, "en")).toBe(revOf(held));
      // The read an editor makes of the held draft, which overlays it on the
      // live row, carries the same version.
      const draftRead = (await t.nextly.findByID({
        collection: DOCS as never,
        id,
        locale: "en",
        draft: true,
        overrideAccess: true,
      } as never)) as Record<string, unknown>;
      expect(draftRead.note).toBe("held edit");
      expect(draftRead._rev).toBe(revOf(held));

      // Discarding the held draft changes what that read shows, so the
      // version changes with it.
      await handlerOf(t)
        .getEntryService()
        .discardWorkingDraft({
          collectionName: DOCS,
          entryId: id,
          locale: "en",
          version: { _rev: draftRead._rev },
        });
      expect(await mainCounter(t, DOCS, id)).toBe(Number(after._revision) + 1);
    });

    it("gives a translated collection with no translation table a version that names no language", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: UNTRANSLATED, overrideAccess: true, locale: "en" },
        { code: "a" }
      );
      expect(revOf(created)).toBe("1");
      const id = idOf(created);
      const saved = await handlerOf(t).updateEntry(
        {
          collectionName: UNTRANSLATED,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { code: "b", _overwrite: true }
      );
      expect(revOf(saved)).toBe("2");
      expect(await readRev(t, UNTRANSLATED, id, "en")).toBe("2");
      expect(await readRev(t, UNTRANSLATED, id, "*")).toBe("2");
    });

    it("a one-language list read takes the translation counters with the translated content", async () => {
      // Read after the content in a statement of its own, a counter could be
      // newer than what the read shows, and a client saving from it would
      // overwrite a translation it never saw. A one-language read's chain
      // holds every language its version names, so the counters come in the
      // content's own statement, where nothing can land between the two.
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          { collectionName: DOCS, overrideAccess: true, locale: "en" },
          { title: "hello", note: "n" }
        )
      );
      const statements = await statementsOf(dialect, () =>
        t.nextly.find({
          collection: DOCS as never,
          locale: "en",
          overrideAccess: true,
          status: "all",
        } as never)
      );
      expectCountersWithContent(statements, `dc_${DOCS}_locales`);
      expect(await readRev(t, DOCS, id, "en")).toBe("1.en:1");
    });

    it("a list read of every language takes the translation counters before the translated content", async () => {
      // Its version names every language, which one fallback chain does not
      // hold, so the counters are read apart from the content, and first:
      // a save landing between the two can only make the version look older
      // than the content.
      const t = await boot(dialect);
      await handlerOf(t).createEntry(
        { collectionName: DOCS, overrideAccess: true, locale: "en" },
        { title: "hello", note: "n" }
      );
      const statements = await statementsOf(dialect, () =>
        t.nextly.find({
          collection: DOCS as never,
          locale: "*",
          overrideAccess: true,
          status: "all",
        } as never)
      );
      expectCountersBeforeContent(statements, `dc_${DOCS}_locales`);
    });

    it("a read of every language takes the translation counters before the translated content", async () => {
      // Not joined with the entry, as a one-language read is: the counters
      // are read apart from the content, and first.
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          { collectionName: DOCS, overrideAccess: true, locale: "en" },
          { title: "hello", note: "n" }
        )
      );
      const statements = await statementsOf(dialect, () =>
        t.nextly.findByID({
          collection: DOCS as never,
          id,
          locale: "*",
          overrideAccess: true,
          status: "all",
        } as never)
      );
      expectCountersBeforeContent(statements, `dc_${DOCS}_locales`);
    });

    it("sets when it changed, equal to the write time a save writes to updated_at", async () => {
      const t = await boot(dialect);
      const id = idOf(await createNote(t, { title: "a", code: "a" }));
      const created = await rowOf(t, `dc_${NOTES}`, { id });
      // Stored by the same column type and clock as updated_at, so the two
      // compare as one kind of moment on every dialect.
      expect(timeOf(created._changed_at)).toBe(timeOf(created.updated_at));

      // Whole seconds on SQLite: wait into the next one, so a save that left
      // the time where the create put it is told from one that set it.
      await new Promise(resolve => setTimeout(resolve, 1_100));
      await updateNote(t, id, { title: "b", _overwrite: true });
      const saved = await rowOf(t, `dc_${NOTES}`, { id });
      expect(timeOf(saved._changed_at)).toBeGreaterThan(
        timeOf(created._changed_at)
      );
      expect(timeOf(saved._changed_at)).toBe(timeOf(saved.updated_at));
    });

    it("sets when it changed on a held draft, which leaves updated_at alone", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          { collectionName: DOCS, overrideAccess: true, locale: "en" },
          { title: "live", note: "n", status: "published" }
        )
      );
      const before = await rowOf(t, `dc_${DOCS}`, { id });
      // Whole seconds on SQLite: wait into the next one, so a time that moved
      // is told from one that did not.
      await new Promise(resolve => setTimeout(resolve, 1_100));
      await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { note: "held edit", _overwrite: true }
      );
      const after = await rowOf(t, `dc_${DOCS}`, { id });
      expect(timeOf(after.updated_at)).toBe(timeOf(before.updated_at));
      expect(timeOf(after._changed_at)).toBeGreaterThan(
        timeOf(before._changed_at)
      );
    });

    it("sets when it changed on a save of a component alone", async () => {
      const t = await boot(dialect);
      const id = idOf(await createNote(t, { title: "a", code: "a" }));
      const before = await rowOf(t, `dc_${NOTES}`, { id });
      await new Promise(resolve => setTimeout(resolve, 1_100));
      await updateNote(t, id, {
        box: { label: "only the component" },
        _overwrite: true,
      });
      const after = await rowOf(t, `dc_${NOTES}`, { id });
      expect(Number(after._revision)).toBe(Number(before._revision) + 1);
      expect(timeOf(after._changed_at)).toBeGreaterThan(
        timeOf(before._changed_at)
      );
    });

    it("stores when a translation row changed as its document's row stores it", async () => {
      // A clock away from UTC, where a time stored with the process's offset
      // rather than as the column stores it lands hours from the other.
      vi.stubEnv("TZ", "Asia/Karachi");
      try {
        const t = await boot(dialect);
        const id = idOf(
          await handlerOf(t).createEntry(
            { collectionName: DOCS, overrideAccess: true, locale: "en" },
            { title: "live", note: "n", status: "published" }
          )
        );
        const q = (name: string) =>
          t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
        const p = t.adapter.dialect === "postgresql" ? "$1" : "?";
        // Both read raw, by one kind of statement, so each comes back exactly
        // as its column stores it.
        const [main] = await t.adapter.executeQuery<Record<string, unknown>>(
          `SELECT ${q("_changed_at")} FROM ${q(`dc_${DOCS}`)} WHERE ${q("id")} = ${p}`,
          [id]
        );
        const language = await languageRow(t, id, "en");
        expect(typeof language._changed_at).toBe(typeof main?._changed_at);
        // One create writes both, within the second SQLite keeps.
        expect(
          Math.abs(timeOf(language._changed_at) - timeOf(main?._changed_at))
        ).toBeLessThanOrEqual(1_000);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("a discard of the held draft changes the version a read gives", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          { collectionName: DOCS, overrideAccess: true, locale: "en" },
          { title: "live", note: "n", status: "published" }
        )
      );
      await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { note: "held edit", _overwrite: true }
      );
      const held = await readRev(t, DOCS, id, "en");
      await handlerOf(t)
        .getEntryService()
        .discardWorkingDraft({
          collectionName: DOCS,
          entryId: id,
          locale: "en",
          version: { _rev: held },
        });
      expect(await readRev(t, DOCS, id, "en")).not.toBe(held);
    });

    it("a discard answers with the version it produced, the one a read then gives", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          { collectionName: DOCS, overrideAccess: true, locale: "en" },
          { title: "live", note: "n", status: "published" }
        )
      );
      await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { note: "held edit", _overwrite: true }
      );
      const held = await readRev(t, DOCS, id, "en");
      // As the discard route makes it: the live document read first, then
      // the draft removed under the document's lock.
      const { document, removed } = await discardWorkingDraft({
        scopeKind: "collection",
        slug: DOCS,
        entryId: id,
        locale: "en",
        user: { id: "system-check", roles: ["super-admin"] } as never,
        version: { _rev: held },
      });
      expect(removed).toBe(1);
      const answered = (document as Record<string, unknown>)._rev;
      expect(answered).not.toBe(held);
      expect(answered).toBe(await readRev(t, DOCS, id, "en"));
    });

    it("a wildcard save answers with every language's version", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          { collectionName: DOCS, overrideAccess: true, locale: "en" },
          { title: "hello", note: "n" }
        )
      );
      const swept = await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "*",
        },
        { status: "published", _overwrite: true }
      );
      expect(revOf(swept)).toBe(await readRev(t, DOCS, id, "*"));
    });

    it("keeps the version and the last changer out of every recorded version", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          {
            collectionName: DOCS,
            overrideAccess: true,
            locale: "en",
            actor: { type: "user", id: "writer" },
          },
          { title: "hello", note: "n", status: "published" }
        )
      );
      await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "en",
          actor: { type: "user", id: "writer" },
        },
        { note: "held", _overwrite: true }
      );
      await handlerOf(t).publishAllLocales({
        collectionName: DOCS,
        entryId: id,
        overrideAccess: true,
        data: { _overwrite: true },
      });
      const snapshots = await recordedSnapshots(t);
      expect(snapshots.length).toBeGreaterThan(0);
      for (const snapshot of snapshots) {
        expect(snapshot).not.toContain("_changed_by");
        expect(snapshot).not.toContain("_changed_at");
        expect(snapshot).not.toContain("_revision");
        expect(snapshot).not.toContain('"_rev"');
      }
    });

    it("publish all and unpublish all change every language's version and return the all-languages form", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          { collectionName: DOCS, overrideAccess: true, locale: "en" },
          { title: "hello", note: "n" }
        )
      );
      await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "es",
        },
        { title: "hola", _overwrite: true }
      );

      const published = await handlerOf(t).publishAllLocales({
        collectionName: DOCS,
        entryId: id,
        overrideAccess: true,
        data: { _overwrite: true },
      });
      const afterPublish = await readRev(t, DOCS, id, "*");
      expect(afterPublish).toBe(
        `${await mainCounter(t, DOCS, id)}.en:${await languageCounter(t, id, "en")},es:${await languageCounter(t, id, "es")}`
      );
      expect(afterPublish).not.toBe("1.en:1,es:1");
      // The response's version is the one after the bumps, not before them.
      expect(revOf(published)).toBe(afterPublish);
      // Changed at the moment the publish wrote to updated_at.
      const publishedRow = await rowOf(t, `dc_${DOCS}`, { id });
      expect(timeOf(publishedRow._changed_at)).toBe(
        timeOf(publishedRow.updated_at)
      );

      const unpublished = await handlerOf(t).unpublishAllLocales({
        collectionName: DOCS,
        entryId: id,
        overrideAccess: true,
        data: { _rev: afterPublish },
      });
      const afterUnpublish = await readRev(t, DOCS, id, "*");
      expect(afterUnpublish).not.toBe(afterPublish);
      expect(revOf(unpublished)).toBe(afterUnpublish);
    });

    it("stores the counter's own value whatever version a create or update carries", async () => {
      const t = await boot(dialect);
      // A create is not judged: a `_rev` it carries is dropped, and never
      // reaches the column.
      const created = await createNote(t, {
        title: "a",
        code: "a",
        _rev: "999",
        _revision: 999,
      });
      const id = idOf(created);
      expect(revOf(created)).toBe("1");
      expect(await mainCounter(t, NOTES, id)).toBe(1);

      const read = (await t.nextly.findByID({
        collection: NOTES as never,
        id,
        overrideAccess: true,
      } as never)) as Record<string, unknown>;
      // A client saving back what it read sends that read's own version.
      const resaved = await updateNote(t, id, { ...read, _revision: 999 });
      expect(revOf(resaved)).toBe("2");

      await updateNote(t, id, { title: "b", _revision: 999, _overwrite: true });
      expect(await mainCounter(t, NOTES, id)).toBe(3);

      // An update of several documents with one set of values names no one
      // document's version, so one carrying `_rev` is refused whole.
      await expect(
        handlerOf(t).bulkUpdateEntries({
          collectionName: NOTES,
          ids: [id],
          data: { title: "c", _rev: "3" },
          overrideAccess: true,
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(
        handlerOf(t).bulkUpdateByQuery({
          collectionName: NOTES,
          where: { id: { equals: id } },
          data: { title: "c", _rev: "3" },
          overrideAccess: true,
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await mainCounter(t, NOTES, id)).toBe(3);

      await handlerOf(t).bulkUpdateEntries({
        collectionName: NOTES,
        ids: [id],
        data: { title: "c", _revision: 999 },
        revs: { [id]: "3" },
        overrideAccess: true,
      });
      expect(await mainCounter(t, NOTES, id)).toBe(4);

      await handlerOf(t).bulkUpdateByQuery({
        collectionName: NOTES,
        where: { id: { equals: id } },
        data: { title: "d", _revision: 999, _overwrite: true },
        overrideAccess: true,
      });
      expect(await mainCounter(t, NOTES, id)).toBe(5);

      // Each entry of `updateMany` carries its own version, judged on its own.
      const stale = await serviceOf(t).updateMany(
        NOTES,
        [{ id, data: { title: "e", _rev: "999", _revision: 999 } }],
        { overrideAccess: true } as never
      );
      expect(stale.errors.map(e => e.code)).toEqual(["STALE_VERSION"]);
      await serviceOf(t).updateMany(
        NOTES,
        [{ id, data: { title: "e", _rev: "5", _revision: 999 } }],
        { overrideAccess: true } as never
      );
      expect(await mainCounter(t, NOTES, id)).toBe(6);

      // Nor may a client name the last changer.
      await updateNote(t, id, {
        title: "f",
        _changed_by_kind: "person",
        _changed_by_id: "forged",
        _overwrite: true,
      });
      const row = await rowOf(t, `dc_${NOTES}`, { id });
      expect(row._changed_by_id).not.toBe("forged");
    });

    it("a save that sends back `_rev` doesn't fail", async () => {
      // A client that saves the document it read sends its version with it.
      // Before the version existed, any key the server did not know reached
      // the database as a column and the save failed outright.
      const t = await boot(dialect);
      const id = idOf(await createNote(t, { title: "a", code: "a" }));
      const read = (await t.nextly.findByID({
        collection: NOTES as never,
        id,
        overrideAccess: true,
      } as never)) as Record<string, unknown>;
      expect(read._rev).toBe("1");

      const saved = await updateNote(t, id, { ...read, title: "b" });
      expect(saved).toMatchObject({ success: true });
      expect(revOf(saved)).toBe("2");
      const created = await createNote(t, { title: "c", code: "c", _rev: "1" });
      expect(created).toMatchObject({ success: true });
    });

    it("a bulk update and an update inside the caller's transaction of a published translated entry return the next read's version", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          { collectionName: DOCS, overrideAccess: true, locale: "en" },
          { title: "live", note: "n", status: "published" }
        )
      );

      // Inside the caller's own transaction: a status-less edit of a
      // published entry is held, writing no translation row, and still names
      // the language a read does.
      const inTransaction = await t.adapter.transaction(tx =>
        serviceOf(t).updateEntryInTransaction(
          tx,
          DOCS,
          id,
          { note: "held in a transaction", _overwrite: true },
          { overrideAccess: true } as never
        )
      );
      expect(inTransaction._rev).toBe(await readRev(t, DOCS, id, "en"));

      const bulk = (await handlerOf(t).bulkUpdateEntries({
        collectionName: DOCS,
        ids: [id],
        data: { note: "held in bulk" },
        revs: { [id]: await readRev(t, DOCS, id, "en") },
        overrideAccess: true,
      })) as unknown as {
        data?: { successes?: Record<string, unknown>[] };
        successes?: Record<string, unknown>[];
      };
      const [saved] = bulk.data?.successes ?? bulk.successes ?? [];
      expect(saved?._rev).toBe(await readRev(t, DOCS, id, "en"));
    });

    it("bulk updates by ids and by query give each entry a new version", async () => {
      const t = await boot(dialect);
      const a = idOf(await createNote(t, { title: "a", code: "a" }));
      const b = idOf(await createNote(t, { title: "b", code: "b" }));

      await handlerOf(t).bulkUpdateEntries({
        collectionName: NOTES,
        ids: [a, b],
        data: { title: "bulk" },
        revs: { [a]: "1", [b]: "1" },
        overrideAccess: true,
      });
      expect([
        await mainCounter(t, NOTES, a),
        await mainCounter(t, NOTES, b),
      ]).toEqual([2, 2]);

      await handlerOf(t).bulkUpdateByQuery({
        collectionName: NOTES,
        where: { title: { equals: "bulk" } },
        // An update by query names no entry to give a version for.
        data: { title: "query", _overwrite: true },
        overrideAccess: true,
      });
      expect([
        await mainCounter(t, NOTES, a),
        await mainCounter(t, NOTES, b),
      ]).toEqual([3, 3]);

      const batch = await serviceOf(t).updateMany(
        NOTES,
        [
          { id: a, data: { title: "batch a", _overwrite: true } },
          { id: b, data: { title: "batch b", _overwrite: true } },
        ],
        { overrideAccess: true } as never
      );
      expect(batch.errors ?? []).toEqual([]);
      expect([
        await mainCounter(t, NOTES, a),
        await mainCounter(t, NOTES, b),
      ]).toEqual([4, 4]);
    });

    it("records who changed the row last, per row, with ids only", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          {
            collectionName: DOCS,
            overrideAccess: true,
            locale: "en",
            actor: { type: "user", id: "creator" },
          },
          { title: "hello", note: "n" }
        )
      );
      const created = await rowOf(t, `dc_${DOCS}`, { id });
      expect([created._changed_by_kind, created._changed_by_id]).toEqual([
        "person",
        "creator",
      ]);

      // A Spanish save changes the Spanish row only, so the Spanish row
      // names its changer and the main row keeps the one before.
      await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "es",
          actor: { type: "apiKey", id: "key-1" },
        },
        { title: "hola", _overwrite: true }
      );
      const spanish = await languageRow(t, id, "es");
      expect([
        spanish._changed_by_kind,
        spanish._changed_by_id,
        spanish._changed_by_principal_kind,
      ]).toEqual(["apiKey", "key-1", null]);
      const main = await rowOf(t, `dc_${DOCS}`, { id });
      expect(main._changed_by_id).toBe("creator");

      await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "en",
          actor: {
            type: "principal",
            principal: { kind: "member", id: "m-1" },
          },
        },
        { note: "shared", _overwrite: true }
      );
      const shared = await rowOf(t, `dc_${DOCS}`, { id });
      // A plugin-defined person by kind alone: their id may be an address,
      // and none is ever written where their erasure would have to find it.
      expect([
        shared._changed_by_kind,
        shared._changed_by_id,
        shared._changed_by_principal_kind,
      ]).toEqual(["principal", null, "member"]);
      expect(JSON.stringify(shared)).not.toContain("m-1");

      // The same for a translation row the person saves: nothing anywhere in
      // the document's rows for an erasure to have to find.
      await handlerOf(t).updateEntry(
        {
          collectionName: DOCS,
          entryId: id,
          overrideAccess: true,
          locale: "es",
          actor: {
            type: "principal",
            principal: { kind: "member", id: "m-1" },
          },
        },
        { title: "hola de nuevo", _overwrite: true }
      );
      const translated = await languageRow(t, id, "es");
      expect([
        translated._changed_by_kind,
        translated._changed_by_id,
        translated._changed_by_principal_kind,
      ]).toEqual(["principal", null, "member"]);
      expect(JSON.stringify(translated)).not.toContain("m-1");

      // Never published: the last changer is for the server to name, through
      // the reader's own access, and only by id.
      const read = (await t.nextly.findByID({
        collection: DOCS as never,
        id,
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
