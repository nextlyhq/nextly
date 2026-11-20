/**
 * A schema change sent through the REST API or a plugin that removes one field and adds another
 * of the same type is never taken as a rename by guesswork. Where the request doesn't say which
 * it is, it is refused before anything is written, naming the entity and both fields; one that
 * says `rename` renames, keeping the values, and one that says `drop_and_add` drops the old field
 * and adds the new one. On each road that takes a field list without the Builder's own answers:
 * the collection schema PATCH, the Single schema PATCH, and a plugin's
 * `ctx.services.collections.updateCollection`. A rename is one field at a time: a request that
 * answers `rename` for two fields replaced at once is refused rather than dropping both.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import type { CollectionService } from "../../collections/services/collection-service";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

/** A field leaving and another of the same type arriving: the pair a guess took for a rename. */
const BEFORE = [
  { name: "heading", type: "text" },
  { name: "body", type: "text" },
];
const AFTER = [
  { name: "headline", type: "text" },
  { name: "body", type: "text" },
];

type Renames = { from: string; to: string; choice: string }[];

const HISTORY = "./database/history";
const DEFINITION = "./schema/builder.json";

/** One road a field list reaches the schema by, without the Builder's answers. */
interface Road {
  name: string;
  /** The registry the entity is recorded in, and its table. */
  registry: string;
  slug: string;
  table: string;
  create(t: TestNextly): Promise<void>;
  /** Stores "Kept" in `heading`. */
  store(t: TestNextly): Promise<void>;
  /** Sends `fields`, AFTER unless a case says otherwise. */
  change(
    t: TestNextly,
    renames?: Renames,
    fields?: readonly Record<string, unknown>[]
  ): Promise<unknown>;
}

const ROADS: readonly Road[] = [
  {
    name: "the collection schema PATCH",
    registry: "dynamic_collections",
    slug: "posts",
    table: "dc_posts",
    create: async () => {
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "posts", label: "Posts", fields: BEFORE }
      );
    },
    store: async t => {
      await t.nextly.create({ collection: "posts", data: { heading: "Kept" } });
    },
    change: (_t, renames, fields = AFTER) =>
      dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "posts" },
        { fields, ...(renames ? { renames } : {}) }
      ),
  },
  {
    name: "a plugin's updateCollection",
    registry: "dynamic_collections",
    slug: "posts",
    table: "dc_posts",
    create: async () => {
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "posts", label: "Posts", fields: BEFORE }
      );
    },
    store: async t => {
      await t.nextly.create({ collection: "posts", data: { heading: "Kept" } });
    },
    change: (t, renames, fields = AFTER) => {
      const service: CollectionService = t.getService("collectionService");
      return service.updateCollection(
        "posts",
        {
          fields,
          ...(renames ? { renames } : {}),
        } as Parameters<CollectionService["updateCollection"]>[1],
        {}
      );
    },
  },
  {
    name: "the Single schema PATCH",
    registry: "dynamic_singles",
    slug: "hero",
    table: "single_hero",
    create: async () => {
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "hero", label: "Hero", fields: BEFORE }
      );
    },
    store: async t => {
      const singles: SingleEntryService = t.getService("singleEntryService");
      const written = await singles.update(
        "hero",
        { heading: "Kept", _overwrite: true },
        { overrideAccess: true }
      );
      expect(written.success, JSON.stringify(written)).toBe(true);
    },
    change: (_t, renames, fields = AFTER) =>
      dispatchSingles(
        "updateSingleSchema",
        { slug: "hero" },
        { fields, ...(renames ? { renames } : {}) }
      ),
  },
];

