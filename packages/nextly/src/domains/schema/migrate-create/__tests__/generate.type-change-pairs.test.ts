/**
 * A field's type change, as `migrate:create` judges it with no database to read: by its pair of
 * types alone. A pair blocked whatever its values hold (`pairBlocked`) is refused before anything
 * is written. A pair that keeps its column but can clear a value (`pairCanLose`) writes no
 * statement that deletes, so the statement judge alone would list nothing: it is listed as a
 * deletion of the column's values, asked consent for and named in the file's header. A pair that
 * can clear nothing is listed as nothing.
 *
 * What separates the correct generator from the plausible broken one: the generator that judges
 * statements only lists no deletion for text becoming a choice (no statement runs), and writes the
 * blocked pair's file.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, password, select, text } from "../../../../config";
import type { Deletion } from "../../migrate/data-loss-consent";
import { resolveCollectionTableName } from "../../utils/resolve-table-name";
import { toMinimalEntities } from "../config-entities";
import { generateMigration } from "../generate";

const TEXT = () => text({ name: "code" });
const SELECT = () =>
  select({ name: "code", options: [{ label: "A", value: "a" }] });
const PASSWORD = () => password({ name: "code" });

/**
 * The `posts` collection with its one field, as `migrate:create` reduces a config: declared, so
 * its snapshot records the field's type with the entity.
 */
const posts = (field: () => unknown) =>
  toMinimalEntities(
    [defineCollection({ slug: "posts", fields: [field()] as never })],
    e => resolveCollectionTableName(e.slug, e.dbName)
  );

describe.each<SupportedDialect>(["postgresql", "mysql", "sqlite"])(
  "migrate:create over a field's type change (%s)",
  dialect => {
    let migrationsDir: string;

    beforeEach(async () => {
      migrationsDir = await mkdtemp(join(tmpdir(), "nextly-type-pairs-"));
    });
    afterEach(async () => {
      await rm(migrationsDir, { recursive: true, force: true });
    });

    /** A run of `migrate:create` with `collections`, collecting what its consent is asked for. */
    async function run(
      collections: ReturnType<typeof posts>,
      name: string,
      minute: number
    ) {
      let judged: readonly Deletion[] = [];
      const result = await generateMigration({
        name,
        dialect,
        migrationsDir,
        collections,
        singles: [],
        components: [],
        nonInteractive: true,
        now: new Date(Date.UTC(2026, 10, 18, 12, minute)),
        judgeDeletions: deletions => {
          judged = deletions;
          return Promise.resolve();
        },
      });
      return { result, judged };
    }

    /** The `.sql` files in the folder and the snapshots in `meta`. */
    async function written(): Promise<string[]> {
      const top = (await readdir(migrationsDir)).filter(f =>
        f.endsWith(".sql")
      );
      const meta = await readdir(join(migrationsDir, "meta"));
      return [...top, ...meta.map(f => `meta/${f}`)].sort();
    }

    it("refuses a pair blocked whatever its values hold, writing nothing", async () => {
      await run(posts(TEXT), "one", 1);
      const before = await written();

      await expect(run(posts(PASSWORD), "two", 2)).rejects.toMatchObject({
        publicData: {
          errors: [expect.objectContaining({ code: "TYPE_CHANGE_BLOCKED" })],
        },
      });
      expect(await written()).toEqual(before);
    });

    it("lists a pair that keeps its column and can clear a value as a deletion of that column's values", async () => {
      await run(posts(TEXT), "one", 1);

      const { result, judged } = await run(posts(SELECT), "two", 2);

      expect(judged).toEqual([
        expect.objectContaining({
          kind: "column",
          table: "dc_posts",
          column: "code",
          reason: expect.stringMatching(/text to select/),
        }),
      ]);
      expect(result).not.toBeNull();
      expect(await readFile(result!.sqlPath, "utf-8")).toMatch(
        /^-- Deletes: column dc_posts\.code: .*text to select/m
      );
    });

    it("lists nothing for a pair that can clear no value", async () => {
      await run(posts(SELECT), "one", 1);

      const { result, judged } = await run(posts(TEXT), "two", 2);

      // The run writes its file, so it judged what the file deletes, and found nothing: the
      // consent is asked for nothing and the header names nothing.
      expect(result).not.toBeNull();
      expect(result!.deletions).toEqual([]);
      expect(judged).toEqual([]);
      expect(await readFile(result!.sqlPath, "utf-8")).not.toContain(
        "-- Deletes:"
      );
    });
  }
);
