/**
 * Moving a whole document's lifecycle applies every language's pending change.
 *
 * Each case pairs what must land with what must survive, because a write that
 * applies nothing satisfies every "unchanged" assertion on its own.
 *
 * @module domains/collections/__tests__/publish-every-language.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { registerHook, unregisterHook } from "../../../hooks";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "pages";
const GUARDED_SLUG = "guardedpages";
const BLOCKS_SLUG = "blockpages";
const CAPPED_SLUG = "cappedpages";

const OPEN_ACCESS = {
  read: () => true,
  update: () => true,
  publish: () => true,
  unpublish: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: "hero",
        localized: true,
        fields: [
          text({ name: "heading", localized: true }),
          text({ name: "tagline", localized: true }),
          text({ name: "variant", localized: false }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: BLOCKS_SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: OPEN_ACCESS,
        fields: [
          text({ name: "title", localized: true }),
          fieldGroup({ name: "blocks", component: "hero", repeatable: true }),
        ],
      }),
      defineCollection({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: OPEN_ACCESS,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "note", localized: false }),
        ],
      }),
      defineCollection({
        slug: GUARDED_SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: OPEN_ACCESS,
        fields: [
          text({ name: "title", localized: true }),
          text({
            name: "note",
            localized: false,
            access: { update: () => false },
          }),
        ],
      }),
      defineCollection({
        slug: CAPPED_SLUG,
        localized: true,
        status: true,
        versions: { drafts: true, maxPerDoc: 1 },
        access: OPEN_ACCESS,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "note", localized: false }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

/** A document published in English and German. */
async function publishedInBoth(t: TestNextly, slug = SLUG): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: slug, overrideAccess: true, locale: "en" },
    { title: "EN v1", note: "live note", status: "published" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  await handlerOf(t).updateEntry(
    { collectionName: slug, entryId: id, overrideAccess: true, locale: "de" },
    { title: "DE v1", status: "published" }
  );
  return id;
}

/** Hold an edit as that language's pending change. */
async function holdEdit(
  t: TestNextly,
  id: string,
  locale: string,
  data: Record<string, unknown>,
  slug = SLUG
): Promise<void> {
  const res = await handlerOf(t).updateEntry(
    { collectionName: slug, entryId: id, overrideAccess: true, locale },
    data
  );
  if (!res.success) throw new Error(`hold failed: ${JSON.stringify(res)}`);
}

/**
 * Put a language's pending change at one stored instant, the way two saves
 * landing in the same second are stored.
 */
async function dateChange(
  t: TestNextly,
  id: string,
  locale: string,
  iso: string
): Promise<void> {
  await t.adapter.update(
    "nextly_versions",
    { updatedAt: new Date(iso) },
    {
      and: [
        { column: "entryId", op: "=", value: id },
        { column: "locale", op: "=", value: locale },
        { column: "versionNo", op: "IS NULL" },
      ],
    }
  );
}

/** What a reader gets for one language, at every status. */
async function live(
  t: TestNextly,
  id: string,
  locale: string,
  slug = SLUG
): Promise<Record<string, unknown>> {
  const doc = (await t.nextly.findByID({
    collection: slug as never,
    id,
    locale,
    overrideAccess: true,
    status: "all",
  } as never)) as Record<string, unknown> | null;
  return doc ?? {};
}

/** The languages this document still holds a pending change for. */
async function pendingLocales(t: TestNextly, id: string): Promise<string[]> {
  // `nextly_versions` is a mapped system table: its rows come back camelCased.
  const rows = await t.adapter.select<{
    entryId?: unknown;
    versionNo?: unknown;
    locale?: unknown;
  }>("nextly_versions", {});
  return rows
    .filter(r => String(r.entryId) === id && r.versionNo === null)
    .map(r => String(r.locale))
    .sort();
}

/** One durable event recorded for a document. */
interface RecordedEvent {
  type: string;
  locale: unknown;
  data: Record<string, unknown> | null;
  previous: Record<string, unknown> | null;
}

