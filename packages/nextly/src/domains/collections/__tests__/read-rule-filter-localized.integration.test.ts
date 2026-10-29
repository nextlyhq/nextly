/**
 * A read rule's filter on a localized field: compared as the field's
 * language table stores it, and judged in every language the read may show
 * the field from.
 *
 * Two properties separate a correct answer from a plausible broken one:
 * - A localized date compared with an ISO date matches by the instant it
 *   names. Bound as written, the text beside SQLite's integer timestamp
 *   compares as text, which every number sorts below, so `less_than` would
 *   admit every entry.
 * - A field the read shows from a fallback language is judged on that
 *   language's value too. Judged in the requested language alone, a rule
 *   admitting entries with no `secret` would admit one whose English secret
 *   the French read then shows.
 *
 * Each is read as a list, a count and by id, as a visitor, whose read is
 * judged by the collection's rule alone.
 *
 * @module domains/collections/__tests__/read-rule-filter-localized.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { grantPublic } from "../../../__tests__/helpers/public-role";
import {
  date,
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  relationship,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this file keeps its
// own collection slugs.
const EVENTS = "rulefilter_localized_events";
const NOTES = "rulefilter_localized_notes";
// A collection, a Single and a component that each point at a note, so each
// populates it through the note's rule.
const PINS = "rulefilter_localized_pins";
const BOARD = "rulefilter_localized_board";
const CARD = "rulefilter_localized_card";
const SHELVES = "rulefilter_localized_shelves";

/** A read rule answering `value`, which the rule type does not allow yet. */
const answering = (value: unknown) => () => value as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    // The cases read as a visitor, judged by the Public role a real boot
    // makes, which reads each target whose rule answers `true`.
    seedPublic: true,
    localization: { locales: ["en", "fr"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: EVENTS,
        localized: true,
        access: { read: answering({ due: { less_than: "2026-06-01" } }) },
        fields: [
          text({ name: "title" }),
          date({ name: "due", localized: true }),
        ],
      }),
      defineCollection({
        slug: NOTES,
        localized: true,
        access: { read: answering({ secret: { exists: false } }) },
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "secret", localized: true }),
        ],
      }),
      defineCollection({
        slug: PINS,
        access: { read: () => true },
        fields: [relationship({ name: "note", relationTo: NOTES })],
      }),
      defineCollection({
        slug: SHELVES,
        access: { read: () => true },
        fields: [fieldGroup({ name: "card", component: CARD })],
      }),
    ],
    fieldGroups: [
      defineFieldGroup({
        slug: CARD,
        fields: [relationship({ name: "note", relationTo: NOTES })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BOARD,
        access: { read: () => true },
        fields: [relationship({ name: "note", relationTo: NOTES })],
      }),
    ],
  });
  // Granted as a site admin would: these rules answer a filter, so boot
  // grants Public no read of them, and the filter decides what is shown.
  await grantPublic(current, [`read-${EVENTS}`, `read-${NOTES}`]);
  return current;
}

const idOf = (made: { item: unknown }) =>
  String((made.item as { id: string | number }).id);

const titles = (items: readonly unknown[]) =>
  items.map(item => (item as { title?: unknown }).title).sort();

/** A visitor's checked read. */
const asVisitor = { overrideAccess: false } as const;

/** What a visitor's read of `id` answers: the entry's title, or the refusal. */
async function byId(
  t: TestNextly,
  collection: string,
  id: string,
  language: { locale?: string; fallbackLocale?: string | false } = {}
): Promise<unknown> {
  try {
    const entry = await t.nextly.findByID({
      collection,
      id,
      ...language,
      ...asVisitor,
    });
    return entry === null ? null : (entry as { title?: unknown }).title;
  } catch (error) {
    const refused = error as { statusCode?: unknown; code?: unknown };
    return { statusCode: refused.statusCode, code: refused.code };
  }
}

describe("a read rule's filter on a localized date", () => {
  it("compares the date as the instant it names, in a list, a count and by id", async () => {
    const t = await boot();
    const early = await t.nextly.create({
      collection: EVENTS,
      data: { title: "early", due: "2026-01-15T00:00:00.000Z" },
    });
    const late = await t.nextly.create({
      collection: EVENTS,
      data: { title: "late", due: "2026-12-15T00:00:00.000Z" },
    });
    const gone = await t.nextly.create({
      collection: EVENTS,
      data: { title: "gone", due: "2026-01-15T00:00:00.000Z" },
    });
    await t.nextly.delete({ collection: EVENTS, id: idOf(gone) });

    const page = await t.nextly.find({ collection: EVENTS, ...asVisitor });
    expect(titles(page.items)).toEqual(["early"]);
    expect(
      (await t.nextly.count({ collection: EVENTS, ...asVisitor })).total
    ).toBe(1);
    expect(await byId(t, EVENTS, idOf(early))).toBe("early");
    // An entry outside the filter answers as a missing one does.
    expect(await byId(t, EVENTS, idOf(late))).toEqual(
      await byId(t, EVENTS, idOf(gone))
    );
  });
});

