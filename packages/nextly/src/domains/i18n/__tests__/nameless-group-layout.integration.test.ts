/**
 * A group with no name is a layout wrapper: its fields are stored at the row it sits in, and it is
 * no container keeping translations inside, having no column of its own for an overlay. A
 * translated collection holding one saves and reads in every language as it did before
 * repeaters and groups kept one structure.
 *
 * The plausible broken version: the wrapper taken for a container whose text is kept per
 * language, so its translations column is asked for under no name and every save fails.
 */
import { afterEach, expect, it } from "vitest";

import { defineCollection, number, repeater, text } from "../../../config";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Written for per-language storage, as every installation now runs it.
perLanguageStorageSuite();

/** Booting a site takes most of the default timeout on MySQL alone. */
const BOOT_TIMEOUT = 90_000;

/**
 * Written as a plain object, as a site's own may be: `defineCollection` refuses a field with no
 * name, and a plain object holding one starts all the same, told of it.
 */
const LAYOUTS = {
  slug: "layouts",
  localized: true,
  fields: [
    text({ name: "title" }),
    {
      type: "group",
      fields: [
        text({ name: "subtitle" }),
        repeater({
          name: "slides",
          fields: [text({ name: "caption" }), number({ name: "rank" })],
        }),
      ],
    },
  ],
} as unknown as ReturnType<typeof defineCollection>;

describeEachDialect(
  "a translated collection with a nameless group",
  dialect => {
    let t: TestNextly | undefined;

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
    }, BOOT_TIMEOUT);

    it(
      "saves and reads the fields inside it in every language",
      async () => {
        t = await createTestNextly({
          dialect,
          collections: [LAYOUTS],
          localization: { locales: ["en", "es"], defaultLocale: "en" },
        });
        const created = await t.nextly.create({
          collection: "layouts",
          locale: "en",
          data: {
            title: "Layout",
            subtitle: "Below",
            slides: [{ caption: "first", rank: 1 }],
          },
        });
        const id = (created.item as { id: string }).id;
        await t.nextly.update({
          collection: "layouts",
          id,
          locale: "es",
          data: { title: "Diseño", _overwrite: true },
        });

        const read = async (locale: string) =>
          (await t!.nextly.findByID({ collection: "layouts", id, locale })) as {
            title?: string;
            subtitle?: string;
            slides?: { caption?: string; rank?: number }[];
          };
        const en = await read("en");
        const es = await read("es");
        expect(en.title).toBe("Layout");
        expect(es.title).toBe("Diseño");
        // Stored at the row, shared by every language, as before.
        for (const doc of [en, es]) {
          expect(doc.subtitle).toBe("Below");
          expect(doc.slides?.map(slide => [slide.caption, slide.rank])).toEqual(
            [["first", 1]]
          );
        }
      },
      BOOT_TIMEOUT
    );
  }
);
