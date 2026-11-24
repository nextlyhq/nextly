/**
 * The moves a Schema Builder save refuses, each sent to the save (and its review) directly, on every
 * configured dialect, with nothing about the database changed: the tables, their columns, indexes
 * and rows, the definition file, the registry rows and the migrations folder. Beside them, the
 * moves that are the way round the refusals: a one-to-one made many-to-one and then moved into a
 * group, and a one-to-one moved out of a group onto its entity's row, which makes it unique.
 *
 * Run from one file per storage layout: the layout the suites default to, and the per-language
 * layout every installation runs. A translated one-to-one is among the fields, whose values the
 * per-language layout keeps in its own table.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import type { ServiceContainer } from "../../../../services";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import type { CollectionService } from "../../../collections/services/collection-service";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";

import { databaseState } from "./refused-moves-state";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const PEOPLE = "rfx_people";
const POSTS = "rfx_posts";
const HOME = "rfx_home";
const FRAME = "rfx_frame";
/** Every table this suite owns, and each language table beside one, starts with one of these. */
const TABLE_PREFIXES = ["dc_rfx_", "single_rfx_", "comp_rfx_"];

type Field = Record<string, unknown>;
type Move = { from: string[]; to: string[] };

const NOTE: Field = { name: "note", type: "text" };
const HEADLINE: Field = { name: "headline", type: "text" };
/** A plugin's field type, as a Blocks field is declared: its values are one JSON document. */
const PAGE: Field = { name: "page", type: "blocks" };
const PLUGIN = definePlugin({
  name: "@test/refused-moves-blocks",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    fieldTypes: [
      {
        type: "blocks",
        storage: "json",
        component: "@test/refused-moves-blocks/admin#Blocks",
      },
    ],
  },
});

const group = (name: string, fields: Field[]): Field => ({
  name,
  type: "group",
  fields,
});
const repeater = (name: string, fields: Field[]): Field => ({
  name,
  type: "repeater",
  fields,
});

const CODE: Field = { name: "code", type: "text", unique: true };
const person = (extra: Field = {}): Field => ({
  name: "person",
  type: "relationship",
  relationTo: PEOPLE,
  ...extra,
});
const ONE_TO_ONE = person({ unique: true });
/** The relationship a one-to-one becomes when it is changed to many-to-one. */
const MANY_TO_ONE = person();

/** The containers a field is moved into, each holding a field of its own beforehand. */
const META = (inside: Field[] = []) => group("meta", [NOTE, ...inside]);
const OUTER = (inside: Field[] = [], deep: Field[] = []) =>
  group("outer", [
    group("inner", [NOTE, ...inside, group("deep", [NOTE, ...deep])]),
  ]);
const ITEMS = (inside: Field[] = []) =>
  repeater("items", [NOTE, group("row", [NOTE, ...inside])]);
const CONTAINERS = [META(), OUTER(), ITEMS()];

/** Where a unique field is moved to, at one depth, two and three, and what the refusal names. */
const TARGETS: {
  what: string;
  path: string[];
  fields: (moved: Field) => Field[];
  noun: "group" | "repeater";
  holder: string;
}[] = [
  {
    what: "a group",
    path: ["meta"],
    fields: moved => [META([moved]), OUTER(), ITEMS()],
    noun: "group",
    holder: "meta",
  },
  {
    what: "a group inside a group",
    path: ["outer", "inner"],
    fields: moved => [META(), OUTER([moved]), ITEMS()],
    noun: "group",
    holder: "outer",
  },
  {
    what: "a group three deep",
    path: ["outer", "inner", "deep"],
    fields: moved => [META(), OUTER([], [moved]), ITEMS()],
    noun: "group",
    holder: "outer",
  },
  {
    what: "a repeater",
    path: ["items"],
    fields: moved => [
      META(),
      OUTER(),
      repeater("items", [NOTE, moved, group("row", [NOTE])]),
    ],
    noun: "repeater",
    holder: "items",
  },
  {
    what: "a group inside a repeater",
    path: ["items", "row"],
    fields: moved => [META(), OUTER(), ITEMS([moved])],
    noun: "repeater",
    holder: "items",
  },
];

