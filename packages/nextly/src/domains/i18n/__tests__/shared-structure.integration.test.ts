/**
 * A repeater and a group keep one structure in every language: rows, their order and their
 * shared values are the same everywhere, and each translatable field inside a row is translated
 * on its own, kept with its row by the row's id, so reordering, adding or removing rows in one
 * language applies to every language and no translation moves to another row.
 *
 * The plausible broken implementations: a repeater stored whole, so a write in one language
 * replaces every language's rows and text (the layout before shared structure); translations
 * matched by position, so a reorder hands one row's text to another (the repeater-shift loss);
 * the structure written only for the language that saved; a fallback that takes a whole row (or a
 * whole group) from another language instead of one field; and a removed row's translation kept,
 * so a row given that id again reads it back.
 */
import { afterEach, expect, it } from "vitest";

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
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { archiveFieldsLeavingTranslation } from "../migration/archive-preflight";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Written for per-language storage, as every installation now runs it.
perLanguageStorageSuite();

const LANGUAGES = { locales: ["en", "es"], defaultLocale: "en" };

/**
 * Each test boots its own site, which on MySQL alone takes most of the default 30 seconds on a
 * loaded machine, as the other suites booting one per test allow for.
 */
const BOOT_TIMEOUT = 90_000;

/** A collection whose repeater and group hold translatable texts and a shared number each. */
const ARTICLES = defineCollection({
  slug: "articles",
  fields: [
    text({ name: "title" }),
    repeater({
      name: "slides",
      fields: [
        text({ name: "caption" }),
        text({ name: "alt" }),
        number({ name: "rank" }),
      ],
    }),
    group({
      name: "seo",
      fields: [text({ name: "headline" }), number({ name: "weight" })],
    }),
    // A repeater inside a repeater: each level's rows keep their translations by their own ids.
    repeater({
      name: "sections",
      fields: [
        text({ name: "heading" }),
        repeater({
          name: "items",
          fields: [text({ name: "label" }), number({ name: "qty" })],
        }),
      ],
    }),
  ],
});

/** A component, placed inside each row of a repeater. */
const PANEL_CARD = defineFieldGroup({
  slug: "panelcard",
  fields: [text({ name: "label" }), number({ name: "size" })],
});

/** A collection whose repeater holds a component in each row. */
const GALLERIES = defineCollection({
  slug: "galleries",
  fields: [
    text({ name: "title" }),
    repeater({
      name: "panels",
      fields: [
        number({ name: "position" }),
        fieldGroup({ name: "card", component: "panelcard" }),
      ],
    }),
  ],
});

/** A Single whose repeater holds a list of component instances in each row. */
const BOARD = defineSingle({
  slug: "boardsite",
  fields: [
    text({ name: "heading" }),
    repeater({
      name: "panels",
      fields: [
        number({ name: "position" }),
        fieldGroup({ name: "cards", component: "panelcard", repeatable: true }),
      ],
    }),
  ],
});

/** A Single holding the same kind of repeater, written through the Single's own path. */
const NOTICE = defineSingle({
  slug: "notice",
  fields: [
    text({ name: "heading" }),
    repeater({
      name: "slides",
      fields: [text({ name: "caption" }), number({ name: "rank" })],
    }),
  ],
});

interface Slide {
  id: string;
  caption?: string | null;
  alt?: string | null;
  rank?: number | null;
}

