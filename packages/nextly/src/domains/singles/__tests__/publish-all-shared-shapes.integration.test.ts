/**
 * Publishing every language of a Single never loses or reverts another
 * language's edit, whatever shape the shared part it edited has.
 *
 * Each case starts with English and Spanish live, then Spanish edits one shape
 * of shared part and English saves its own later, so English's copy of that
 * part is the older one and English's promotion runs last. Publishing every
 * language must then either put both edits live or refuse, with nothing
 * changed and both changes still pending; never put English's older copy back
 * over Spanish's edit.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "home";

async function boot(dialect: TestDialect): Promise<SingleEntryService> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      // Shared whole.
      defineFieldGroup({ slug: "hero", fields: [text({ name: "heading" })] }),
      // Kept per language, with a shared sub-field.
      defineFieldGroup({
        slug: "banner",
        localized: true,
        fields: [
          text({ name: "words" }),
          text({ name: "code", localized: false }),
        ],
      }),
      // Kept per language, with nothing shared but its instances.
      defineFieldGroup({
        slug: "note",
        localized: true,
        fields: [text({ name: "body" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "siteName" }),
          fieldGroup({ name: "hero", component: "hero" }),
          fieldGroup({ name: "banner", component: "banner" }),
          fieldGroup({ name: "notes", component: "note", repeatable: true }),
          fieldGroup({
            name: "blocks",
            components: ["hero", "banner"],
            repeatable: true,
          }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return current.getService("singleEntryService");
}

function save(
  singles: SingleEntryService,
  locale: string,
  data: Record<string, unknown>
) {
  return singles.update(
    SLUG,
    { ...data, _overwrite: true },
    { locale, overrideAccess: true }
  );
}

async function liveIn(
  singles: SingleEntryService,
  locale: string
): Promise<Record<string, unknown>> {
  const res = await singles.get(SLUG, { locale, overrideAccess: true });
  return (res.data ?? {}) as Record<string, unknown>;
}

async function pendingLocales(): Promise<string[]> {
  const rows = await current!.adapter.select<{ locale: string | null }>(
    "nextly_versions",
    {
      where: {
        and: [
          { column: "scopeKind", op: "=", value: "single" },
          { column: "scopeSlug", op: "=", value: SLUG },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NULL" },
          { column: "status", op: "=", value: "draft" },
        ],
      },
    }
  );
  return rows.map(r => r.locale ?? "(none)").sort();
}

/** Live in both languages, each with its own words in every shape. */
async function live(singles: SingleEntryService): Promise<void> {
  for (const [locale, words] of [
    ["en", "EN"],
    ["es", "ES"],
  ] as const) {
    expect(
      (
        await save(singles, locale, {
          siteName: words,
          ...(locale === "en" ? { hero: { heading: "hero" } } : {}),
          banner: { words: `${words} banner`, code: "c1" },
          notes: [{ body: `${words} note` }],
          blocks: [
            { _componentType: "banner", words: `${words} block`, code: "b1" },
          ],
          status: "published",
        })
      ).success
    ).toBe(true);
  }
}

/** A part of the live Single, read in one language. */
type Read = (doc: Record<string, unknown>) => unknown;

const codeOf: Read = doc => (doc.banner as { code?: unknown } | null)?.code;
const noteCount: Read = doc =>
  Array.isArray(doc.notes) ? doc.notes.length : 0;
const blockCode: Read = doc =>
  Array.isArray(doc.blocks)
    ? (doc.blocks[0] as { code?: unknown } | undefined)?.code
    : undefined;

interface ShapeCase {
  shape: string;
  /** Spanish's edit of the shared part. */
  spanish: Record<string, unknown>;
  /** English's later save, its own words in the same part. */
  english: Record<string, unknown>;
  /** The shared part, read in English, and its value before and after. */
  read: Read;
  before: unknown;
  edited: unknown;
}

const cases: ShapeCase[] = [
  {
    shape: "a shared component",
    spanish: { hero: { heading: "es hero" } },
    english: { siteName: "EN 2" },
    read: doc => (doc.hero as { heading?: unknown } | null)?.heading,
    before: "hero",
    edited: "es hero",
  },
  {
    shape: "a translated component's shared sub-field",
    spanish: { banner: { words: "ES banner", code: "c2" } },
    english: { banner: { words: "EN banner 2", code: "c1" } },
    read: codeOf,
    before: "c1",
    edited: "c2",
  },
  {
    shape: "a translated component's instances",
    spanish: { notes: [{ body: "ES note" }, { body: "ES note 2" }] },
    english: { notes: [{ body: "EN note 2" }] },
    read: noteCount,
    before: 1,
    edited: 2,
  },
  ...(["_componentType", "_fieldGroupType"] as const).map(key => ({
    shape: `a dynamic zone, its type stored as ${key}`,
    spanish: {
      blocks: [{ [key]: "banner", words: "ES block", code: "b2" }],
    },
    english: {
      blocks: [{ _componentType: "banner", words: "EN block 2", code: "b1" }],
    },
    read: blockCode,
    before: "b1",
    edited: "b2",
  })),
];

