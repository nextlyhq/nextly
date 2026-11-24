/**
 * A repeater keeps one structure across languages in its pending changes too: its rows, their
 * order and their shared values are the shared part's, so a structure change is drafted in the
 * shared draft and goes live with any language's publish; the text inside each row is its
 * language's, drafted in that language's draft keyed by row id, and goes live only with that
 * language's publish.
 *
 * The plausible broken implementations: the repeater filed whole in the shared part (a translation
 * held in one language starts a shared draft and is published with every language), filed whole in
 * the language part (a reorder held in one language reaches no other), a language's draft carrying
 * its copy of the structure (a publish puts back an order another language's publish changed), and
 * a shared draft carrying the text of the language that saved it.
 *
 * Each "absent" assertion stands beside a positive one in the same case.
 */
import { afterEach, describe, expect, it } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  number,
  repeater,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

// Written for per-language storage, as every installation now runs it.
perLanguageStorageSuite();

const SLUG = "slidesite";
/** A Single holding a repeatable component, whose instances keep one structure too. */
const DECK = "decksite";
/** A collection holding the same repeatable component, held through the collection's own path. */
const DECKS = "decks";
/** A collection holding a repeater, published one part at a time. */
const SHOWS = "slideshows";
const CARD = "deckcard";

/** Booting a site per test takes most of the default timeout on MySQL alone. */
const BOOT_TIMEOUT = 90_000;

interface Slide {
  id: string;
  caption?: string | null;
  rank?: number | null;
}

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
}, BOOT_TIMEOUT);

