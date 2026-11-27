/**
 * The Builder's type picker asks the server what each other type would do to a saved field's
 * values: through the collection, Single and field-group routes alike, read from the conversion
 * rules on the database the site runs on, as a list.
 *
 * What a translation rule of the save refuses is in `type-change-targets.translation.integration.test.ts`.
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

import {
  collection,
  DB,
  fieldGroup,
  LOCALIZATION,
  single,
  targetsOf,
  type Field,
} from "./type-change-targets-entities";

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
        (await targetsOf("tct_posts", ["summary"], "text")).map(t => [
          t.type,
          t,
        ])
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
        (await targetsOf("tct_posts", ["views"], "number")).map(t => [
          t.type,
          t,
        ])
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
              // Shared, and so after its change too: its pair's rule alone answers.
              fields: [{ name: "rating", type: "number", localized: false }],
            },
          ],
        } as never,
        {}
      );

      const inGroup = new Map(
        (await targetsOf("tct_nested", ["meta", "rating"], "number")).map(t => [
          t.type,
          t,
        ])
      );
      // A number held in the group's JSON is no text until rewritten, which no save does yet: the save
      // refuses the change where a row stores one.
      expect(inGroup.get("text")).toMatchObject({
        blocked: null,
        outcome: "may-lose",
      });
      expect(inGroup.get("json")).toMatchObject({
        blocked: null,
        outcome: "keeps",
      });
      await expect(
        targetsOf("tct_nested", ["meta", "missing"], "number")
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
      await expect(
        targetsOf("tct_posts", ["missing"], "text")
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "the type picker's route of each kind of entity (%s)",
  dialect => {
    it.each([{ of: collection }, { of: single }, { of: fieldGroup }])(
      "$of.name: answers from the conversion rules for a field it holds",
      async ({ of }) => {
        const basePath = await mkdtemp(join(tmpdir(), "nextly-type-targets-"));
        folders.push(basePath);
        vi.stubEnv("NODE_ENV", "development");
        instance = await createTestNextly({
          dialect: dialect as TestDialect,
          basePath,
          db: DB,
          localization: LOCALIZATION,
        });
        const entity = of(instance);
        // Shared, so the conversion rules alone answer.
        const field = { name: "v", type: "text", localized: false };
        await entity.create(field);

        const targets = new Map(
          (await entity.targets(field)).map(t => [t.type, t])
        );
        expect(targets.get("textarea")).toMatchObject({
          blocked: null,
          outcome: "keeps",
        });
        expect(targets.get("number")).toMatchObject({
          blocked: null,
          outcome: "may-lose",
        });
        expect(targets.get("group")).toMatchObject({ blocked: "container" });
      }
    );
  }
);

// No save rewrites a value held in a group's JSON, and the save refuses such a change only where a
// row stores a value, naming the field: a group holding none of the field's values takes it. The
// picker cannot see the rows, so it leaves the change open, marked as one the save may refuse.
describe.each(getConfiguredTestDialects())(
  "a number held in a group, becoming a text (%s)",
  dialect => {
    it("is open, marked as one that may lose values: refused once a row stores one, saved while none does", async () => {
      const basePath = await mkdtemp(join(tmpdir(), "nextly-type-targets-"));
      folders.push(basePath);
      vi.stubEnv("NODE_ENV", "development");
      const test = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
        localization: LOCALIZATION,
      });
      instance = test;
      // Shared, and so after the change too: the pair's rule and the stored values alone answer.
      const number = (name: string): Field => ({
        name,
        type: "number",
        localized: false,
      });
      const text = (name: string): Field => ({
        name,
        type: "text",
        localized: false,
      });
      const holding = (...fields: Field[]): Field[] => [
        { name: "meta", type: "group", fields },
      ];
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: "tct_held",
          label: "Post",
          fields: holding(number("unset"), number("rating")),
        }
      );
      const saving = async (fields: Field[]) => {
        const [row] = await (
          test.adapter as unknown as {
            executeQuery<R>(statement: string): Promise<R[]>;
          }
        ).executeQuery<{ v: number | string | null }>(
          "SELECT schema_version AS v FROM dynamic_collections WHERE slug = 'tct_held'"
        );
        return dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "tct_held" },
          { fields, confirmed: true, schemaVersion: Number(row?.v ?? 1) }
        ).then(
          () => undefined,
          (error: unknown) => error
        );
      };
      const toText = async (name: string) =>
        (await targetsOf("tct_held", ["meta", name], "number")).find(
          target => target.type === "text"
        );
      // One row, storing a rating and no value of `unset`.
      await test.nextly.create({
        collection: "tct_held",
        locale: "en",
        data: { title: "A", slug: "a", meta: { rating: 4 } },
      });

      for (const name of ["unset", "rating"]) {
        expect(await toText(name)).toMatchObject({
          blocked: null,
          refusal: null,
          outcome: "may-lose",
        });
      }
      // The stored rating is no text until it is rewritten, which no save does.
      expect(
        await saving(holding(number("unset"), text("rating")))
      ).toMatchObject({
        publicData: {
          errors: [{ path: "fields.meta.rating", code: "TYPE_CHANGE_BLOCKED" }],
        },
      });
      // No row stores a value of `unset`, so the save goes ahead.
      expect(
        await saving(holding(text("unset"), number("rating")))
      ).toBeUndefined();
    }, 300_000);
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
