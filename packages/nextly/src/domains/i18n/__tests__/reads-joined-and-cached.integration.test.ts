/**
 * A translated site's reads on every dialect: a detail read that takes its translations in the
 * same query as its entry, and Single and component registry rows read from the registry row
 * cache.
 *
 * - A detail read answers the same in one query as in two (the entry, then its translations),
 *   for the requested language, a fallback, no fallback and a draft read.
 * - It sends one statement for the entry and its translations, matching a one-language chain with
 *   `=` and a longer one with `IN`.
 * - A warm Single or component read sends no registry statement, and answers as a cold one does.
 * - Every registry write a registry service makes is seen at once; a change made elsewhere once
 *   the cached row's second is up, and not before; and a read inside a transaction never comes
 *   from the cache.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// The detail read as it was before the join, with a switch: the entry, then its translations in
// a second statement, for the joined read to be compared with.
const twoStep = vi.hoisted(() => ({ on: false }));
// A joined read that fails as a driver fails, its message naming the translations table.
const failJoin = vi.hoisted(() => ({ on: false }));
vi.mock("../companion-join", async importOriginal => {
  const actual = await importOriginal<typeof import("../companion-join")>();
  const { and, eq, inArray } = await import("drizzle-orm");
  interface TwoStepDb {
    select(): {
      from(table: unknown): {
        where(where: unknown): Promise<Record<string, unknown>[]> & {
          limit(count: number): Promise<Record<string, unknown>[]>;
        };
      };
    };
  }
  return {
    ...actual,
    selectEntryWithCompanion: async (
      args: Parameters<typeof actual.selectEntryWithCompanion>[0]
    ) => {
      if (failJoin.on) {
        throw new Error(
          'select "dc_pages_locales"."heading", "single_site_locales"."tagline" failed'
        );
      }
      if (!twoStep.on) return actual.selectEntryWithCompanion(args);
      const db = args.db as TwoStepDb;
      const [entry] = await db
        .select()
        .from(args.mainTable)
        .where(args.where)
        .limit(1);
      if (!entry) return { entry: undefined, companionRows: [] };
      const companion = args.companionTable as Record<string, unknown>;
      const companionRows = await db
        .select()
        .from(args.companionTable)
        .where(
          and(
            eq(companion._parent as never, entry.id as never),
            // Every language of the chain, as the batched read asks; the rows are the same.
            inArray(companion._locale as never, args.localeChain)
          )
        );
      return { entry, companionRows };
    },
  };
});

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  number,
  text,
} from "../../../config";
import { statementsOf } from "../../../database/__tests__/integration/helpers/count-statements";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import {
  clearRegistryRowCache,
  COLLECTION_ROW_LIFETIME_MS,
} from "../../dynamic-collections/services/collection-row-cache";

let current: TestNextly | undefined;

afterEach(async () => {
  twoStep.on = false;
  failJoin.on = false;
  vi.useRealTimers();
  await current?.destroy();
  current = undefined;
});

/** A translated site: pages with a card, a Single, and both written in two languages. */
async function bootSite(dialect: TestDialect) {
  const t = await createTestNextly({
    dialect,
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    fieldGroups: [
      defineFieldGroup({
        slug: "card",
        fields: [text({ name: "blurb", localized: false })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "site",
        localized: true,
        fields: [text({ name: "tagline" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: "pages",
        localized: true,
        status: true,
        fields: [
          text({ name: "title", localized: false }),
          number({ name: "views", localized: false }),
          text({ name: "heading" }),
          fieldGroup({ name: "card", component: "card" }),
        ],
      }),
    ],
  });
  current = t;
  const both = await t.nextly.create({
    collection: "pages",
    data: {
      title: "Both",
      views: 3,
      heading: "Hello",
      card: { blurb: "Blurb" },
      status: "published",
    },
  });
  const bothId = (both.item as { id: string }).id;
  await t.nextly.update({
    collection: "pages",
    id: bothId,
    locale: "de",
    data: { heading: "Hallo" },
  });
  const englishOnly = await t.nextly.create({
    collection: "pages",
    data: {
      title: "English only",
      views: 1,
      heading: "Only",
      status: "published",
    },
  });
  await t.nextly.updateSingle({ slug: "site", data: { tagline: "Welcome" } });
  await t.nextly.updateSingle({
    slug: "site",
    locale: "de",
    data: { tagline: "Willkommen" },
  });
  return {
    t,
    bothId,
    englishOnlyId: (englishOnly.item as { id: string }).id,
  };
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    getEntry(params: Record<string, unknown>): Promise<unknown>;
  };
}

/** The detail reads compared: languages, fallback, no fallback and a draft read. */
function detailReads(t: TestNextly, bothId: string, englishOnlyId: string) {
  const read = (params: Record<string, unknown>) => () =>
    handlerOf(t).getEntry({
      collectionName: "pages",
      overrideAccess: true,
      depth: 1,
      ...params,
    });
  return [
    read({ entryId: bothId }),
    read({ entryId: bothId, locale: "de" }),
    read({ entryId: englishOnlyId, locale: "de" }),
    read({ entryId: englishOnlyId, locale: "de", fallbackLocale: "none" }),
    read({ entryId: bothId, locale: "de", status: "draft" }),
    () => t.nextly.findSingle({ slug: "site" }),
    () => t.nextly.findSingle({ slug: "site", locale: "de" }),
    () =>
      t.nextly.findSingle({
        slug: "site",
        locale: "de",
        fallbackLocale: "none",
      }),
  ];
}

/** The statements of `read` that name a translations table: the pages' unless `table` says. */
async function translationStatements(
  dialect: TestDialect,
  read: () => Promise<unknown>,
  table = "dc_pages_locales"
): Promise<string[]> {
  await read();
  return (await statementsOf(dialect, read)).filter(statement =>
    statement.includes(table)
  );
}

const REGISTRY = /dynamic_(singles|components|field_groups)/;

describe.each(getConfiguredTestDialects())(
  "a translated site's reads (%s)",
  dialect => {
    it("answers a detail read the same in one query as in two", async () => {
      const { t, bothId, englishOnlyId } = await bootSite(dialect);
      for (const read of detailReads(t, bothId, englishOnlyId)) {
        const joined = await read();
        twoStep.on = true;
        const apart = await read();
        twoStep.on = false;
        expect(JSON.stringify(joined)).toBe(JSON.stringify(apart));
      }
    });

    it("sends a detail read one statement for the entry and its translations", async () => {
      const { t, bothId } = await bootSite(dialect);
      const read = () =>
        handlerOf(t).getEntry({
          collectionName: "pages",
          entryId: bothId,
          locale: "de",
          overrideAccess: true,
          depth: 0,
        });

      const joined = await translationStatements(dialect, read);
      expect(joined).toHaveLength(1);
      expect(joined[0]).toMatch(/left join/i);

      twoStep.on = true;
      expect(await translationStatements(dialect, read)).toHaveLength(1);
      expect((await translationStatements(dialect, read))[0]).not.toMatch(
        /left join/i
      );
    });

    it("sends a Single's read one statement for its document and its translations", async () => {
      const { t } = await bootSite(dialect);
      const read = () => t.nextly.findSingle({ slug: "site", locale: "de" });

      const joined = await translationStatements(
        dialect,
        read,
        "single_site_locales"
      );
      expect(joined).toHaveLength(1);
      expect(joined[0]).toMatch(/left join/i);
    });

    it("matches a one-language chain with = and a longer one with IN", async () => {
      const { t, bothId } = await bootSite(dialect);
      const readIn = (params: Record<string, unknown>) => () =>
        handlerOf(t).getEntry({
          collectionName: "pages",
          entryId: bothId,
          overrideAccess: true,
          depth: 0,
          ...params,
        });
      const locale = /_locale["`]?\s*(=|in\s*\()/i;

      const [one] = await translationStatements(
        dialect,
        readIn({ locale: "en", fallbackLocale: "none" })
      );
      expect(one?.match(locale)?.[1]).toBe("=");

      const [chain] = await translationStatements(
        dialect,
        readIn({ locale: "de" })
      );
      expect(chain?.match(locale)?.[1]?.toLowerCase().replace(/\s/g, "")).toBe(
        "in("
      );
    });

    it("sends a warm Single and component read no registry statement, and answers as a cold one", async () => {
      const { t, bothId } = await bootSite(dialect);
      const reads = [
        () => t.nextly.findSingle({ slug: "site", locale: "de" }),
        () =>
          handlerOf(t).getEntry({
            collectionName: "pages",
            entryId: bothId,
            overrideAccess: true,
            depth: 1,
          }),
      ];
      for (const read of reads) {
        clearRegistryRowCache();
        const cold = await statementsOf(dialect, read);
        const coldAnswer = JSON.stringify(await read());
        const warm = await statementsOf(dialect, read);

        expect(cold.filter(s => REGISTRY.test(s)).length).toBeGreaterThan(0);
        expect(warm.filter(s => REGISTRY.test(s))).toEqual([]);
        expect(JSON.stringify(await read())).toBe(coldAnswer);
      }
    });

    it("sees every Single and component registry write a registry service makes at once", async () => {
      const { t } = await bootSite(dialect);
      const singles = t.getService("singleRegistryService") as {
        getSingleBySlug(slug: string): Promise<{ label?: string } | null>;
        updateSingle(
          slug: string,
          data: object,
          options: { source: string }
        ): Promise<unknown>;
      };
      const groups = t.getService("fieldGroupRegistryService") as {
        getComponentBySlug(slug: string): Promise<{ label?: string } | null>;
        updateComponent(
          slug: string,
          data: object,
          options: { source: string }
        ): Promise<unknown>;
      };
      await singles.getSingleBySlug("site");
      await groups.getComponentBySlug("card");

      // Both are defined in code, which is the only source allowed to change them.
      await singles.updateSingle(
        "site",
        { label: "Site settings" },
        { source: "code" }
      );
      await groups.updateComponent(
        "card",
        { label: "Teaser card" },
        { source: "code" }
      );

      expect((await singles.getSingleBySlug("site"))?.label).toBe(
        "Site settings"
      );
      expect((await groups.getComponentBySlug("card"))?.label).toBe(
        "Teaser card"
      );
    });

    // The Builder's component save writes its registry row past the registry services, so it
    // clears the cache itself: the row this process read just before the save is not served after.
    it("sees a Builder component save's own registry write at once", async () => {
      const { t } = await bootSite(dialect);
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "promo",
          label: "Promo",
          fields: [{ name: "note", type: "text" }],
        }
      );
      const groups = t.getService("fieldGroupRegistryService") as {
        getComponentBySlug(slug: string): Promise<{
          fields?: Array<{ name: string }> | string;
          schemaVersion?: number;
        } | null>;
      };
      const fieldNames = async () => {
        const fields = (await groups.getComponentBySlug("promo"))?.fields;
        const list =
          typeof fields === "string"
            ? (JSON.parse(fields) as Array<{ name: string }>)
            : (fields ?? []);
        return list.map(field => field.name);
      };
      // Cached as it was before the save.
      expect(await fieldNames()).toEqual(["note"]);
      const { schemaVersion } =
        (await groups.getComponentBySlug("promo")) ?? {};

      await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "promo" },
        {
          fields: [
            { name: "note", type: "text" },
            { name: "extra", type: "text" },
          ],
          confirmed: true,
          schemaVersion: schemaVersion ?? 1,
        }
      );

      expect(await fieldNames()).toEqual(["note", "extra"]);
    });

    it("sees a Single changed elsewhere once the cached row's second is up, and not before", async () => {
      const { t } = await bootSite(dialect);
      const singles = t.getService("singleRegistryService") as {
        getSingleBySlug(slug: string): Promise<{ label?: string } | null>;
      };
      vi.useFakeTimers({ toFake: ["performance"] });
      // Rows cached while the site booted were timed on the real clock.
      clearRegistryRowCache();
      const before = (await singles.getSingleBySlug("site"))?.label;

      // Past the registry services, as another process writes.
      await t.adapter.update(
        "dynamic_singles",
        { label: "Elsewhere" },
        { and: [{ column: "slug", op: "=", value: "site" }] }
      );
      vi.advanceTimersByTime(COLLECTION_ROW_LIFETIME_MS - 1);
      expect((await singles.getSingleBySlug("site"))?.label).toBe(before);

      vi.advanceTimersByTime(1);
      expect((await singles.getSingleBySlug("site"))?.label).toBe("Elsewhere");
    });

    it("never answers a Single's registry read inside a transaction from the cache", async () => {
      const { t } = await bootSite(dialect);
      const singles = t.getService("singleRegistryService") as {
        getSingleBySlug(slug: string): Promise<{ label?: string } | null>;
      };
      const cached = (await singles.getSingleBySlug("site"))?.label;
      await t.adapter.update(
        "dynamic_singles",
        { label: "Inside" },
        { and: [{ column: "slug", op: "=", value: "site" }] }
      );
      expect((await singles.getSingleBySlug("site"))?.label).toBe(cached);

      let inside: string | undefined;
      await t.adapter.transaction(async () => {
        inside = (await singles.getSingleBySlug("site"))?.label;
      });
      expect(inside).toBe("Inside");
    });

    // A row read a moment ago from the cache would advance a version another instance already
    // advanced, and two schema changes would share one version.
    it("advances a component's schema version from the stored row, not the cached one", async () => {
      const { t } = await bootSite(dialect);
      const groups = t.getService("fieldGroupRegistryService") as {
        getComponentBySlug(
          slug: string
        ): Promise<{ schemaVersion?: number } | null>;
        updateComponent(
          slug: string,
          data: object,
          options: { source: string; invalidateSchemaVersion: boolean }
        ): Promise<{ schemaVersion?: number }>;
      };
      const cached = (await groups.getComponentBySlug("card"))?.schemaVersion;
      // Advanced past the registry services, as another instance's save advances it.
      const elsewhere = (cached ?? 1) + 5;
      await t.adapter.update(
        STORAGE_FORMAT.registryTable,
        { schema_version: elsewhere },
        { and: [{ column: "slug", op: "=", value: "card" }] }
      );

      const updated = await groups.updateComponent(
        "card",
        {},
        { source: "code", invalidateSchemaVersion: true }
      );

      expect(updated.schemaVersion).toBe(elsewhere + 1);
    });

    // A destructive write decides from the stored row: a component another instance locked a
    // moment after this process read it unlocked is refused, not deleted.
    it("refuses to delete a component locked elsewhere a moment after it was read", async () => {
      const { t } = await bootSite(dialect);
      const groups = t.getService("fieldGroupRegistryService") as {
        registerComponent(data: object): Promise<unknown>;
        getComponentBySlug(slug: string): Promise<{ locked?: boolean } | null>;
        deleteComponent(slug: string): Promise<void>;
      };
      await groups.registerComponent({
        slug: "promo",
        label: "Promo",
        tableName: "comp_promo",
        fields: [{ name: "note", type: "text" }],
        source: "ui",
        locked: false,
        schemaHash: "promo",
      });
      expect((await groups.getComponentBySlug("promo"))?.locked).toBe(false);
      // Locked past the registry services, as another instance's code sync locks it.
      await t.adapter.update(
        STORAGE_FORMAT.registryTable,
        { locked: true },
        { and: [{ column: "slug", op: "=", value: "promo" }] }
      );

      await expect(groups.deleteComponent("promo")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await groups.getComponentBySlug("promo")).not.toBeNull();
    });

    // The same for a Single, on the path the delete route takes: the re-read inside the exclusion
    // decides whether the table is dropped.
    it("refuses to delete a Single locked elsewhere a moment after it was read", async () => {
      const { t } = await bootSite(dialect);
      const singles = t.getService("singleRegistryService") as {
        registerSingle(data: object): Promise<unknown>;
        getSingleBySlug(slug: string): Promise<{ locked?: boolean } | null>;
      };
      const metadata = t.getService("singleMetadataService") as {
        deleteSingle(slug: string, tableName: string): Promise<void>;
      };
      await singles.registerSingle({
        slug: "notice",
        label: "Notice",
        tableName: "single_notice",
        fields: [{ name: "note", type: "text" }],
        source: "ui",
        locked: false,
        schemaHash: "notice",
      });
      expect((await singles.getSingleBySlug("notice"))?.locked).toBe(false);
      // Locked past the registry services, as another instance's code sync locks it.
      await t.adapter.update(
        "dynamic_singles",
        { locked: true },
        { and: [{ column: "slug", op: "=", value: "notice" }] }
      );

      await expect(
        metadata.deleteSingle("notice", "single_notice")
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await singles.getSingleBySlug("notice")).not.toBeNull();
    });

    it("keeps a failed joined read's SQL out of the answer", async () => {
      const { t, bothId } = await bootSite(dialect);
      failJoin.on = true;

      const entry = await handlerOf(t).getEntry({
        collectionName: "pages",
        entryId: bothId,
        locale: "de",
        overrideAccess: true,
        depth: 0,
      });
      const single = await t.nextly
        .findSingle({ slug: "site", locale: "de" })
        .then(
          answer => answer,
          (error: unknown) => error
        );

      // What the caller is handed: the entry read's answer, and the Single read's error.
      expect(JSON.stringify(entry)).not.toMatch(/_locales/);
      expect(single).toBeInstanceOf(Error);
      expect((single as Error).message).not.toMatch(/_locales/);
    });
  }
);
