/**
 * An update made from an out-of-date version of a collection entry is
 * refused; one made from the current version is applied.
 *
 * The oracle throughout is the stored row, read raw: a refused save leaves it
 * as it was, an applied one moves its counter by one.
 *
 * @module domains/collections/services/__tests__/stale-version.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { CollectionService } from "../collection-service";
import {
  poolRevisionReader,
  readDocumentRevision,
} from "../../../versions/stale-version";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Translated, with a shared field, so an entry can exist with no translation row. */
const DOCS = "docs";
const LANGUAGES = `dc_${DOCS}_locales`;
/** No languages: the plainest entry there is. */
const NOTES = "notes";
/** Draft and published, so a published entry holds an edit as a working draft. */
const POSTS = "posts";
/** A person whose saves are named in a refusal. */
const ANA = {
  id: "user-ana",
  name: "Ana Ruiz",
  email: "ana@x.test",
  role: "admin",
};

const OPEN = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: DOCS,
        localized: true,
        access: OPEN,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "note", localized: false }),
        ],
      }),
      defineCollection({
        slug: NOTES,
        access: OPEN,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: POSTS,
        status: true,
        versions: { drafts: true },
        access: { ...OPEN, publish: () => true, unpublish: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing
  // about those databases.
  expect(current.adapter.dialect).toBe(dialect);
  const now = new Date();
  await current.adapter.insert("users", {
    id: ANA.id,
    email: ANA.email,
    name: ANA.name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return current;
}

type Result = {
  success?: boolean;
  statusCode?: number;
  code?: string;
  data?: Record<string, unknown> | null;
  publicData?: Record<string, unknown>;
};

/** The `_rev` a service result carries. */
function revOf(result: unknown): string {
  const rev = (result as Result).data?._rev;
  if (typeof rev !== "string")
    throw new Error(`no _rev on ${JSON.stringify(result)}`);
  return rev;
}

const update = (
  t: TestNextly,
  slug: string,
  id: string,
  data: Record<string, unknown>,
  options: { locale?: string; user?: typeof ANA } = {}
): Promise<Result> =>
  handlerOf(t).updateEntry(
    { collectionName: slug, entryId: id, overrideAccess: true, ...options },
    data
  ) as Promise<Result>;

/** A row of `table`, read raw. */
async function stored(t: TestNextly, table: string, id: string) {
  const row = await t.adapter.selectOne<Record<string, unknown>>(table, {
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  if (!row) throw new Error(`no row ${id} in ${table}`);
  return row;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

const serviceOf = (t: TestNextly): CollectionService =>
  t.getService("collectionService") as unknown as CollectionService;

function idOf(result: unknown): string {
  const id = (result as { data?: { id?: unknown } }).data?.id;
  if (typeof id !== "string")
    throw new Error(`no id on ${JSON.stringify(result)}`);
  return id;
}

const q = (t: TestNextly, name: string) =>
  t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** Each translation row's counter, by document and language, read raw. */
async function languageCounters(
  t: TestNextly,
  ids: readonly string[]
): Promise<Record<string, number>> {
  const p = (n: number) => (t.adapter.dialect === "postgresql" ? `$${n}` : "?");
  const rows = await t.adapter.executeQuery<Record<string, unknown>>(
    `SELECT ${q(t, "_parent")}, ${q(t, "_locale")}, ${q(t, "_revision")} FROM ${q(t, LANGUAGES)} WHERE ${q(t, "_parent")} IN (${ids.map((_, i) => p(i + 1)).join(", ")})`,
    [...ids]
  );
  return Object.fromEntries(
    rows.map(row => [
      `${String(row._parent)}.${String(row._locale)}`,
      Number(row._revision),
    ])
  );
}

/**
 * Holds every insert into `table` made inside a transaction until `parties`
 * of them are waiting, then lets them all go at once. By then each of those
 * transactions has done everything it does before that insert, so whatever
 * it locked on the way is held by all of them together.
 *
 * Refuses, rather than proceeding alone, when the others never arrive: a
 * staging that did not overlap would pass whatever the write path locks.
 */
function holdInsertsInto(
  t: TestNextly,
  table: string,
  parties: number
): { arrived: () => number; release: () => void } {
  const pattern = new RegExp(
    `^\\s*insert\\s+into\\s+[\`"]?${table}[\`"]?\\s`,
    "i"
  );
  let waiting = 0;
  let open!: () => void;
  const allHere = new Promise<void>(resolve => {
    open = resolve;
  });
  const adapter = t.adapter as unknown as {
    transaction: (
      callback: (tx: unknown) => Promise<unknown>,
      ...rest: unknown[]
    ) => Promise<unknown>;
  };
  const original = adapter.transaction.bind(adapter);
  adapter.transaction = (callback, ...rest) =>
    original(
      tx => {
        const ctx = tx as {
          execute: (sql: string, params?: unknown[]) => Promise<unknown>;
        };
        const execute = ctx.execute.bind(ctx);
        ctx.execute = async (sql, params) => {
          if (pattern.test(sql)) {
            waiting += 1;
            if (waiting === parties) open();
            await Promise.race([
              allHere,
              new Promise((_, reject) =>
                setTimeout(
                  () =>
                    reject(
                      new Error(
                        `only ${waiting} of ${parties} saves reached the insert into ${table}`
                      )
                    ),
                  10_000
                )
              ),
            ]);
          }
          return execute(sql, params);
        };
        return callback(ctx);
      },
      ...rest
    );
  return {
    arrived: () => waiting,
    release: () => {
      adapter.transaction = original;
    },
  };
}

describe.each(getConfiguredTestDialects())(
  "stale versions of a collection entry (%s)",
  dialect => {
    // SQLite runs one write transaction at a time, so two saves can never both
    // be inside theirs: the second waits for the first to commit.
    it.skipIf(dialect === "sqlite")(
      "applies two entries' first translations, saved at the same moment, when no translation row is near",
      async () => {
        const t = await boot(dialect);
        // Entries with no translation row at all, as entries saved before
        // translation was turned on are: each entry's first Spanish row then
        // falls in the same empty stretch of the translation table's key. On
        // MySQL a locking read of a row that isn't there locks that stretch,
        // and two saves that each lock it and then insert into it deadlock.
        const ids = [];
        for (const note of ["a", "b"]) {
          ids.push(
            idOf(
              await handlerOf(t).createEntry(
                { collectionName: DOCS, overrideAccess: true, locale: "en" },
                { note }
              )
            )
          );
        }
        // A create writes its own language's row, so the rows are removed to
        // stand for entries that predate translation.
        await t.adapter.executeQuery(`DELETE FROM ${q(t, LANGUAGES)}`, []);
        expect(await languageCounters(t, ids)).toEqual({});

        const gate = holdInsertsInto(t, LANGUAGES, 2);
        try {
          const saved = await Promise.all(
            ids.map(id =>
              handlerOf(t).updateEntry(
                {
                  collectionName: DOCS,
                  entryId: id,
                  overrideAccess: true,
                  locale: "es",
                },
                { title: `hola ${id}` }
              )
            )
          );
          expect(gate.arrived()).toBe(2);
          // The whole result on failure, so a refused save says why.
          for (const result of saved) {
            expect(
              (result as { success?: unknown }).success,
              JSON.stringify(result)
            ).toBe(true);
          }
        } finally {
          gate.release();
        }
        expect(await languageCounters(t, ids)).toEqual({
          [`${ids[0]}.es`]: 1,
          [`${ids[1]}.es`]: 1,
        });
      }
    );

    it.skipIf(dialect === "sqlite")(
      "applies two entries' first Spanish saves at the same moment when each already has an English row",
      async () => {
        const t = await boot(dialect);
        const ids = [];
        for (const title of ["a", "b"]) {
          ids.push(
            idOf(
              await handlerOf(t).createEntry(
                { collectionName: DOCS, overrideAccess: true, locale: "en" },
                { title, note: title }
              )
            )
          );
        }
        expect(Object.keys(await languageCounters(t, ids)).sort()).toEqual(
          ids.map(id => `${id}.en`).sort()
        );

        const gate = holdInsertsInto(t, LANGUAGES, 2);
        try {
          const saved = await Promise.all(
            ids.map(id =>
              handlerOf(t).updateEntry(
                {
                  collectionName: DOCS,
                  entryId: id,
                  overrideAccess: true,
                  locale: "es",
                },
                { title: `hola ${id}` }
              )
            )
          );
          expect(gate.arrived()).toBe(2);
          // The whole result on failure, so a refused save says why.
          for (const result of saved) {
            expect(
              (result as { success?: unknown }).success,
              JSON.stringify(result)
            ).toBe(true);
          }
        } finally {
          gate.release();
        }
        const counters = await languageCounters(t, ids);
        expect(counters[`${ids[0]}.es`]).toBe(1);
        expect(counters[`${ids[1]}.es`]).toBe(1);
      }
    );
  }
);

describe.each(getConfiguredTestDialects())(
  "judging an update by the version it gives (%s)",
  dialect => {
    it("refuses a save from a version someone else's save replaced, and leaves the entry as it was", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: NOTES, overrideAccess: true },
        { title: "first" }
      );
      const id = idOf(created);
      const read = revOf(created);
      const theirs = await update(
        t,
        NOTES,
        id,
        { title: "theirs", _rev: read },
        { user: ANA }
      );
      expect(theirs.success, JSON.stringify(theirs)).toBe(true);

      const mine = await update(t, NOTES, id, { title: "mine", _rev: read });
      expect(mine).toMatchObject({
        success: false,
        statusCode: 409,
        code: "STALE_VERSION",
      });
      expect(mine.publicData).toMatchObject({ currentVersion: revOf(theirs) });
      // The entry keeps the save that came in between.
      expect((await stored(t, `dc_${NOTES}`, id)).title).toBe("theirs");
    });

    it("applies a save from the current version, and one that gives none", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: NOTES, overrideAccess: true },
        { title: "first" }
      );
      const id = idOf(created);
      const second = await update(t, NOTES, id, {
        title: "second",
        _rev: revOf(created),
      });
      expect(second.success, JSON.stringify(second)).toBe(true);
      const third = await update(t, NOTES, id, {
        title: "third",
        _rev: revOf(second),
      });
      expect(third.success, JSON.stringify(third)).toBe(true);
      const unjudged = await update(t, NOTES, id, { title: "fourth" });
      expect(unjudged.success, JSON.stringify(unjudged)).toBe(true);
      expect((await stored(t, `dc_${NOTES}`, id)).title).toBe("fourth");
    });

    it("refuses with 400 a version that is not one, and one from a read of another language", async () => {
      const t = await boot(dialect);
      const note = idOf(
        await handlerOf(t).createEntry(
          { collectionName: NOTES, overrideAccess: true },
          { title: "a" }
        )
      );
      for (const rev of ["", "seven", "0", "7.", "7.es", 7]) {
        const result = await update(t, NOTES, note, { title: "b", _rev: rev });
        expect(result, JSON.stringify(rev)).toMatchObject({
          success: false,
          statusCode: 400,
        });
      }
      const doc = await handlerOf(t).createEntry(
        { collectionName: DOCS, overrideAccess: true, locale: "en" },
        { title: "hello" }
      );
      const result = await update(
        t,
        DOCS,
        idOf(doc),
        { title: "hola", _rev: revOf(doc) },
        { locale: "es" }
      );
      expect(result).toMatchObject({ success: false, statusCode: 400 });
      expect((await stored(t, `dc_${NOTES}`, note)).title).toBe("a");
    });

    it("judges a translated save on its own language and the shared fields, not on other languages", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: DOCS, overrideAccess: true, locale: "en" },
        { title: "hello", note: "n" }
      );
      const id = idOf(created);
      const es = await update(t, DOCS, id, { title: "hola" }, { locale: "es" });
      const readEs = revOf(es);

      // English changes: a Spanish save from before it is still current.
      await update(t, DOCS, id, { title: "hello again" }, { locale: "en" });
      const fine = await update(
        t,
        DOCS,
        id,
        { title: "hola de nuevo", _rev: readEs },
        { locale: "es" }
      );
      expect(fine.success, JSON.stringify(fine)).toBe(true);

      // Spanish changes: a Spanish save from before it is out of date.
      const stale = await update(
        t,
        DOCS,
        id,
        { title: "adios", _rev: readEs },
        { locale: "es" }
      );
      expect(stale).toMatchObject({
        success: false,
        statusCode: 409,
        code: "STALE_VERSION",
      });
      expect(stale.publicData).toMatchObject({ currentVersion: revOf(fine) });

      // A shared field changes: every language's save from before it is out of date.
      const current = revOf(fine);
      await update(t, DOCS, id, { note: "shared" }, { locale: "en" });
      const afterShared = await update(
        t,
        DOCS,
        id,
        { title: "otra", _rev: current },
        { locale: "es" }
      );
      expect(afterShared).toMatchObject({
        success: false,
        statusCode: 409,
        code: "STALE_VERSION",
      });
      const counters = await languageCounters(t, [id]);
      expect(counters[`${id}.es`]).toBe(2);
    });

    it("names who changed it last and when, to a caller who may read it, and never a value", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: NOTES, overrideAccess: true },
        { title: "first" }
      );
      const id = idOf(created);
      const before = Date.now();
      await update(t, NOTES, id, { title: "secret words" }, { user: ANA });
      const refused = await update(t, NOTES, id, {
        title: "mine",
        _rev: revOf(created),
      });
      expect(refused).toMatchObject({ code: "STALE_VERSION" });
      expect(refused.publicData).toMatchObject({
        changedBy: { kind: "person", name: ANA.name },
      });
      const at = Date.parse(String(refused.publicData?.changedAt));
      expect(at).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
      expect(JSON.stringify(refused)).not.toContain("secret words");
      expect(JSON.stringify(refused)).not.toContain(ANA.email);
      expect(JSON.stringify(refused)).not.toContain(ANA.id);
    });

    it("applies exactly one of two saves made from the same version at once", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: NOTES, overrideAccess: true },
        { title: "first" }
      );
      const id = idOf(created);
      const results = await Promise.all(
        ["one", "two"].map(title =>
          update(t, NOTES, id, { title, _rev: revOf(created) })
        )
      );
      expect(
        results.filter(r => r.success).length,
        JSON.stringify(results)
      ).toBe(1);
      expect(results.filter(r => r.code === "STALE_VERSION").length).toBe(1);
      expect(Number((await stored(t, `dc_${NOTES}`, id))._revision)).toBe(2);
    });

    it("never stores _overwrite, and refuses one that is not true or false", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: NOTES, overrideAccess: true },
        { title: "first" }
      );
      const id = idOf(created);
      const overwritten = await update(t, NOTES, id, {
        title: "over",
        _overwrite: true,
      });
      expect(overwritten.success, JSON.stringify(overwritten)).toBe(true);
      expect(overwritten.data).not.toHaveProperty("_overwrite");
      expect(await stored(t, `dc_${NOTES}`, id)).not.toHaveProperty(
        "_overwrite"
      );
      const withVersion = await update(t, NOTES, id, {
        title: "over again",
        _overwrite: false,
        _rev: revOf(overwritten),
      });
      expect(withVersion.success, JSON.stringify(withVersion)).toBe(true);
      // Through the Direct API too.
      const direct = await t.nextly.update({
        collection: NOTES as never,
        id,
        data: { title: "direct", _overwrite: true } as never,
      });
      expect(direct).not.toHaveProperty("item._overwrite");
      for (const value of ["yes", 1, null]) {
        const refused = await update(t, NOTES, id, {
          title: "no",
          _overwrite: value,
        });
        expect(refused, JSON.stringify(value)).toMatchObject({
          success: false,
          statusCode: 400,
        });
      }
      expect((await stored(t, `dc_${NOTES}`, id)).title).toBe("direct");
    });

    it("judges a request that carries anything that looks like the release-run mark", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: NOTES, overrideAccess: true },
        { title: "first" }
      );
      const id = idOf(created);
      const read = revOf(created);
      await update(t, NOTES, id, { title: "theirs" });
      const lookalikes = {
        exempt: true,
        _exempt: true,
        releaseRun: true,
        _releaseRun: true,
      };
      // In the body,
      const inBody = await update(t, NOTES, id, {
        title: "mine",
        _rev: read,
        ...lookalikes,
      });
      expect(inBody).toMatchObject({ success: false, code: "STALE_VERSION" });
      // in the options,
      const inOptions = (await handlerOf(t).updateEntry(
        {
          collectionName: NOTES,
          entryId: id,
          overrideAccess: true,
          ...lookalikes,
        } as never,
        { title: "mine", _rev: read }
      )) as Result;
      expect(inOptions).toMatchObject({
        success: false,
        code: "STALE_VERSION",
      });
      // and through the Direct API.
      await expect(
        t.nextly.update({
          collection: NOTES as never,
          id,
          data: { title: "mine", _rev: read, ...lookalikes } as never,
          ...lookalikes,
        } as never)
      ).rejects.toMatchObject({ code: "STALE_VERSION" });
      expect((await stored(t, `dc_${NOTES}`, id)).title).toBe("theirs");
    });

    it("reads a document's counters, who moved each and when, per language, with a row missing as 0", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        {
          collectionName: DOCS,
          overrideAccess: true,
          locale: "en",
          user: ANA,
        } as never,
        { title: "hello", note: "n" }
      );
      const id = idOf(created);
      const state = await readDocumentRevision(poolRevisionReader(t.adapter), {
        dialect: t.adapter.dialect,
        table: `dc_${DOCS}`,
        id,
        languages: { table: LANGUAGES, locales: ["en", "es"] },
      });
      expect(state?.main).toMatchObject({
        part: "main",
        counter: 1,
        changer: { kind: "person", id: ANA.id },
      });
      expect(state?.main.at).toBeInstanceOf(Date);
      expect(state?.languages.en).toMatchObject({
        part: "en",
        counter: 1,
        changer: { kind: "person", id: ANA.id },
      });
      expect(state?.languages.es).toEqual({
        part: "es",
        counter: 0,
        changer: { kind: null, id: null, principalKind: null },
        at: null,
      });
      expect(
        await readDocumentRevision(poolRevisionReader(t.adapter), {
          dialect: t.adapter.dialect,
          table: `dc_${DOCS}`,
          id: "no-such-entry",
        })
      ).toBeUndefined();
    });

    it("never writes a translation row for a save that writes none of that language's fields", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: DOCS, overrideAccess: true, locale: "en" },
        { title: "hello", note: "n" }
      );
      const id = idOf(created);
      // A Spanish save of a shared field alone, judged on its version.
      const read = (await t.nextly.findByID({
        collection: DOCS as never,
        id,
        locale: "es",
        overrideAccess: true,
      } as never)) as { _rev: string };
      const saved = await update(
        t,
        DOCS,
        id,
        { note: "shared", _rev: read._rev },
        { locale: "es" }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      // The same through a batch, in the default language, after its row is gone.
      await t.adapter.executeQuery(`DELETE FROM ${q(t, LANGUAGES)}`, []);
      const batch = await serviceOf(t).updateMany(
        DOCS,
        [
          {
            id,
            data: { note: "batch", _rev: revOf(saved).split(".")[0] + ".en:0" },
          },
        ],
        { overrideAccess: true } as never
      );
      expect(batch.errors, JSON.stringify(batch)).toEqual([]);
      expect(await languageCounters(t, [id])).toEqual({});
      expect((await stored(t, `dc_${DOCS}`, id)).note).toBe("batch");
    });

    describe("a batch judges each entry on its own and applies the rest", () => {
      /** Three entries read at their current versions, in the default language. */
      async function three(t: TestNextly) {
        const ids: string[] = [];
        const revs: string[] = [];
        for (const title of ["a", "b", "c"]) {
          const created = await handlerOf(t).createEntry(
            { collectionName: DOCS, overrideAccess: true, locale: "en" },
            { title, note: title }
          );
          ids.push(idOf(created));
          revs.push(revOf(created));
        }
        return { ids, revs };
      }

      /** Every row an entry has, raw, to compare before and after. */
      async function rowsOf(t: TestNextly, id: string) {
        return {
          main: await stored(t, `dc_${DOCS}`, id),
          languages: await languageCounters(t, [id]),
        };
      }

      it.each([
        ["its translation moved", { title: "theirs" }, { title: "mine" }],
        ["its shared fields moved", { note: "theirs" }, { title: "mine" }],
        [
          "its translation moved, and it also changes a shared field",
          { title: "theirs" },
          { title: "mine", note: "mine" },
        ],
      ])(
        "refuses the entry whose %s, writing nothing of it",
        async (_name, theirs, mine) => {
          const t = await boot(dialect);
          const { ids, revs } = await three(t);
          await update(t, DOCS, ids[1], theirs, { locale: "en" });
          const before = await rowsOf(t, ids[1]);

          const batch = await serviceOf(t).updateMany(
            DOCS,
            ids.map((id, i) => ({
              id,
              data:
                i === 1
                  ? { ...mine, _rev: revs[i] }
                  : { title: `new ${i}`, _rev: revs[i] },
            })),
            { overrideAccess: true } as never
          );
          expect(
            batch.errors.map(e => ({ index: e.index, code: e.code })),
            JSON.stringify(batch)
          ).toEqual([{ index: 1, code: "STALE_VERSION" }]);
          expect(batch.successful).toBe(2);
          // The refused entry is exactly as it was: no shared value, no translation, no counter moved.
          expect(await rowsOf(t, ids[1])).toEqual(before);
          // The others were applied.
          for (const i of [0, 2]) {
            const doc = (await t.nextly.findByID({
              collection: DOCS as never,
              id: ids[i],
              locale: "en",
              overrideAccess: true,
            } as never)) as { title: string };
            expect(doc.title).toBe(`new ${i}`);
          }
        }
      );
    });

    it("dates the change by when the counter moved, a held draft included, and gives no time for a row never saved since", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: POSTS, overrideAccess: true },
        { title: "live", status: "published" }
      );
      const id = idOf(created);
      // Past SQLite's whole second, so the held draft's moment is not the
      // row's last update.
      await new Promise(resolve => setTimeout(resolve, 1100));
      // A published entry holds this edit as a working draft: the counter and
      // its time move, `updated_at` does not.
      const held = await update(t, POSTS, id, { title: "held" }, { user: ANA });
      expect(held.success, JSON.stringify(held)).toBe(true);
      const row = await stored(t, `dc_${POSTS}`, id);
      expect(new Date(row._changed_at as Date).getTime()).toBeGreaterThan(
        new Date(row.updated_at as Date).getTime()
      );

      const refused = await update(t, POSTS, id, {
        title: "mine",
        _rev: revOf(created),
      });
      expect(refused).toMatchObject({ code: "STALE_VERSION" });
      expect(refused.publicData).toMatchObject({
        changedBy: { kind: "person", name: ANA.name },
        changedAt: new Date(row._changed_at as Date).toISOString(),
      });

      // A row from before the column existed: who and when are unknown.
      await t.adapter.executeQuery(
        `UPDATE ${q(t, `dc_${POSTS}`)} SET ${q(t, "_changed_at")} = NULL, ${q(t, "_changed_by_kind")} = NULL, ${q(t, "_changed_by_id")} = NULL WHERE ${q(t, "id")} = ${t.adapter.dialect === "postgresql" ? "$1" : "?"}`,
        [id]
      );
      const unknown = await update(t, POSTS, id, {
        title: "mine",
        _rev: revOf(created),
      });
      expect(unknown).toMatchObject({ code: "STALE_VERSION" });
      expect(unknown.publicData).not.toHaveProperty("changedBy");
      expect(unknown.publicData).not.toHaveProperty("changedAt");
    });

    it("gives the newest recorded version to compare against where the entry keeps history, and none where it keeps none", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: POSTS, overrideAccess: true },
        { title: "first", status: "draft" }
      );
      const id = idOf(created);
      await update(t, POSTS, id, { title: "theirs" }, { user: ANA });
      const refused = await update(t, POSTS, id, {
        title: "mine",
        _rev: revOf(created),
      });
      expect(refused).toMatchObject({ code: "STALE_VERSION" });

      const versions = t.getService("versionsService") as unknown as {
        listPartVersions(
          ref: object
        ): Promise<{ versionNo: number; locale: string | null }[]>;
        get(ref: object, versionNo: number): Promise<{ snapshot: unknown }>;
      };
      const ref = { scopeKind: "collection", scopeSlug: POSTS, entryId: id };
      const newest = Math.max(
        ...(await versions.listPartVersions(ref)).map(v => v.versionNo)
      );
      const history = refused.publicData?.historyVersion as {
        version: number;
        locale: string | null;
      };
      expect(history.version).toBe(newest);
      // The version named is the save that came in between.
      const snapshot = (await versions.get(ref, history.version)).snapshot;
      expect(JSON.stringify(snapshot)).toContain("theirs");

      const note = await handlerOf(t).createEntry(
        { collectionName: NOTES, overrideAccess: true },
        { title: "a" }
      );
      await update(t, NOTES, idOf(note), { title: "b" });
      const unversioned = await update(t, NOTES, idOf(note), {
        title: "c",
        _rev: revOf(note),
      });
      expect(unversioned).toMatchObject({ code: "STALE_VERSION" });
      expect(unversioned.publicData).not.toHaveProperty("historyVersion");
    });
  }
);
