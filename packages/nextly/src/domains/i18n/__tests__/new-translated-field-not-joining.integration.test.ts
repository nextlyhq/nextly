/**
 * A translated collection's `title` field, sent by the schema dialog, takes over the system `title`
 * column the collection was created with: its values move to the default language's row of the
 * translations table, which is a field joining translation. Saving fields beside it is applied on
 * every dialect, each entry keeps its title as the default language's, and a translated
 * relationship added in the same save holds a value per language.
 *
 * On MySQL the system column is `varchar(255)` and the translated column `TEXT`, and the join was
 * refused as a field "reshaped" as it became translated, though TEXT holds every value the
 * varchar does. A join is refused only when the new column cannot hold every value the old one
 * holds, which the control below still shows: a number made translated as text.
 *
 * Saves run as a development server runs them, where a save applies its DDL at once, with the
 * Builder writing the app's schema files into a folder of the test's own.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { clearServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { _resetApplyDesiredSchemaForTests } from "../../schema/pipeline/index";

const PEOPLE = "ntf_people";
const POSTS = "ntf_posts";
const TITLE = { name: "title", type: "text" };

/** A short text `summary`, shared or translated, with a length bound when given. */
const summary = (at: { localized: boolean; maxLength?: number }) => ({
  name: "summary",
  type: "text",
  localized: at.localized,
  options: { variant: "short" },
  ...(at.maxLength === undefined
    ? {}
    : { validation: { maxLength: at.maxLength } }),
});

/** A translated relationship to a person, as the Builder's editor sends it; one-to-one is marked unique. */
const author = (oneToOne: boolean) => ({
  name: "author",
  type: "relationship",
  relationTo: PEOPLE,
  localized: true,
  ...(oneToOne ? { unique: true } : {}),
});

