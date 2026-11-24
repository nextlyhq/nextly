/**
 * `nextly migrate`'s data steps bring a repeater or group an earlier release kept whole per
 * language into one structure across languages: where every language's value has the default
 * language's rows, ids, order and shared values, the structure goes to the main table and each
 * language keeps its own text by row; where any language differs, the upgrade refuses, naming the
 * document and field, and a dry run lists it the same way. The Schema Builder's definitions lose
 * `localized` on such a field.
 *
 * The plausible broken upgrades: one that takes the default language's whole value and drops the
 * other languages' text; one that converts a document whose languages differ, so one language's
 * rows or order silently replace another's; one that refuses without naming what differs; one that
 * leaves the flag on a stored definition; and one that converts again on a second run.
 */
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { LOCALISATION_DATA_STEPS } from "../../../cli/commands/upgrade-steps";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  group,
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
import { parsedValue } from "../../../shared/lib/json-column-value";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import { WORKING_DRAFT_SHAPE } from "../../versions/versions-repository";
import { workingDraftKey } from "../../versions/working-draft-key";
import { _resetPerLanguageStorage } from "../per-language-storage";

import {
  migrateData,
  openUpgradeDatabase,
  previewMigrateData,
  type UpgradeDatabase,
} from "./helpers/localisation-upgrade-fixture";

// Written for per-language storage, as every installation now runs it; `nextly migrate` then runs
// the localisation data steps.
perLanguageStorageSuite();

const SLUG = "slideshows";
const TABLE = `dc_${SLUG}`;
const LANGUAGES_TABLE = `${TABLE}_locales`;

const SLIDESHOWS = defineCollection({
  slug: SLUG,
  localized: true,
  fields: [
    text({ name: "title" }),
    repeater({
      name: "slides",
      fields: [text({ name: "caption" }), number({ name: "rank" })],
    }),
    group({
      name: "seo",
      fields: [text({ name: "headline" }), number({ name: "weight" })],
    }),
  ],
});

/** A component an earlier release held inline in a row's list, its instances given no id. */
const UP_CARD = defineFieldGroup({
  slug: "upcard",
  fields: [text({ name: "label" }), number({ name: "size" })],
});

const BOARDS = defineCollection({
  slug: "upboards",
  localized: true,
  fields: [
    text({ name: "title" }),
    repeater({
      name: "panels",
      fields: [
        number({ name: "position" }),
        fieldGroup({ name: "cards", component: "upcard", repeatable: true }),
      ],
    }),
  ],
});

const SITE = {
  collections: [SLIDESHOWS, BOARDS],
  singles: [],
  fieldGroups: [UP_CARD],
  localization: { locales: ["en", "es"], defaultLocale: "en" },
};

/** The one step under test, as `nextly migrate` lists it. */
const STRUCTURES_STEP = LOCALISATION_DATA_STEPS.filter(step =>
  step.title.startsWith("keep one structure")
);
/** The step splitting a whole-document pending change by part. */
const DRAFTS_STEP = LOCALISATION_DATA_STEPS.filter(step =>
  step.title.startsWith("split pending changes")
);

/** Booting a site takes most of the default timeout on MySQL alone. */
const BOOT_TIMEOUT = 90_000;

interface Slide {
  id: string;
  caption?: string | null;
  rank?: number | null;
}

