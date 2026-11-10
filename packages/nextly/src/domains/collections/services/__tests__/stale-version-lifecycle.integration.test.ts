/**
 * Publishing and unpublishing an entry, in one language or in all of them, is
 * judged by the version its caller read, as a save is.
 *
 * A publish from an out-of-date view would put live a draft the publisher
 * never saw, so a stale one is refused with `STALE_VERSION` and changes
 * nothing. Publishing every language judges every language: a Spanish save
 * since the read refuses it, though an English publish alone would not.
 *
 * The oracle throughout is the stored rows, read raw: a refused move leaves
 * every status and counter as it was.
 *
 * @module domains/collections/services/__tests__/stale-version-lifecycle.integration.test
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

/** Translated, with a lifecycle per language and a shared field. */
const PAGES = "pages";
const LANGUAGES = `dc_${PAGES}_locales`;
/** A lifecycle and no languages. */
const NOTES = "notes";

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
  publish: () => true,
  unpublish: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: PAGES,
        localized: true,
        status: true,
        access: OPEN,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "note", localized: false }),
        ],
      }),
      defineCollection({
        slug: NOTES,
        status: true,
        access: OPEN,
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

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

function revOf(result: unknown): string {
  const rev = (result as Result).data?._rev;
  if (typeof rev !== "string")
    throw new Error(`no _rev on ${JSON.stringify(result)}`);
  return rev;
}

function idOf(result: unknown): string {
  const id = (result as Result).data?.id;
  if (typeof id !== "string")
    throw new Error(`no id on ${JSON.stringify(result)}`);
  return id;
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

/** The version a read of `locale` gives, `*` for every language. */
async function readRev(
  t: TestNextly,
  slug: string,
  id: string,
  locale?: string
): Promise<string> {
  const doc = (await t.nextly.findByID({
    collection: slug as never,
    id,
    ...(locale ? { locale } : {}),
    overrideAccess: true,
    status: "all",
  } as never)) as { _rev?: unknown } | null;
  if (typeof doc?._rev !== "string") throw new Error(`no _rev for ${id}`);
  return doc._rev;
}

const q = (t: TestNextly, name: string) =>
  t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/**
 * Everything a lifecycle move can change, read raw: the entry's status and
 * counter, and each translation row's status and counter.
 */
async function lifecycleOf(t: TestNextly, id: string) {
  const main = await t.adapter.selectOne<Record<string, unknown>>(
    `dc_${PAGES}`,
    { where: { and: [{ column: "id", op: "=", value: id }] } }
  );
  const p = (n: number) => (t.adapter.dialect === "postgresql" ? `$${n}` : "?");
  const rows = await t.adapter.executeQuery<Record<string, unknown>>(
    `SELECT ${q(t, "_locale")}, ${q(t, "_status")}, ${q(t, "_revision")} FROM ${q(t, LANGUAGES)} WHERE ${q(t, "_parent")} = ${p(1)}`,
    [id]
  );
  return {
    status: main?.status,
    revision: Number(main?._revision),
    languages: Object.fromEntries(
      rows
        .map(r => [
          String(r._locale),
          `${String(r._status)}#${Number(r._revision)}`,
        ])
        .sort(([a], [b]) => (a < b ? -1 : 1))
    ),
  };
}

/** A draft page with an English and a Spanish translation, and its versions as read. */
async function translatedDraft(t: TestNextly) {
  const id = idOf(
    await handlerOf(t).createEntry(
      { collectionName: PAGES, overrideAccess: true, locale: "en" },
      { title: "hello", note: "n" }
    )
  );
  await update(
    t,
    PAGES,
    id,
    { title: "hola", _rev: await readRev(t, PAGES, id, "es") },
    { locale: "es" }
  );
  return {
    id,
    en: await readRev(t, PAGES, id, "en"),
    es: await readRev(t, PAGES, id, "es"),
    every: await readRev(t, PAGES, id, "*"),
  };
}

/** Where a page publishes or unpublishes every language: the two routes' service, and a write naming `*`. */
const EVERY_LANGUAGE_DOORS = [
  [
    "publish all",
    (t: TestNextly, id: string, data: Record<string, unknown>) =>
      handlerOf(t).publishAllLocales({
        collectionName: PAGES,
        entryId: id,
        overrideAccess: true,
        data,
      }) as Promise<Result>,
  ],
  [
    "a published status written to every language",
    (t: TestNextly, id: string, data: Record<string, unknown>) =>
      update(t, PAGES, id, { status: "published", ...data }, { locale: "*" }),
  ],
] as const;

describe.each(getConfiguredTestDialects())(
  "publishing and unpublishing, judged by version (%s)",
  dialect => {
    it("refuses a publish from an out-of-date version", async () => {
      const t = await boot(dialect);
      const page = await translatedDraft(t);
      // Someone saves the Spanish translation after the Spanish read.
      await update(
        t,
        PAGES,
        page.id,
        { title: "hola otra vez", _overwrite: true },
        {
          locale: "es",
          user: ANA,
        }
      );
      const before = await lifecycleOf(t, page.id);

      const refused = await update(
        t,
        PAGES,
        page.id,
        { status: "published", _rev: page.es },
        { locale: "es" }
      );
      expect(refused.code, JSON.stringify(refused)).toBe("STALE_VERSION");
      expect(refused.statusCode).toBe(409);
      expect(refused.publicData).toMatchObject({
        currentVersion: await readRev(t, PAGES, page.id, "es"),
        changedBy: { kind: "person", name: ANA.name },
      });
      expect(await lifecycleOf(t, page.id)).toEqual(before);

      // Only English moved: a Spanish publish is judged on Spanish and the
      // shared fields, so it goes ahead.
      const fresh = await readRev(t, PAGES, page.id, "es");
      await update(
        t,
        PAGES,
        page.id,
        { title: "hello again", _overwrite: true },
        { locale: "en" }
      );
      const published = await update(
        t,
        PAGES,
        page.id,
        { status: "published", _rev: fresh },
        { locale: "es" }
      );
      expect(published.success, JSON.stringify(published)).toBe(true);
      expect((await lifecycleOf(t, page.id)).languages.es).toMatch(
        /^published#/
      );
    });

    it("refuses a publish of an entry with no languages from an out-of-date version", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await handlerOf(t).createEntry(
          { collectionName: NOTES, overrideAccess: true },
          { title: "a" }
        )
      );
      const read = await readRev(t, NOTES, id);
      await update(t, NOTES, id, { title: "b", _overwrite: true });
      const refused = await update(t, NOTES, id, {
        status: "published",
        _rev: read,
      });
      expect(refused.code, JSON.stringify(refused)).toBe("STALE_VERSION");
      const row = await t.adapter.selectOne<Record<string, unknown>>(
        `dc_${NOTES}`,
        { where: { and: [{ column: "id", op: "=", value: id }] } }
      );
      expect(row?.status).toBe("draft");
    });

    it("refuses an unpublish from an out-of-date version", async () => {
      const t = await boot(dialect);
      const page = await translatedDraft(t);
      await update(
        t,
        PAGES,
        page.id,
        { status: "published", _overwrite: true },
        { locale: "es" }
      );
      const read = await readRev(t, PAGES, page.id, "es");
      await update(
        t,
        PAGES,
        page.id,
        { title: "hola de nuevo", _overwrite: true },
        {
          locale: "es",
        }
      );
      const before = await lifecycleOf(t, page.id);

      const refused = await update(
        t,
        PAGES,
        page.id,
        { status: "draft", _rev: read },
        { locale: "es" }
      );
      expect(refused.code, JSON.stringify(refused)).toBe("STALE_VERSION");
      expect(await lifecycleOf(t, page.id)).toEqual(before);
    });

    describe.each(EVERY_LANGUAGE_DOORS)(
      "refuses a publish of every language after one of them changed: %s",
      (_door, publishEvery) => {
        it("refuses when another language changed since the read", async () => {
          const t = await boot(dialect);
          const page = await translatedDraft(t);
          // A Spanish save after the read of every language: an English
          // publish would not see it, a publish of every language must.
          await update(
            t,
            PAGES,
            page.id,
            { title: "hola otra vez", _overwrite: true },
            {
              locale: "es",
              user: ANA,
            }
          );
          const before = await lifecycleOf(t, page.id);

          const refused = await publishEvery(t, page.id, { _rev: page.every });
          expect(refused.code, JSON.stringify(refused)).toBe("STALE_VERSION");
          expect(refused.publicData).toMatchObject({
            currentVersion: await readRev(t, PAGES, page.id, "*"),
            changedBy: { kind: "person", name: ANA.name },
          });
          // Nothing moved: not the entry, not English, not Spanish.
          expect(await lifecycleOf(t, page.id)).toEqual(before);
        });

        it("refuses when the shared fields changed, or the default language", async () => {
          const t = await boot(dialect);
          const page = await translatedDraft(t);
          await update(
            t,
            PAGES,
            page.id,
            { note: "changed", _overwrite: true },
            { locale: "en" }
          );
          const sharedMoved = await publishEvery(t, page.id, {
            _rev: page.every,
          });
          expect(sharedMoved.code).toBe("STALE_VERSION");
          // The current version names every language, as a read of every
          // language spells it, though only the entry's own row moved: a
          // version naming no language could not be published from.
          expect(sharedMoved.publicData).toMatchObject({
            currentVersion: await readRev(t, PAGES, page.id, "*"),
          });

          const again = await readRev(t, PAGES, page.id, "*");
          await update(
            t,
            PAGES,
            page.id,
            { title: "hi", _overwrite: true },
            { locale: "en" }
          );
          const before = await lifecycleOf(t, page.id);
          expect((await publishEvery(t, page.id, { _rev: again })).code).toBe(
            "STALE_VERSION"
          );
          expect(await lifecycleOf(t, page.id)).toEqual(before);
        });

        it("refuses when a language was first translated since the read", async () => {
          const t = await boot(dialect);
          const id = idOf(
            await handlerOf(t).createEntry(
              { collectionName: PAGES, overrideAccess: true, locale: "en" },
              { title: "hello", note: "n" }
            )
          );
          // Read with no Spanish yet: the version names Spanish at 0.
          const read = await readRev(t, PAGES, id, "*");
          expect(read).toMatch(/es:0$/);
          await update(
            t,
            PAGES,
            id,
            { title: "hola", _overwrite: true },
            { locale: "es" }
          );
          const before = await lifecycleOf(t, id);
          expect((await publishEvery(t, id, { _rev: read })).code).toBe(
            "STALE_VERSION"
          );
          expect(await lifecycleOf(t, id)).toEqual(before);
        });

        it("publishes from the current version, and answers with every language's new version", async () => {
          const t = await boot(dialect);
          const page = await translatedDraft(t);
          const published = await publishEvery(t, page.id, {
            _rev: page.every,
          });
          expect(published.success, JSON.stringify(published)).toBe(true);
          const after = await lifecycleOf(t, page.id);
          expect(after.status).toBe("published");
          expect(Object.values(after.languages)).toEqual([
            expect.stringMatching(/^published#/),
            expect.stringMatching(/^published#/),
          ]);
          expect(revOf(published)).toBe(await readRev(t, PAGES, page.id, "*"));
        });

        it("refuses a one-language version: it can't say whether another language changed", async () => {
          const t = await boot(dialect);
          const page = await translatedDraft(t);
          const before = await lifecycleOf(t, page.id);
          const refused = await publishEvery(t, page.id, { _rev: page.en });
          expect(refused.code, JSON.stringify(refused)).toBe(
            "VALIDATION_ERROR"
          );
          expect(refused.statusCode).toBe(400);
          expect(await lifecycleOf(t, page.id)).toEqual(before);
        });

        it("refuses a publish with no version, publishing nothing", async () => {
          const t = await boot(dialect);
          const page = await translatedDraft(t);
          const before = await lifecycleOf(t, page.id);
          const refused = await publishEvery(t, page.id, {});
          expect(refused.code, JSON.stringify(refused)).toBe(
            "VERSION_REQUIRED"
          );
          expect(refused.statusCode).toBe(428);
          expect(await lifecycleOf(t, page.id)).toEqual(before);
        });

        it("publishes over a change with the overwrite choice, and records it", async () => {
          const t = await boot(dialect);
          const page = await translatedDraft(t);
          await update(
            t,
            PAGES,
            page.id,
            { title: "hola otra vez", _rev: page.es },
            {
              locale: "es",
              user: ANA,
            }
          );
          const published = await publishEvery(t, page.id, {
            _rev: page.every,
            _overwrite: true,
          });
          expect(published.success, JSON.stringify(published)).toBe(true);
          expect((await lifecycleOf(t, page.id)).status).toBe("published");
          const overwrites = (
            await t.nextly.contentEvents.list({
              subject: { kind: "collection", slug: PAGES, id: page.id },
              limit: 100,
            })
          ).items.filter(e => e.kind === "overwritten");
          expect(overwrites).toHaveLength(1);
          expect(overwrites[0]?.payload).toMatchObject({
            given: "stale",
            replaced: { kind: "person", id: ANA.id },
          });
        });
      }
    );

    it("refuses an unpublish of every language after one of them changed", async () => {
      const t = await boot(dialect);
      const page = await translatedDraft(t);
      await handlerOf(t).publishAllLocales({
        collectionName: PAGES,
        entryId: page.id,
        overrideAccess: true,
        data: { _overwrite: true },
      });
      const read = await readRev(t, PAGES, page.id, "*");
      await update(
        t,
        PAGES,
        page.id,
        { title: "hola otra vez", _overwrite: true },
        {
          locale: "es",
        }
      );
      const before = await lifecycleOf(t, page.id);
      const viaRoute = (await handlerOf(t).unpublishAllLocales({
        collectionName: PAGES,
        entryId: page.id,
        overrideAccess: true,
        data: { _rev: read },
      })) as Result;
      expect(viaRoute.code, JSON.stringify(viaRoute)).toBe("STALE_VERSION");
      const viaWildcard = await update(
        t,
        PAGES,
        page.id,
        { status: "draft", _rev: read },
        { locale: "*" }
      );
      expect(viaWildcard.code, JSON.stringify(viaWildcard)).toBe(
        "STALE_VERSION"
      );
      expect(await lifecycleOf(t, page.id)).toEqual(before);
    });
  }
);