describeEachDialect(
  "a REST or plugin schema change renames a field only when the request says so",
  dialect => {
    let current: TestNextly;
    let basePath: string;

    beforeEach(async () => {
      // The change's migration is written into the project's history and run, in development.
      vi.stubEnv("NODE_ENV", "development");
      basePath = mkdtempSync(join(tmpdir(), "nextly-asks-before-renaming-"));
      current = await createTestNextly({
        dialect,
        collections: [],
        basePath,
        db: { migrationsDir: HISTORY, uiSchemaFile: DEFINITION },
      });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
      rmSync(basePath, { recursive: true, force: true });
    });

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    /** The names of the fields the registry records for the road's entity. */
    async function registeredNames(road: Road): Promise<string[]> {
      const [row] = await query<{ fields: unknown }>(
        `SELECT ${q("fields")} AS fields FROM ${q(road.registry)} WHERE ${q("slug")} = '${road.slug}'`
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name: string }[];
      return fields.map(field => field.name);
    }

    async function valuesOf(road: Road, column: string): Promise<unknown[]> {
      const rows = await query<{ v: unknown }>(
        `SELECT ${q(column)} AS v FROM ${q(road.table)}`
      );
      return rows.map(row => row.v);
    }

    /** Every migration file in the project's history folder, oldest first. */
    function sqlFiles(): string[] {
      const folder = join(basePath, HISTORY);
      if (!existsSync(folder)) return [];
      return readdirSync(folder)
        .filter(f => f.endsWith(".sql"))
        .sort()
        .map(f => join(folder, f));
    }

    /** What a change answered: its refusal's per-field entries, or "accepted". */
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

    for (const road of ROADS) {
      it(`refuses an unanswered pair on ${road.name}, naming both fields, and writes nothing`, async () => {
        await road.create(current);
        await road.store(current);
        const files = sqlFiles();

        const answer = await answerOf(() => road.change(current));

        expect(answer).toEqual([
          expect.objectContaining({
            code: "FIELD_RENAME_UNANSWERED",
            message: expect.stringMatching(
              new RegExp(`${road.slug}[\\s\\S]*heading[\\s\\S]*headline`)
            ),
          }),
        ]);
        expect(await registeredNames(road)).toEqual(["heading", "body"]);
        expect(await valuesOf(road, "heading")).toEqual(["Kept"]);
        expect(sqlFiles(), "the migration files").toEqual(files);
      });

      it(`renames on ${road.name} when the request says rename, keeping the values`, async () => {
        await road.create(current);
        await road.store(current);

        const answer = await answerOf(() =>
          road.change(current, [
            { from: "heading", to: "headline", choice: "rename" },
          ])
        );

        expect(answer).toBe("accepted");
        expect(await registeredNames(road)).toEqual(["headline", "body"]);
        expect(await valuesOf(road, "headline")).toEqual(["Kept"]);
        expect(readFileSync(sqlFiles().at(-1)!, "utf-8")).toMatch(
          /RENAME COLUMN/i
        );
      });

      it(`drops and adds on ${road.name} when the request says it is not a rename`, async () => {
        // Nothing stored: a drop of a column holding values asks a consent of its own.
        await road.create(current);

        const answer = await answerOf(() =>
          road.change(current, [
            { from: "heading", to: "headline", choice: "drop_and_add" },
          ])
        );

        expect(answer).toBe("accepted");
        expect(await registeredNames(road)).toEqual(["headline", "body"]);
        const file = readFileSync(sqlFiles().at(-1)!, "utf-8").split(
          "-- DOWN"
        )[0]!;
        expect(file).not.toMatch(/RENAME COLUMN/i);
        expect(file).toMatch(/DROP COLUMN/i);
      });

      it(`refuses on ${road.name} renaming two fields replaced at once, rather than dropping both`, async () => {
        // Two fields leave and two arrive, which pairs nothing: the answers would be left aside
        // and both columns dropped with their values, though the request asked to keep them.
        await road.create(current);
        await road.store(current);
        const files = sqlFiles();

        const answer = await answerOf(() =>
          road.change(
            current,
            [
              { from: "heading", to: "headline", choice: "rename" },
              { from: "body", to: "copy", choice: "rename" },
            ],
            [
              { name: "headline", type: "text" },
              { name: "copy", type: "text" },
            ]
          )
        );

        expect(answer).toEqual([
          expect.objectContaining({
            code: "FIELD_RENAME_NOT_OFFERED",
            message: expect.stringMatching(/heading[\s\S]*headline/),
          }),
        ]);
        expect(await registeredNames(road)).toEqual(["heading", "body"]);
        expect(await valuesOf(road, "heading")).toEqual(["Kept"]);
        expect(sqlFiles(), "the migration files").toEqual(files);
      });
    }
  }
);

