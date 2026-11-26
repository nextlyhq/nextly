/**
 * A required repeater keeping one structure on a translated entity is still required.
 *
 * Its main column is nullable (`buildDesiredTableFromFields`), as a translated field's is, so a
 * migration never waits on rows that get their structure later. What makes it required is the
 * save: a collection entry created without it, or a collection entry or a Single updated to
 * clear it, is refused, naming the field, and nothing is stored. A write holding rows goes ahead.
 */
import { afterEach, describe, expect, it } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { NextlyError } from "../../../errors";
import {
  defineCollection,
  defineSingle,
  number,
  repeater,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";

perLanguageStorageSuite();

const slides = () =>
  repeater({
    name: "slides",
    required: true,
    fields: [text({ name: "caption" }), number({ name: "rank" })],
  });

let t: TestNextly | undefined;
afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a required repeater keeping one structure (%s)",
  dialect => {
    async function boot(): Promise<TestNextly> {
      t = await createTestNextly({
        dialect,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "rq-shows",
            localized: true,
            fields: [text({ name: "title" }), slides()],
          }),
        ],
        singles: [
          defineSingle({
            slug: "rq-home",
            localized: true,
            fields: [text({ name: "title" }), slides()],
          }),
        ],
      });
      return t;
    }

    /** Whatever a refused write throws or answers, as one text naming why. */
    async function refusal(write: () => Promise<unknown>): Promise<string> {
      try {
        const result = (await write()) as { success?: boolean } | undefined;
        if (result && result.success === false) return JSON.stringify(result);
        return "";
      } catch (error) {
        return NextlyError.is(error)
          ? `${error.publicMessage} ${JSON.stringify(error.publicData ?? null)}`
          : String(error);
      }
    }

    it("refuses a collection entry created or updated without rows, naming the field", async () => {
      const { nextly } = await boot();
      expect(
        await refusal(() =>
          nextly.create({
            collection: "rq-shows",
            locale: "en",
            data: { title: "A" },
          })
        )
      ).toMatch(/slides/);
      const created = await nextly.create({
        collection: "rq-shows",
        locale: "en",
        data: { title: "A", slides: [{ caption: "One", rank: 1 }] },
      });
      const id = (created.item as { id: string }).id;
      expect(
        await refusal(() =>
          nextly.update({
            collection: "rq-shows",
            id,
            locale: "en",
            data: { slides: null, _overwrite: true },
          })
        )
      ).toMatch(/slides/);
      const read = (await nextly.findByID({
        collection: "rq-shows",
        id,
        locale: "en",
      })) as { slides: { caption?: string }[] };
      expect(read.slides.map(slide => slide.caption)).toEqual(["One"]);
    });

    // A Single's row stands from the start, so each save is an update: one leaving the repeater
    // out leaves it as it is, and one clearing it is refused.
    it("refuses a Single's save clearing the repeater, naming the field", async () => {
      const { nextly } = await boot();
      const save = (data: Record<string, unknown>) =>
        nextly.updateSingle({
          slug: "rq-home",
          locale: "en",
          data: { ...data, _overwrite: true },
        });
      await save({ title: "Home", slides: [{ caption: "One", rank: 1 }] });
      expect(await refusal(() => save({ slides: null }))).toMatch(/slides/);
      const read = (await nextly.findSingle({
        slug: "rq-home",
        locale: "en",
      })) as {
        slides: { caption?: string }[];
      };
      expect(read.slides.map(slide => slide.caption)).toEqual(["One"]);
    });
  }
);
