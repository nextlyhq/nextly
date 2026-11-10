/**
 * Reading an entry's component subtrees in several languages at once returns,
 * for each language, exactly what a read of that language alone returns, and
 * reads each component table once however many languages are asked.
 *
 * The plausible broken implementations: one language's translations copied
 * into another's (a single overlay shared by every copy), a language with no
 * translation shown another's text, and a reader that simply loops the
 * one-language read, so its reads multiply with the languages while the
 * caller holds a row lock.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { getTableName, isTable } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  json,
  text,
} from "../../../config";
import type { FieldConfig } from "../../../collections/fields/types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import {
  readComponentSubtrees,
  readComponentSubtreesByLocale,
} from "../read-component-subtrees";

let current: TestNextly | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

const PAGES = "subtreepages";

const pages = defineCollection({
  slug: PAGES,
  localized: true,
  fields: [
    text({ name: "title", localized: true }),
    // Translated, with a part every language shares.
    fieldGroup({ name: "hero", component: "subtreehero" }),
    // The same in every language.
    fieldGroup({ name: "cards", component: "subtreecard", repeatable: true }),
  ],
});

async function boot(dialect: TestDialect): Promise<string> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: "subtreehero",
        localized: true,
        fields: [
          text({ name: "heading", localized: true }),
          text({ name: "tone" }),
        ],
      }),
      defineFieldGroup({
        slug: "subtreecard",
        // A stored JSON value: a driver may hand it back already parsed.
        fields: [text({ name: "label" }), json({ name: "meta" })],
      }),
    ],
    collections: [pages],
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
  });
  const entries = (
    current.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService();
  const created = await entries.createEntry(
    { collectionName: PAGES, overrideAccess: true, locale: "en" },
    {
      title: "Hello",
      hero: { heading: "Hello hero", tone: "warm" },
      cards: [
        { label: "One", meta: { flags: ["a"] } },
        { label: "Two", meta: { flags: ["b"] } },
      ],
    }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  const id = (created.data as { id: string }).id;
  // Spanish translates the hero; French translates nothing.
  const spanish = await entries.updateEntry(
    {
      collectionName: PAGES,
      entryId: id,
      overrideAccess: true,
      locale: "es",
    },
    { hero: { heading: "Hola hero", tone: "warm" }, _overwrite: true }
  );
  expect(spanish.success, JSON.stringify(spanish)).toBe(true);
  return id;
}

/**
 * The component tables a transaction reads, each time one is read: every
 * select the reader makes goes through the one handle it takes from `tx`.
 */
function countComponentReads(tx: TransactionContext): string[] {
  const read: string[] = [];
  type Joins = { leftJoin?: (table: unknown, ...rest: unknown[]) => unknown };
  type Select = (...args: unknown[]) => {
    from: (table: unknown, ...rest: unknown[]) => Joins;
  };
  const db = tx.getDrizzle<{ select: Select }>();
  const select = db.select.bind(db);
  const record = (table: unknown) => {
    if (isTable(table) && getTableName(table).startsWith("comp_")) {
      read.push(getTableName(table));
    }
  };
  vi.spyOn(db, "select").mockImplementation((...args: unknown[]) => {
    const builder = select(...args);
    const from = builder.from.bind(builder);
    builder.from = (table: unknown, ...rest: unknown[]) => {
      record(table);
      const joined = from(table, ...rest);
      // A table read through a join is read too: a read in one language takes a component's
      // translations in the same statement as its instances.
      const leftJoin = joined.leftJoin?.bind(joined);
      if (leftJoin) {
        joined.leftJoin = (other: unknown, ...on: unknown[]) => {
          record(other);
          return leftJoin(other, ...on);
        };
      }
      return joined;
    };
    return builder;
  });
  vi.spyOn(tx, "getDrizzle").mockReturnValue(db);
  return read;
}