describeEachDialect(
  "a localized collection's change asks about the pair each of its tables would rename",
  dialect => {
    let current: TestNextly;
    let basePath: string;

    beforeEach(async () => {
      vi.stubEnv("NODE_ENV", "development");
      basePath = mkdtempSync(join(tmpdir(), "nextly-asks-localized-"));
      current = await createTestNextly({
        dialect,
        collections: [],
        basePath,
        db: { migrationsDir: HISTORY, uiSchemaFile: DEFINITION },
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
      rmSync(basePath, { recursive: true, force: true });
    });

    async function posts(fields: Record<string, unknown>[]): Promise<void> {
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "posts", label: "Posts", localized: true, fields }
      );
    }

    function change(
      fields: Record<string, unknown>[],
      renames?: Renames
    ): Promise<unknown> {
      return dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "posts" },
        { fields, ...(renames ? { renames } : {}) }
      );
    }

    async function codeOf(run: Promise<unknown>): Promise<string | undefined> {
      try {
        const result = (await run) as { success?: boolean } | null;
        return result?.success === false ? "refused" : undefined;
      } catch (error) {
        return (error as { publicData?: { errors?: { code?: string }[] } })
          .publicData?.errors?.[0]?.code;
      }
    }

    it("refuses a shared field replaced beside a translated one added, which the shared table alone pairs", async () => {
      await posts([
        { name: "heading", type: "text", localized: false },
        { name: "body", type: "text", localized: true },
      ]);

      // Over the whole list two fields arrive, so it pairs nothing; the shared table's own
      // change is `heading` leaving and `headline` arriving.
      expect(
        await codeOf(
          change([
            { name: "headline", type: "text", localized: false },
            { name: "body", type: "text", localized: true },
            { name: "summary", type: "text", localized: true },
          ])
        )
      ).toBe("FIELD_RENAME_UNANSWERED");
    });

    it("asks nothing of a text field translated by default replaced beside another translated field added", async () => {
      // `heading` and `headline` carry no flag, so the collection's default translates them: the
      // companion sees one removal and two additions, which pair nothing to ask about. What is
      // left is the translated-field preflight's own answer, as before.
      await posts([
        { name: "heading", type: "text" },
        { name: "views", type: "number" },
      ]);

      expect(
        await codeOf(
          change([
            { name: "headline", type: "text" },
            { name: "summary", type: "text", localized: true },
            { name: "views", type: "number" },
          ])
        )
      ).toBe("TRANSLATED_FIELD_REMOVED_BESIDE_ADDED");
    });

    it("still asks about a translated field removed beside one added when the request answered only a shared pair", async () => {
      // `views` to `count` is the only pair, answered drop_and_add; `heading` leaving beside
      // `summary` of another type is no pair, so its translations are not the request's to drop.
      await posts([
        { name: "views", type: "number", localized: false },
        { name: "heading", type: "text", localized: true },
      ]);

      expect(
        await codeOf(
          change(
            [
              { name: "count", type: "number", localized: false },
              { name: "summary", type: "richText", localized: true },
            ],
            [{ from: "views", to: "count", choice: "drop_and_add" }]
          )
        )
      ).toBe("TRANSLATED_FIELD_REMOVED_BESIDE_ADDED");
    });

    it("drops and adds a translated field when the request says so, not refusing its removal as unanswered", async () => {
      await posts([
        { name: "heading", type: "text", localized: true },
        { name: "views", type: "number" },
      ]);

      expect(
        await codeOf(
          change(
            [
              { name: "headline", type: "text", localized: true },
              { name: "views", type: "number" },
            ],
            [{ from: "heading", to: "headline", choice: "drop_and_add" }]
          )
        )
      ).toBeUndefined();
      // Dropped and added on the companion too: no step renamed its column.
      const folder = join(basePath, HISTORY);
      const newest = readdirSync(folder)
        .filter(file => file.endsWith(".sql"))
        .sort()
        .at(-1)!;
      expect(
        readFileSync(join(folder, newest), "utf-8").split("-- DOWN")[0]
      ).not.toMatch(/RENAME COLUMN/i);
    });
  }
);
