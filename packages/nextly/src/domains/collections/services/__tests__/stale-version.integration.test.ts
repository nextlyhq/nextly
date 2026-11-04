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

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Translated, with a shared field, so an entry can exist with no translation row. */
const DOCS = "docs";
const LANGUAGES = `dc_${DOCS}_locales`;

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
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing
  // about those databases.
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

function idOf(result: unknown): string {
  const id = (result as { data?: { id?: unknown } }).data?.id;
  if (typeof id !== "string") throw new Error(`no id on ${JSON.stringify(result)}`);
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
    rows.map(row => [`${String(row._parent)}.${String(row._locale)}`, Number(row._revision)])
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
  const pattern = new RegExp(`^\\s*insert\\s+into\\s+[\`"]?${table}[\`"]?\\s`, "i");
  let waiting = 0;
  let open!: () => void;
  const allHere = new Promise<void>(resolve => {
    open = resolve;
  });
  const adapter = t.adapter as unknown as {
    transaction: (callback: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) => Promise<unknown>;
  };
  const original = adapter.transaction.bind(adapter);
  adapter.transaction = (callback, ...rest) =>
    original(tx => {
      const ctx = tx as { execute: (sql: string, params?: unknown[]) => Promise<unknown> };
      const execute = ctx.execute.bind(ctx);
      ctx.execute = async (sql, params) => {
        if (pattern.test(sql)) {
          waiting += 1;
          if (waiting === parties) open();
          await Promise.race([
            allHere,
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`only ${waiting} of ${parties} saves reached the insert into ${table}`)),
                10_000
              )
            ),
          ]);
        }
        return execute(sql, params);
      };
      return callback(ctx);
    }, ...rest);
  return {
    arrived: () => waiting,
    release: () => {
      adapter.transaction = original;
    },
  };
}

describe.each(getConfiguredTestDialects())("stale versions of a collection entry (%s)", dialect => {
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
              { collectionName: DOCS, entryId: id, overrideAccess: true, locale: "es" },
              { title: `hola ${id}` }
            )
          )
        );
        expect(gate.arrived()).toBe(2);
        // The whole result on failure, so a refused save says why.
        for (const result of saved) {
          expect((result as { success?: unknown }).success, JSON.stringify(result)).toBe(true);
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
              { collectionName: DOCS, entryId: id, overrideAccess: true, locale: "es" },
              { title: `hola ${id}` }
            )
          )
        );
        expect(gate.arrived()).toBe(2);
        // The whole result on failure, so a refused save says why.
        for (const result of saved) {
          expect((result as { success?: unknown }).success, JSON.stringify(result)).toBe(true);
        }
      } finally {
        gate.release();
      }
      const counters = await languageCounters(t, ids);
      expect(counters[`${ids[0]}.es`]).toBe(1);
      expect(counters[`${ids[1]}.es`]).toBe(1);
    }
  );
});
