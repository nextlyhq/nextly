/**
 * Publishing judges a collection document with its components and its
 * junction many-to-many relationships, as they are stored.
 *
 * Neither sits on the document's row: a component's values live in tables of
 * its own, and a many-to-many relationship in a junction. A status-only
 * publish judges the stored row in update mode, where an absent key is left
 * unjudged, so a required component or relationship missing from storage went
 * live unchecked. Each document here is saved while the field is optional and
 * the field is then made required, which is how a document comes to lack one:
 * a rule tightened since the save, or rows removed outside the write.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  group,
  password,
  text,
} from "../../../config";
import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { registerFieldFunctions } from "../../../shared/lib/field-level-registry";
import { FieldGroupDataService } from "../../field-groups/services/field-group-data-service";
import { FieldGroupQueryService } from "../../field-groups/services/field-group-query-service";
import { currentFieldGroupTypeKey } from "../../field-groups/storage/field-group-type-key";
import { seedPlainAuthor } from "../../releases/__tests__/helpers/live-author";
import { resolveVersionsConfig } from "../../versions/resolve-config";
import { GoingLiveRelationsBatch } from "../services/collection-mutation-service";
import {
  CollectionRelationshipService,
  junctionLinkColumns,
} from "../services/collection-relationship-service";
import type { CollectionRegistryService } from "../services/collection-registry-service";

type Doc = Record<string, unknown>;
type Result = { success: boolean; statusCode?: number; data?: unknown };

interface Entries {
  createEntry(
    params: {
      collectionName: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Doc
  ): Promise<Result>;
  updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Doc
  ): Promise<Result>;
  publishAllLocales(params: {
    collectionName: string;
    entryId: string;
    overrideAccess?: boolean;
    data?: Doc;
  }): Promise<Result>;
  updateEntries(
    params: { collectionName: string; overrideAccess?: boolean },
    entries: { id: string; data: Doc }[]
  ): Promise<{ successful: number; failed: number }>;
  bulkUpdateEntries(params: {
    collectionName: string;
    ids: string[];
    data: Doc;
    overrideAccess?: boolean;
  }): Promise<{ successes: unknown[]; failures: unknown[] }>;
}

/**
 * Whether a nested sub-field's rule refuses: off while documents are saved,
 * on for the publish, as a rule tightened since a save.
 */
let nestedRuleOn = false;

const hero = (heading: string): Doc => ({ heading });
const card = (label: string): Doc => ({ label });
const zoneRow = (heading: string): Doc => ({
  [currentFieldGroupTypeKey]: "hero",
  heading,
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  return createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    fieldGroups: [
      defineFieldGroup({
        slug: "hero",
        fields: [
          text({ name: "heading" }),
          text({
            name: "code",
            validate: (value: unknown) =>
              !nestedRuleOn || value !== "retired" || "code is retired",
          }),
        ],
      }),
      defineFieldGroup({ slug: "card", fields: [text({ name: "label" })] }),
      defineFieldGroup({ slug: "aside", fields: [text({ name: "body" })] }),
      // Translated, with a rule that, once tightened, refuses a stored value.
      defineFieldGroup({
        slug: "memo",
        localized: true,
        fields: [
          text({
            name: "code",
            validate: (value: unknown) =>
              !nestedRuleOn || value !== "retired" || "code is retired",
          }),
        ],
      }),
      // A required password: stored as a hash, which no read returns.
      defineFieldGroup({
        slug: "secured",
        fields: [
          text({ name: "label" }),
          password({ name: "pin", required: true }),
        ],
      }),
      // A component placed directly in a component, required there: stored as
      // a row of its own, beneath the row of the instance that holds it.
      defineFieldGroup({
        slug: "shell",
        fields: [
          text({ name: "label" }),
          fieldGroup({ name: "core", component: "card", required: true }),
        ],
      }),
      // Its values are kept per language, in its translations table.
      defineFieldGroup({
        slug: "note",
        localized: true,
        fields: [text({ name: "body" })],
      }),
      // A second translated kind, for a zone that mixes kinds.
      defineFieldGroup({
        slug: "quote",
        localized: true,
        fields: [text({ name: "body" })],
      }),
      // Translated, its translated group holding a password: both are kept on
      // the translations row.
      defineFieldGroup({
        slug: "vault",
        localized: true,
        fields: [
          text({ name: "heading" }),
          group({
            name: "box",
            localized: true,
            fields: [text({ name: "b" }), password({ name: "pin" })],
          }),
        ],
      }),
      // Used by one collection only, whose table a test removes.
      defineFieldGroup({ slug: "banner", fields: [text({ name: "body" })] }),
    ],
    collections: [
      // No drafts: what goes live is the stored row.
      defineCollection({
        slug: "pages",
        status: true,
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "hero", component: "hero" }),
          fieldGroup({ name: "cards", component: "card", repeatable: true }),
          fieldGroup({
            name: "zone",
            components: ["hero", "card"],
            repeatable: true,
          }),
        ],
      }),
      defineCollection({
        slug: "drafted",
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "hero", component: "hero" }),
        ],
      }),
      defineCollection({
        slug: "guides",
        status: true,
        localized: true,
        fields: [
          text({ name: "title", localized: true }),
          fieldGroup({ name: "hero", component: "hero" }),
        ],
      }),
      // A top-level component whose own rule refuses a value only as it goes
      // live: saved as a draft, judged again as published.
      defineCollection({
        slug: "checked",
        status: true,
        fields: [
          text({ name: "title" }),
          fieldGroup({
            name: "hero",
            component: "hero",
            validate: (value: unknown, { data }: { data: Doc }) =>
              data.status !== "published" ||
              (value as Doc | null)?.heading !== "draft only" ||
              "this hero cannot go live",
          }),
        ],
      }),
      // Translated, with drafts: a pending change is promoted when published.
      // Its hero may not say "Bad" where the title says "Blocked".
      defineCollection({
        slug: "manuals",
        status: true,
        localized: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title", localized: true }),
          fieldGroup({
            name: "hero",
            component: "hero",
            validate: (value: unknown, { data }: { data: Doc }) =>
              data.status !== "published" ||
              !(
                data.title === "Blocked" &&
                (value as Doc | null)?.heading === "Bad"
              ) ||
              "this hero cannot go live beside this title",
          }),
        ],
      }),
      // Translated only through its component: no translated field of its own.
      defineCollection({
        slug: "notebooks",
        status: true,
        localized: true,
        fields: [
          text({ name: "title", localized: false }),
          fieldGroup({ name: "memo", component: "memo" }),
        ],
      }),
      defineCollection({
        slug: "vaults",
        status: true,
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "secured", component: "secured" }),
          fieldGroup({ name: "shell", component: "shell" }),
        ],
      }),
      defineCollection({
        slug: "asides",
        status: true,
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "aside", component: "aside" }),
        ],
      }),
      // A localized group's value judged as it goes live, by its own rule.
      defineCollection({
        slug: "annotated",
        status: true,
        fields: [
          text({ name: "title" }),
          fieldGroup({
            name: "note",
            component: "note",
            validate: (value: unknown, { data }: { data: Doc }) =>
              data.status !== "published" ||
              (value as Doc | null)?.body !== "draft only" ||
              "this note cannot go live",
          }),
        ],
      }),
      // No translated field of its own: only its note is kept per language.
      // With drafts, so a publish promotes a pending change in the language
      // it names.
      defineCollection({
        slug: "noted",
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "hero", component: "hero" }),
          fieldGroup({ name: "note", component: "note" }),
        ],
      }),
      // A zone of translated kinds.
      defineCollection({
        slug: "zoned",
        status: true,
        fields: [
          text({ name: "title" }),
          fieldGroup({
            name: "blocks",
            components: ["note", "quote"],
            repeatable: true,
          }),
        ],
      }),
      // Translated, with drafts: a pending change saved before a component
      // kept per language was added, promoted into every language.
      defineCollection({
        slug: "sweeping",
        status: true,
        localized: true,
        versions: { drafts: true },
        fields: [text({ name: "title", localized: true })],
      }),
      // A pending change saved before a required component was added, whose
      // stored value another writer then removes.
      defineCollection({
        slug: "growing",
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
      // A pending change saved before a required component was added.
      defineCollection({
        slug: "evolving",
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "vaulted",
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "items", component: "vault", repeatable: true }),
        ],
      }),
      defineCollection({
        slug: "bannered",
        status: true,
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "banner", component: "banner" }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
}