async function boot(dialect: TestDialect): Promise<SingleEntryService> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          repeater({
            name: "slides",
            fields: [text({ name: "caption" }), number({ name: "rank" })],
          }),
        ],
      }),
      defineSingle({
        slug: DECK,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "cards", component: CARD, repeatable: true }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: SHOWS,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          repeater({
            name: "slides",
            fields: [text({ name: "caption" }), number({ name: "rank" })],
          }),
        ],
      }),
      defineCollection({
        slug: DECKS,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "cards", component: CARD, repeatable: true }),
        ],
      }),
    ],
    fieldGroups: [
      defineFieldGroup({
        slug: CARD,
        fields: [text({ name: "label" }), number({ name: "weight" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return current.getService("singleEntryService");
}

async function save(
  singles: SingleEntryService,
  locale: string,
  data: Record<string, unknown>,
  slug: string = SLUG
): Promise<void> {
  // Every save here replaces what is stored, as an editor's save does.
  const saved = await singles.update(
    slug,
    { ...data, _overwrite: true },
    { locale, overrideAccess: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

async function read(
  singles: SingleEntryService,
  locale: string,
  editor = false,
  slug: string = SLUG
): Promise<{
  slides: Slide[];
  cards: Card[];
  _sharedChangesPending?: boolean;
}> {
  const res = await singles.get(slug, {
    locale,
    overrideAccess: true,
    ...(editor ? { includeWorkingDraft: true, status: "all" as const } : {}),
  });
  expect(res.success, JSON.stringify(res)).toBe(true);
  return res.data as never;
}

const captions = (slides: Slide[]) => slides.map(slide => slide.caption);

interface Card {
  id: string;
  label?: string | null;
  weight?: number | null;
}

const labels = (cards: Card[]) => cards.map(card => card.label);

/** The Single's working drafts as stored, by slot (`shared` for none). */
async function drafts(
  slug: string = SLUG
): Promise<Record<string, Record<string, unknown>>> {
  const rows = await current!.adapter.select<{
    locale: string | null;
    snapshot: unknown;
  }>("nextly_versions", {
    where: {
      and: [
        { column: "scopeKind", op: "=", value: "single" },
        { column: "scopeSlug", op: "=", value: slug },
        { column: "isAutosave", op: "=", value: false },
        { column: "versionNo", op: "IS NULL" },
        { column: "status", op: "=", value: "draft" },
      ],
    },
  });
  const bySlot: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    bySlot[row.locale ?? "shared"] =
      typeof row.snapshot === "string"
        ? (JSON.parse(row.snapshot) as Record<string, unknown>)
        : (row.snapshot as Record<string, unknown>);
  }
  return bySlot;
}

/** The Single published in English and Spanish with two slides, each caption translated. */
async function publishedInBoth(
  singles: SingleEntryService
): Promise<{ first: string; second: string }> {
  await save(singles, "en", {
    title: "en title",
    slides: [
      { caption: "first", rank: 1 },
      { caption: "second", rank: 2 },
    ],
    status: "published",
  });
  const [first, second] = (await read(singles, "en")).slides;
  await save(singles, "es", {
    title: "es title",
    slides: [
      { id: first!.id, caption: "primero", rank: 1 },
      { id: second!.id, caption: "segundo", rank: 2 },
    ],
    status: "published",
  });
  return { first: first!.id, second: second!.id };
}

/** The deck published in English and Spanish with two cards, each label translated. */
async function deckInBoth(
  singles: SingleEntryService
): Promise<{ first: string; second: string }> {
  await save(
    singles,
    "en",
    {
      title: "en deck",
      cards: [
        { label: "first", weight: 1 },
        { label: "second", weight: 2 },
      ],
      status: "published",
    },
    DECK
  );
  const [first, second] = (await read(singles, "en", false, DECK)).cards;
  await save(
    singles,
    "es",
    {
      title: "es deck",
      cards: [
        { id: first!.id, label: "primero", weight: 1 },
        { id: second!.id, label: "segundo", weight: 2 },
      ],
      status: "published",
    },
    DECK
  );
  return { first: first!.id, second: second!.id };
}

describe.each(getConfiguredTestDialects())(
  "a repeater's structure is drafted in the shared part, its text per language (integration, %s)",
  dialect => {
    it(
      "holds a translation inside a row in that language's draft only, keyed by the row's id",
      async () => {
        const singles = await boot(dialect);
        const { first, second } = await publishedInBoth(singles);

        await save(singles, "es", {
          slides: [
            { id: first, caption: "primero 2", rank: 1 },
            { id: second, caption: "segundo", rank: 2 },
          ],
        });

        const stored = await drafts();
        expect(Object.keys(stored)).toEqual(["es"]);
        // The language's draft holds the text by row id, and no shared value.
        expect(stored.es.slides).toMatchObject({
          [first]: { caption: "primero 2" },
        });
        expect(JSON.stringify(stored.es.slides)).not.toMatch(/rank/);
        expect(captions((await read(singles, "es", true)).slides)).toEqual([
          "primero 2",
          "segundo",
        ]);
        const english = await read(singles, "en", true);
        expect(captions(english.slides)).toEqual(["first", "second"]);
        expect(english._sharedChangesPending).toBe(false);
        // Nothing published moved.
        expect(captions((await read(singles, "es")).slides)).toEqual([
          "primero",
          "segundo",
        ]);
      },
      BOOT_TIMEOUT
    );

    it(
      "holds a reorder made in one language in the shared draft, without that language's text",
      async () => {
        const singles = await boot(dialect);
        const { first, second } = await publishedInBoth(singles);

        await save(singles, "es", {
          slides: [
            { id: second, caption: "segundo", rank: 2 },
            { id: first, caption: "primero", rank: 1 },
          ],
        });

        const stored = await drafts();
        expect(Object.keys(stored)).toEqual(["shared"]);
        expect(stored.shared.slides).toEqual([
          { id: second, rank: 2 },
          { id: first, rank: 1 },
        ]);
        // Every language's editor sees the new order, each row in its own language's text.
        const english = await read(singles, "en", true);
        expect(captions(english.slides)).toEqual(["second", "first"]);
        expect(english._sharedChangesPending).toBe(true);
        expect(captions((await read(singles, "es", true)).slides)).toEqual([
          "segundo",
          "primero",
        ]);
      },
      BOOT_TIMEOUT
    );

    it(
      "puts only the publishing language's text live, and keeps the other language's pending",
      async () => {
        const singles = await boot(dialect);
        const { first, second } = await publishedInBoth(singles);
        await save(singles, "en", {
          slides: [
            { id: first, caption: "first 2", rank: 1 },
            { id: second, caption: "second", rank: 2 },
          ],
        });
        await save(singles, "es", {
          slides: [
            { id: first, caption: "primero 2", rank: 1 },
            { id: second, caption: "segundo", rank: 2 },
          ],
        });

        await save(singles, "es", { status: "published" });

        expect(captions((await read(singles, "es")).slides)).toEqual([
          "primero 2",
          "segundo",
        ]);
        expect(captions((await read(singles, "en")).slides)).toEqual([
          "first",
          "second",
        ]);
        expect(Object.keys(await drafts())).toEqual(["en"]);
        expect(captions((await read(singles, "en", true)).slides)).toEqual([
          "first 2",
          "second",
        ]);
      },
      BOOT_TIMEOUT
    );

    it(
      "puts a structure change live for every language with one language's publish, and keeps another language's held text",
      async () => {
        const singles = await boot(dialect);
        const { first, second } = await publishedInBoth(singles);
        await save(singles, "en", {
          slides: [
            { id: first, caption: "first 2", rank: 1 },
            { id: second, caption: "second", rank: 2 },
          ],
        });
        await save(singles, "es", {
          slides: [
            { id: second, caption: "segundo", rank: 20 },
            { id: first, caption: "primero", rank: 1 },
          ],
        });

        await save(singles, "es", { status: "published" });

        const english = await read(singles, "en");
        expect(english.slides.map(({ id, rank }) => [id, rank])).toEqual([
          [second, 20],
          [first, 1],
        ]);
        // English's own text stayed as published; its held edit is still pending, on the new order.
        expect(captions(english.slides)).toEqual(["second", "first"]);
        expect(Object.keys(await drafts())).toEqual(["en"]);
        expect(captions((await read(singles, "en", true)).slides)).toEqual([
          "second",
          "first 2",
        ]);
      },
      BOOT_TIMEOUT
    );

    it(
      "holds a translation inside a component's instance in that language's draft only, by instance id",
      async () => {
        const singles = await boot(dialect);
        const { first, second } = await deckInBoth(singles);

        await save(
          singles,
          "es",
          {
            cards: [
              { id: first, label: "primero 2", weight: 1 },
              { id: second, label: "segundo", weight: 2 },
            ],
          },
          DECK
        );

        const stored = await drafts(DECK);
        expect(Object.keys(stored)).toEqual(["es"]);
        expect(stored.es.cards).toMatchObject({
          [first]: { label: "primero 2" },
        });
        expect(JSON.stringify(stored.es.cards)).not.toMatch(/weight/);
        expect(labels((await read(singles, "es", true, DECK)).cards)).toEqual([
          "primero 2",
          "segundo",
        ]);
        const english = await read(singles, "en", true, DECK);
        expect(labels(english.cards)).toEqual(["first", "second"]);
        expect(english._sharedChangesPending).toBe(false);
      },
      BOOT_TIMEOUT
    );

    it(
      "holds a reorder of a component's instances in the shared draft, without any language's text",
      async () => {
        const singles = await boot(dialect);
        const { first, second } = await deckInBoth(singles);

        await save(
          singles,
          "es",
          {
            cards: [
              { id: second, label: "segundo", weight: 2 },
              { id: first, label: "primero", weight: 1 },
            ],
          },
          DECK
        );

        const stored = await drafts(DECK);
        expect(Object.keys(stored)).toEqual(["shared"]);
        expect(JSON.stringify(stored.shared.cards)).not.toMatch(
          /segundo|primero/
        );
        const english = await read(singles, "en", true, DECK);
        expect(labels(english.cards)).toEqual(["second", "first"]);
        expect(english._sharedChangesPending).toBe(true);
      },
      BOOT_TIMEOUT
    );

    it(
      "puts a component reorder held in one language live with another language's publish, and only the publishing language's text",
      async () => {
        const singles = await boot(dialect);
        const { first, second } = await deckInBoth(singles);
        // English holds a reorder and a label of its own.
        await save(
          singles,
          "en",
          {
            cards: [
              { id: second, label: "second", weight: 2 },
              { id: first, label: "first 2", weight: 1 },
            ],
          },
          DECK
        );
        // Spanish holds an edit of its own title alone, and publishes.
        await save(singles, "es", { title: "es deck 2" }, DECK);

        await save(singles, "es", { status: "published" }, DECK);

        // The reorder is a shared change: Spanish's publish put it live for every language, each
        // card keeping its Spanish label.
        expect(labels((await read(singles, "es", false, DECK)).cards)).toEqual([
          "segundo",
          "primero",
        ]);
        // English's own label edit is not Spanish's to publish.
        expect(labels((await read(singles, "en", false, DECK)).cards)).toEqual([
          "second",
          "first",
        ]);
        expect(Object.keys(await drafts(DECK))).toEqual(["en"]);
        expect(labels((await read(singles, "en", true, DECK)).cards)).toEqual([
          "second",
          "first 2",
        ]);
      },
      BOOT_TIMEOUT
    );

    it(
      "holds a reorder of a collection entry's component instances in the shared draft",
      async () => {
        await boot(dialect);
        const nextly = current!.nextly;
        const created = await nextly.create({
          collection: DECKS,
          locale: "en",
          data: {
            title: "en deck",
            cards: [
              { label: "first", weight: 1 },
              { label: "second", weight: 2 },
            ],
            status: "published",
          },
        });
        const id = (created.item as { id: string }).id;
        // Read as the editor reads it, through the entry service.
        const entries = (
          current!.getService("collectionsHandler") as CollectionsHandler
        ).getEntryService();
        const cardsIn = async (locale: string, editor = false) => {
          const read = await entries.getEntry({
            collectionName: DECKS,
            entryId: id,
            overrideAccess: true,
            locale,
            ...(editor
              ? { includeWorkingDraft: true, status: "all" as const }
              : {}),
          });
          expect(read.success, JSON.stringify(read)).toBe(true);
          return (read.data as { cards: Card[] }).cards;
        };
        const [first, second] = await cardsIn("en");
        await nextly.update({
          collection: DECKS,
          id,
          locale: "es",
          data: {
            cards: [
              { id: first!.id, label: "primero", weight: 1 },
              { id: second!.id, label: "segundo", weight: 2 },
            ],
            status: "published",
            _overwrite: true,
          },
        });

        // Held in Spanish: a reorder, its captions unchanged.
        await nextly.update({
          collection: DECKS,
          id,
          locale: "es",
          data: {
            cards: [
              { id: second!.id, label: "segundo", weight: 2 },
              { id: first!.id, label: "primero", weight: 1 },
            ],
            _overwrite: true,
          },
        });

        const rows = await current!.adapter.select<{
          locale: string | null;
          snapshot: unknown;
        }>("nextly_versions", {
          where: {
            and: [
              { column: "scopeSlug", op: "=", value: DECKS },
              { column: "entryId", op: "=", value: id },
              { column: "isAutosave", op: "=", value: false },
              { column: "versionNo", op: "IS NULL" },
              { column: "status", op: "=", value: "draft" },
            ],
          },
        });
        expect(rows.map(row => row.locale ?? "shared")).toEqual(["shared"]);
        expect(JSON.stringify(rows[0]!.snapshot)).not.toMatch(
          /segundo|primero/
        );
        // English's editor sees the held order, each card in English.
        expect(labels(await cardsIn("en", true))).toEqual(["second", "first"]);
      },
      BOOT_TIMEOUT
    );

    it(
      "publishes one language's text inside a row alone, leaving a held reorder pending",
      async () => {
        await boot(dialect);
        const nextly = current!.nextly;
        const created = await nextly.create({
          collection: SHOWS,
          locale: "en",
          data: {
            title: "Show",
            slides: [
              { caption: "first", rank: 1 },
              { caption: "second", rank: 2 },
            ],
            status: "published",
          },
        });
        const id = (created.item as { id: string }).id;
        const slidesIn = async (locale: string) =>
          (
            (await nextly.findByID({ collection: SHOWS, id, locale })) as {
              slides: Slide[];
            }
          ).slides;
        const [first, second] = await slidesIn("en");
        await nextly.update({
          collection: SHOWS,
          id,
          locale: "es",
          data: {
            slides: [
              { id: first!.id, caption: "primero", rank: 1 },
              { id: second!.id, caption: "segundo", rank: 2 },
            ],
            status: "published",
            _overwrite: true,
          },
        });
        // English holds a reorder: the shared part's.
        await nextly.update({
          collection: SHOWS,
          id,
          locale: "en",
          data: {
            slides: [
              { id: second!.id, caption: "second", rank: 2 },
              { id: first!.id, caption: "first", rank: 1 },
            ],
            _overwrite: true,
          },
        });
        // Spanish holds a caption of its own: its part's.
        await nextly.update({
          collection: SHOWS,
          id,
          locale: "es",
          data: {
            slides: [
              { id: second!.id, caption: "segundo", rank: 2 },
              { id: first!.id, caption: "primero 2", rank: 1 },
            ],
            _overwrite: true,
          },
        });

        // Spanish alone, not the shared part.
        await nextly.publish({
          collection: SHOWS,
          id,
          locales: ["es"],
          data: { _overwrite: true },
        });

        // Spanish's text is live, on the order that was live: the held reorder is not Spanish's.
        expect(captions(await slidesIn("es"))).toEqual([
          "primero 2",
          "segundo",
        ]);
        expect(captions(await slidesIn("en"))).toEqual(["first", "second"]);
      },
      BOOT_TIMEOUT
    );
  }
);

// A group's text on a type that is not translated, on a site with no languages, as the SEO
// plugin's `seo` group is on a page: one structure, its text the default language's. A change
// held as the working draft and then published with the same change puts it live, never losing
// the text the page had or the change.
describe.each(getConfiguredTestDialects())(
  "a group's text held and then published on an untranslated type (integration, %s)",
  dialect => {
    it(
      "publishes the held text of a group, and keeps the live text while it is held",
      async () => {
        current = await createTestNextly({
          dialect,
          collections: [
            defineCollection({
              slug: "heldpages",
              status: true,
              versions: { drafts: true },
              access: { read: () => true, update: () => true },
              fields: [
                text({ name: "title" }),
                group({
                  name: "seo",
                  fields: [text({ name: "metaTitle", localized: true })],
                }),
              ],
            }),
          ],
        });
        const nextly = current.nextly;
        const created = await nextly.create({
          collection: "heldpages",
          data: {
            title: "About",
            status: "published",
            seo: { metaTitle: "About Acme" },
          },
        });
        const id = (created.item as { id: string }).id;
        const live = async () =>
          (
            (await nextly.findByID({ collection: "heldpages", id })) as {
              seo?: { metaTitle?: string | null };
            }
          ).seo?.metaTitle;
        expect(await live()).toBe("About Acme");

        // Held as the working draft: the live text stays.
        await nextly.update({
          collection: "heldpages",
          id,
          data: {
            seo: { metaTitle: "About Acme, rewritten" },
            _overwrite: true,
          },
        });
        expect(await live()).toBe("About Acme");

        // Published with the same change: the change is live.
        await nextly.update({
          collection: "heldpages",
          id,
          data: {
            seo: { metaTitle: "About Acme, rewritten" },
            status: "published",
            _overwrite: true,
          },
        });
        expect(await live()).toBe("About Acme, rewritten");
      },
      BOOT_TIMEOUT
    );
  }
);
