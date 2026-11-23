/**
 * The Builder's type picker asks the server what each other type would do to a saved field's
 * values: through the collection, Single and field-group routes alike, read from the conversion
 * rules on the database the site runs on, as a list.
 *
 * A change the save refuses whatever the values hold is unavailable, with the save's own reason:
 * a field that stops being translated, or becomes translated, while how it is stored changes, and
 * a translated field whose translations column would keep its old type. Proved by making each
 * change through the Builder's own save and comparing its answer with the picker's.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { isBuilderRoute } from "../../../shared/builder-access";
import { dispatchCollections } from "../../handlers/collection-dispatcher";
import { dispatchComponents } from "../../handlers/component-dispatcher";
import { dispatchSingles } from "../../handlers/single-dispatcher";

// Written for per-language storage as every installation runs it (`storage-layout`): a text-like
// field is translated unless it says `localized: false`.
perLanguageStorageSuite();

let instance: TestNextly | undefined;
/** Every project folder a case made, removed after it. */
let folders: string[] = [];

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.unstubAllEnvs();
    for (const folder of folders) {
      await rm(folder, { recursive: true, force: true });
    }
    folders = [];
  }
});

type Field = Record<string, unknown>;
type Refusal = { code: string; reason: string; steps: string[] };
type Target = {
  type: string;
  blocked: string | null;
  outcome: string | null;
  refusal: Refusal | null;
};

/** The picker's answer, read as the admin reads it: a list whose total counts its items. */
async function itemsOf(answer: unknown): Promise<Target[]> {
  const body = (await (answer as Response).json()) as {
    items: Target[];
    meta: { total: number };
  };
  expect(body.meta.total).toBe(body.items.length);
  return body.items;
}

async function targetsOf(slug: string, field: string[]): Promise<Target[]> {
  return itemsOf(
    await dispatchCollections(
      {} as ServiceContainer,
      "typeChangeTargets",
      { collectionName: slug },
      { field }
    )
  );
}

