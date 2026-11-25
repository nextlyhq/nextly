/**
 * A repeater placing a component in each row is split and put back by the component's fields as
 * the registry holds them now, so a later change to the component's definition reads gracefully:
 * the stored translation of a field the component no longer has is never read back, and a field
 * added since falls back through the chain as any value no language holds does. A component with
 * no translatable field leaves its container with nothing per language, and is no error.
 *
 * The plausible broken implementations: a shape fixed when the container's table was built, which
 * reads a removed field's old translation back or never reads a new field's; and a container
 * whose component has no text refused, or failing its write, for having nothing to translate.
 */
import { afterEach, expect, it, vi } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  number,
  repeater,
  text,
} from "../../../config";
import { clearServices } from "../../../di/register";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetPerLanguageStorage } from "../per-language-storage";

import {
  openUpgradeDatabase,
  type UpgradeDatabase,
} from "./helpers/localisation-upgrade-fixture";

// Written for per-language storage, as every installation now runs it.
perLanguageStorageSuite();

const LANGUAGES = { locales: ["en", "es"], defaultLocale: "en" };
const BOOT_TIMEOUT = 90_000;

/** A collection whose repeater places the `notecard` component in each row. */
const BOARDS = defineCollection({
  slug: "boards",
  fields: [
    text({ name: "title" }),
    repeater({
      name: "notes",
      fields: [
        number({ name: "position" }),
        fieldGroup({ name: "card", component: "notecard" }),
      ],
    }),
  ],
});

/** The component as first defined: a label and an aside, both translatable. */
const CARD_BEFORE = defineFieldGroup({
  slug: "notecard",
  fields: [text({ name: "label" }), text({ name: "aside" })],
});

/** The component changed: the aside gone, a summary added. */
const CARD_AFTER = defineFieldGroup({
  slug: "notecard",
  fields: [text({ name: "label" }), text({ name: "summary" })],
});

/** A component holding no translatable field. */
const COUNTER = defineFieldGroup({
  slug: "tallycard",
  fields: [number({ name: "amount" })],
});

const TALLIES = defineCollection({
  slug: "tallies",
  fields: [
    text({ name: "title" }),
    repeater({
      name: "lines",
      fields: [fieldGroup({ name: "tally", component: "tallycard" })],
    }),
  ],
});

type Card = { label?: unknown; aside?: unknown; summary?: unknown };
type Note = { id: string; position?: number; card?: Card | null };

describeEachDialect(
  "a component's later change, read inside a container",
  dialect => {
    let database: UpgradeDatabase | undefined;
    let t: TestNextly | undefined;

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
      await database?.close();
      database = undefined;
      _resetPerLanguageStorage();
      vi.unstubAllEnvs();
    }, BOOT_TIMEOUT);

    /**
     * Boot the site on the one database, with `card` as the component's definition. A second boot
     * takes over from the first as a restarted site does, on the same connection, which only the
     * test's end closes.
     */
    async function boot(card: ReturnType<typeof defineFieldGroup>) {
      clearServices();
      t = await createTestNextly({
        adapter: database!.adapter as never,
        collections: [BOARDS, TALLIES],
        fieldGroups: [card, COUNTER],
        localization: LANGUAGES,
      });
      return t.nextly;
    }

    const notesIn = async (
      nextly: TestNextly["nextly"],
      id: string,
      locale: string
    ) =>
      (
        (await nextly.findByID({ collection: "boards", id, locale })) as {
          notes: Note[];
        }
      ).notes;

    it(
      "never reads back a removed field's translation, and lets an added field fall back",
      async () => {
        database = await openUpgradeDatabase(dialect);
        let nextly = await boot(CARD_BEFORE);
        const created = await nextly.create({
          collection: "boards",
          locale: "en",
          data: {
            title: "Board",
            notes: [
              { position: 1, card: { label: "one", aside: "by the way" } },
            ],
          },
        });
        const id = (created.item as { id: string }).id;
        const [note] = await notesIn(nextly, id, "en");
        await nextly.update({
          collection: "boards",
          id,
          locale: "es",
          data: {
            notes: [
              {
                id: note!.id,
                position: 1,
                card: { label: "uno", aside: "por cierto" },
              },
            ],
            _overwrite: true,
          },
        });
        // The control: both texts are Spanish's own before the change.
        expect((await notesIn(nextly, id, "es"))[0]!.card).toMatchObject({
          label: "uno",
          aside: "por cierto",
        });

        nextly = await boot(CARD_AFTER);

        const [es] = await notesIn(nextly, id, "es");
        expect(es!.card?.label).toBe("uno");
        // The removed field's translation is not read back.
        expect(JSON.stringify(es)).not.toMatch(/por cierto/);
        // The added field: no language holds it.
        expect(es!.card?.summary ?? null).toBeNull();

        // Written again in Spanish, the added field is Spanish's own and English keeps its label.
        await nextly.update({
          collection: "boards",
          id,
          locale: "es",
          data: {
            notes: [
              {
                id: note!.id,
                position: 1,
                card: { label: "uno", summary: "resumen" },
              },
            ],
            _overwrite: true,
          },
        });
        expect((await notesIn(nextly, id, "es"))[0]!.card).toMatchObject({
          label: "uno",
          summary: "resumen",
        });
        expect((await notesIn(nextly, id, "en"))[0]!.card?.label).toBe("one");
      },
      BOOT_TIMEOUT
    );

    it(
      "keeps a container whose component has no text the same in every language, without error",
      async () => {
        database = await openUpgradeDatabase(dialect);
        const nextly = await boot(CARD_BEFORE);
        const created = await nextly.create({
          collection: "tallies",
          locale: "en",
          data: { title: "Tally", lines: [{ tally: { amount: 3 } }] },
        });
        const id = (created.item as { id: string }).id;
        const linesIn = async (locale: string) =>
          (
            (await nextly.findByID({ collection: "tallies", id, locale })) as {
              lines: { id: string; tally?: { amount?: number } | null }[];
            }
          ).lines;
        const [line] = await linesIn("en");
        await nextly.update({
          collection: "tallies",
          id,
          locale: "es",
          data: {
            lines: [{ id: line!.id, tally: { amount: 7 } }],
            _overwrite: true,
          },
        });

        // A shared value: Spanish's write changed it for every language.
        expect((await linesIn("en"))[0]!.tally?.amount).toBe(7);
        expect((await linesIn("es"))[0]!.tally?.amount).toBe(7);
      },
      BOOT_TIMEOUT
    );
  }
);
