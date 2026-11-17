/**
 * A related row reached through a relationship is answered as its own
 * collection's field `afterRead` hooks return it, wherever the relationship
 * sits: on the document itself, inside a component, or inside a component
 * zone, and on an entry and a Single alike, read in one language or in every
 * language (`_allLocales`).
 *
 * The person collection's `secret` field is masked by its field hook, so a
 * read answering the stored value instead has skipped the hook for that row.
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
    let pageId = "";

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
        ],
        singles: [
          defineSingle({
            slug: HOME,
            localized: true,
            access: { read: () => true },
            fields: [text({ name: "title" }), ...holders()],
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
      pageId = String(
        (
          await t.nextly.create({
            collection: PAGES,
            locale: "en",
            data: { title: "Page", ...heldBy(ann), ...zoneOf(ann) },
          })
        ).item.id
      );
      await t.nextly.update({
        collection: PAGES,
        id: pageId,
        locale: "fr",
        data: { title: "Page en français", ...heldBy(bea), _overwrite: true },
      });
      await t.nextly.updateSingle({
        slug: HOME,
        locale: "en",
        data: {
          title: "Home",
          ...heldBy(ann),
          ...zoneOf(ann),
          _overwrite: true,
        },
      } as never);
      await t.nextly.updateSingle({
        slug: HOME,
        locale: "fr",
        data: { title: "Accueil", ...heldBy(bea), _overwrite: true },
      } as never);
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

    const reads: Record<
      string,
      (locale: "en" | "all") => Promise<Record<string, unknown>>
    > = {
      "an entry read by id": async locale =>
        (await t.nextly.findByID({
          collection: PAGES,
          id: pageId,
          ...visitor(locale),
        })) as Record<string, unknown>,
      "an entry listed": async locale =>
        (await t.nextly.find({ collection: PAGES, ...visitor(locale) }))
          .items[0] as Record<string, unknown>,
      "a Single read": async locale =>
        (await t.nextly.findSingle({
          slug: HOME,
          ...visitor(locale),
        } as never)) as unknown as Record<string, unknown>,
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

        // Under no key of the field, in any language, is a stored secret.
        expect(JSON.stringify(held)).not.toMatch(/stored (Ann|Bea)/);
      },
      60_000
    );
  }
);