describe.each(getConfiguredTestDialects())(
  "the type picker's targets for a saved field (%s)",
  dialect => {
    it("lists each other type, blocked with why or marked by what it does to the values", async () => {
      instance = await createTestNextly(
        dialect === "sqlite" ? {} : { dialect }
      );
      vi.stubEnv("NODE_ENV", "development");
      await instance.getService("collectionService").createCollection(
        {
          name: "tct_posts",
          label: "Post",
          // Shared, so the conversion rules alone answer: the translation rules are proved below.
          fields: [
            { name: "summary", type: "text", localized: false },
            { name: "views", type: "number", localized: false },
          ],
        } as never,
        {}
      );

      const fromText = new Map(
        (await targetsOf("tct_posts", ["summary"])).map(t => [t.type, t])
      );
      expect(fromText.has("text")).toBe(false);
      expect(fromText.get("number")).toMatchObject({
        blocked: null,
        outcome: "may-lose",
      });
      expect(fromText.get("group")).toMatchObject({
        blocked: "container",
        outcome: null,
      });
      const fromNumber = new Map(
        (await targetsOf("tct_posts", ["views"])).map(t => [t.type, t])
      );
      expect(fromNumber.get("text")).toMatchObject({
        blocked: null,
        outcome: "converts",
      });
    });

    it("judges a field inside a named group by its path", async () => {
      instance = await createTestNextly(
        dialect === "sqlite" ? {} : { dialect }
      );
      vi.stubEnv("NODE_ENV", "development");
      await instance.getService("collectionService").createCollection(
        {
          name: "tct_nested",
          label: "Post",
          fields: [
            {
              name: "meta",
              type: "group",
              fields: [{ name: "rating", type: "number" }],
            },
          ],
        } as never,
        {}
      );

      const inGroup = new Map(
        (await targetsOf("tct_nested", ["meta", "rating"])).map(t => [
          t.type,
          t,
        ])
      );
      expect(inGroup.get("text")).toMatchObject({
        blocked: null,
        outcome: "converts",
      });
      await expect(
        targetsOf("tct_nested", ["meta", "missing"])
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("refuses a field the collection does not hold", async () => {
      instance = await createTestNextly(
        dialect === "sqlite" ? {} : { dialect }
      );
      vi.stubEnv("NODE_ENV", "development");
      await instance
        .getService("collectionService")
        .createCollection(
          { name: "tct_posts", label: "Post", fields: [] } as never,
          {}
        );
      await expect(targetsOf("tct_posts", ["missing"])).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  }
);

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

/** The reasons the save refuses a change by a translation rule of its own, whatever the values. */
const BY_TRANSLATION = new Set([
  "leaves-translation",
  "joins-translation",
  "translations-column",
]);

/**
 * A saved field `v` and the type the picker is asked about. Chosen to reach each translation rule:
 * a translated text becoming a number leaves translation reshaped; a translated text becoming a long
 * text keeps its translations column only where the database makes one type of both; a shared field
 * becoming a text-like one joins translation; a long text becoming code changes nothing there.
 */
const CASES: { field: Field; to: string }[] = [
  { field: { name: "v", type: "text" }, to: "number" },
  { field: { name: "v", type: "text" }, to: "textarea" },
  { field: { name: "v", type: "textarea" }, to: "code" },
  { field: { name: "v", type: "number" }, to: "text" },
  { field: { name: "v", type: "json" }, to: "code" },
  { field: { name: "v", type: "date" }, to: "text" },
  { field: { name: "v", type: "checkbox", localized: true }, to: "number" },
];

/** Where a case's change is asked and made: the picker's route and the Builder's own save. */
interface Entity {
  kind: "collection" | "Single" | "field group";
  create(field: Field): Promise<void>;
  targets(): Promise<Target[]>;
  save(field: Field): Promise<unknown>;
}

const collection = (t: TestNextly): Entity => ({
  kind: "collection",
  create: async field => {
    await dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      { name: "tct_agree", label: "Post", fields: [field] }
    );
  },
  targets: () => targetsOf("tct_agree", ["v"]),
  save: async field => {
    const [row] = await (
      t.adapter as unknown as {
        executeQuery<R>(statement: string): Promise<R[]>;
      }
    ).executeQuery<{ v: number | string | null }>(
      "SELECT schema_version AS v FROM dynamic_collections WHERE slug = 'tct_agree'"
    );
    return dispatchCollections(
      {} as ServiceContainer,
      "applySchemaChanges",
      { collectionName: "tct_agree" },
      { fields: [field], confirmed: true, schemaVersion: Number(row?.v ?? 1) }
    );
  },
});

const single = (t: TestNextly): Entity => ({
  kind: "Single",
  create: async field => {
    await dispatchSingles(
      "createSingle",
      {},
      { slug: "tct_home", label: "Home", fields: [field] }
    );
  },
  targets: async () =>
    itemsOf(
      await dispatchSingles(
        "singleTypeChangeTargets",
        { slug: "tct_home" },
        { field: ["v"] }
      )
    ),
  save: async field => {
    const stored = await t
      .getService("singleRegistryService")
      .getSingleBySlug("tct_home");
    return dispatchSingles(
      "applySingleSchemaChanges",
      { slug: "tct_home" },
      {
        fields: [field],
        confirmed: true,
        schemaVersion: stored?.schemaVersion ?? 1,
      }
    );
  },
});

const fieldGroup = (t: TestNextly): Entity => ({
  kind: "field group",
  create: async field => {
    await dispatchComponents(
      "createComponent",
      {},
      { slug: "tct_box", label: "Box", fields: [field] }
    );
  },
  targets: async () =>
    itemsOf(
      await dispatchComponents(
        "componentTypeChangeTargets",
        { slug: "tct_box" },
        { field: ["v"] }
      )
    ),
  save: async field => {
    const { schemaVersion } = await t
      .getService("fieldGroupRegistryService")
      .getComponent("tct_box");
    return dispatchComponents(
      "applyComponentSchemaChanges",
      { slug: "tct_box" },
      { fields: [field], confirmed: true, schemaVersion }
    );
  },
});

describe.each(getConfiguredTestDialects())(
  "the type picker answers as the Builder's save does (%s)",
  dialect => {
    /** A fresh project, so each case's save writes its files from nothing. */
    async function boot(): Promise<TestNextly> {
      await instance?.destroy();
      const basePath = await mkdtemp(join(tmpdir(), "nextly-type-targets-"));
      folders.push(basePath);
      vi.stubEnv("NODE_ENV", "development");
      instance = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
        localization: LOCALIZATION,
      });
      return instance;
    }

    it.each([
      {
        of: collection,
        expected: ["joins-translation", "leaves-translation"],
      },
      {
        of: single,
        expected: [
          "joins-translation",
          "leaves-translation",
          "translations-column",
        ],
      },
      {
        of: fieldGroup,
        expected: [
          "joins-translation",
          "leaves-translation",
          "translations-column",
        ],
      },
    ])(
      "$of.name: each change the picker marks unavailable, the save refuses, with the reason it gives",
      async ({ of, expected }) => {
        const seen = new Set<string>();
        for (const { field, to } of CASES) {
          const entity = of(await boot());
          await entity.create(field);
          const label = `${entity.kind} ${String(field.type)} to ${to}`;
          const target = (await entity.targets()).find(t => t.type === to);
          expect(target, label).toBeDefined();
          const outcome = await entity.save({ ...field, type: to }).then(
            () => undefined,
            (error: unknown) => error
          );
          if (target?.blocked == null) {
            // No values to judge, so a change open in the picker goes ahead.
            expect(outcome, `${label}: the save goes ahead`).toBeUndefined();
            continue;
          }
          expect(BY_TRANSLATION.has(target.blocked), label).toBe(true);
          seen.add(target.blocked);
          expect(outcome, `${label}: the save refuses it`).toMatchObject({
            code: "VALIDATION_ERROR",
            publicData: {
              errors: expect.arrayContaining([
                expect.objectContaining({
                  code: target.refusal?.code,
                  message: expect.stringContaining(
                    target.refusal?.reason ?? "no reason given"
                  ),
                }),
              ]),
            },
          });
        }
        // The cases reached the rules this entity has, so the agreement is about something.
        expect([...seen].sort()).toEqual(expect.arrayContaining(expected));
      },
      600_000
    );
  }
);

describe("the route", () => {
  it("is the schema builder's, refused wherever the builder is off", () => {
    expect(isBuilderRoute("collections", "typeChangeTargets")).toBe(true);
    expect(isBuilderRoute("singles", "singleTypeChangeTargets")).toBe(true);
    expect(isBuilderRoute("field-groups", "componentTypeChangeTargets")).toBe(
      true
    );
  });
});