describeEachDialect(
  "a translated relationship added to a translated collection",
  dialect => {
    let current: TestNextly | undefined;
    let projectRoot: string;

    beforeEach(async () => {
      // The Builder writes the app's schema files; they go to a folder of the test's own.
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-new-translated-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      // An apply with the same desired schema as an earlier case's would otherwise be skipped.
      clearCachedSnapshot();
      _resetApplyDesiredSchemaForTests();
      current = await createTestNextly({
        dialect,
        basePath: projectRoot,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await current?.destroy();
      current = undefined;
      clearServices();
      clearCachedSnapshot();
      vi.unstubAllEnvs();
      await rm(projectRoot, { recursive: true, force: true });
    });

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** One Builder call as a development server runs it. */
    async function builder(
      method: string,
      params: object,
      body: unknown
    ): Promise<unknown> {
      vi.stubEnv("NODE_ENV", "development");
      try {
        return await dispatchCollections(
          {} as ServiceContainer,
          method,
          params as never,
          body
        );
      } finally {
        vi.unstubAllEnvs();
      }
    }

    /** What a call answered: its refusal's per-field entries, or "accepted". */
    async function answerOf(
      run: () => Promise<unknown>
    ): Promise<"accepted" | { code?: string; message?: string }[]> {
      let result: unknown;
      try {
        result = await run();
      } catch (error) {
        const e = error as {
          code?: string;
          message?: string;
          publicData?: { errors?: { code?: string; message?: string }[] };
        };
        return e.publicData?.errors ?? [{ code: e.code, message: e.message }];
      }
      const failed = result as {
        success?: boolean;
        code?: string;
        message?: string;
        data?: { errors?: { code?: string; message?: string }[] };
      } | null;
      if (failed && failed.success === false) {
        return (
          failed.data?.errors ?? [
            { code: failed.code, message: failed.message },
          ]
        );
      }
      return "accepted";
    }

    async function schemaVersion(t: TestNextly): Promise<number> {
      const [row] = await t.adapter.executeQuery<{ v: unknown }>(
        `SELECT ${q("schema_version")} AS v FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${POSTS}'`
      );
      return Number(row?.v ?? 1);
    }

    /** `people`, the relationship's target, and a translated `posts` holding only a title. */
    async function seed(t: TestNextly): Promise<void> {
      for (const body of [
        {
          name: PEOPLE,
          label: "People",
          fields: [{ name: "name", type: "text" }],
        },
        { name: POSTS, label: "Posts", localized: true, fields: [TITLE] },
      ]) {
        expect(
          await answerOf(() => builder("createCollection", {}, body))
        ).toBe("accepted");
      }
      expect(t).toBeDefined();
    }

    /** The schema dialog's save of `fields` onto the posts, as the admin confirms it. */
    async function apply(t: TestNextly, fields: unknown[]) {
      const answer = await answerOf(async () =>
        builder(
          "applySchemaChanges",
          { collectionName: POSTS },
          {
            fields,
            confirmed: true,
            schemaVersion: await schemaVersion(t),
            localized: true,
          }
        )
      );
      clearRegistryRowCache();
      return answer;
    }

    /** A post pointing at a person in German only: the relationship holds a value per language. */
    async function holdsAPerLanguageValue(t: TestNextly): Promise<void> {
      const ada = await t.nextly.create({
        collection: PEOPLE,
        data: { name: "Ada" },
      });
      const post = await t.nextly.create({
        collection: POSTS,
        data: { title: "Hello" },
        locale: "en",
      });
      const id = (post.item as { id: string }).id;
      const adaId = (ada.item as { id: string }).id;
      await t.nextly.update({
        collection: POSTS,
        id,
        locale: "de",
        data: { author: adaId, _overwrite: true },
      });
      const authorIn = async (locale: string) => {
        const found = (await t.nextly.findByID({
          collection: POSTS,
          id,
          locale,
          depth: 0,
        })) as Record<string, unknown> | null;
        const value = found?.author;
        return typeof value === "object" && value !== null
          ? (value as { id?: unknown }).id
          : value;
      };
      expect(await authorIn("de")).toBe(adaId);
      expect(await authorIn("en")).toBeFalsy();
    }

    /** An entry made before the save, titled "Before", by its id. */
    async function anEntry(t: TestNextly): Promise<string> {
      const post = await t.nextly.create({
        collection: POSTS,
        data: { title: "Before" },
        locale: "en",
      });
      return (post.item as { id: string }).id;
    }

    async function titleIn(
      t: TestNextly,
      id: string,
      locale: string
    ): Promise<unknown> {
      const found = (await t.nextly.findByID({
        collection: POSTS,
        id,
        locale,
        depth: 0,
      })) as Record<string, unknown> | null;
      return found?.title;
    }

    for (const oneToOne of [false, true]) {
      it(`applies the schema dialog adding a translated ${oneToOne ? "one-to-one" : "many-to-one"} relationship beside title`, async () => {
        const t = current as TestNextly;
        await seed(t);
        const before = await anEntry(t);

        expect(await apply(t, [TITLE, author(oneToOne)])).toBe("accepted");

        expect(await titleIn(t, before, "en")).toBe("Before");
        await holdsAPerLanguageValue(t);
      }, 120_000);
    }

    it("applies the schema dialog adding a translated text field beside title", async () => {
      const t = current as TestNextly;
      await seed(t);
      const before = await anEntry(t);

      expect(await apply(t, [TITLE, { name: "summary", type: "text" }])).toBe(
        "accepted"
      );

      expect(await titleIn(t, before, "en")).toBe("Before");
    }, 120_000);

    /** A short text `summary`, shared, saved beside the title, then an entry holding one. */
    async function withSharedSummary(
      t: TestNextly,
      maxLength?: number
    ): Promise<string> {
      await seed(t);
      expect(
        await apply(t, [TITLE, summary({ localized: false, maxLength })])
      ).toBe("accepted");
      const post = await t.nextly.create({
        collection: POSTS,
        data: { title: "Before", summary: "Kept" },
        locale: "en",
      });
      return (post.item as { id: string }).id;
    }

    async function summaryIn(t: TestNextly, id: string): Promise<unknown> {
      const found = (await t.nextly.findByID({
        collection: POSTS,
        id,
        locale: "en",
        depth: 0,
      })) as Record<string, unknown> | null;
      return found?.summary;
    }

    // Short text into long text holds every value, through the Builder as through the push.
    it("applies the schema dialog making a shared short text translated as long text", async () => {
      const t = current as TestNextly;
      const id = await withSharedSummary(t);

      expect(
        await apply(t, [
          TITLE,
          { name: "summary", type: "text", localized: true },
        ])
      ).toBe("accepted");

      expect(await summaryIn(t, id)).toBe("Kept");
    }, 120_000);

    // SQLite keeps no length on a text column, so a shorter bound cuts nothing there.
    it.skipIf(dialect === "sqlite")(
      "still refuses the schema dialog narrowing a short text as it becomes translated",
      async () => {
        const t = current as TestNextly;
        const id = await withSharedSummary(t, 100);

        const answer = await apply(t, [
          TITLE,
          summary({ localized: true, maxLength: 10 }),
        ]);

        expect(answer).toEqual([
          expect.objectContaining({
            code: "RESHAPED_FIELD_JOINS_TRANSLATION",
          }),
        ]);
        expect(await summaryIn(t, id)).toBe("Kept");
      },
      120_000
    );

    // A number made translated as text in one save: its values would be copied as they are into a
    // column of another kind, which no widening covers. Still refused, and nothing changes.
    it("still refuses a field whose kind changes as it becomes translated", async () => {
      const t = current as TestNextly;
      await seed(t);
      expect(
        await apply(t, [
          TITLE,
          { name: "views", type: "number", localized: false },
        ])
      ).toBe("accepted");
      const before = await anEntry(t);

      const answer = await apply(t, [TITLE, { name: "views", type: "text" }]);

      expect(answer).toEqual([
        expect.objectContaining({
          code: "RESHAPED_FIELD_JOINS_TRANSLATION",
          path: "fields.views",
        }),
      ]);
      expect(await titleIn(t, before, "en")).toBe("Before");
    }, 120_000);

    // A checkbox (a boolean) made a number changes what the field is, though SQLite keeps both as integers and
    // would copy every value: still refused, on every dialect.
    it("still refuses a field moving to another kind's family as it becomes translated", async () => {
      const t = current as TestNextly;
      await seed(t);
      expect(
        await apply(t, [
          TITLE,
          { name: "featured", type: "checkbox", localized: false },
        ])
      ).toBe("accepted");
      const before = await anEntry(t);

      const answer = await apply(t, [
        TITLE,
        { name: "featured", type: "number", localized: true },
      ]);

      expect(answer).toEqual([
        expect.objectContaining({
          code: "RESHAPED_FIELD_JOINS_TRANSLATION",
          path: "fields.featured",
        }),
      ]);
      expect(await titleIn(t, before, "en")).toBe("Before");
    }, 120_000);
  }
);