/**
 * Tags, and stories that point at them through a junction table. Made as the
 * Schema Builder makes them: a code-first relationship keeps its ids on the
 * row, so only a Builder collection keeps a many-to-many in a junction.
 */
const TAGS_FIELD = {
  name: "tags",
  type: "relationship",
  options: { relationType: "manyToMany", target: "tags" },
};

async function seedStories(t: TestNextly): Promise<void> {
  await seedBuilderCollection(t.adapter, {
    slug: "tags",
    fields: [{ name: "name", type: "text" }],
  });
  await seedBuilderCollection(t.adapter, {
    slug: "stories",
    status: true,
    versions: resolveVersionsConfig({ drafts: false }, true),
    fields: [{ name: "title", type: "text" }, TAGS_FIELD],
  });
}

/**
 * The relationship's own rule, as a code-first collection would declare it:
 * more than one tag may be saved, and not published.
 */
function registerTagsRule(): void {
  registerFieldFunctions("collection", "stories", [
    { name: "title", type: "text" },
    {
      ...TAGS_FIELD,
      validate: (value: unknown, { data }: { data: Doc }) =>
        data.status !== "published" ||
        !Array.isArray(value) ||
        value.length <= 1 ||
        "at most one tag goes live",
    },
  ]);
}

/** Make these fields of a stored collection required, as a later schema change. */
async function makeRequired(
  t: TestNextly,
  slug: string,
  names: readonly string[]
): Promise<void> {
  const registry = t.getService(
    "collectionRegistryService"
  ) as CollectionRegistryService;
  const stored = await registry.getCollection(slug);
  await registry.updateCollection(
    slug,
    {
      fields: stored.fields.map(field =>
        "name" in field &&
        typeof field.name === "string" &&
        names.includes(field.name)
          ? { ...field, required: true }
          : field
      ),
    },
    { source: "code" }
  );
}

/** Add a field to a stored collection, as a later schema change. */
async function addField(
  t: TestNextly,
  slug: string,
  field: ReturnType<typeof fieldGroup>
): Promise<void> {
  const registry = t.getService(
    "collectionRegistryService"
  ) as CollectionRegistryService;
  const stored = await registry.getCollection(slug);
  await registry.updateCollection(
    slug,
    { fields: [...stored.fields, field] as typeof stored.fields },
    { source: "code" }
  );
}

function entriesOf(t: TestNextly): Entries {
  return (
    t.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as unknown as Entries;
}

async function created(
  t: TestNextly,
  collection: string,
  data: Doc,
  locale?: string
): Promise<string> {
  const result = await entriesOf(t).createEntry(
    {
      collectionName: collection,
      overrideAccess: true,
      ...(locale === undefined ? {} : { locale }),
    },
    data
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
  const id = (result.data as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string" && typeof id !== "number") {
    throw new Error("no id from create");
  }
  return String(id);
}

function publish(
  t: TestNextly,
  collection: string,
  id: string,
  data: Doc = {},
  locale?: string
): Promise<Result> {
  return entriesOf(t).updateEntry(
    {
      collectionName: collection,
      entryId: id,
      overrideAccess: true,
      ...(locale === undefined ? {} : { locale }),
    },
    { ...data, status: "published", _overwrite: true }
  );
}

/** The paths a refusal names, in the order it names them. */
function refusedPaths(result: unknown): string[] {
  return [...JSON.stringify(result).matchAll(/"path":"([^"]+)"/g)].map(
    match => match[1]
  );
}

/**
 * The reads a judgement of components and many-to-many relationships makes,
 * counted where every reader of them goes.
 */
function countRelationReads(): { count(): number; restore(): void } {
  const spies = [
    vi.spyOn(FieldGroupDataService.prototype, "populateComponentData"),
    vi.spyOn(FieldGroupDataService.prototype, "populateComponentDataMany"),
    vi.spyOn(
      CollectionRelationshipService.prototype,
      "fetchManyToManyTargetIds"
    ),
    vi.spyOn(
      CollectionRelationshipService.prototype,
      "fetchManyToManyTargetIdsOf"
    ),
  ];
  return {
    count: () => spies.reduce((n, spy) => n + spy.mock.calls.length, 0),
    restore: () => spies.forEach(spy => spy.mockRestore()),
  };
}

/**
 * Each read of a component's translations, as the number of values it binds,
 * seen on the Drizzle handle every pooled read takes, under a lowered limit
 * on a statement's parameters. `failRead` makes the read with that number,
 * counted from 1, fail, as a database fault would.
 */
function recordTranslationReads(
  t: TestNextly,
  budget: number,
  failRead?: number
): { binds: number[]; restore(): void } {
  const capabilities = t.adapter.getCapabilities();
  const limit = vi
    .spyOn(t.adapter, "getCapabilities")
    .mockReturnValue({ ...capabilities, maxParamsPerQuery: budget });
  const binds: number[] = [];
  const drizzle = t.adapter.getDrizzle();
  const recordingBuilder = (builder: object): object =>
    new Proxy(builder, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(
            target,
            args
          ) as { toSQL?: () => { sql: string; params: unknown[] } };
          if (property === "from") return recordingBuilder(result);
          if (property === "where" && result.toSQL) {
            const query = result.toSQL();
            if (query.sql.includes("_locales")) {
              binds.push(query.params.length);
              if (binds.length === failRead) {
                return Promise.reject(new Error("translations read failed"));
              }
            }
          }
          return result;
        };
      },
    });
  const handle = vi.spyOn(t.adapter, "getDrizzle").mockReturnValue(
    new Proxy(drizzle as object, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (typeof value !== "function") return value;
        return property === "select"
          ? (...args: unknown[]) =>
              recordingBuilder(
                (value as (...a: unknown[]) => object).apply(target, args)
              )
          : (value as (...a: unknown[]) => unknown).bind(target);
      },
    }) as ReturnType<typeof t.adapter.getDrizzle>
  );
  return {
    binds,
    restore: () => {
      handle.mockRestore();
      limit.mockRestore();
    },
  };
}

