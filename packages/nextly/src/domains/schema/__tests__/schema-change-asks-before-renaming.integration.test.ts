/**
 * A schema change sent through the REST API or a plugin that removes one field and adds another
 * of the same type is never taken as a rename by guesswork. Where the request doesn't say which
 * it is, it is refused before anything is written, naming the entity and both fields; one that
 * says `rename` renames, keeping the values, and one that says `drop_and_add` drops the old field
 * and adds the new one. On each road that takes a field list without the Builder's own answers:
 * the collection schema PATCH, the Single schema PATCH, and a plugin's
 * `ctx.services.collections.updateCollection`.
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
  change(t: TestNextly, renames?: Renames): Promise<unknown>;
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
    change: (_t, renames) =>
      dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "posts" },
        { fields: AFTER, ...(renames ? { renames } : {}) }
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
    change: (t, renames) => {
      const service: CollectionService = t.getService("collectionService");
      return service.updateCollection(
        "posts",
        {
          fields: AFTER,
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
    change: (_t, renames) =>
      dispatchSingles(
        "updateSingleSchema",
        { slug: "hero" },
        { fields: AFTER, ...(renames ? { renames } : {}) }
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
    }
  }
);