/** The durable events recorded for one document. */
async function eventsFor(t: TestNextly, id: string): Promise<RecordedEvent[]> {
  const rows = await t.adapter.select<{ type?: unknown; payload?: unknown }>(
    "nextly_events",
    {}
  );
  const events: RecordedEvent[] = [];
  for (const row of rows) {
    // The locale and the documents live on the envelope, not on a column.
    const envelope = (
      typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
    ) as {
      resource?: { id?: unknown; locale?: unknown };
      data?: Record<string, unknown> | null;
      previous?: Record<string, unknown> | null;
    } | null;
    if (!envelope?.resource || envelope.resource.id !== id) continue;
    events.push({
      type: String(row.type),
      locale: envelope.resource.locale,
      data: envelope.data ?? null,
      previous: envelope.previous ?? null,
    });
  }
  return events;
}

/** One durable version of a document. */
interface RecordedVersion {
  versionNo: number;
  locale: unknown;
  status: unknown;
  snapshot: Record<string, unknown>;
}

/** One document's durable versions, oldest first. */
async function versionsFor(
  t: TestNextly,
  id: string
): Promise<RecordedVersion[]> {
  const rows = await t.adapter.select<{
    entryId?: unknown;
    versionNo?: unknown;
    locale?: unknown;
    status?: unknown;
    snapshot?: unknown;
  }>("nextly_versions", {});
  return rows
    .filter(
      row =>
        String(row.entryId) === id &&
        row.versionNo !== null &&
        row.versionNo !== undefined
    )
    .map(row => ({
      versionNo: Number(row.versionNo),
      locale: row.locale,
      status: row.status,
      snapshot: (typeof row.snapshot === "string"
        ? JSON.parse(row.snapshot)
        : row.snapshot) as Record<string, unknown>,
    }))
    .sort((a, b) => a.versionNo - b.versionNo);
}

type Block = {
  id: string;
  heading?: unknown;
  tagline?: unknown;
  variant?: unknown;
};

