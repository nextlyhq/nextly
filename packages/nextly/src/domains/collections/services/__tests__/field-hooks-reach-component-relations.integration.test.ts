/**
 * A related row reached through a relationship is answered as its own
 * collection's field `afterRead` hooks return it, wherever the relationship
 * sits: on the document itself, inside a component, or inside a component
 * zone, and on an entry and a Single alike, read in one language or in every
 * language (`_allLocales`).
 *
 * The person collection's `secret` field is masked by its field hook, so a
 * read answering the stored value instead has skipped the hook for that row.
 * A document whose own read hook (collection-level or field-level) rewrites a
 * related row still answers it as the related collection's hooks return it.
 *
 * @module domains/collections/services/__tests__/field-hooks-reach-component-relations.integration.test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  relationship,
  text,
} from "../../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";

const PEOPLE = "fhc_people";
const PAGES = "fhc_pages";
const HOME = "fhc_home";
const HOOKED_PAGES = "fhc_hooked_pages";
const HOOKED_HOME = "fhc_hooked_home";
const FIELD_HOOKED_PAGES = "fhc_field_hooked_pages";
const FIELD_HOOKED_HOME = "fhc_field_hooked_home";
const BYLINE = "fhc_byline";
const QUOTE = "fhc_quote";
const NOTE = "fhc_note";

const MASKED = "masked-secret";

/**
 * Where a page and the Single hold a related person: on the document itself
 * and inside a component, both translated, and inside a component zone, whose
 * components are shared by every language.
 */
const holders = () => [
  relationship({ name: "writer", relationTo: PEOPLE, localized: true }),
  fieldGroup({ name: "byline", component: BYLINE }),
  fieldGroup({ name: "blocks", components: [QUOTE, NOTE], repeatable: true }),
];

/** What one language stores in its translated places, pointing at `person`. */
const heldBy = (person: string) => ({
  writer: person,
  byline: { author: person },
});

/** The zone, written once: a write replaces its instances. */
const zoneOf = (person: string) => ({
  blocks: [
    { _componentType: NOTE, body: "Said" },
    { _componentType: QUOTE, speaker: person },
  ],
});

/**
 * The people a read of every language carries beside it, per field. Only a
 * component's values are populated there; a relationship on the document is
 * carried as its references, which hold no field to mask, and the zone is not
 * translated, so nothing of it is beside the read.
 */
const besidePeople: Record<string, string[]> = {
  writer: [],
  byline: ["Ann", "Bea"],
  blocks: [],
};

/**
 * Write a value over the secret of every person row a read hook is handed,
 * in place, wherever it sits: a source hook rewriting a related row.
 */
function rewritePeople(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rewritePeople(item);
    return;
  }
  const row = value as Record<string, unknown>;
  if (row.name === "Ann" || row.name === "Bea") row.secret = "rewritten";
  for (const inner of Object.values(row)) rewritePeople(inner);
}

/** A title whose field-level read hook rewrites the document's related rows. */
const rewritingTitle = () =>
  text({
    name: "title",
    hooks: {
      afterRead: [
        ({ value, data }) => {
          rewritePeople(data);
          return value;
        },
      ],
    },
  });

/** A person row found in an answer, and where. */
interface FoundPerson {
  path: string;
  name: unknown;
  secret: unknown;
}

/** Every populated person row inside `value`. */
function peopleIn(value: unknown, path = "$"): FoundPerson[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => peopleIn(item, `${path}[${index}]`));
  }
  const row = value as Record<string, unknown>;
  const here =
    row.name === "Ann" || row.name === "Bea"
      ? [{ path, name: row.name, secret: row.secret }]
      : [];
  return [
    ...here,
    ...Object.entries(row).flatMap(([key, inner]) =>
      peopleIn(inner, `${path}.${key}`)
    ),
  ];
}

let t: TestNextly;