describe.each(getConfiguredTestDialects())(
  "publishing every language of a Single on %s",
  dialect => {
    it.each(cases)(
      "never loses Spanish's edit of $shape",
      async ({ spanish, english, read, before, edited }) => {
        const singles = await boot(dialect);
        await live(singles);
        expect((await save(singles, "es", spanish)).success).toBe(true);
        expect((await save(singles, "en", english)).success).toBe(true);

        const published = await singles
          .publishAllLocales(SLUG, {
            overrideAccess: true,
            data: { _overwrite: true },
          })
          .then(
            () => ({ ok: true as const }),
            (error: { statusCode?: number; publicData?: unknown }) => ({
              ok: false as const,
              error,
            })
          );

        if (published.ok) {
          expect(read(await liveIn(singles, "en"))).toEqual(edited);
          expect(await pendingLocales()).toEqual([]);
        } else {
          expect(published.error.statusCode).toBe(409);
          expect(read(await liveIn(singles, "en"))).toEqual(before);
          expect(await pendingLocales()).toEqual(["en", "es"]);
        }
      }
    );

    it("refuses a translated component's shared edit while another language publishes too, naming it", async () => {
      const singles = await boot(dialect);
      await live(singles);
      expect(
        (await save(singles, "es", { banner: { words: "ES", code: "c2" } }))
          .success
      ).toBe(true);
      expect((await save(singles, "en", { siteName: "EN 2" })).success).toBe(
        true
      );

      await expect(
        singles.publishAllLocales(SLUG, {
          overrideAccess: true,
          data: { _overwrite: true },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        publicData: {
          reason: "shared-edits-unmergeable",
          fields: ["banner"],
        },
      });
    });

    // A component kept per language whose shared and translated children are
    // each valid in one language's draft but not together: English with mode
    // A and label X, German with mode B and label Y, and a validator that
    // refuses label X with mode B. Whichever shared mode were written last
    // would pair with the other language's label, a document no gate judged.
    // Publishing every language is refused before anything is written, with
    // both changes still pending. The plausible broken implementation judges
    // each language's draft alone and puts the combination live.
    it("refuses a publish whose languages would combine a component's shared and translated children into an invalid one", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: "panel",
            localized: true,
            fields: [
              text({ name: "mode", localized: false }),
              text({
                name: "label",
                validate: (value, { data }) =>
                  value === "X" && data.mode === "B"
                    ? "Label X does not go with mode B."
                    : true,
              }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: SLUG,
            localized: true,
            status: true,
            versions: { drafts: true },
            access: { read: () => true, update: () => true },
            fields: [
              text({ name: "siteName" }),
              fieldGroup({ name: "panel", component: "panel" }),
            ],
          }),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const singles = current.getService("singleEntryService");
      for (const locale of ["en", "de"]) {
        expect(
          (
            await save(singles, locale, {
              siteName: locale,
              panel: { mode: "A", label: "Y" },
              status: "published",
            })
          ).success
        ).toBe(true);
      }
      expect(await pendingLocales()).toEqual([]);
      const enSaved = await save(singles, "en", {
        panel: { mode: "A", label: "X" },
      });
      expect(enSaved.success, JSON.stringify(enSaved)).toBe(true);
      expect(await pendingLocales()).toEqual(["en"]);
      const deSaved = await save(singles, "de", {
        panel: { mode: "B", label: "Y" },
      });
      expect(deSaved.success, JSON.stringify(deSaved)).toBe(true);

      // POPULATION CONTROL: both languages hold a change.
      expect(await pendingLocales()).toEqual(["de", "en"]);

      await expect(
        singles.publishAllLocales(SLUG, {
          overrideAccess: true,
          data: { _overwrite: true },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        publicData: { reason: "shared-edits-unmergeable", fields: ["panel"] },
      });
      const en = (await liveIn(singles, "en")).panel as Record<string, unknown>;
      const de = (await liveIn(singles, "de")).panel as Record<string, unknown>;
      expect({ en: [en.mode, en.label], de: [de.mode, de.label] }).toEqual({
        en: ["A", "Y"],
        de: ["A", "Y"],
      });
      expect(await pendingLocales()).toEqual(["de", "en"]);
    });

    // Two languages making the same edit to a translated component's shared
    // part do not disagree: whichever language's copy goes last holds the
    // other's edit too, so the publish puts it live, each language keeping
    // its own words. The plausible broken implementation refuses any shared
    // edit while two languages publish, whether or not they agree; the case
    // above, where the two disagree, is the control that still refuses.
    it("publishes the same shared edit of a translated component made in two languages", async () => {
      const singles = await boot(dialect);
      await live(singles);
      expect(
        (await save(singles, "es", { banner: { words: "ES 2", code: "c2" } }))
          .success
      ).toBe(true);
      expect(
        (await save(singles, "en", { banner: { words: "EN 2", code: "c2" } }))
          .success
      ).toBe(true);

      const published = await singles.publishAllLocales(SLUG, {
        overrideAccess: true,
        data: { _overwrite: true },
      });

      expect(published.success, JSON.stringify(published)).toBe(true);
      const en = (await liveIn(singles, "en")).banner as Record<
        string,
        unknown
      >;
      const es = (await liveIn(singles, "es")).banner as Record<
        string,
        unknown
      >;
      expect({ en: [en.words, en.code], es: [es.words, es.code] }).toEqual({
        en: ["EN 2", "c2"],
        es: ["ES 2", "c2"],
      });
      expect(await pendingLocales()).toEqual([]);
    });

    it("publishes a translated component's shared edit when it is the only language pending", async () => {
      const singles = await boot(dialect);
      await live(singles);
      expect(
        (await save(singles, "es", { banner: { words: "ES", code: "c2" } }))
          .success
      ).toBe(true);

      const published = await singles.publishAllLocales(SLUG, {
        overrideAccess: true,
        data: { _overwrite: true },
      });

      expect(published.success).toBe(true);
      expect(codeOf(await liveIn(singles, "en"))).toBe("c2");
      expect(await pendingLocales()).toEqual([]);
    });
  }
);