describe("a read rule's filter on a field the read may show from a fallback language", () => {
  /** Two notes, each titled in both languages; only one has an English secret. */
  async function seed(t: TestNextly) {
    const made = async (title: string, secret?: string) => {
      const created = await t.nextly.create({
        collection: NOTES,
        data: secret === undefined ? { title } : { title, secret },
      });
      await t.nextly.update({
        collection: NOTES,
        id: idOf(created),
        locale: "fr",
        data: { title },
      });
      return idOf(created);
    };
    return {
      withEnglishSecret: await made("english-secret", "classified"),
      withoutSecret: await made("no-secret"),
    };
  }

  const frenchFallingBack = { locale: "fr", fallbackLocale: "en" } as const;

  it("withholds an entry whose fallback value the rule refuses, in a list, a count and by id", async () => {
    const t = await boot();
    const { withEnglishSecret, withoutSecret } = await seed(t);

    // The control: read with trust, French falls back to the English secret,
    // so the entry the rule admits in French alone would show it.
    const trusted = await t.nextly.findByID({
      collection: NOTES,
      id: withEnglishSecret,
      ...frenchFallingBack,
    });
    expect((trusted as { secret?: unknown } | null)?.secret).toBe("classified");

    const page = await t.nextly.find({
      collection: NOTES,
      ...frenchFallingBack,
      ...asVisitor,
    });
    expect(titles(page.items)).toEqual(["no-secret"]);
    expect(
      (
        await t.nextly.count({
          collection: NOTES,
          ...frenchFallingBack,
          ...asVisitor,
        })
      ).total
    ).toBe(1);
    expect(await byId(t, NOTES, withoutSecret, frenchFallingBack)).toBe(
      "no-secret"
    );
    expect(await byId(t, NOTES, withEnglishSecret, frenchFallingBack)).not.toBe(
      "english-secret"
    );
  });

  /** The id a populated relation holds, whether populated or withheld. */
  const populatedId = (relation: unknown) =>
    typeof relation === "string"
      ? { withheld: relation }
      : { populated: (relation as { id?: unknown } | null)?.id };

  it("withholds such an entry where a read populates it", async () => {
    const t = await boot();
    const { withEnglishSecret, withoutSecret } = await seed(t);
    const pinned = async (note: string) => {
      const pin = await t.nextly.create({ collection: PINS, data: { note } });
      const read = (await t.nextly.findByID({
        collection: PINS,
        id: idOf(pin),
        depth: 1,
        ...frenchFallingBack,
        ...asVisitor,
      })) as Record<string, unknown>;
      return populatedId(read.note);
    };
    expect(await pinned(withoutSecret)).toEqual({ populated: withoutSecret });
    // Withheld as a row the caller may not read is: the stored id, not the row.
    expect(await pinned(withEnglishSecret)).toEqual({
      withheld: withEnglishSecret,
    });
  });

  it("withholds such an entry where a Single populates it", async () => {
    const t = await boot();
    const { withEnglishSecret, withoutSecret } = await seed(t);
    const onBoard = async (note: string) => {
      await t.nextly.updateSingle({ slug: BOARD, data: { note } } as never);
      const read = (await t.nextly.findSingle({
        slug: BOARD,
        depth: 1,
        ...frenchFallingBack,
        ...asVisitor,
      } as never)) as Record<string, unknown>;
      return populatedId(read.note);
    };
    expect(await onBoard(withoutSecret)).toEqual({ populated: withoutSecret });
    expect(await onBoard(withEnglishSecret)).toEqual({
      withheld: withEnglishSecret,
    });
  });

  it("withholds such an entry where a component populates it", async () => {
    const t = await boot();
    const { withEnglishSecret, withoutSecret } = await seed(t);
    // A component is a level of its own, so its relationship populates one
    // level below the shelf: at depth 1 the note stays an id for every caller.
    const throughComponent = { depth: 2 } as const;
    const shelved = async (note: string) => {
      const shelf = await t.nextly.create({
        collection: SHELVES,
        data: { card: { note } },
      });
      const read = (await t.nextly.findByID({
        collection: SHELVES,
        id: idOf(shelf),
        ...throughComponent,
        ...frenchFallingBack,
        ...asVisitor,
      })) as { card?: { note?: unknown } };
      return populatedId(read.card?.note);
    };
    // The control: read with trust, the component populates its note.
    const trustedShelf = await t.nextly.create({
      collection: SHELVES,
      data: { card: { note: withEnglishSecret } },
    });
    const trusted = (await t.nextly.findByID({
      collection: SHELVES,
      id: idOf(trustedShelf),
      ...throughComponent,
      ...frenchFallingBack,
    })) as { card?: { note?: unknown } };
    expect(populatedId(trusted.card?.note)).toEqual({
      populated: withEnglishSecret,
    });
    expect(await shelved(withoutSecret)).toEqual({ populated: withoutSecret });
    expect(await shelved(withEnglishSecret)).toEqual({
      withheld: withEnglishSecret,
    });
  });

  it("judges a read with no fallback in its own language alone", async () => {
    // The control the fallback case is measured against: French with no
    // fallback shows no secret for either note, so the rule admits both.
    const t = await boot();
    await seed(t);
    const page = await t.nextly.find({
      collection: NOTES,
      locale: "fr",
      fallbackLocale: false,
      ...asVisitor,
    });
    expect(titles(page.items)).toEqual(["english-secret", "no-secret"]);
  });
});
