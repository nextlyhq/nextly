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
 * Beside a read of every language, each language's related row is answered
 * in that language: its own values, its hooks and its field rules.
 *
 * @module domains/collections/services/__tests__/field-hooks-reach-component-relations.integration.test
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { grantPublic } from "../../../../__tests__/helpers/public-role";
import { currentRuleLanguage } from "../../../../auth/access/rule-language";

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
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import type { ServiceContainer } from "../../../../services";
import { _resetEnvCache } from "../../../../shared/lib/env";

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
const SPEAKERS = "fhc_speakers";
const CREDIT = "fhc_credit";
const CREDITED_PAGES = "fhc_credited_pages";
const CREDITED_HOME = "fhc_credited_home";
const LANGUAGES = ["en", "fr", "es"] as const;

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
          // Each language's credit names a speaker, the same one in all.
          defineFieldGroup({
            slug: CREDIT,
            localized: true,
            fields: [
              relationship({
                name: "speaker",
                relationTo: SPEAKERS,
                localized: true,
              }),
            ],
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
          // A speaker's name is translated; its mask names the language its
          // hook ran in; its nickname is withheld from Spanish by its rule.
          defineCollection({
            slug: SPEAKERS,
            localized: true,
            access: { read: () => true },
            fields: [
              text({ name: "name" }),
              text({
                name: "mask",
                localized: false,
                hooks: {
                  afterRead: [
                    () => `masked-${currentRuleLanguage().locale ?? "none"}`,
                  ],
                },
              }),
              text({
                name: "nickname",
                localized: false,
                access: { read: ({ locale }) => locale !== "es" },
              }),
            ],
          }),
          defineCollection({
            slug: CREDITED_PAGES,
            localized: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "credit", component: CREDIT }),
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
            slug: CREDITED_HOME,
            localized: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "credit", component: CREDIT }),
            ],
          }),
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
        localization: { locales: [...LANGUAGES], defaultLocale: "en" },
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

      // One speaker, named in each language, credited by every language.
      const cy = String(
        (
          await t.nextly.create({
            collection: SPEAKERS,
            locale: "en",
            data: { name: "Cy-en", mask: "stored mask", nickname: "Cyclone" },
          })
        ).item.id
      );
      for (const locale of ["fr", "es"] as const) {
        await t.nextly.update({
          collection: SPEAKERS,
          id: cy,
          locale,
          data: { name: `Cy-${locale}`, _overwrite: true },
        });
      }
      for (const locale of LANGUAGES) {
        const data = { title: `Page ${locale}`, credit: { speaker: cy } };
        if (locale === "en") {
          pageIds.set(
            CREDITED_PAGES,
            String(
              (
                await t.nextly.create({
                  collection: CREDITED_PAGES,
                  locale,
                  data,
                })
              ).item.id
            )
          );
        } else {
          await t.nextly.update({
            collection: CREDITED_PAGES,
            id: pageIds.get(CREDITED_PAGES) ?? "",
            locale,
            data: { ...data, _overwrite: true },
          });
        }
        await t.nextly.updateSingle({
          slug: CREDITED_HOME,
          locale,
          data: { ...data, _overwrite: true },
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

    const creditReads: Record<string, () => Promise<Record<string, unknown>>> =
      {
        "an entry read by id": async () =>
          (await t.nextly.findByID({
            collection: CREDITED_PAGES,
            id: pageIds.get(CREDITED_PAGES) ?? "",
            ...visitor("all"),
          })) as Record<string, unknown>,
        "an entry listed": async () =>
          (
            await t.nextly.find({
              collection: CREDITED_PAGES,
              ...visitor("all"),
            })
          ).items[0] as Record<string, unknown>,
        "a Single read": async () =>
          (await t.nextly.findSingle({
            slug: CREDITED_HOME,
            ...visitor("all"),
          } as never)) as unknown as Record<string, unknown>,
      };

    // Every language credits the same speaker. Beside a read of every
    // language, each language's speaker is that language's: its translated
    // name, its mask as its hook answered in that language, and its nickname
    // withheld in Spanish alone, where its rule refuses it.
    it.each(Object.keys(creditReads))(
      "%s carries each language's related row as that language answers it",
      async read => {
        const answer = await creditReads[read]();
        const every = answer._allLocales as
          | Record<string, Record<string, unknown>>
          | undefined;
        const speakers = Object.fromEntries(
          LANGUAGES.map(locale => [
            locale,
            (every?.credit?.[locale] as { speaker?: unknown } | undefined)
              ?.speaker as Record<string, unknown> | undefined,
          ])
        );
        const seen = JSON.stringify(speakers);
        for (const locale of LANGUAGES) {
          expect(speakers[locale]?.name, seen).toBe(`Cy-${locale}`);
          expect(speakers[locale]?.mask, seen).toBe(`masked-${locale}`);
        }
        expect(speakers.en?.nickname, seen).toBe("Cyclone");
        expect(speakers.fr?.nickname, seen).toBe("Cyclone");
        expect(speakers.es, seen).not.toHaveProperty("nickname");
        expect(JSON.stringify(answer)).not.toContain("stored mask");
      },
      60_000
    );
  }
);

const LAID_PEOPLE = "fhc_laid_people";
const LAID_PAGES = "fhc_laid_pages";
const LAID_HOME = "fhc_laid_home";

/**
 * A group with no name only lays fields out: the relationship inside it is
 * stored and read at the level the group sits in, here inside `meta`, as
 * `meta.keeper`. A field with no name is refused at the top of a document and
 * by the code-first config, so the Builder creates the shape inside a group.
 */
const laidOut = () => [
  { name: "title", type: "text" },
  {
    name: "meta",
    type: "group",
    fields: [
      {
        type: "group",
        label: "Layout",
        fields: [
          { name: "keeper", type: "relationship", relationTo: LAID_PEOPLE },
        ],
      },
    ],
  },
];

/**
 * A Builder save as a development server runs it, where a save applies its
 * DDL at once, failing with what it answered when it did not succeed.
 */
async function builderSaved(save: () => Promise<unknown>): Promise<void> {
  const previous = process.env.NODE_ENV;
  vi.stubEnv("NODE_ENV", "development");
  try {
    const response = (await save()) as Response;
    expect(response.status, await response.clone().text()).toBeLessThan(300);
  } finally {
    vi.stubEnv("NODE_ENV", previous);
  }
}

describe.each(getConfiguredTestDialects())(
  "a related row inside a group with no name (integration, %s)",
  dialect => {
    let laid: TestNextly;
    let laidPageId = "";
    /** The person every read here must answer with, by the id she was stored under. */
    let laidAnnId = "";
    let projectRoot = "";

    beforeAll(async () => {
      // What a development save writes beside the app goes to a project of
      // its own, never into this package.
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-laid-out-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      clearCachedSnapshot();
      laid = await createTestNextly({
        dialect,
        seedPublic: true,
        collections: [
          defineCollection({
            slug: LAID_PEOPLE,
            access: { read: () => true },
            fields: [
              text({ name: "name" }),
              text({
                name: "secret",
                hooks: { afterRead: [() => MASKED] },
              }),
            ],
          }),
        ],
        localization: { locales: ["en", "fr"], defaultLocale: "en" },
      });
      await builderSaved(() =>
        dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          {
            name: LAID_PAGES,
            label: "Laid pages",
            localized: true,
            fields: laidOut(),
          }
        )
      );
      await builderSaved(() =>
        dispatchSingles(
          "createSingle",
          {},
          {
            slug: LAID_HOME,
            label: "Laid home",
            localized: true,
            fields: laidOut(),
          }
        )
      );
      // A visitor reads them by the Public role's grants, which the Builder
      // leaves to the site.
      await grantPublic(laid, [`read-${LAID_PAGES}`, `read-${LAID_HOME}`]);
      const person = async (name: string) =>
        String(
          (
            await laid.nextly.create({
              collection: LAID_PEOPLE,
              data: { name, secret: `stored ${name}` },
            })
          ).item.id
        );
      const ann = await person("Ann");
      laidAnnId = ann;
      await person("Bea");
      laidPageId = String(
        (
          await laid.nextly.create({
            collection: LAID_PAGES,
            locale: "en",
            data: { title: "Page", meta: { keeper: ann } },
          })
        ).item.id
      );
      await laid.nextly.update({
        collection: LAID_PAGES,
        id: laidPageId,
        locale: "fr",
        // Its own reference in French too, so a read in French, and the French
        // values beside a read of every language, are populated and masked.
        data: {
          title: "Page en français",
          meta: { keeper: ann },
          _overwrite: true,
        },
      });
      await laid.nextly.updateSingle({
        slug: LAID_HOME,
        locale: "en",
        data: { title: "Home", meta: { keeper: ann }, _overwrite: true },
      } as never);
      await laid.nextly.updateSingle({
        slug: LAID_HOME,
        locale: "fr",
        data: { title: "Accueil", meta: { keeper: ann }, _overwrite: true },
      } as never);
    }, 120_000);

    afterAll(async () => {
      await laid?.destroy();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      _resetEnvCache();
      clearCachedSnapshot();
      if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
    });

    const visitor = (locale: "en" | "fr" | "all") => ({
      locale,
      depth: 2,
      overrideAccess: false,
    });
    const laidReads: Record<
      string,
      (locale: "en" | "fr" | "all") => Promise<Record<string, unknown>>
    > = {
      "an entry read by id": async locale =>
        (await laid.nextly.findByID({
          collection: LAID_PAGES,
          id: laidPageId,
          ...visitor(locale),
        })) as Record<string, unknown>,
      "an entry listed": async locale =>
        (await laid.nextly.find({ collection: LAID_PAGES, ...visitor(locale) }))
          .items[0] as Record<string, unknown>,
      "a Single read": async locale =>
        (await laid.nextly.findSingle({
          slug: LAID_HOME,
          ...visitor(locale),
        } as never)) as unknown as Record<string, unknown>,
    };

    // Ann, where the read stores her, inside `meta`. An entry's read populates
    // her; a Single's read carries her reference there, which holds no field
    // to mask. Wherever she is populated, her secret reads as her hook returns
    // it, and her stored secret appears nowhere.
    it.each(
      Object.keys(laidReads).flatMap(read =>
        (["en", "fr", "all"] as const).map(locale => ({ read, locale }))
      )
    )(
      "$read in locale $locale answers the related row as its field hook returns it",
      async ({ read, locale }) => {
        const answer = await laidReads[read](locale);
        const own = peopleIn(answer.meta, "$.meta");
        // Populated on every read, a Single's included, so the hook below is
        // observed on a row the read returned rather than passed by its absence.
        expect(
          own.map(p => p.name),
          JSON.stringify(answer.meta)
        ).toContain("Ann");
        expect(own, JSON.stringify(own)).toEqual(
          own.map(p => ({ ...p, secret: MASKED }))
        );
        // Each language's values carried beside a read of every language are
        // populated and masked the same way, the default language's and French.
        if (locale === "all") {
          const beside = peopleIn(answer._allLocales, "$._allLocales");
          expect(beside, JSON.stringify(beside)).toEqual(
            beside.map(p => ({ ...p, secret: MASKED }))
          );
        }
        expect(JSON.stringify(answer)).not.toMatch(/stored (Ann|Bea)/);
      },
      60_000
    );

    // Depth 0 asks for no related rows: the reference stays as stored, a Single's
    // as an entry's, so the population above is the depth the read asked for.
    it("a Single read at depth 0 keeps the related row as its reference", async () => {
      const answer = (await laid.nextly.findSingle({
        slug: LAID_HOME,
        locale: "en",
        depth: 0,
        overrideAccess: false,
      } as never)) as unknown as Record<string, unknown>;
      const meta = answer.meta as Record<string, unknown>;
      expect(meta.keeper, JSON.stringify(meta)).toBe(laidAnnId);
      expect(JSON.stringify(answer)).not.toMatch(/stored (Ann|Bea)/);
    }, 60_000);
  }
);