describe.each(getConfiguredTestDialects())(
  "publishing judges a document's components and relationships as stored (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    const ids: Record<string, string> = {};

    /** Both zoned entries' zones, read in `locale`, exactly as stored. */
    const readZones = (
      t: TestNextly,
      locale: string
    ): Promise<Record<string, unknown>[]> =>
      (
        t.getService("fieldGroupDataService") as FieldGroupDataService
      ).populateComponentDataMany({
        entries: [{ id: ids.zonedA }, { id: ids.zonedB }],
        parentTable: "dc_zoned",
        fields: [
          fieldGroup({
            name: "blocks",
            components: ["note", "quote"],
            repeatable: true,
          }),
        ] as never,
        depth: 0,
        strict: true,
        locale,
        fallbackLocale: false,
      });

    beforeAll(async () => {
      t = await boot(dialect);
      await seedStories(t);
      nestedRuleOn = false;
      const tag = await created(t, "tags", { title: "one", name: "one" });
      const tag2 = await created(t, "tags", { title: "two", name: "two" });
      ids.tag = tag;

      // Saved while every component and the relationship are optional.
      for (const name of [
        "missing",
        "batchA",
        "batchB",
        "bulkA",
        "bulkB",
        "supplied",
        "releaseMissing",
      ]) {
        ids[name] = await created(t, "pages", {
          title: name,
          status: "draft",
          ...(name === "supplied" ? { zone: [zoneRow("kept")] } : {}),
        });
      }
      ids.complete = await created(t, "pages", {
        title: "complete",
        status: "draft",
        hero: hero("Welcome"),
        cards: [card("one")],
        zone: [zoneRow("first")],
      });
      ids.releaseComplete = await created(t, "pages", {
        title: "release complete",
        status: "draft",
        hero: hero("Welcome"),
        cards: [card("one")],
        zone: [zoneRow("first")],
      });
      ids.live = await created(t, "pages", {
        title: "live",
        status: "published",
      });
      for (let i = 0; i < 4; i += 1) {
        ids[`count${i}`] = await created(t, "pages", {
          title: `count ${i}`,
          status: "draft",
        });
        ids[`storyCount${i}`] = await created(t, "stories", {
          title: `count ${i}`,
          status: "draft",
        });
      }

      ids.storyEmpty = await created(t, "stories", {
        title: "empty",
        status: "draft",
      });
      ids.storyTagged = await created(t, "stories", {
        title: "tagged",
        status: "draft",
        tags: [tag],
      });
      ids.storySupplied = await created(t, "stories", {
        title: "supplied",
        status: "draft",
      });
      ids.storyTwoTags = await created(t, "stories", {
        title: "two tags",
        status: "draft",
        tags: [tag, tag2],
      });

      // Live, then taken down: its next publish is a republish.
      ids.republished = await created(t, "drafted", {
        title: "republished",
        status: "published",
      });
      expect(
        (
          await entriesOf(t).updateEntry(
            {
              collectionName: "drafted",
              entryId: ids.republished,
              overrideAccess: true,
            },
            { status: "draft", _overwrite: true }
          )
        ).success
      ).toBe(true);
      // Live with a hero, and a pending change that clears it.
      ids.promoted = await created(t, "drafted", {
        title: "promoted",
        status: "published",
        hero: hero("Live"),
      });
      expect(
        (
          await entriesOf(t).updateEntry(
            {
              collectionName: "drafted",
              entryId: ids.promoted,
              overrideAccess: true,
            },
            { hero: null, _overwrite: true }
          )
        ).success
      ).toBe(true);

      ids.everyLanguage = await created(
        t,
        "guides",
        { title: "every", status: "draft" },
        "en"
      );
      ids.german = await created(
        t,
        "guides",
        { title: "german", status: "draft" },
        "en"
      );
      ids.english = await created(
        t,
        "guides",
        { title: "english", status: "draft" },
        "en"
      );

      ids.draftOnly = await created(t, "checked", {
        title: "draft only",
        status: "draft",
        hero: hero("draft only"),
      });
      ids.noteDraftOnly = await created(t, "annotated", {
        title: "draft only note",
        status: "draft",
        note: { body: "draft only" },
      });
      ids.noteFine = await created(t, "annotated", {
        title: "fine note",
        status: "draft",
        note: { body: "fine" },
      });
      ids.nested = await created(t, "checked", {
        title: "nested",
        status: "draft",
        hero: { heading: "fine", code: "retired" },
      });
      ids.nestedFine = await created(t, "checked", {
        title: "nested fine",
        status: "draft",
        hero: { heading: "fine", code: "current" },
      });
      for (const name of ["nestedBatchA", "nestedBatchB"]) {
        ids[name] = await created(t, "checked", {
          title: name,
          status: "draft",
          hero: { heading: "fine", code: "retired" },
        });
      }
      for (const name of ["germanNested", "englishNested"]) {
        ids[name] = await created(
          t,
          "guides",
          {
            title: name,
            status: "draft",
            hero: { heading: "fine", code: "retired" },
          },
          "en"
        );
      }
      // Live with a hero that meets its rules, and a pending change to one
      // that, once the rule is tightened, does not.
      ids.promotedNested = await created(t, "drafted", {
        title: "promoted nested",
        status: "published",
        hero: { heading: "Live", code: "current" },
      });
      expect(
        (
          await entriesOf(t).updateEntry(
            {
              collectionName: "drafted",
              entryId: ids.promotedNested,
              overrideAccess: true,
            },
            { hero: { heading: "Live", code: "retired" }, _overwrite: true }
          )
        ).success
      ).toBe(true);

      ids.missingDe = await created(t, "pages", {
        title: "missing, published in German",
        status: "draft",
      });
      // Live in English with no hero, and a German change pending.
      ids.manualGerman = await created(
        t,
        "manuals",
        { title: "Manual", status: "published" },
        "en"
      );
      expect(
        (
          await entriesOf(t).updateEntry(
            {
              collectionName: "manuals",
              entryId: ids.manualGerman,
              overrideAccess: true,
              locale: "de",
            },
            { title: "Handbuch", _overwrite: true }
          )
        ).success
      ).toBe(true);
      // Live in English, German titled "Blocked" and not yet live, and an
      // English change pending that gives the shared hero a heading German
      // forbids.
      ids.manualSwept = await created(
        t,
        "manuals",
        { title: "Fine", status: "published", hero: hero("Good") },
        "en"
      );
      for (const [locale, data] of [
        ["de", { title: "Blocked", status: "draft" }],
        ["en", { hero: hero("Bad") }],
      ] as const) {
        expect(
          (
            await entriesOf(t).updateEntry(
              {
                collectionName: "manuals",
                entryId: ids.manualSwept,
                overrideAccess: true,
                locale,
              },
              { ...data, _overwrite: true }
            )
          ).success
        ).toBe(true);
      }
      for (const name of ["notebookGerman"]) {
        ids[name] = await created(
          t,
          "notebooks",
          { title: name, status: "draft", memo: { code: "retired" } },
          "en"
        );
      }
      // The German translation of the memo holds the same stored value.
      expect(
        (
          await entriesOf(t).updateEntry(
            {
              collectionName: "notebooks",
              entryId: ids.notebookGerman,
              overrideAccess: true,
              locale: "de",
            },
            { memo: { code: "retired" }, _overwrite: true }
          )
        ).success
      ).toBe(true);
      ids.vault = await created(t, "vaults", {
        title: "vault",
        status: "draft",
        secured: { label: "front door", pin: "1234" },
        shell: { label: "wrapper", core: card("inside") },
      });
      ids.aside = await created(t, "asides", {
        title: "aside",
        status: "draft",
      });
      // Each holds the one tag its required relationship needs.
      for (const name of ["raceA", "raceB"]) {
        ids[name] = await created(t, "stories", {
          title: name,
          status: "draft",
          tags: [tag],
        });
      }
      // Live with no hero, and a pending change to the translated note.
      for (const name of ["notedGerman", "notedEnglish"]) {
        ids[name] = await created(t, "noted", {
          title: name,
          status: "published",
          note: { body: "translated" },
        });
        expect(
          (
            await entriesOf(t).updateEntry(
              {
                collectionName: "noted",
                entryId: ids[name],
                overrideAccess: true,
              },
              { note: { body: "changed" }, _overwrite: true }
            )
          ).success
        ).toBe(true);
      }
      for (const name of ["zonedA", "zonedB"]) {
        ids[name] = await created(t, "zoned", {
          title: name,
          status: "draft",
          blocks: [
            { [currentFieldGroupTypeKey]: "note", body: `${name} 1` },
            { [currentFieldGroupTypeKey]: "quote", body: `${name} 2` },
            { [currentFieldGroupTypeKey]: "note", body: `${name} 3` },
            { [currentFieldGroupTypeKey]: "quote", body: `${name} 4` },
            { [currentFieldGroupTypeKey]: "note", body: `${name} 5` },
          ],
        });
      }
      // Live, with a pending change saved before `extra` existed.
      ids.evolving = await created(t, "evolving", {
        title: "evolving",
        status: "published",
      });
      expect(
        (
          await entriesOf(t).updateEntry(
            {
              collectionName: "evolving",
              entryId: ids.evolving,
              overrideAccess: true,
            },
            { title: "evolved", _overwrite: true }
          )
        ).success
      ).toBe(true);
      // Live, with a pending change saved before `extra` existed; `extra` is
      // then stored on the live entry, so the change goes live with it.
      ids.growing = await created(t, "growing", {
        title: "growing",
        status: "published",
      });
      expect(
        (
          await entriesOf(t).updateEntry(
            {
              collectionName: "growing",
              entryId: ids.growing,
              overrideAccess: true,
            },
            { title: "grown", _overwrite: true }
          )
        ).success
      ).toBe(true);
      // The same, for a publish of every language.
      ids.growingAll = await created(t, "growing", {
        title: "growing",
        status: "published",
      });
      expect(
        (
          await entriesOf(t).updateEntry(
            {
              collectionName: "growing",
              entryId: ids.growingAll,
              overrideAccess: true,
            },
            { title: "grown", _overwrite: true }
          )
        ).success
      ).toBe(true);
      // Live in English, German not yet live, and an English change pending
      // from before `remark` existed.
      ids.sweeping = await created(
        t,
        "sweeping",
        { title: "Fine", status: "published" },
        "en"
      );
      for (const [locale, data] of [
        ["de", { title: "Fein", status: "draft" }],
        ["en", { title: "Finer" }],
      ] as const) {
        expect(
          (
            await entriesOf(t).updateEntry(
              {
                collectionName: "sweeping",
                entryId: ids.sweeping,
                overrideAccess: true,
                locale,
              },
              { ...data, _overwrite: true }
            )
          ).success
        ).toBe(true);
      }
      ids.vaulted = await created(t, "vaulted", {
        title: "vaulted",
        items: [1, 2, 3, 4, 5].map(at => ({
          heading: `item ${at}`,
          box: { b: `b ${at}`, pin: `pin-${at}` },
        })),
      });
      ids.bannered = await created(t, "bannered", {
        title: "bannered",
        status: "draft",
      });

      await makeRequired(t, "pages", ["hero", "cards", "zone"]);
      await makeRequired(t, "noted", ["hero"]);
      await addField(
        t,
        "evolving",
        fieldGroup({ name: "extra", component: "card", required: true })
      );
      await addField(
        t,
        "growing",
        fieldGroup({ name: "extra", component: "card", required: true })
      );
      // `remark` is added, its rule refusing a "bad" remark, and stored in
      // each language: fine in English, refused in German.
      const remark = fieldGroup({ name: "remark", component: "note" });
      await addField(t, "sweeping", remark);
      registerFieldFunctions("collection", "sweeping", [
        text({ name: "title", localized: true }),
        {
          ...remark,
          validate: (value: unknown) =>
            (value as Doc | null)?.body !== "bad" || "this remark is bad",
        },
      ]);
      for (const [locale, body] of [
        ["en", "good"],
        ["de", "bad"],
      ] as const) {
        await (
          t.getService("fieldGroupDataService") as FieldGroupDataService
        ).saveComponentData({
          parentId: ids.sweeping,
          parentTable: "dc_sweeping",
          access: { overrideAccess: true },
          fields: [remark] as never,
          data: { remark: { body } },
          locale,
        });
      }
      await (
        t.getService("fieldGroupDataService") as FieldGroupDataService
      ).saveComponentData({
        parentId: ids.growing,
        parentTable: "dc_growing",
        access: { overrideAccess: true },
        fields: [fieldGroup({ name: "extra", component: "card" })] as never,
        data: { extra: card("stored") },
      });
      await (
        t.getService("fieldGroupDataService") as FieldGroupDataService
      ).saveComponentData({
        parentId: ids.growingAll,
        parentTable: "dc_growing",
        access: { overrideAccess: true },
        fields: [fieldGroup({ name: "extra", component: "card" })] as never,
        data: { extra: card("stored") },
      });
      await makeRequired(t, "manuals", ["hero"]);
      await makeRequired(t, "drafted", ["hero"]);
      await makeRequired(t, "guides", ["hero"]);
      await makeRequired(t, "stories", ["tags"]);
      registerTagsRule();
    });

    afterAll(async () => {
      await t?.destroy();
    });

    it("refuses a first publish whose required components are missing from storage", async () => {
      const result = await publish(t, "pages", ids.missing);

      expect(result.success).toBe(false);
      expect(refusedPaths(result)).toEqual(
        expect.arrayContaining(["hero", "cards", "zone"])
      );
    });

    it("refuses a publish whose required many-to-many relationship is empty", async () => {
      const result = await publish(t, "stories", ids.storyEmpty);

      expect(result.success).toBe(false);
      expect(refusedPaths(result)).toContain("tags");
    });

    it("publishes a document whose required components and relationship are stored", async () => {
      const page = await publish(t, "pages", ids.complete);
      expect(page.success, JSON.stringify(page)).toBe(true);

      const story = await publish(t, "stories", ids.storyTagged);
      expect(story.success, JSON.stringify(story)).toBe(true);
    });

    it("publishes when the publish request itself supplies the missing values", async () => {
      const page = await publish(t, "pages", ids.supplied, {
        hero: hero("Sent"),
        cards: [card("sent")],
      });
      expect(page.success, JSON.stringify(page)).toBe(true);

      const story = await publish(t, "stories", ids.storySupplied, {
        tags: [ids.tag],
      });
      expect(story.success, JSON.stringify(story)).toBe(true);
    });

    it("refuses a republish after an unpublish", async () => {
      const result = await publish(t, "drafted", ids.republished);

      expect(result.success).toBe(false);
      expect(refusedPaths(result)).toContain("hero");
    });

    it("refuses promoting a pending change that clears a required component", async () => {
      const result = await publish(t, "drafted", ids.promoted);

      expect(result.success).toBe(false);
      expect(refusedPaths(result)).toContain("hero");
    });

    it("does not judge again a live document sent published again", async () => {
      const result = await publish(t, "pages", ids.live);

      expect(result.success, JSON.stringify(result)).toBe(true);
    });

    it("refuses each document of a batch publish that lacks them", async () => {
      const batch = await entriesOf(t).updateEntries(
        { collectionName: "pages", overrideAccess: true },
        [ids.batchA, ids.batchB].map(id => ({
          id,
          data: { status: "published", _overwrite: true },
        }))
      );
      expect(batch).toMatchObject({ successful: 0, failed: 2 });

      const bulk = await entriesOf(t).bulkUpdateEntries({
        collectionName: "pages",
        ids: [ids.bulkA, ids.bulkB],
        // Refused for what each lacks, not for want of a version.
        data: { status: "published", _overwrite: true },
        overrideAccess: true,
      });
      expect(bulk.successes).toHaveLength(0);
      expect(bulk.failures).toHaveLength(2);
    });

    it("refuses publishing every language at once", async () => {
      const result = await entriesOf(t).publishAllLocales({
        collectionName: "guides",
        entryId: ids.everyLanguage,
        overrideAccess: true,
        data: { _overwrite: true },
      });

      expect(result.success).toBe(false);
      expect(refusedPaths(result)).toContain("hero");
    });

    it("enforces a required component for the default language only", async () => {
      const german = await publish(t, "guides", ids.german, {}, "de");
      expect(german.success, JSON.stringify(german)).toBe(true);

      const english = await publish(t, "guides", ids.english, {}, "en");
      expect(english.success).toBe(false);
      expect(refusedPaths(english)).toContain("hero");
    });

    it("runs the top-level component's and the relationship's own rules on what goes live", async () => {
      const page = await publish(t, "checked", ids.draftOnly);
      expect(page.success).toBe(false);
      expect(refusedPaths(page)).toContain("hero");

      const story = await publish(t, "stories", ids.storyTwoTags);
      expect(story.success).toBe(false);
      expect(refusedPaths(story)).toContain("tags");
    });

    it("refuses a component instance that breaks a rule tightened since it was saved, naming the field inside it", async () => {
      nestedRuleOn = true;
      try {
        const refused = await publish(t, "checked", ids.nested);
        expect(refused.success).toBe(false);
        expect(refusedPaths(refused)).toContain("hero.code");

        const meets = await publish(t, "checked", ids.nestedFine);
        expect(meets.success, JSON.stringify(meets)).toBe(true);

        // A pending change promoted over the live document is judged too.
        const promoted = await publish(t, "drafted", ids.promotedNested);
        expect(promoted.success).toBe(false);
        expect(refusedPaths(promoted)).toContain("hero.code");

        // Each document of a batch.
        const batch = await entriesOf(t).updateEntries(
          { collectionName: "checked", overrideAccess: true },
          [ids.nestedBatchA, ids.nestedBatchB].map(id => ({
            id,
            data: { status: "published", _overwrite: true },
          }))
        );
        expect(batch).toMatchObject({ successful: 0, failed: 2 });
      } finally {
        nestedRuleOn = false;
      }
    });

    it("publishes an instance whose required password is stored, and whose required direct component is stored beneath it", async () => {
      // A stored password reads back as absent, which is not a missing value;
      // a component placed directly in a component is read from its own row.
      const result = await publish(t, "vaults", ids.vault);

      expect(result.success, JSON.stringify(result)).toBe(true);
    });

    it("judges a component instance's own rules in the default language only", async () => {
      nestedRuleOn = true;
      try {
        // A translation falls back to the default language's values, so it
        // is not refused for them, as a required component is not.
        const german = await publish(t, "guides", ids.germanNested, {}, "de");
        expect(german.success, JSON.stringify(german)).toBe(true);

        const english = await publish(t, "guides", ids.englishNested, {}, "en");
        expect(english.success).toBe(false);
        expect(refusedPaths(english)).toContain("hero.code");

        // Translated only through a localized component, with no field of its
        // own to translate: a publish names no language of its own, so the
        // document goes live as one, judged in the default language.
        const germanBook = await publish(
          t,
          "notebooks",
          ids.notebookGerman,
          {},
          "de"
        );
        expect(germanBook.success).toBe(false);
        expect(refusedPaths(germanBook)).toContain("memo.code");
      } finally {
        nestedRuleOn = false;
      }
    });

    it("reads a bulk publish's components and relationships once, whatever its size, and a batch's per entry under its lock", async () => {
      const bulkReads = async (
        collection: string,
        names: readonly string[]
      ): Promise<number> => {
        const reads = countRelationReads();
        try {
          await entriesOf(t).bulkUpdateEntries({
            collectionName: collection,
            ids: names.map(name => ids[name]),
            // The reads a publish makes are under test, not versions.
            data: { status: "published", _overwrite: true },
            overrideAccess: true,
          });
          return reads.count();
        } finally {
          reads.restore();
        }
      };
      /** The ids each read in a batch publish's transaction names. */
      const batchReadIds = async (
        collection: string,
        names: readonly string[]
      ): Promise<string[][]> => {
        const components = vi.spyOn(
          FieldGroupDataService.prototype,
          "populateComponentDataMany"
        );
        const links = vi.spyOn(
          CollectionRelationshipService.prototype,
          "fetchManyToManyTargetIdsOf"
        );
        try {
          await entriesOf(t).updateEntries(
            { collectionName: collection, overrideAccess: true },
            names.map(name => ({
              id: ids[name],
              data: { status: "published", _overwrite: true },
            }))
          );
          return [
            ...components.mock.calls.map(([read]) =>
              read.entries.map(entry => String(entry.id))
            ),
            ...links.mock.calls.map(([, entryIds]) => [...entryIds]),
          ];
        } finally {
          components.mockRestore();
          links.mockRestore();
        }
      };

      // The definitions its instances are judged against are asked of the
      // batch, which reads each once for all its documents.
      const viaBatch = vi.spyOn(
        GoingLiveRelationsBatch.prototype,
        "componentFields"
      );
      try {
        await batchReadIds("checked", ["nestedBatchA", "nestedBatchB"]);
        expect(viaBatch).toHaveBeenCalled();
      } finally {
        viaBatch.mockRestore();
      }

      // Every document is refused, so each batch can be asked again.
      const bulkTwo = await bulkReads("pages", ["count0", "count1"]);
      expect(bulkTwo).toBeGreaterThan(0);
      expect(
        await bulkReads("pages", ["count0", "count1", "count2", "count3"])
      ).toBe(bulkTwo);

      // A batch on one transaction reads each entry's alone, once it holds
      // that entry's lock: every entry is read, and no read names another.
      for (const [collection, names] of [
        ["pages", ["count0", "count1", "count2", "count3"]],
        [
          "stories",
          ["storyCount0", "storyCount1", "storyCount2", "storyCount3"],
        ],
      ] as const) {
        const reads = await batchReadIds(collection, names);
        expect(reads.every(read => read.length === 1)).toBe(true);
        expect(new Set(reads.flat())).toEqual(
          new Set(names.map(name => ids[name]))
        );
      }
    });

    it("keeps a required component enforced on a collection without languages, whatever language a publish names", async () => {
      const result = await publish(t, "pages", ids.missingDe, {}, "de");

      expect(result.success).toBe(false);
      expect(refusedPaths(result)).toContain("hero");
    });

    it("lets a pending change in another language go live while the required component is missing", async () => {
      const result = await publish(t, "manuals", ids.manualGerman, {}, "de");

      expect(result.success, JSON.stringify(result)).toBe(true);
    });

    it("judges each language a publish of every language puts live with the change it promotes", async () => {
      // The wildcard write promotes the pending change into every language.
      const result = await publish(t, "manuals", ids.manualSwept, {}, "*");

      expect(result.success).toBe(false);
      expect(refusedPaths(result)).toContain("hero");
    });

    it("stops a release whose document lacks a required component, naming it and the field, and publishes none of it", async () => {
      const author = await seedPlainAuthor(t);
      for (const action of ["read", "update", "publish", "unpublish"]) {
        await grantTo(t, author, action, ["pages"]);
      }
      const release = await t.nextly.releases.create({ title: "Launch" });
      const members: Record<string, string> = {};
      for (const name of ["releaseMissing", "releaseComplete"]) {
        const member = await t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug: "pages",
          entryId: ids[name],
          locale: null,
          action: "publish",
          userId: author,
        });
        members[name] = member.id;
      }

      const readiness = await t.nextly.releases.readiness({
        releaseId: release.id,
      });
      expect(readiness.hard).toEqual([
        expect.objectContaining({
          memberId: members.releaseMissing,
          code: "REQUIRED_FIELD_MISSING",
          detail: {
            fields: expect.arrayContaining(["hero", "cards", "zone"]),
          },
        }),
      ]);

      await expect(
        t.nextly.releases.publishNow({ id: release.id })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      for (const name of ["releaseMissing", "releaseComplete"]) {
        const row = await t.adapter.selectOne<{ status?: string }>("dc_pages", {
          where: { and: [{ column: "id", op: "=", value: ids[name] }] },
        });
        expect(row?.status).toBe("draft");
      }
    });

    it("judges each document of a batch publish on what is stored once the batch has locked it", async () => {
      const relationships = t.getService(
        "relationshipService"
      ) as unknown as CollectionRelationshipService;
      const junction = relationships.getJunctionTableName(
        "stories",
        "tags",
        TAGS_FIELD as Parameters<
          CollectionRelationshipService["getJunctionTableName"]
        >[2]
      );
      const { sourceColumn } = junctionLinkColumns("stories", "tags");
      // The other writer, which takes `raceB`'s tag away once the batch has
      // locked `raceA` and read its relations, and before it reaches
      // `raceB`. Begun here, before the batch opens its transaction, so its
      // statement runs outside that transaction: on PostgreSQL and MySQL on
      // a connection of its own, committed at once, while the batch holds
      // `raceA`'s lock only. On MySQL this is after the batch's first read,
      // which under REPEATABLE READ would fix what every later read sees.
      // SQLite has one connection and one writer, so
      // there the statement lands between the batch's two rows on that
      // connection, which proves the order the batch reads in: what a
      // document is judged on is read after the batch reaches it.
      let letWriterRun = (): void => undefined;
      const writerMayRun = new Promise<void>(resolve => {
        letWriterRun = resolve;
      });
      const writer = (async () => {
        await writerMayRun;
        await t.adapter.executeQuery(
          `DELETE FROM ${junction} WHERE ${sourceColumn} = '${ids.raceB}'`
        );
      })();
      const read =
        CollectionRelationshipService.prototype.fetchManyToManyTargetIdsOf;
      let interleaved = false;
      const spy = vi
        .spyOn(
          CollectionRelationshipService.prototype,
          "fetchManyToManyTargetIdsOf"
        )
        .mockImplementation(async function (
          this: CollectionRelationshipService,
          ...args: Parameters<typeof read>
        ) {
          const targets = await read.apply(this, args);
          if (!interleaved && args[1].includes(ids.raceA)) {
            interleaved = true;
            letWriterRun();
            await writer;
          }
          return targets;
        });
      try {
        const batch = await entriesOf(t).updateEntries(
          { collectionName: "stories", overrideAccess: true },
          [ids.raceA, ids.raceB].map(id => ({
            id,
            data: { status: "published", _overwrite: true },
          }))
        );
        expect(interleaved).toBe(true);
        expect(batch).toMatchObject({ successful: 1, failed: 1 });
      } finally {
        spy.mockRestore();
        letWriterRun();
        await writer;
      }
      for (const [name, status] of [
        ["raceA", "published"],
        ["raceB", "draft"],
      ] as const) {
        const row = await t.adapter.selectOne<{ status?: string }>(
          "dc_stories",
          { where: { and: [{ column: "id", op: "=", value: ids[name] }] } }
        );
        expect(row?.status).toBe(status);
      }
    });

    it("lets a pending change go live outside the default language where only a component is translated", async () => {
      const german = await publish(t, "noted", ids.notedGerman, {}, "de");
      expect(german.success, JSON.stringify(german)).toBe(true);

      const english = await publish(t, "noted", ids.notedEnglish, {}, "en");
      expect(english.success).toBe(false);
      expect(refusedPaths(english)).toContain("hero");
    });

    it("refuses promoting a pending change saved before a required component was added", async () => {
      const result = await publish(t, "evolving", ids.evolving);

      expect(result.success).toBe(false);
      expect(refusedPaths(result)).toContain("extra");
    });

    it("refuses a promotion whose stored required component is removed before the publish locks the entry", async () => {
      const registry = t.getService("fieldGroupRegistryService") as {
        getComponent(slug: string): Promise<{ tableName: string }>;
      };
      const { tableName } = await registry.getComponent("card");
      // The other writer, which removes the entry's stored `extra` once the
      // publish has judged the pending change with it, before locking the
      // entry. Begun here, outside any transaction: on PostgreSQL a commit on
      // a connection of its own; on SQLite, whose one writer the publish
      // does not hold yet, a statement between that judgement and the lock,
      // which proves the publish reads `extra` again once it holds the lock.
      let letWriterRun = (): void => undefined;
      const writerMayRun = new Promise<void>(resolve => {
        letWriterRun = resolve;
      });
      const writer = (async () => {
        await writerMayRun;
        await t.adapter.executeQuery(
          `DELETE FROM ${tableName} WHERE _parent_id = '${ids.growing}' AND _parent_field = 'extra'`
        );
      })();
      const read = FieldGroupDataService.prototype.populateComponentDataMany;
      let interleaved = false;
      const spy = vi
        .spyOn(FieldGroupDataService.prototype, "populateComponentDataMany")
        .mockImplementation(async function (
          this: FieldGroupDataService,
          ...args: Parameters<typeof read>
        ) {
          const populated = await read.apply(this, args);
          if (
            !interleaved &&
            args[0].entries.some(entry => entry.id === ids.growing)
          ) {
            interleaved = true;
            letWriterRun();
            await writer;
          }
          return populated;
        });
      let result: Result;
      try {
        result = await publish(t, "growing", ids.growing);
        expect(interleaved).toBe(true);
      } finally {
        spy.mockRestore();
        letWriterRun();
        await writer;
      }

      expect(result.success).toBe(false);
      expect(refusedPaths(result)).toContain("extra");
      // Nothing was promoted: the live entry keeps its title.
      const row = await t.adapter.selectOne<{ title?: string }>("dc_growing", {
        where: { and: [{ column: "id", op: "=", value: ids.growing }] },
      });
      expect(row?.title).toBe("growing");
    });

    // A publish of every language promotes a pending change as a publish of
    // one language does, so it is judged on what is stored once it holds the
    // entry's lock. The plausible broken implementation judges the change's
    // relations as they were read before the lock, and puts live a document
    // whose required component another writer removed in between.
    it("refuses publishing every language once a required component it promotes with is removed before the lock", async () => {
      const registry = t.getService("fieldGroupRegistryService") as {
        getComponent(slug: string): Promise<{ tableName: string }>;
      };
      const { tableName } = await registry.getComponent("card");
      // The other writer, run just before the publish opens its transaction:
      // after everything the publish judges off the lock, before the lock.
      const transaction = t.adapter.transaction.bind(t.adapter);
      let removed = false;
      const spy = vi
        .spyOn(t.adapter, "transaction")
        .mockImplementationOnce(async (...args) => {
          await t.adapter.executeQuery(
            `DELETE FROM ${tableName} WHERE _parent_id = '${ids.growingAll}' AND _parent_field = 'extra'`
          );
          removed = true;
          return transaction(...args);
        });
      let result: Result;
      try {
        result = await entriesOf(t).publishAllLocales({
          collectionName: "growing",
          entryId: ids.growingAll,
          overrideAccess: true,
          data: { _overwrite: true },
        });
        expect(removed).toBe(true);
      } finally {
        spy.mockRestore();
      }

      expect(result.success).toBe(false);
      expect(refusedPaths(result)).toContain("extra");
      // Nothing was promoted: the live entry keeps its title.
      const row = await t.adapter.selectOne<{ title?: string }>("dc_growing", {
        where: { and: [{ column: "id", op: "=", value: ids.growingAll }] },
      });
      expect(row?.title).toBe("growing");
    });

    it("judges each language a publish of every language promotes into with that language's stored component", async () => {
      // The pending change does not name `remark`: German goes live with its
      // own stored remark, which its rule refuses, not English's.
      const result = await publish(t, "sweeping", ids.sweeping, {}, "*");

      expect(result.success).toBe(false);
      expect(refusedPaths(result)).toContain("remark");
    });

    it("reads a zone's translations within the database's limit on a statement's parameters", async () => {
      // A limit of four: one language and three instances to a statement,
      // where each kind here has four or six.
      const budget = 4;
      const reads = recordTranslationReads(t, budget);
      try {
        const read = await readZones(t, "en");

        expect(
          read.map(entry => (entry.blocks as Doc[]).map(block => block.body))
        ).toEqual(
          ["zonedA", "zonedB"].map(name =>
            [1, 2, 3, 4, 5].map(at => `${name} ${at}`)
          )
        );
        // Each kind in runs: six notes and four quotes, three to a run.
        expect(reads.binds).toHaveLength(4);
        expect(reads.binds.every(bound => bound <= budget)).toBe(true);
      } finally {
        reads.restore();
      }
    });

    it("splits the languages of a read of every translation where they alone reach the limit", async () => {
      // A limit of two, which the two languages of a read of every
      // translation reach with no instance at all.
      const budget = 2;
      const reads = recordTranslationReads(t, budget);
      try {
        const read = await readZones(t, "all");

        expect(
          read.map(entry => (entry.blocks as Doc[]).map(block => block.body))
        ).toEqual(
          ["zonedA", "zonedB"].map(name =>
            [1, 2, 3, 4, 5].map(at => ({ en: `${name} ${at}`, de: null }))
          )
        );
        expect(reads.binds.length).toBeGreaterThan(0);
        expect(reads.binds.every(bound => bound <= budget)).toBe(true);
      } finally {
        reads.restore();
      }
    });

    it("returns no translation, raw value or password from a read whose later translations statement fails", async () => {
      // A limit of four: three instances to a statement for one language, two
      // for both, so five instances take more than one statement either way.
      const items = async (locale: string, failRead: number) => {
        const reads = recordTranslationReads(t, 4, failRead);
        try {
          const fieldGroups = t.getService(
            "fieldGroupDataService"
          ) as FieldGroupDataService;
          const [entry] = await fieldGroups.populateComponentDataMany({
            entries: [{ id: ids.vaulted }],
            parentTable: "dc_vaulted",
            fields: [
              fieldGroup({
                name: "items",
                component: "vault",
                repeatable: true,
              }),
            ] as never,
            depth: 0,
            locale,
          });
          expect(reads.binds.length).toBeGreaterThanOrEqual(failRead);
          return entry.items as Doc[];
        } finally {
          reads.restore();
        }
      };
      for (const locale of ["en", "all"]) {
        // Where the first statement fails, nothing is translated: what a
        // failed read returned when it was one statement.
        const unread = await items(locale, 1);
        expect(unread).toHaveLength(5);
        expect(JSON.stringify(unread)).not.toMatch(/item \d|pin/);

        // A later statement failing returns the same, with no item carrying
        // what the statements before it read.
        expect(await items(locale, 2)).toEqual(unread);
      }
    });

    it("reads a zone's translations once for each kind, not once for each instance", async () => {
      const overlays = vi.spyOn(
        FieldGroupQueryService.prototype as unknown as {
          overlayLocalizedComponent(
            meta: { slug: string; localized?: boolean },
            rows: Record<string, unknown>[]
          ): Promise<void>;
        },
        "overlayLocalizedComponent"
      );
      try {
        const fieldGroups = t.getService(
          "fieldGroupDataService"
        ) as FieldGroupDataService;
        const read = await fieldGroups.populateComponentDataMany({
          entries: [{ id: ids.zonedA }, { id: ids.zonedB }],
          parentTable: "dc_zoned",
          fields: [
            fieldGroup({
              name: "blocks",
              components: ["note", "quote"],
              repeatable: true,
            }),
          ] as never,
          depth: 0,
          strict: true,
          locale: "en",
          fallbackLocale: false,
        });

        // Every instance carries its translation, in its stored order.
        expect(
          read.map(entry => (entry.blocks as Doc[]).map(block => block.body))
        ).toEqual(
          ["zonedA", "zonedB"].map(name =>
            [1, 2, 3, 4, 5].map(at => `${name} ${at}`)
          )
        );
        // One translations read per kind, for every instance of it at once.
        const translated = overlays.mock.calls.filter(
          ([meta, rows]) => meta.localized === true && rows.length > 0
        );
        expect(translated.map(([meta]) => meta.slug).sort()).toEqual([
          "note",
          "quote",
        ]);
        expect(translated.map(([, rows]) => rows.length).sort()).toEqual([
          4, 6,
        ]);
      } finally {
        overlays.mockRestore();
      }
    });

    it("reads a component table not yet created as empty when a release's readiness is judged", async () => {
      const registry = t.getService("fieldGroupRegistryService") as {
        getComponent(slug: string): Promise<{ tableName: string }>;
      };
      const { tableName } = await registry.getComponent("banner");
      await t.adapter.executeQuery(`DROP TABLE ${tableName}`);
      const author = await seedPlainAuthor(t);
      for (const action of ["read", "update", "publish", "unpublish"]) {
        await grantTo(t, author, action, ["bannered"]);
      }
      const release = await t.nextly.releases.create({ title: "Banner" });
      await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "collection",
        scopeSlug: "bannered",
        entryId: ids.bannered,
        locale: null,
        action: "publish",
        userId: author,
      });

      // Judged on the pool, writing nothing: the optional banner, whose table
      // does not exist yet, reads as absent rather than failing the check.
      const readiness = await t.nextly.releases.readiness({
        releaseId: release.id,
      });

      expect(readiness.hard).toEqual([]);
    });

    // Last: it removes the note group's translations table.
    it("judges a localized group's stored value, and refuses when it cannot be read", async () => {
      // The rule sees the stored translation, so the publish is refused.
      const judged = await publish(t, "annotated", ids.noteDraftOnly);
      expect(judged.success).toBe(false);
      expect(refusedPaths(judged)).toContain("note");

      const registry = t.getService("fieldGroupRegistryService") as {
        getComponent(slug: string): Promise<{ tableName: string }>;
      };
      const { tableName } = await registry.getComponent("note");
      await t.adapter.executeQuery(`DROP TABLE ${tableName}_locales`);

      // The read a publish judges with, off any transaction: it is told the
      // translations could not be read, rather than given the shared values
      // alone, which the rule would pass.
      const fieldGroups = t.getService(
        "fieldGroupDataService"
      ) as FieldGroupDataService;
      await expect(
        fieldGroups.populateComponentDataMany({
          entries: [{ id: ids.noteFine }],
          parentTable: "dc_annotated",
          fields: [fieldGroup({ name: "note", component: "note" })] as never,
          depth: 0,
          strict: true,
          locale: "en",
          fallbackLocale: false,
        })
      ).rejects.toThrow();
    });

    // Last: it removes the aside group's table.
    it("refuses alike on every dialect when a publish cannot read a component inside its transaction", async () => {
      const registry = t.getService("fieldGroupRegistryService") as {
        getComponent(slug: string): Promise<{ tableName: string }>;
      };
      const { tableName } = await registry.getComponent("aside");
      await t.adapter.executeQuery(`DROP TABLE ${tableName}`);

      // Publishing every language judges on its own transaction.
      const result = await entriesOf(t).publishAllLocales({
        collectionName: "asides",
        entryId: ids.aside,
        overrideAccess: true,
        data: { _overwrite: true },
      });

      expect(result.success).toBe(false);
      const row = await t.adapter.selectOne<{ status?: string }>("dc_asides", {
        where: { and: [{ column: "id", op: "=", value: ids.aside }] },
      });
      expect(row?.status).toBe("draft");
    });
  }
);
