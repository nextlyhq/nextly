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
  defineSingle,
  group,
  number,
  repeater,
  text,
} from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

const LANGUAGES = { locales: ["en", "es"], defaultLocale: "en" };

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
  });

  async function site(): Promise<TestNextly> {
    t = await createTestNextly({
      dialect,
      collections: [ARTICLES],
      singles: [NOTICE],
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

  it("translates each text inside a row and a group on its own, sharing the rest", async () => {
    const { nextly } = await site();
    const { id } = await translatedArticle(nextly);

    const en = await read(nextly, id, "en");
    const es = await read(nextly, id, "es");
    expect(en.slides.map(slide => slide.caption)).toEqual(["first", "second"]);
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
  });

  it("applies a reorder, an added row and a removed row to every language, each row keeping its own translations", async () => {
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
    expect(en.slides.map(slide => slide.caption)).toEqual(["second", "third"]);
    // Spanish has the same rows in the same order: its translation stayed with its row, and the
    // row it never translated reads in the default language.
    expect(es.slides.map(slide => slide.caption)).toEqual(["segundo", "third"]);
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
  });

  it("applies a reorder made in another language to every language", async () => {
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
  });

  it("keeps one structure for a Single's repeater, each row keeping its own translations", async () => {
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
  });
});