/** The fields the database keeps unique, and how each stays apart from the others. */
const UNIQUE_KINDS: { kind: string; field: Field; localized: boolean }[] = [
  { kind: "a field declared unique", field: CODE, localized: false },
  { kind: "a one-to-one", field: ONE_TO_ONE, localized: false },
  {
    kind: "a translated one-to-one",
    field: { ...ONE_TO_ONE, localized: true },
    localized: true,
  },
];

/** The cases, on the storage layout the calling file set. */
export function describeRefusedMoves(): void {
  describe.each(getConfiguredTestDialects())(
    "a move a Builder save refuses (%s)",
    (dialect: TestDialect) => {
      let instance: TestNextly | undefined;
      let basePath: string;

      beforeEach(async () => {
        basePath = await mkdtemp(join(tmpdir(), "nextly-refused-moves-"));
        // The schema dialog applies its change, and writes its migration, in development only.
        vi.stubEnv("NODE_ENV", "development");
      });

      afterEach(async () => {
        try {
          await instance?.destroy();
        } finally {
          instance = undefined;
          vi.unstubAllEnvs();
          await rm(basePath, { recursive: true, force: true });
        }
      });

      async function boot(): Promise<TestNextly> {
        instance = await createTestNextly({
          dialect,
          basePath,
          db: DB,
          localization: LOCALIZATION,
          plugins: [PLUGIN],
        });
        return instance;
      }

      const run = <T>(t: TestNextly, statement: string) =>
        (t.adapter as unknown as DrizzleAdapter).executeQuery(
          statement
        ) as unknown as Promise<T[]>;

      /** The collection of people, then the posts with `fields`, as the Builder creates them. */
      async function createEntities(
        t: TestNextly,
        fields: Field[],
        localized = false
      ): Promise<void> {
        const service = t.getService("collectionService");
        type Create = Parameters<CollectionService["createCollection"]>[0];
        await service.createCollection(
          {
            name: PEOPLE,
            label: "Person",
            localized: false,
            fields: [HEADLINE],
          } as Create,
          {}
        );
        await service.createCollection(
          { name: POSTS, label: "Post", localized, fields } as Create,
          {}
        );
      }

      async function versionOf(t: TestNextly): Promise<number> {
        const [row] = await run<{ version: number | string | null }>(
          t,
          `SELECT schema_version AS version FROM dynamic_collections WHERE slug = '${POSTS}'`
        );
        return Number(row?.version ?? 1);
      }

      /** The schema dialog's save of `fields`, with the moves the Builder sends beside them. */
      async function save(
        t: TestNextly,
        fields: Field[],
        moves: Move[] = []
      ): Promise<void> {
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: POSTS },
          {
            fields,
            confirmed: true,
            schemaVersion: await versionOf(t),
            ...(moves.length === 0 ? {} : { hints: { moves } }),
          }
        );
        clearRegistryRowCache();
      }

      /** The dialog's review of the same save, before the person confirms it. */
      function preview(fields: Field[], moves: Move[]): Promise<unknown> {
        return dispatchCollections(
          {} as ServiceContainer,
          "previewSchemaChanges",
          { collectionName: POSTS },
          { fields, hints: { moves } }
        );
      }

      /** What a refused save must leave as it was (`databaseState`). */
      const state = (t: TestNextly) =>
        databaseState({
          run: <T>(statement: string) => run<T>(t, statement),
          dialect,
          tablePrefixes: TABLE_PREFIXES,
          registries: [
            { table: "dynamic_collections", slugs: [PEOPLE, POSTS] },
            { table: "dynamic_singles", slugs: [HOME] },
            { table: STORAGE_FORMAT.registryTable, slugs: [FRAME] },
          ],
          migrations: join(basePath, "migrations"),
          definitionFile: join(basePath, "ui-schema.json"),
        });

      /** The save of `fields`, in its review and its apply, refused with `message`, changing nothing. */
      async function expectRefused(
        t: TestNextly,
        fields: Field[],
        moves: Move[],
        message: string
      ): Promise<void> {
        const before = await state(t);
        const refusal = expect.objectContaining({
          publicData: {
            errors: [
              expect.objectContaining({
                code: "FIELD_MOVE_REFUSED",
                message: expect.stringContaining(message),
              }),
            ],
          },
        });
        await expect(preview(fields, moves)).rejects.toThrow(refusal);
        await expect(save(t, fields, moves)).rejects.toThrow(refusal);
        expect(await state(t)).toEqual(before);
      }

      /** An entry of the posts holding `data`, and its id. */
      const post = async (t: TestNextly, data: Record<string, unknown>) => {
        const { item } = await t.nextly.create({
          collection: POSTS as never,
          data: data as never,
        });
        return String((item as { id: unknown }).id);
      };
      const someone = async (t: TestNextly, headline: string) => {
        const { item } = await t.nextly.create({
          collection: PEOPLE as never,
          data: { title: headline, slug: headline, headline } as never,
        });
        return String((item as { id: unknown }).id);
      };

      /** Each post's person inside `holder`, or on the row, as the API reads it: its id, by slug. */
      async function persons(
        t: TestNextly,
        holder?: string
      ): Promise<Map<string, unknown>> {
        const { items } = await t.nextly.find({
          collection: POSTS as never,
          limit: 100,
        });
        const idOf = (value: unknown): unknown =>
          value !== null && typeof value === "object" && "id" in value
            ? (value as { id: unknown }).id
            : value;
        return new Map(
          (items as Record<string, unknown>[]).map(item => [
            String(item.slug),
            idOf(
              (holder === undefined
                ? item.person
                : (item[holder] as Record<string, unknown> | null)?.person) ??
                null
            ),
          ])
        );
      }

      describe("into or out of a Blocks field", () => {
        // A Blocks field holds blocks declared in code, so it holds no field a move could reach: a
        // field moved in has no place there, and a move out names one that was never a field.
        it("refuses each, naming the Blocks field, nothing changed", async () => {
          const t = await boot();
          await createEntities(t, [HEADLINE, PAGE, ...CONTAINERS]);
          await post(t, { title: "P", slug: "p", headline: "H" });
          await expectRefused(
            t,
            [PAGE, ...CONTAINERS],
            [{ from: ["headline"], to: ["page", "headline"] }],
            "headline cannot be moved into or out of page: a blocks field holds blocks declared in code, not fields."
          );
          await expectRefused(
            t,
            [HEADLINE, PAGE, { name: "inner", type: "text" }, ...CONTAINERS],
            [{ from: ["page", "inner"], to: ["inner"] }],
            "inner cannot be moved into or out of page: a blocks field holds blocks declared in code, not fields."
          );
        });
      });

      // A field already inside a repeater is refused for its rows, whatever it is: a unique one is not
      // told that losing its uniqueness would move it, as it would not.
      describe("a unique field already inside a repeater", () => {
        const items = (inside: Field[], row: Field[] = []) =>
          repeater("items", [NOTE, ...inside, group("row", [NOTE, ...row])]);
        const BEFORE = [HEADLINE, META(), items([CODE])];
        it.each([
          {
            what: "out to the row",
            fields: [HEADLINE, CODE, META(), items([])],
            move: [{ from: ["items", "code"], to: ["code"] }],
            message:
              "code cannot be moved out of the repeating rows items: each entry may hold several rows of it, which one field cannot keep. Add a new field instead.",
          },
          {
            what: "into a group outside it",
            fields: [HEADLINE, META([CODE]), items([])],
            move: [{ from: ["items", "code"], to: ["meta", "code"] }],
            message:
              "code cannot be moved out of the repeating rows items: each entry may hold several rows of it, which one field cannot keep. Add a new field instead.",
          },
          {
            what: "into a group inside it",
            fields: [HEADLINE, META(), items([], [CODE])],
            move: [{ from: ["items", "code"], to: ["items", "row", "code"] }],
            message:
              "Moving code within the repeating rows items is not available yet.",
          },
        ])(
          "moved $what is refused for its rows, nothing changed",
          async ({ fields, move, message }) => {
            const t = await boot();
            await createEntities(t, BEFORE);
            await post(t, {
              title: "P",
              slug: "p",
              headline: "H",
              items: [
                { note: "a", code: "x" },
                { note: "b", code: "y" },
              ],
            });
            await expectRefused(t, fields, move, message);
          }
        );
      });

      // Each entry may hold several rows of it, and one field keeps one value: refused, no row
      // dropped, and a new field suggested.
      describe("a field out of a repeater", () => {
        it("is refused where entries hold several rows of it, nothing changed", async () => {
          const t = await boot();
          const label: Field = { name: "label", type: "text" };
          const rows = repeater("rows", [label, NOTE]);
          await createEntities(t, [HEADLINE, rows, META(), OUTER()]);
          await post(t, {
            title: "P",
            slug: "p",
            headline: "H",
            rows: [
              { label: "First", note: "a" },
              { label: "Second", note: "b" },
            ],
          });
          await expectRefused(
            t,
            [HEADLINE, label, repeater("rows", [NOTE]), META(), OUTER()],
            [{ from: ["rows", "label"], to: ["label"] }],
            "label cannot be moved out of the repeating rows rows: each entry may hold several rows of it, which one field cannot keep. Add a new field instead."
          );
        });
      });

      describe("a field the database keeps unique into a group or a repeater", () => {
        it.each(UNIQUE_KINDS)(
          "refuses $kind, at one depth, two and three, naming the container and why, nothing changed",
          async ({ field, localized }) => {
            const t = await boot();
            const name = String(field.name);
            await createEntities(
              t,
              [field, HEADLINE, ...CONTAINERS],
              localized
            );
            const first = await someone(t, "ann");
            const second = await someone(t, "ben");
            const value = (id: string, text: string) =>
              name === "person" ? { person: id } : { code: text };
            await post(t, {
              title: "P",
              slug: "p",
              headline: "H",
              ...value(first, "one"),
            });
            await post(t, {
              title: "Q",
              slug: "q",
              headline: "I",
              ...value(second, "two"),
            });

            for (const target of TARGETS) {
              await expectRefused(
                t,
                [HEADLINE, ...target.fields(field)],
                [{ from: [name], to: [...target.path, name] }],
                `${name} cannot be moved into the ${target.noun} ${target.holder}: a ${target.noun} keeps its values in one JSON value, which cannot be kept unique. It can be moved once it is no longer unique (a one-to-one changed to many-to-one, or its unique setting removed), as a change of its own.`
              );
            }
          }
        );
      });

      describe("the way round: a one-to-one changed to many-to-one, then moved into a group", () => {
        it("keeps every entry's target", async () => {
          const t = await boot();
          await createEntities(t, [ONE_TO_ONE, HEADLINE, ...CONTAINERS]);
          const ann = await someone(t, "ann");
          const ben = await someone(t, "ben");
          const cam = await someone(t, "cam");
          await post(t, { title: "P", slug: "p", headline: "H", person: ann });
          await post(t, { title: "Q", slug: "q", headline: "I", person: ben });
          await post(t, { title: "R", slug: "r", headline: "J", person: cam });
          const targets = await persons(t);
          expect(new Set([...targets.values()])).toEqual(
            new Set([ann, ben, cam])
          );

          await save(t, [MANY_TO_ONE, HEADLINE, ...CONTAINERS]);
          expect(await persons(t)).toEqual(targets);
          await save(
            t,
            [HEADLINE, META([MANY_TO_ONE]), OUTER(), ITEMS()],
            [{ from: ["person"], to: ["meta", "person"] }]
          );

          expect(await persons(t, "meta")).toEqual(targets);
        });
      });

      const UNIQUE_MESSAGE =
        "person cannot be moved into the group meta: a group keeps its values in one JSON value, which cannot be kept unique.";
      const UNIQUE_MOVE: Move[] = [
        { from: ["person"], to: ["meta", "person"] },
      ];
      const WORDS: Field = { name: "words", type: "text" };
      const WORDS_MOVE: Move[] = [{ from: ["words"], to: ["meta", "words"] }];

      /** A Builder road, which saves one entity and refuses its moves for a reason of its own. */
      interface Road {
        road: string;
        /** The registry table the entity's row is in, whose schema version an apply is checked against. */
        registry: { table: string; slug: string };
        create: (t: TestNextly) => Promise<unknown>;
        send: (
          t: TestNextly,
          operation: "preview" | "apply",
          fields: Field[],
          moves: Move[],
          version: number
        ) => Promise<unknown>;
      }

      /** Each Builder road that refuses moves, on an entity holding `fields`, translated or not. */
      const roadsFor = (fields: Field[], localized: boolean): Road[] => [
        {
          road: "a collection",
          registry: { table: "dynamic_collections", slug: POSTS },
          create: t => createEntities(t, fields, localized),
          send: (_t, operation, sent, moves, version) =>
            dispatchCollections(
              {} as ServiceContainer,
              operation === "preview"
                ? "previewSchemaChanges"
                : "applySchemaChanges",
              { collectionName: POSTS },
              operation === "preview"
                ? { fields: sent, hints: { moves } }
                : {
                    fields: sent,
                    confirmed: true,
                    schemaVersion: version,
                    hints: { moves },
                  }
            ),
        },
        {
          road: "a Single",
          registry: { table: "dynamic_singles", slug: HOME },
          create: async t => {
            await createEntities(t, [HEADLINE]);
            await dispatchSingles(
              "createSingle",
              {},
              { slug: HOME, label: "Home", localized, fields }
            );
          },
          send: (_t, operation, sent, moves, version) =>
            dispatchSingles(
              operation === "preview"
                ? "previewSingleSchemaChanges"
                : "applySingleSchemaChanges",
              { slug: HOME },
              operation === "preview"
                ? { fields: sent, hints: { moves } }
                : {
                    fields: sent,
                    confirmed: true,
                    schemaVersion: version,
                    hints: { moves },
                  }
            ),
        },
        {
          road: "a field group",
          registry: { table: STORAGE_FORMAT.registryTable, slug: FRAME },
          create: async t => {
            await createEntities(t, [HEADLINE]);
            await dispatchComponents(
              "createComponent",
              {},
              { slug: FRAME, label: "Frame", localized, fields }
            );
          },
          send: (_t, operation, sent, moves, version) =>
            dispatchComponents(
              operation === "preview"
                ? "previewComponentSchemaChanges"
                : "applyComponentSchemaChanges",
              { slug: FRAME },
              operation === "preview"
                ? { fields: sent, hints: { moves } }
                : {
                    fields: sent,
                    confirmed: true,
                    schemaVersion: version,
                    hints: { moves },
                  }
            ),
        },
      ];

      /** Each case, refused in `operations`, its message as given, nothing changed. */
      async function expectRoadRefuses(
        t: TestNextly,
        road: Road,
        operations: ("preview" | "apply")[],
        cases: { fields: Field[]; moves: Move[]; message: string }[]
      ): Promise<void> {
        for (const { fields, moves, message } of cases) {
          const [row] = await run<{ version: number | string | null }>(
            t,
            `SELECT schema_version AS version FROM ${road.registry.table} WHERE slug = '${road.registry.slug}'`
          );
          const version = Number(row?.version ?? 1);
          const before = await state(t);
          for (const operation of operations) {
            await expect(
              road.send(t, operation, fields, moves, version)
            ).rejects.toThrow(
              expect.objectContaining({
                publicData: {
                  errors: [
                    expect.objectContaining({
                      code: "FIELD_MOVE_REFUSED",
                      message: expect.stringContaining(message),
                    }),
                  ],
                },
              })
            );
          }
          clearRegistryRowCache();
          expect(await state(t)).toEqual(before);
        }
      }

      // A translated entity's save goes to the push, which carries no values, so the road refuses
      // every move of it: one its fields alone refuse is told why first, and one they would allow is
      // told it waits, as before. The Single's and the field group's say so in their planner's words.
      describe("a translated entity's moves, on each road", () => {
        const UNIQUE = person({ unique: true, localized: true });
        const WORDS_HERE: Field = { ...WORDS, localized: true };
        const FIELDS = [UNIQUE, WORDS_HERE, HEADLINE, ...CONTAINERS];
        const WAITS = [
          "Fields in a translated collection can't be moved yet.",
          "keeps a value for each language",
          "keeps a value for each language",
        ];
        it.each(
          roadsFor(FIELDS, true).map((road, at) => ({ road, waits: WAITS[at] }))
        )(
          "$road.road refuses a field kept unique for that, and any other for its road",
          async ({ road, waits }) => {
            const t = await boot();
            await road.create(t);
            await expectRoadRefuses(
              t,
              road,
              ["preview", "apply"],
              [
                {
                  fields: [
                    WORDS_HERE,
                    HEADLINE,
                    META([UNIQUE]),
                    OUTER(),
                    ITEMS(),
                  ],
                  moves: UNIQUE_MOVE,
                  message: UNIQUE_MESSAGE,
                },
                {
                  fields: [
                    UNIQUE,
                    HEADLINE,
                    META([WORDS_HERE]),
                    OUTER(),
                    ITEMS(),
                  ],
                  moves: WORDS_MOVE,
                  message: waits ?? "",
                },
              ]
            );
          }
        );
      });

      // A Single's and a field group's save outside development is applied at once, while the file
      // waits for the deploy: the road refuses a move there for that, in the words it always had.
      describe("a Single's or a field group's moves outside development", () => {
        const PERSON = person({ unique: true });
        const FIELDS = [PERSON, WORDS, HEADLINE, ...CONTAINERS];
        it.each(roadsFor(FIELDS, false).slice(1))(
          "$road refuses a field kept unique for that, and any other for its road",
          async road => {
            const t = await boot();
            await road.create(t);
            vi.stubEnv("NODE_ENV", "production");
            await expectRoadRefuses(
              t,
              road,
              ["apply"],
              [
                {
                  fields: [WORDS, HEADLINE, META([PERSON]), OUTER(), ITEMS()],
                  moves: UNIQUE_MOVE,
                  message: UNIQUE_MESSAGE,
                },
                {
                  fields: [PERSON, HEADLINE, META([WORDS]), OUTER(), ITEMS()],
                  moves: WORDS_MOVE,
                  message: "which the Schema Builder runs only in development",
                },
              ]
            );
          }
        );
      });

      describe("a one-to-one out of a group onto its entity's row", () => {
        const GROUPED = [HEADLINE, META([MANY_TO_ONE]), OUTER(), ITEMS()];
        const ON_ROW = [ONE_TO_ONE, HEADLINE, META(), OUTER(), ITEMS()];
        const OUT: Move[] = [{ from: ["meta", "person"], to: ["person"] }];

        it("is moved, its column unique: every target kept, and a duplicate refused", async () => {
          const t = await boot();
          await createEntities(t, GROUPED);
          const ann = await someone(t, "ann");
          const ben = await someone(t, "ben");
          await post(t, {
            title: "P",
            slug: "p",
            headline: "H",
            meta: { person: ann },
          });
          await post(t, {
            title: "Q",
            slug: "q",
            headline: "I",
            meta: { person: ben },
          });
          const targets = await persons(t, "meta");

          await save(t, ON_ROW, OUT);

          expect(await persons(t)).toEqual(targets);
          await expect(
            post(t, { title: "R", slug: "r", headline: "J", person: ann })
          ).rejects.toThrow();
        });

        it("is refused, nothing changed, while two entries hold one target, naming the field and the count", async () => {
          const t = await boot();
          await createEntities(t, GROUPED);
          const ann = await someone(t, "ann");
          await post(t, {
            title: "P",
            slug: "p",
            headline: "H",
            meta: { person: ann },
          });
          await post(t, {
            title: "Q",
            slug: "q",
            headline: "I",
            meta: { person: ann },
          });

          await expectRefused(
            t,
            ON_ROW,
            OUT,
            "person is unique where it moves to, and 1 of its values is held by more than one entry in the group it moves out of. Give each entry its own value, or clear the repeats, then move it."
          );
        });
      });
    }
  );
}