const heroHeading = (subtrees: Record<string, unknown> | undefined) =>
  (subtrees?.hero as { heading?: unknown } | null | undefined)?.heading;

describe.each(getConfiguredTestDialects())(
  "reading component subtrees in several languages at once (integration, %s)",
  dialect => {
    it("returns each language exactly what a read of that language alone returns", async () => {
      const id = await boot(dialect);
      const locales = ["en", "es", "fr", undefined];
      await current!.adapter.transaction(async tx => {
        const base = {
          fieldGroupDataService: current!.getService("fieldGroupDataService"),
          tx,
          entryId: id,
          parentTable: `dc_${PAGES}`,
          fieldConfigs: pages.fields as FieldConfig[],
          reason: "test-component-read",
        };
        const alone = new Map<string | undefined, Record<string, unknown>>();
        for (const locale of locales) {
          alone.set(locale, await readComponentSubtrees({ ...base, locale }));
        }
        const together = await readComponentSubtreesByLocale({
          ...base,
          locales,
        });

        // POPULATION CONTROL: the languages differ where they should, so
        // equality below cannot come from every language reading the same.
        expect(heroHeading(alone.get("en"))).toBe("Hello hero");
        expect(heroHeading(alone.get("es"))).toBe("Hola hero");
        expect(["Hello hero", "Hola hero"]).not.toContain(
          heroHeading(alone.get("fr"))
        );
        expect(heroHeading(alone.get(undefined))).toBe("Hello hero");
        expect(
          (alone.get("fr")?.cards as { label?: unknown }[] | undefined)?.map(
            card => card.label
          )
        ).toEqual(["One", "Two"]);

        expect([...together.keys()]).toEqual(locales);
        for (const locale of locales) {
          expect(together.get(locale)).toEqual(alone.get(locale));
        }
      });
    });

    it("gives each language its own copy of a stored JSON value", async () => {
      const id = await boot(dialect);
      await current!.adapter.transaction(async tx => {
        const together = await readComponentSubtreesByLocale({
          fieldGroupDataService: current!.getService("fieldGroupDataService"),
          tx,
          entryId: id,
          parentTable: `dc_${PAGES}`,
          fieldConfigs: pages.fields as FieldConfig[],
          reason: "test-component-read",
          locales: ["en", "es"],
        });
        const flagsOf = (locale: string) =>
          (together.get(locale)?.cards as { meta?: { flags?: string[] } }[])[0]
            ?.meta?.flags;
        expect(flagsOf("en")).toEqual(["a"]);
        // A change to one language's copy, as an event's assembly may make.
        flagsOf("es")?.push("changed");
        expect(flagsOf("en")).toEqual(["a"]);
      });
    });

    it("reads each component table once, however many languages it reads", async () => {
      const id = await boot(dialect);
      await current!.adapter.transaction(async tx => {
        const read = countComponentReads(tx);
        const base = {
          fieldGroupDataService: current!.getService("fieldGroupDataService"),
          tx,
          entryId: id,
          parentTable: `dc_${PAGES}`,
          fieldConfigs: pages.fields as FieldConfig[],
          reason: "test-component-read",
        };
        await readComponentSubtreesByLocale({ ...base, locales: ["en"] });
        const one = read.splice(0).sort();
        await readComponentSubtreesByLocale({
          ...base,
          locales: ["en", "es", "fr"],
        });
        const three = read.splice(0).sort();
        for (const locale of ["en", "es", "fr"]) {
          await readComponentSubtrees({ ...base, locale });
        }
        const eachAlone = read.splice(0).sort();

        // POPULATION CONTROL: the count sees every component table, the
        // translations' included, and a read per language multiplies it.
        expect(one).toEqual(
          expect.arrayContaining([
            "comp_subtreecard",
            "comp_subtreehero",
            "comp_subtreehero_locales",
          ])
        );
        expect(eachAlone).toHaveLength(one.length * 3);
        expect(three).toEqual(one);
      });
    });
  }
);