describe.each(getConfiguredTestDialects())(
  "a related row's field hooks wherever the relationship sits (integration, %s)",
  dialect => {
    const pageIds = new Map<string, string>();

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        seedPublic: true,
        fieldGroups: [
          defineFieldGroup({
            slug: BYLINE,
            localized: true,
            fields: [
              relationship({
                name: "author",
                relationTo: PEOPLE,
                localized: true,
              }),
            ],
          }),
          defineFieldGroup({
            slug: QUOTE,
            fields: [relationship({ name: "speaker", relationTo: PEOPLE })],
          }),
          defineFieldGroup({
            slug: NOTE,
            fields: [text({ name: "body" })],
          }),
        ],
        collections: [
          // A person's secret is masked on every read by its field hook.
          defineCollection({
            slug: PEOPLE,
            access: { read: () => true },
            fields: [
              text({ name: "name" }),
              text({
                name: "secret",
                hooks: { afterRead: [() => MASKED] },
              }),
            ],
          }),
          defineCollection({
            slug: PAGES,
            localized: true,
            access: { read: () => true },
            fields: [text({ name: "title" }), ...holders()],
          }),
          // Its own read hook rewrites the related rows it is handed.
          defineCollection({
            slug: HOOKED_PAGES,
            localized: true,
            access: { read: () => true },
            hooks: { afterRead: [({ data }) => rewritePeople(data)] },
            fields: [text({ name: "title" }), ...holders()],
          }),
          // A field's read hook rewrites the related rows of its document.
          defineCollection({
            slug: FIELD_HOOKED_PAGES,
            localized: true,
            access: { read: () => true },
            fields: [rewritingTitle(), ...holders()],
          }),
        ],
        singles: [
          defineSingle({
            slug: HOME,
            localized: true,
            access: { read: () => true },
            fields: [text({ name: "title" }), ...holders()],
          }),
          defineSingle({
            slug: HOOKED_HOME,
            localized: true,
            access: { read: () => true },
            hooks: { afterRead: [({ data }) => rewritePeople(data)] },
            fields: [text({ name: "title" }), ...holders()],
          }),
          defineSingle({
            slug: FIELD_HOOKED_HOME,
            localized: true,
            access: { read: () => true },
            fields: [rewritingTitle(), ...holders()],
          }),
        ],
        localization: { locales: ["en", "fr"], defaultLocale: "en" },
      });

      const person = async (name: string) =>
        String(
          (
            await t.nextly.create({
              collection: PEOPLE,
              data: { name, secret: `stored ${name}` },
            })
          ).item.id
        );
      const ann = await person("Ann");
      const bea = await person("Bea");

      // Ann in English and Bea in French, in each translated place a person is
      // held; Ann in the zone every language shares.
      for (const collection of [PAGES, HOOKED_PAGES, FIELD_HOOKED_PAGES]) {
        const id = String(
          (
            await t.nextly.create({
              collection,
              locale: "en",
              data: { title: "Page", ...heldBy(ann), ...zoneOf(ann) },
            })
          ).item.id
        );
        await t.nextly.update({
          collection,
          id,
          locale: "fr",
          data: { title: "Page en français", ...heldBy(bea), _overwrite: true },
        });
        pageIds.set(collection, id);
      }
      for (const slug of [HOME, HOOKED_HOME, FIELD_HOOKED_HOME]) {
        await t.nextly.updateSingle({
          slug,
          locale: "en",
          data: {
            title: "Home",
            ...heldBy(ann),
            ...zoneOf(ann),
            _overwrite: true,
          },
        } as never);
        await t.nextly.updateSingle({
          slug,
          locale: "fr",
          data: { title: "Accueil", ...heldBy(bea), _overwrite: true },
        } as never);
      }
    }, 120_000);

    afterAll(async () => {
      await t?.destroy();
    });

    /** A visitor's read, populating related rows. */
    const visitor = (locale: "en" | "all") => ({
      locale,
      depth: 2,
      overrideAccess: false,
    });

    type Locale = "en" | "all";
    type Read = (locale: Locale) => Promise<Record<string, unknown>>;
    const entryReads = (
      label: string,
      collection: string
    ): Record<string, Read> => ({
      [`${label} read by id`]: async (locale: Locale) =>
        (await t.nextly.findByID({
          collection,
          id: pageIds.get(collection) ?? "",
          ...visitor(locale),
        })) as Record<string, unknown>,
      [`${label} listed`]: async (locale: Locale) =>
        (await t.nextly.find({ collection, ...visitor(locale) }))
          .items[0] as Record<string, unknown>,
    });
    const singleRead = (label: string, slug: string): Record<string, Read> => ({
      [label]: async (locale: Locale) =>
        (await t.nextly.findSingle({
          slug,
          ...visitor(locale),
        } as never)) as unknown as Record<string, unknown>,
    });
    const reads: Record<string, Read> = {
      ...entryReads("an entry", PAGES),
      ...singleRead("a Single read", HOME),
      // The document's own read hooks hand back related rows they rewrote;
      // the answer still carries what the related collection's hooks return.
      ...entryReads("an entry its read hook rewrites", HOOKED_PAGES),
      ...singleRead("a Single its read hook rewrites", HOOKED_HOME),
      ...entryReads("an entry a field hook rewrites", FIELD_HOOKED_PAGES),
      ...singleRead("a Single a field hook rewrites", FIELD_HOOKED_HOME),
    };

    const cases = Object.keys(reads).flatMap(read =>
      (["writer", "byline", "blocks"] as const).flatMap(field =>
        (["en", "all"] as const).map(locale => ({ read, field, locale }))
      )
    );

    // `writer` sits on the document itself, `byline` inside a component and
    // `blocks` inside a component zone. The read's own language holds Ann; a
    // read of every language carries the people `besidePeople` names beside
    // it. Each person is found where the read places it and answers its secret
    // as the hook returns it.
    it.each(cases)(
      "$read in locale $locale answers $field's related row as its field hook returns it",
      async ({ read, field, locale }) => {
        const answer = await reads[read](locale);
        const every = answer._allLocales as Record<string, unknown> | undefined;
        // The field under test, in the read's own language and beside it: the
        // other places a person is held are cases of their own.
        const held = { own: answer[field], beside: every?.[field] };

        const own = peopleIn(held.own, `$.${field}`);
        expect(
          own.map(p => p.name),
          JSON.stringify(held.own)
        ).toContain("Ann");
        expect(own, JSON.stringify(own)).toEqual(
          own.map(p => ({ ...p, secret: MASKED }))
        );

        if (locale === "all") {
          const beside = peopleIn(held.beside, `$._allLocales.${field}`);
          expect(
            beside.map(p => p.name),
            JSON.stringify(held.beside)
          ).toEqual(expect.arrayContaining(besidePeople[field]));
          expect(beside, JSON.stringify(beside)).toEqual(
            beside.map(p => ({ ...p, secret: MASKED }))
          );
        }

        // Under no key of the field, in any language, is a stored or
        // rewritten secret.
        expect(JSON.stringify(held)).not.toMatch(/stored (Ann|Bea)|rewritten/);
      },
      60_000
    );
  }
);