describeEachDialect(
  "upgrading repeaters and groups translated whole",
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

    async function boot(): Promise<TestNextly> {
      database = await openUpgradeDatabase(dialect);
      clearServices();
      _resetPerLanguageStorage();
      t = await createTestNextly({
        adapter: database.adapter as never,
        collections: [SLIDESHOWS, BOARDS],
        fieldGroups: [UP_CARD],
        localization: SITE.localization,
      });
      return t;
    }

    async function read(id: string, locale: string) {
      return (await t!.nextly.findByID({
        collection: SLUG,
        id,
        locale,
      })) as { slides: Slide[]; seo: { headline?: string; weight?: number } };
    }

    /**
     * An entry stored as an earlier release stored a repeater and a group translated whole: no
     * structure on the main table, and each language's whole value on its per-language row.
     */
    async function storedWhole(
      values: Record<string, { slides: Slide[]; seo: Record<string, unknown> }>
    ): Promise<string> {
      const created = await t!.nextly.create({
        collection: SLUG,
        locale: "en",
        data: { title: "Show" },
      });
      const id = (created.item as { id: string }).id;
      await t!.nextly.update({
        collection: SLUG,
        id,
        locale: "es",
        data: { title: "Muestra", _overwrite: true },
      });
      const adapter = database!.adapter;
      await adapter.update(
        TABLE,
        { slides: null, seo: null },
        { and: [{ column: "id", op: "=", value: id }] }
      );
      for (const [locale, value] of Object.entries(values)) {
        await adapter.update(
          LANGUAGES_TABLE,
          {
            slides: JSON.stringify(value.slides),
            seo: JSON.stringify(value.seo),
          },
          {
            and: [
              { column: "_parent", op: "=", value: id },
              { column: "_locale", op: "=", value: locale },
            ],
          }
        );
      }
      return id;
    }

    /**
     * The entry's main-table structure of `slides`, as stored: read through a statement, as the
     * upgrade's own connection, which registers no content table, reads it.
     */
    async function storedStructure(id: string): Promise<unknown> {
      const [row] = await database!.adapter.queryStatement<{ slides: unknown }>(
        sql`SELECT ${sql.identifier("slides")} AS ${sql.identifier("slides")} FROM ${sql.identifier(TABLE)} WHERE ${sql.identifier("id")} = ${id}`
      );
      return parsedValue(row?.slides);
    }

    const sameRows = (captions: [string, string]) => ({
      slides: [
        { id: "r1", caption: captions[0], rank: 1 },
        { id: "r2", caption: captions[1], rank: 2 },
      ],
    });

    it(
      "keeps one structure on the main table, and each language's text by row",
      async () => {
        await boot();
        const id = await storedWhole({
          en: {
            ...sameRows(["first", "second"]),
            seo: { headline: "Read", weight: 5 },
          },
          es: {
            ...sameRows(["primero", "segundo"]),
            seo: { headline: "Lee", weight: 5 },
          },
        });

        await migrateData(database!.adapter, SITE, STRUCTURES_STEP);

        // The structure alone on the main table: ids, order and shared values, no language's text.
        expect(await storedStructure(id)).toEqual([
          { id: "r1", rank: 1 },
          { id: "r2", rank: 2 },
        ]);
        const en = await read(id, "en");
        const es = await read(id, "es");
        expect(
          en.slides.map(slide => [slide.id, slide.caption, slide.rank])
        ).toEqual([
          ["r1", "first", 1],
          ["r2", "second", 2],
        ]);
        expect(
          es.slides.map(slide => [slide.id, slide.caption, slide.rank])
        ).toEqual([
          ["r1", "primero", 1],
          ["r2", "segundo", 2],
        ]);
        expect(en.seo).toMatchObject({ headline: "Read", weight: 5 });
        expect(es.seo).toMatchObject({ headline: "Lee", weight: 5 });

        // Converted once: a second run finds nothing to do.
        expect(await STRUCTURES_STEP[0]!.pending(stepContext())).toBe(0);
      },
      BOOT_TIMEOUT
    );

    it(
      "stores no translation for a language whose text inside is all blank",
      async () => {
        await boot();
        const id = await storedWhole({
          en: {
            ...sameRows(["first", "second"]),
            seo: { headline: "Read", weight: 5 },
          },
          // Spanish has the rows, but no text in them: it is not translated.
          es: { ...sameRows(["", ""]), seo: { headline: "", weight: 5 } },
        });

        await migrateData(database!.adapter, SITE, STRUCTURES_STEP);

        const [row] = await database!.adapter.queryStatement<{
          slides: unknown;
          seo: unknown;
        }>(
          sql`SELECT ${sql.identifier("slides")} AS ${sql.identifier("slides")}, ${sql.identifier("seo")} AS ${sql.identifier("seo")} FROM ${sql.identifier(LANGUAGES_TABLE)} WHERE ${sql.identifier("_parent")} = ${id} AND ${sql.identifier("_locale")} = ${"es"}`
        );
        expect(row?.slides ?? null).toBeNull();
        expect(row?.seo ?? null).toBeNull();
        // English keeps its own text.
        expect(
          (await read(id, "en")).slides.map(slide => slide.caption)
        ).toEqual(["first", "second"]);
      },
      BOOT_TIMEOUT
    );

    it(
      "refuses a document whose languages differ, naming it, and changes nothing",
      async () => {
        await boot();
        const id = await storedWhole({
          en: {
            ...sameRows(["first", "second"]),
            seo: { headline: "Read", weight: 5 },
          },
          // Spanish holds the rows in another order.
          es: {
            slides: [
              { id: "r2", caption: "segundo", rank: 2 },
              { id: "r1", caption: "primero", rank: 1 },
            ],
            seo: { headline: "Lee", weight: 5 },
          },
        });

        // The dry run names it as the real run does.
        const plan = await previewMigrateData(database!.adapter, SITE);
        expect((plan.refusals ?? []).join("\n"), JSON.stringify(plan)).toMatch(
          new RegExp(
            `"${SLUG}", field "slides": document ${id}: es has other rows`
          )
        );

        const refused = migrateData(database!.adapter, SITE, STRUCTURES_STEP);
        await expect(refused).rejects.toThrow(
          new RegExp(
            `"${SLUG}", field "slides": document ${id}: es has other rows`
          )
        );
        // The group, the same in both languages, is not named.
        await expect(refused).rejects.not.toThrow(/field "seo"/);
        expect(await storedStructure(id)).toBeNull();
      },
      BOOT_TIMEOUT
    );

    it(
      "takes `localized` off a stored definition's repeater and group, keeping the flags inside",
      async () => {
        await boot();
        const adapter = database!.adapter;
        const [registered] = await adapter.select<{ fields: unknown }>(
          "dynamic_collections",
          {
            columns: ["fields"],
            where: { and: [{ column: "slug", op: "=", value: SLUG }] },
          }
        );
        const flagged = (
          parsedValue(registered!.fields) as Record<string, unknown>[]
        ).map(field =>
          field.name === "slides" || field.name === "seo"
            ? { ...field, localized: true }
            : field
        );
        await adapter.update(
          "dynamic_collections",
          { fields: JSON.stringify(flagged) },
          { and: [{ column: "slug", op: "=", value: SLUG }] }
        );

        await migrateData(adapter, SITE, STRUCTURES_STEP);

        const [stored] = await adapter.select<{ fields: unknown }>(
          "dynamic_collections",
          {
            columns: ["fields"],
            where: { and: [{ column: "slug", op: "=", value: SLUG }] },
          }
        );
        const fields = parsedValue(stored!.fields) as Record<string, unknown>[];
        const byName = (name: string) =>
          fields.find(field => field.name === name);
        expect(byName("slides")).not.toHaveProperty("localized");
        expect(byName("seo")).not.toHaveProperty("localized");
        expect(byName("slides")).toMatchObject({ type: "repeater" });
      },
      BOOT_TIMEOUT
    );

    it(
      "splits a pending change holding a repeater whole: its text to the language's draft by row, no shared draft for an unchanged structure",
      async () => {
        await boot();
        const created = await t!.nextly.create({
          collection: SLUG,
          locale: "en",
          data: {
            title: "Show",
            slides: [
              { caption: "first", rank: 1 },
              { caption: "second", rank: 2 },
            ],
          },
        });
        const id = (created.item as { id: string }).id;
        const [first, second] = (await read(id, "en")).slides;
        const ref = {
          scopeKind: "collection" as const,
          scopeSlug: SLUG,
          entryId: id,
        };
        // As an earlier release held it: the whole document in Spanish, the repeater whole,
        // its rows and order as live.
        await database!.adapter.insert(
          VERSIONS_TABLE,
          {
            id: crypto.randomUUID(),
            scopeKind: "collection",
            scopeSlug: SLUG,
            entryId: id,
            versionNo: null,
            status: "draft",
            isAutosave: false,
            snapshot: JSON.stringify({
              title: "Muestra",
              slides: [
                { id: first!.id, caption: "primero", rank: 1 },
                { id: second!.id, caption: "segundo", rank: 2 },
              ],
            }),
            label: null,
            locale: "es",
            draftKey: workingDraftKey(ref, "es"),
            sourceVersionNo: null,
            createdBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { returning: [] }
        );

        await migrateData(database!.adapter, SITE, DRAFTS_STEP);

        const rows = await database!.adapter.select<{
          locale: string | null;
          snapshot: unknown;
        }>(VERSIONS_TABLE, {
          where: {
            and: [
              { column: "entryId", op: "=", value: id },
              ...WORKING_DRAFT_SHAPE,
            ],
          },
        });
        const bySlot = Object.fromEntries(
          rows.map(row => [row.locale ?? "shared", parsedValue(row.snapshot)])
        ) as Record<string, Record<string, unknown>>;
        // The structure equals live, so it starts no shared change; the text is Spanish's, by row.
        expect(Object.keys(bySlot)).toEqual(["es"]);
        expect(bySlot.es!.slides).toEqual({
          [first!.id]: { caption: "primero" },
          [second!.id]: { caption: "segundo" },
        });
        expect(bySlot.es!.title).toBe("Muestra");
      },
      BOOT_TIMEOUT
    );

    /**
     * An entry of `upboards` stored as an earlier release stored a repeater translated whole whose
     * rows hold a list of component instances: no structure on the main table, and each language's
     * whole value on its row, its instances with no id.
     */
    async function boardStoredWhole(
      values: Record<string, unknown[]>
    ): Promise<string> {
      const created = await t!.nextly.create({
        collection: "upboards",
        locale: "en",
        data: { title: "Board" },
      });
      const id = (created.item as { id: string }).id;
      await t!.nextly.update({
        collection: "upboards",
        id,
        locale: "es",
        data: { title: "Tablero", _overwrite: true },
      });
      const adapter = database!.adapter;
      await adapter.update(
        "dc_upboards",
        { panels: null },
        { and: [{ column: "id", op: "=", value: id }] }
      );
      for (const [locale, panels] of Object.entries(values)) {
        await adapter.update(
          "dc_upboards_locales",
          { panels: JSON.stringify(panels) },
          {
            and: [
              { column: "_parent", op: "=", value: id },
              { column: "_locale", op: "=", value: locale },
            ],
          }
        );
      }
      return id;
    }

    const panelWith = (labels: string[]) => [
      {
        id: "p1",
        position: 1,
        cards: labels.map((label, index) => ({
          _componentType: "upcard",
          label,
          size: index + 1,
        })),
      },
    ];

    it(
      "gives instances stored without an id one id at the same place in every language, each keeping its own text",
      async () => {
        await boot();
        const id = await boardStoredWhole({
          en: panelWith(["one", "two"]),
          es: panelWith(["uno", "dos"]),
        });

        await migrateData(database!.adapter, SITE, STRUCTURES_STEP);

        const cardsIn = async (locale: string) =>
          (
            (await t!.nextly.findByID({
              collection: "upboards",
              id,
              locale,
            })) as { panels: { cards: { id?: string; label?: string }[] }[] }
          ).panels[0]!.cards;
        const en = await cardsIn("en");
        const es = await cardsIn("es");
        expect(en.map(card => card.label)).toEqual(["one", "two"]);
        expect(es.map(card => card.label)).toEqual(["uno", "dos"]);
        // One id per instance, the same in every language.
        expect(es.map(card => card.id)).toEqual(en.map(card => card.id));
        expect(new Set(en.map(card => card.id)).size).toBe(2);
      },
      BOOT_TIMEOUT
    );

    it(
      "refuses instances stored without an id whose lists differ by language, naming the document",
      async () => {
        await boot();
        const id = await boardStoredWhole({
          en: panelWith(["one", "two"]),
          // Spanish holds one instance fewer: its place cannot say which instance is which.
          es: panelWith(["uno"]),
        });

        await expect(
          migrateData(database!.adapter, SITE, STRUCTURES_STEP)
        ).rejects.toThrow(
          new RegExp(
            `"upboards", field "panels": document ${id}: es has other rows`
          )
        );
      },
      BOOT_TIMEOUT
    );

    /** The context the step is handed, as `nextly migrate` builds it. */
    function stepContext() {
      const adapter = database!.adapter;
      return {
        adapter: adapter as never,
        db: adapter.getDrizzle(),
        dialect: adapter.dialect,
        site: SITE,
        log: () => undefined,
        warn: () => undefined,
      };
    }
  }
);