describeEachDialect("one structure across languages", dialect => {
  let t: TestNextly | undefined;

  afterEach(async () => {
    await t?.destroy();
    t = undefined;
  }, BOOT_TIMEOUT);

  async function site(): Promise<TestNextly> {
    t = await createTestNextly({
      dialect,
      collections: [ARTICLES, GALLERIES],
      singles: [NOTICE, BOARD],
      fieldGroups: [PANEL_CARD],
      localization: LANGUAGES,
    });
    return t;
  }

  /** The article as one language reads it. */
  async function read(
    nextly: TestNextly["nextly"],
    id: string,
    locale: string
  ): Promise<{ slides: Slide[]; seo: { headline?: string; weight?: number } }> {
    return (await nextly.findByID({
      collection: "articles",
      id,
      locale,
    })) as never;
  }

  /** Writes the slides and seo in one language. */
  async function write(
    nextly: TestNextly["nextly"],
    id: string,
    locale: string,
    data: Record<string, unknown>
  ): Promise<void> {
    await nextly.update({
      collection: "articles",
      id,
      locale,
      data: { ...data, _overwrite: true },
    });
  }

  /**
   * An article with two slides, written in English and then translated into Spanish: each
   * slide's caption is translated and its alt text is not, so it reads in English.
   */
  async function translatedArticle(nextly: TestNextly["nextly"]) {
    const created = await nextly.create({
      collection: "articles",
      locale: "en",
      data: {
        title: "Hello",
        slides: [
          { caption: "first", alt: "a1", rank: 1 },
          { caption: "second", alt: "a2", rank: 2 },
        ],
        seo: { headline: "Read me", weight: 5 },
      },
    });
    const id = (created.item as { id: string }).id;
    const [first, second] = (await read(nextly, id, "en")).slides;
    await write(nextly, id, "es", {
      slides: [
        { id: first!.id, caption: "primero", rank: 1 },
        { id: second!.id, caption: "segundo", rank: 2 },
      ],
      seo: { headline: "Léeme", weight: 5 },
    });
    return { id, first: first!.id, second: second!.id };
  }

  it(
    "translates each text inside a row and a group on its own, sharing the rest",
    async () => {
      const { nextly } = await site();
      const { id } = await translatedArticle(nextly);

      const en = await read(nextly, id, "en");
      const es = await read(nextly, id, "es");
      expect(en.slides.map(slide => slide.caption)).toEqual([
        "first",
        "second",
      ]);
      expect(es.slides.map(slide => slide.caption)).toEqual([
        "primero",
        "segundo",
      ]);
      // Each field falls back on its own: the untranslated alt text reads in English beside the
      // translated caption of the same row.
      expect(en.slides.map(slide => slide.alt)).toEqual(["a1", "a2"]);
      expect(es.slides.map(slide => slide.alt)).toEqual(["a1", "a2"]);
      expect(en.seo).toMatchObject({ headline: "Read me", weight: 5 });
      expect(es.seo).toMatchObject({ headline: "Léeme", weight: 5 });
      // One structure: the same rows, in the same order, with the same shared values.
      expect(es.slides.map(({ id: row, rank }) => [row, rank])).toEqual(
        en.slides.map(({ id: row, rank }) => [row, rank])
      );
    },
    BOOT_TIMEOUT
  );

  it(
    "applies a reorder, an added row and a removed row to every language, each row keeping its own translations",
    async () => {
      const { nextly } = await site();
      const { id, first, second } = await translatedArticle(nextly);

      // In English: the second slide first, a new third, and the first removed; a shared value
      // changed too, in a row and in the group.
      await write(nextly, id, "en", {
        slides: [
          { id: second, caption: "second", alt: "a2", rank: 20 },
          { caption: "third", alt: "a3", rank: 3 },
        ],
        seo: { headline: "Read me", weight: 9 },
      });

      const en = await read(nextly, id, "en");
      const es = await read(nextly, id, "es");
      expect(en.slides.map(slide => slide.caption)).toEqual([
        "second",
        "third",
      ]);
      // Spanish has the same rows in the same order: its translation stayed with its row, and the
      // row it never translated reads in the default language.
      expect(es.slides.map(slide => slide.caption)).toEqual([
        "segundo",
        "third",
      ]);
      expect(es.slides.map(({ id: row, rank }) => [row, rank])).toEqual(
        en.slides.map(({ id: row, rank }) => [row, rank])
      );
      expect(es.slides[0]).toMatchObject({ id: second, rank: 20 });
      // The removed row is gone in every language, its translation with it.
      expect(es.slides.map(slide => slide.id)).not.toContain(first);
      expect(JSON.stringify(es)).not.toMatch(/primero/);
      // The group's shared value changed for Spanish too, its translated headline kept.
      expect(es.seo).toMatchObject({ headline: "Léeme", weight: 9 });

      // The removed row's translation went with it: a row given its id again reads the English
      // text in Spanish rather than the old translation.
      await write(nextly, id, "en", {
        slides: [
          { id: second, caption: "second", alt: "a2", rank: 20 },
          { id: first, caption: "back", alt: "a1", rank: 1 },
        ],
      });
      expect(
        (await read(nextly, id, "es")).slides.map(slide => slide.caption)
      ).toEqual(["segundo", "back"]);
    },
    BOOT_TIMEOUT
  );

  it(
    "applies a reorder made in another language to every language",
    async () => {
      const { nextly } = await site();
      const { id, first, second } = await translatedArticle(nextly);

      await write(nextly, id, "es", {
        slides: [
          { id: second, caption: "segundo", rank: 2 },
          { id: first, caption: "primero", rank: 1 },
        ],
      });

      // English keeps its own text, alt text included, on the rows in Spanish's new order.
      expect(
        (await read(nextly, id, "en")).slides.map(slide => [
          slide.caption,
          slide.alt,
        ])
      ).toEqual([
        ["second", "a2"],
        ["first", "a1"],
      ]);
      expect(
        (await read(nextly, id, "en")).slides.map(slide => slide.caption)
      ).toEqual(["second", "first"]);
      expect(
        (await read(nextly, id, "es")).slides.map(slide => slide.caption)
      ).toEqual(["segundo", "primero"]);
    },
    BOOT_TIMEOUT
  );

  it(
    "keeps one structure for a Single's repeater, each row keeping its own translations",
    async () => {
      const { nextly } = await site();
      const slidesOf = async (locale: string) =>
        (
          (await nextly.findSingle({ slug: "notice", locale })) as {
            slides: Slide[];
          }
        ).slides;

      await nextly.updateSingle({
        slug: "notice",
        locale: "en",
        data: {
          slides: [
            { caption: "first", rank: 1 },
            { caption: "second", rank: 2 },
          ],
          _overwrite: true,
        },
      });
      const [first, second] = await slidesOf("en");
      await nextly.updateSingle({
        slug: "notice",
        locale: "es",
        data: {
          slides: [
            { id: first!.id, caption: "primero", rank: 1 },
            { id: second!.id, caption: "segundo", rank: 2 },
          ],
          _overwrite: true,
        },
      });
      expect((await slidesOf("en")).map(slide => slide.caption)).toEqual([
        "first",
        "second",
      ]);

      // Reordered in English with the first row removed: Spanish follows, its translation kept
      // by row id and the removed row's gone.
      await nextly.updateSingle({
        slug: "notice",
        locale: "en",
        data: {
          slides: [{ id: second!.id, caption: "second", rank: 20 }],
          _overwrite: true,
        },
      });
      expect(
        (await slidesOf("es")).map(({ id: row, caption, rank }) => [
          row,
          caption,
          rank,
        ])
      ).toEqual([[second!.id, "segundo", 20]]);

      // A row given the removed row's id again reads English in Spanish, not the old translation.
      await nextly.updateSingle({
        slug: "notice",
        locale: "en",
        data: {
          slides: [
            { id: second!.id, caption: "second", rank: 20 },
            { id: first!.id, caption: "back", rank: 1 },
          ],
          _overwrite: true,
        },
      });
      expect((await slidesOf("es")).map(slide => slide.caption)).toEqual([
        "segundo",
        "back",
      ]);
    },
    BOOT_TIMEOUT
  );

  it(
    "keeps each nested row's translation with it when the inner rows are reordered in another language",
    async () => {
      const { nextly } = await site();
      type Item = { id: string; label?: string; qty?: number };
      type Section = { id: string; heading?: string; items: Item[] };
      const sectionsIn = async (id: string, locale: string) =>
        (
          (await nextly.findByID({ collection: "articles", id, locale })) as {
            sections: Section[];
          }
        ).sections;
      const created = await nextly.create({
        collection: "articles",
        locale: "en",
        data: {
          title: "Nested",
          sections: [
            {
              heading: "Section",
              items: [
                { label: "apple", qty: 1 },
                { label: "bread", qty: 2 },
              ],
            },
          ],
        },
      });
      const id = (created.item as { id: string }).id;
      const [section] = await sectionsIn(id, "en");
      const [apple, bread] = section!.items;
      await write(nextly, id, "es", {
        sections: [
          {
            id: section!.id,
            heading: "Sección",
            items: [
              { id: apple!.id, label: "manzana", qty: 1 },
              { id: bread!.id, label: "pan", qty: 2 },
            ],
          },
        ],
      });

      // English reorders the inner rows and changes a shared value inside one.
      await write(nextly, id, "en", {
        sections: [
          {
            id: section!.id,
            heading: "Section",
            items: [
              { id: bread!.id, label: "bread", qty: 3 },
              { id: apple!.id, label: "apple", qty: 1 },
            ],
          },
        ],
      });

      const [es] = await sectionsIn(id, "es");
      expect(es!.heading).toBe("Sección");
      expect(es!.items.map(item => [item.id, item.label, item.qty])).toEqual([
        [bread!.id, "pan", 3],
        [apple!.id, "manzana", 1],
      ]);
      const [en] = await sectionsIn(id, "en");
      expect(en!.items.map(item => item.label)).toEqual(["bread", "apple"]);
    },
    BOOT_TIMEOUT
  );

  it(
    "keeps a component's translation inside each row with its row when the rows are reordered",
    async () => {
      const { nextly } = await site();
      type Panel = {
        id: string;
        position?: number;
        card?: { label?: string; size?: number } | null;
      };
      const panelsIn = async (id: string, locale: string) =>
        (
          (await nextly.findByID({ collection: "galleries", id, locale })) as {
            panels: Panel[];
          }
        ).panels;
      const created = await nextly.create({
        collection: "galleries",
        locale: "en",
        data: {
          title: "Gallery",
          panels: [
            { position: 1, card: { label: "one", size: 10 } },
            { position: 2, card: { label: "two", size: 20 } },
          ],
        },
      });
      const id = (created.item as { id: string }).id;
      const [first, second] = await panelsIn(id, "en");
      await nextly.update({
        collection: "galleries",
        id,
        locale: "es",
        data: {
          panels: [
            { id: first!.id, position: 1, card: { label: "uno", size: 10 } },
            { id: second!.id, position: 2, card: { label: "dos", size: 20 } },
          ],
          _overwrite: true,
        },
      });

      // English reorders the rows.
      await nextly.update({
        collection: "galleries",
        id,
        locale: "en",
        data: {
          panels: [
            { id: second!.id, position: 2, card: { label: "two", size: 20 } },
            { id: first!.id, position: 1, card: { label: "one", size: 10 } },
          ],
          _overwrite: true,
        },
      });

      // Each row's component keeps its own Spanish text, on the rows in their new order.
      expect(
        (await panelsIn(id, "es")).map(panel => [panel.id, panel.card?.label])
      ).toEqual([
        [second!.id, "dos"],
        [first!.id, "uno"],
      ]);
      expect(
        (await panelsIn(id, "en")).map(panel => panel.card?.label)
      ).toEqual(["two", "one"]);
    },
    BOOT_TIMEOUT
  );

  it(
    "gives every language's repeater and group, each assembled with that language's own text, in an every-language read",
    async () => {
      const { nextly } = await site();
      const { id, first, second } = await translatedArticle(nextly);

      const read = (await nextly.findByID({
        collection: "articles",
        id,
        locale: "en",
        translations: "all",
      } as never)) as {
        _allLocales?: Record<string, Record<string, unknown>>;
      };

      const slides = read._allLocales?.slides as
        | Record<string, Slide[] | null>
        | undefined;
      // Each language's rows, the one structure with its own text: never the text alone.
      expect(
        slides?.es?.map(({ id: row, caption, rank }) => [row, caption, rank])
      ).toEqual([
        [first, "primero", 1],
        [second, "segundo", 2],
      ]);
      expect(slides?.en?.map(slide => slide.caption)).toEqual([
        "first",
        "second",
      ]);
      expect(read._allLocales?.seo).toMatchObject({
        en: { headline: "Read me", weight: 5 },
        es: { headline: "Léeme", weight: 5 },
      });
    },
    BOOT_TIMEOUT
  );

  it(
    "drops a removed component instance's text inside a Single's row in every language, so an instance given its id again reads afresh",
    async () => {
      const { nextly } = await site();
      type Card = { id: string; label?: string };
      type Panel = { id: string; cards?: Card[] };
      const panelsIn = async (locale: string) =>
        (
          (await nextly.findSingle({ slug: "boardsite", locale })) as {
            panels: Panel[];
          }
        ).panels;
      const write = (locale: string, panels: unknown[]) =>
        nextly.updateSingle({
          slug: "boardsite",
          locale,
          data: { panels, _overwrite: true },
        });

      await write("en", [
        {
          position: 1,
          cards: [
            { label: "one", size: 1 },
            { label: "two", size: 2 },
          ],
        },
      ]);
      const [panel] = await panelsIn("en");
      const [one, two] = panel!.cards!;
      await write("es", [
        {
          id: panel!.id,
          position: 1,
          cards: [
            { id: one!.id, label: "uno", size: 1 },
            { id: two!.id, label: "dos", size: 2 },
          ],
        },
      ]);
      // The control: Spanish's own text before the removal.
      expect((await panelsIn("es"))[0]!.cards!.map(c => c.label)).toEqual([
        "uno",
        "dos",
      ]);

      // English removes the second instance inside the row, then gives an instance its id again.
      await write("en", [
        {
          id: panel!.id,
          position: 1,
          cards: [{ id: one!.id, label: "one", size: 1 }],
        },
      ]);
      await write("en", [
        {
          id: panel!.id,
          position: 1,
          cards: [
            { id: one!.id, label: "one", size: 1 },
            { id: two!.id, label: "back", size: 2 },
          ],
        },
      ]);

      // The removed instance's Spanish text went with it: it reads English's.
      expect((await panelsIn("es"))[0]!.cards!.map(c => c.label)).toEqual([
        "uno",
        "back",
      ]);
    },
    BOOT_TIMEOUT
  );

  it(
    "stores no translation for a language whose text inside a container is all blank",
    async () => {
      const { nextly } = await site();
      const created = await nextly.create({
        collection: "articles",
        locale: "en",
        data: {
          title: "Hello",
          slides: [{ caption: "first", alt: "a1", rank: 1 }],
        },
      });
      const id = (created.item as { id: string }).id;
      const [slide] = (await read(nextly, id, "en")).slides;
      const overlayIn = async (locale: string) => {
        const rows = await t!.adapter.select<{ slides: unknown }>(
          "dc_articles_locales",
          {
            columns: ["slides"],
            where: {
              and: [
                { column: "_parent", op: "=", value: id },
                { column: "_locale", op: "=", value: locale },
              ],
            },
          }
        );
        return rows[0]?.slides ?? null;
      };

      // Spanish writes the rows with nothing translated in them.
      await write(nextly, id, "es", {
        title: "Hola",
        slides: [{ id: slide!.id, caption: "", alt: "", rank: 1 }],
      });

      // The control: English's text is stored.
      expect(await overlayIn("en")).not.toBeNull();
      // Spanish holds no translation inside the repeater, so none is stored, and it reads English's.
      expect(await overlayIn("es")).toBeNull();
      expect((await read(nextly, id, "es")).slides[0]?.caption).toBe("first");
    },
    BOOT_TIMEOUT
  );

  it(
    "keeps each component instance's translation with it when the instances inside a Single's row are reordered",
    async () => {
      const { nextly } = await site();
      type Card = { id: string; label?: string; size?: number };
      type Panel = { id: string; cards?: Card[] };
      const panelsIn = async (locale: string) =>
        (
          (await nextly.findSingle({ slug: "boardsite", locale })) as {
            panels: Panel[];
          }
        ).panels;
      const write = (locale: string, panels: unknown[]) =>
        nextly.updateSingle({
          slug: "boardsite",
          locale,
          data: { panels, _overwrite: true },
        });

      await write("en", [
        {
          position: 1,
          cards: [
            { label: "one", size: 1 },
            { label: "two", size: 2 },
          ],
        },
      ]);
      const [panel] = await panelsIn("en");
      const [one, two] = panel!.cards!;
      // Each instance has an id of its own, minted once.
      expect(one!.id).toEqual(expect.any(String));
      expect(two!.id).not.toBe(one!.id);
      await write("es", [
        {
          id: panel!.id,
          position: 1,
          cards: [
            { id: one!.id, label: "uno", size: 1 },
            { id: two!.id, label: "dos", size: 2 },
          ],
        },
      ]);

      // English reorders the instances, with a shared value changed.
      await write("en", [
        {
          id: panel!.id,
          position: 1,
          cards: [
            { id: two!.id, label: "two", size: 20 },
            { id: one!.id, label: "one", size: 1 },
          ],
        },
      ]);

      const [es] = await panelsIn("es");
      expect(es!.cards!.map(c => [c.id, c.label, c.size])).toEqual([
        [two!.id, "dos", 20],
        [one!.id, "uno", 1],
      ]);
      // The ids moved with the instances: none re-minted by the save.
      const [en] = await panelsIn("en");
      expect(en!.cards!.map(c => c.id)).toEqual([two!.id, one!.id]);
    },
    BOOT_TIMEOUT
  );

  // A language whose last translated row is removed holds no text there any more: stored as no
  // translation, as a write holding none is, so it never reads as translated.
  it(
    "stores no translation for a language whose last translated row a removal takes",
    async () => {
      const { nextly } = await site();
      const created = await nextly.create({
        collection: "articles",
        locale: "en",
        data: {
          title: "Hello",
          slides: [
            { caption: "first", rank: 1 },
            { caption: "second", rank: 2 },
          ],
        },
      });
      const id = (created.item as { id: string }).id;
      const [first, second] = (await read(nextly, id, "en")).slides;
      // Spanish translates the second row alone.
      await write(nextly, id, "es", {
        slides: [
          { id: first!.id, rank: 1 },
          { id: second!.id, caption: "segundo", rank: 2 },
        ],
      });
      const spanish = async () =>
        (
          await t!.adapter.select<{ _locale: string; slides: unknown }>(
            "dc_articles_locales",
            {
              where: {
                and: [
                  { column: "_parent", op: "=", value: id },
                  { column: "_locale", op: "=", value: "es" },
                ],
              },
            }
          )
        )[0]?.slides;
      // The control: Spanish holds the second row's text.
      expect(JSON.stringify(await spanish())).toContain("segundo");

      // English removes the second row: Spanish's text there goes with it, and nothing is left.
      await write(nextly, id, "en", {
        slides: [{ id: first!.id, caption: "first", rank: 1 }],
      });

      expect(await spanish()).toBeNull();
    },
    BOOT_TIMEOUT
  );

  // A create and an update answer with the document as a read of the language returns it: a
  // repeater as its rows, a group as its value, never the text alone the translation row keeps.
  it(
    "answers a create and an update with each container as its rows and value, in the language written",
    async () => {
      const { nextly } = await site();
      const created = await nextly.create({
        collection: "articles",
        locale: "en",
        data: {
          title: "Hello",
          slides: [{ caption: "first", rank: 1 }],
          seo: { headline: "Read me", weight: 5 },
        },
      });
      const item = created.item as {
        id: string;
        slides: Slide[];
        seo: { headline?: string; weight?: number };
      };
      expect(Array.isArray(item.slides)).toBe(true);
      expect(item.slides).toEqual([
        expect.objectContaining({ caption: "first", rank: 1 }),
      ]);
      expect(typeof item.slides[0]!.id).toBe("string");
      expect(item.seo).toMatchObject({ headline: "Read me", weight: 5 });

      const updated = await nextly.update({
        collection: "articles",
        id: item.id,
        locale: "es",
        data: {
          slides: [{ id: item.slides[0]!.id, caption: "primero", rank: 1 }],
          seo: { headline: "Léeme", weight: 5 },
          _overwrite: true,
        },
      });
      const es = updated.item as {
        slides: Slide[];
        seo: { headline?: string; weight?: number };
      };
      expect(es.slides).toEqual([
        expect.objectContaining({
          id: item.slides[0]!.id,
          caption: "primero",
          rank: 1,
        }),
      ]);
      expect(es.seo).toMatchObject({ headline: "Léeme", weight: 5 });
      // A list read says the same.
      const listed = await nextly.find({
        collection: "articles",
        locale: "es",
      });
      expect(
        (listed.items[0] as { slides: Slide[] }).slides.map(
          slide => slide.caption
        )
      ).toEqual(["primero"]);
    },
    BOOT_TIMEOUT
  );

  /** The paths of one document's live provenance records in `locale`, sorted. */
  async function livePaths(
    scope: { kind: string; slug: string; id: string },
    locale: string
  ): Promise<string[]> {
    const rows = await t!.adapter.select<{
      scopeKind: string;
      scopeSlug: string;
      entryId: string;
      locale: string;
      partState: string;
      fieldPath: string;
    }>("nextly_translation_provenance");
    return rows
      .filter(
        row =>
          row.scopeKind === scope.kind &&
          row.scopeSlug === scope.slug &&
          row.entryId === scope.id &&
          row.locale === locale &&
          row.partState === "live"
      )
      .map(row => row.fieldPath)
      .sort();
  }

  it(
    "forgets a removed row's record in every language, keeping the other rows'",
    async () => {
      const { nextly } = await site();
      const { id, first, second } = await translatedArticle(nextly);
      // Spanish copies the rows from English: each row's record names the row it copied.
      await write(nextly, id, "es", {
        slides: [
          { id: first, caption: "primero", rank: 1 },
          { id: second, caption: "segundo", rank: 2 },
        ],
        _provenance: { slides: { origin: "copy", sourceLocale: "en" } },
      });
      const scope = { kind: "collection", slug: "articles", id };
      // The control: Spanish records both rows.
      expect(await livePaths(scope, "es")).toEqual(
        expect.arrayContaining([`slides#${first}`, `slides#${second}`])
      );

      // English removes the second row: the one structure loses it in every language.
      await write(nextly, id, "en", {
        slides: [{ id: first, caption: "first", alt: "a1", rank: 1 }],
      });

      const paths = await livePaths(scope, "es");
      expect(paths).toContain(`slides#${first}`);
      expect(paths).not.toContain(`slides#${second}`);
    },
    BOOT_TIMEOUT
  );

  it(
    "forgets a row removed from a Single's structure in every language",
    async () => {
      const { nextly } = await site();
      const noticeIn = async (locale: string) =>
        (await nextly.findSingle({ slug: "notice", locale })) as {
          id: string;
          slides: { id: string }[];
        };
      const write = (locale: string, data: Record<string, unknown>) =>
        nextly.updateSingle({
          slug: "notice",
          locale,
          data: { ...data, _overwrite: true },
        });

      await write("en", {
        slides: [
          { caption: "first", rank: 1 },
          { caption: "second", rank: 2 },
        ],
      });
      const notice = await noticeIn("en");
      const [one, two] = notice.slides;
      await write("es", {
        slides: [
          { id: one!.id, caption: "primero", rank: 1 },
          { id: two!.id, caption: "segundo", rank: 2 },
        ],
        _provenance: { slides: { origin: "copy", sourceLocale: "en" } },
      });
      const scope = { kind: "single", slug: "notice", id: notice.id };
      expect(await livePaths(scope, "es")).toEqual(
        expect.arrayContaining([`slides#${one!.id}`, `slides#${two!.id}`])
      );

      await write("en", {
        slides: [{ id: one!.id, caption: "first", rank: 1 }],
      });

      const paths = await livePaths(scope, "es");
      expect(paths).toContain(`slides#${one!.id}`);
      expect(paths).not.toContain(`slides#${two!.id}`);
    },
    BOOT_TIMEOUT
  );

  // Translation stays on, and every text inside the repeater is made shared: the repeater no
  // longer keeps its text apart, so its overlay column would be dropped with every language's
  // text in it, while its structure was stored without that text. Refused before anything
  // changes, naming the repeater; each language keeps its own text.
  it(
    "refuses a schema change leaving a repeater with nothing translated inside, naming it, and keeps every language's text",
    async () => {
      const { nextly, adapter } = await site();
      const { id } = await translatedArticle(nextly);
      const shared = (ARTICLES.fields as { name: string }[]).map(field =>
        field.name === "slides"
          ? repeater({
              name: "slides",
              fields: [
                text({ name: "caption", localized: false }),
                text({ name: "alt", localized: false }),
                number({ name: "rank" }),
              ],
            })
          : field
      );

      const refusal = await archiveFieldsLeavingTranslation({
        adapter,
        entity: "articles",
        kind: "collection",
        tableName: "dc_articles",
        builtBy: "collection",
        defaultLocale: "en",
        oldFields: ARTICLES.fields as never,
        newFields: shared as never,
        wasLocalized: true,
        isLocalized: true,
      }).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refusal).toBeInstanceOf(Error);
      expect((refusal as { publicMessage?: string }).publicMessage).toMatch(
        /repeaters and groups "slides" keep their text per language/
      );
      expect(
        (await read(nextly, id, "es")).slides.map(slide => slide.caption)
      ).toEqual(["primero", "segundo"]);
    },
    BOOT_TIMEOUT
  );
});