/** A document with one block, published and translated in both languages. */
async function publishedWithOneBlock(
  t: TestNextly
): Promise<{ id: string; firstBlockId: string }> {
  const created = await handlerOf(t).createEntry(
    { collectionName: BLOCKS_SLUG, overrideAccess: true, locale: "en" },
    {
      title: "EN",
      blocks: [{ heading: "EN one", variant: "wide" }],
      status: "published",
    }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  const blocks = (await live(t, id, "en", BLOCKS_SLUG)).blocks as Block[];
  const firstBlockId = blocks[0].id;
  await handlerOf(t).updateEntry(
    {
      collectionName: BLOCKS_SLUG,
      entryId: id,
      overrideAccess: true,
      locale: "de",
    },
    {
      title: "DE",
      blocks: [{ id: firstBlockId, heading: "DE eins", variant: "wide" }],
      status: "published",
    }
  );
  return { id, firstBlockId };
}

/** Whether a block holds a stored translation for one language. */
async function hasTranslation(
  t: TestNextly,
  blockId: string,
  locale: string
): Promise<boolean> {
  const rows = await t.adapter.select<Record<string, unknown>>(
    "comp_hero_locales",
    {
      where: {
        and: [
          { column: "_parent", op: "=", value: blockId },
          { column: "_locale", op: "=", value: locale },
        ],
      },
    }
  );
  return rows.length > 0;
}

/**
 * English adds a block while German translates the existing one; `germanLater`
 * decides which pending change was saved last.
 */
async function blockAddedBesideATranslation(
  t: TestNextly,
  germanLater: boolean
): Promise<string> {
  const { id, firstBlockId } = await publishedWithOneBlock(t);
  const german = () =>
    holdEdit(
      t,
      id,
      "de",
      {
        blocks: [{ id: firstBlockId, heading: "DE eins v2", variant: "wide" }],
      },
      BLOCKS_SLUG
    );
  const english = () =>
    holdEdit(
      t,
      id,
      "en",
      {
        blocks: [
          { id: firstBlockId, heading: "EN one", variant: "wide" },
          { heading: "EN two", variant: "narrow" },
        ],
      },
      BLOCKS_SLUG
    );
  if (germanLater) {
    await english();
    await german();
  } else {
    await german();
    await english();
  }
  return id;
}

async function publishEveryLanguage(t: TestNextly, id: string, slug = SLUG) {
  return handlerOf(t).updateEntry(
    { collectionName: slug, entryId: id, overrideAccess: true, locale: "*" },
    { status: "published" }
  );
}

describe.each(getConfiguredTestDialects())(
  "a whole-document publish and every language's pending change (%s)",
  dialect => {
    it("publishes every language's pending change and consumes each one", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await holdEdit(t, id, "en", { title: "EN v2" });
      await holdEdit(t, id, "de", { title: "DE v2" });

      const res = await publishEveryLanguage(t, id);

      expect(res.success, JSON.stringify(res)).toBe(true);
      expect((await live(t, id, "en")).title).toBe("EN v2");
      expect((await live(t, id, "de")).title).toBe("DE v2");
      expect(await pendingLocales(t, id)).toEqual([]);
    });

    it("keeps a shared edit that a later translation-only change never touched", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await holdEdit(t, id, "en", { note: "EN edited note" });
      // German saved later, holding the note as it was live.
      await holdEdit(t, id, "de", { title: "DE v2" });

      const res = await publishEveryLanguage(t, id);

      expect(res.success, JSON.stringify(res)).toBe(true);
      expect((await live(t, id, "de")).title).toBe("DE v2");
      expect((await live(t, id, "en")).note).toBe("EN edited note");
    });

    it("lets the later save win when two languages edited the same shared value", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await holdEdit(t, id, "de", { note: "DE note" });
      await holdEdit(t, id, "en", { note: "EN note" });

      const res = await publishEveryLanguage(t, id);

      expect(res.success, JSON.stringify(res)).toBe(true);
      expect((await live(t, id, "de")).note).toBe("EN note");
    });

    it("lets the later save win when both saves are stored in the same second", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await holdEdit(t, id, "en", { note: "EN note" });
      await holdEdit(t, id, "de", { note: "DE note" });
      await dateChange(t, id, "en", "2026-01-01T00:00:00.000Z");
      await dateChange(t, id, "de", "2026-01-01T00:00:00.000Z");

      const res = await publishEveryLanguage(t, id);

      expect(res.success, JSON.stringify(res)).toBe(true);
      expect((await live(t, id, "en")).note).toBe("DE note");
    });

    it.each([
      ["saved before", false],
      ["saved after", true],
    ])(
      "keeps a block English added when the German translation was %s it",
      async (_label, germanLater) => {
        const t = await boot(dialect);
        const id = await blockAddedBesideATranslation(t, germanLater);

        const res = await publishEveryLanguage(t, id, BLOCKS_SLUG);

        expect(res.success, JSON.stringify(res)).toBe(true);
        const en = (await live(t, id, "en", BLOCKS_SLUG)).blocks as Block[];
        const de = (await live(t, id, "de", BLOCKS_SLUG)).blocks as Block[];
        expect(en.map(block => block.heading)).toEqual(["EN one", "EN two"]);
        expect(de.map(block => block.variant)).toEqual(["wide", "narrow"]);
        expect(de[0].heading).toBe("DE eins v2");
        // German never translated the new block, so no German value is stored
        // for it: a read falling back to English is not a translation.
        expect(await hasTranslation(t, en[1].id, "de")).toBe(false);
        expect(await pendingLocales(t, id)).toEqual([]);
      }
    );

    it("runs the update hooks once for the whole document when every language is published", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await holdEdit(t, id, "de", { title: "DE v2" });
      const seen: string[] = [];
      const before = (ctx: { req?: { http?: { method?: string } } }) => {
        seen.push(`before:${ctx.req?.http?.method ?? "none"}`);
        return undefined;
      };
      const after = () => {
        seen.push("after");
        return undefined;
      };
      // Registered after boot: creating the instance resets the hook registry.
      registerHook("beforeUpdate", SLUG, before as never);
      registerHook("afterUpdate", SLUG, after as never);
      try {
        const res = await handlerOf(t).publishAllLocales({
          collectionName: SLUG,
          entryId: id,
          overrideAccess: true,
          request: new Request("http://localhost/api/collections", {
            method: "POST",
          }),
        });

        expect(res.success, JSON.stringify(res)).toBe(true);
        expect(seen).toEqual(["before:POST", "after"]);
        expect((await live(t, id, "de")).title).toBe("DE v2");
        expect(await pendingLocales(t, id)).toEqual([]);
      } finally {
        unregisterHook("beforeUpdate", SLUG, before as never);
        unregisterHook("afterUpdate", SLUG, after as never);
      }
    });

    it("applies every language's pending change before taking the document down", async () => {
      // A pending change sits over a published row. Withdrawn, the row is a
      // draft and nothing accumulates onto it any more, so each language's
      // pending change becomes the content, as a single-language unpublish does.
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await holdEdit(t, id, "en", { title: "EN v2" });
      await holdEdit(t, id, "de", { title: "DE v2" });

      const res = await handlerOf(t).unpublishAllLocales({
        collectionName: SLUG,
        entryId: id,
        overrideAccess: true,
      });

      expect(res.success, JSON.stringify(res)).toBe(true);
      const en = await live(t, id, "en");
      const de = await live(t, id, "de");
      expect([en.status, de.status]).toEqual(["draft", "draft"]);
      expect([en.title, de.title]).toEqual(["EN v2", "DE v2"]);
      expect(await pendingLocales(t, id)).toEqual([]);
    });

    it("refuses the whole write, and keeps every pending change, when one edits a field the publisher may not", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t, GUARDED_SLUG);
      await holdEdit(t, id, "en", { title: "EN v2" }, GUARDED_SLUG);
      await holdEdit(t, id, "de", { note: "forbidden" }, GUARDED_SLUG);

      const res = await handlerOf(t).updateEntry(
        {
          collectionName: GUARDED_SLUG,
          entryId: id,
          locale: "*",
          routeAuthorized: true,
          user: { id: "editor-1", isActive: true } as never,
        },
        { status: "published" }
      );

      expect(res.success, JSON.stringify(res)).toBe(false);
      // English was applied first and must not survive the refusal.
      expect((await live(t, id, "en", GUARDED_SLUG)).title).toBe("EN v1");
      expect((await live(t, id, "en", GUARDED_SLUG)).note).toBe("live note");
      expect(await pendingLocales(t, id)).toEqual(["de", "en"]);
    });

    it("tells subscribers a language's content changed when its pending change goes live", async () => {
      // German is already live, so its status does not move and no lifecycle
      // event reports it: the update event is what a subscriber learns from.
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await holdEdit(t, id, "de", { title: "DE v2" });

      const res = await publishEveryLanguage(t, id);

      expect(res.success, JSON.stringify(res)).toBe(true);
      const updates = (await eventsFor(t, id)).filter(
        event => event.type === "entry.updated"
      );
      // Population control: the write's own event, for the default language.
      expect(updates.some(event => event.locale === "en")).toBe(true);
      const german = updates.filter(
        event => event.locale === "de" && event.data?.title === "DE v2"
      );
      expect(german).toHaveLength(1);
      expect(german[0].previous?.title).toBe("DE v1");
      expect(german[0].data?.status).toBe("published");
    });

    it("reports a language's replaced content when taking it down applies its pending change", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await holdEdit(t, id, "de", { title: "DE v2" });

      const res = await handlerOf(t).unpublishAllLocales({
        collectionName: SLUG,
        entryId: id,
        overrideAccess: true,
      });

      expect(res.success, JSON.stringify(res)).toBe(true);
      const withdrawn = (await eventsFor(t, id)).filter(
        event => event.type === "entry.unpublished" && event.locale === "de"
      );
      expect(withdrawn).toHaveLength(1);
      expect(withdrawn[0].data?.title).toBe("DE v2");
      expect(withdrawn[0].previous?.title).toBe("DE v1");
      expect(withdrawn[0].previous?.status).toBe("published");
    });

    it("records the content each language released as a version of that language", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await holdEdit(t, id, "de", { title: "DE v2" });

      const res = await publishEveryLanguage(t, id);

      expect(res.success, JSON.stringify(res)).toBe(true);
      const german = (await versionsFor(t, id)).filter(
        version => version.locale === "de"
      );
      // Population control: German's first publish recorded a version.
      expect(german.length).toBeGreaterThan(0);
      const newest = german[german.length - 1];
      expect(newest.snapshot.title).toBe("DE v2");
      expect(newest.status).toBe("published");
    });

    it("keeps every version one write records, even at a history cap of one", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t, CAPPED_SLUG);
      await holdEdit(t, id, "en", { title: "EN v2" }, CAPPED_SLUG);
      await holdEdit(t, id, "de", { title: "DE v2" }, CAPPED_SLUG);

      const res = await publishEveryLanguage(t, id, CAPPED_SLUG);

      expect(res.success, JSON.stringify(res)).toBe(true);
      const recorded = (await versionsFor(t, id)).map(
        version =>
          `${String(version.locale)}: ${String(version.snapshot.title)}`
      );
      expect(recorded).toEqual(
        expect.arrayContaining(["en: EN v2", "de: DE v2"])
      );
    });

    it("reports the status a hook committed when it replaces the one requested", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      const keepDraft = (ctx: { data?: Record<string, unknown> }) => ({
        ...ctx.data,
        status: "draft",
      });
      // Registered after boot: creating the instance resets the hook registry.
      registerHook("beforeUpdate", SLUG, keepDraft as never);
      try {
        const res = await handlerOf(t).publishAllLocales({
          collectionName: SLUG,
          entryId: id,
          overrideAccess: true,
        });

        expect(res.success, JSON.stringify(res)).toBe(true);
        // Population control: the hook's status is the one that landed.
        const statuses = [
          (await live(t, id, "en")).status,
          (await live(t, id, "de")).status,
        ];
        expect(statuses).toEqual(["draft", "draft"]);
        expect(res.data).toEqual({ id, status: "draft" });
        expect(res.message).toBe("All languages unpublished.");
      } finally {
        unregisterHook("beforeUpdate", SLUG, keepDraft as never);
      }
    });

    it("leaves a block translation no pending change held following the language it falls back to", async () => {
      const t = await boot(dialect);
      const { id, firstBlockId } = await publishedWithOneBlock(t);
      const englishTagline = (tagline: string) =>
        handlerOf(t).updateEntry(
          {
            collectionName: BLOCKS_SLUG,
            entryId: id,
            overrideAccess: true,
            locale: "en",
          },
          {
            blocks: [
              { id: firstBlockId, heading: "EN one", tagline, variant: "wide" },
            ],
            status: "published",
          }
        );
      // English gives the block a tagline German never translates, and German's
      // pending change holds the block without one.
      await englishTagline("EN tag");
      await holdEdit(
        t,
        id,
        "de",
        {
          blocks: [
            { id: firstBlockId, heading: "DE eins v2", variant: "wide" },
          ],
        },
        BLOCKS_SLUG
      );

      const res = await publishEveryLanguage(t, id, BLOCKS_SLUG);

      expect(res.success, JSON.stringify(res)).toBe(true);
      // Population control: German's own change went live.
      const german = (await live(t, id, "de", BLOCKS_SLUG)).blocks as Block[];
      expect(german[0].heading).toBe("DE eins v2");
      await englishTagline("EN tag v2");
      const followed = (await live(t, id, "de", BLOCKS_SLUG)).blocks as Block[];
      expect(followed[0].tagline).toBe("EN tag v2");
    });
  }
);
