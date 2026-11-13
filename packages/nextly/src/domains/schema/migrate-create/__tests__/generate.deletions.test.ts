// A generated migration that deletes data: its deletions are judged before
// anything is written, a refusal writes nothing, and the file it writes names
// every deletion in its header, under the hash its snapshot records.
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { Deletion } from "../../migrate/data-loss-consent";
import { generateMigration, type MinimalConfigEntity } from "../generate";
import { computeMigrationHash } from "../snapshot-io";

const NOW = new Date("2026-04-29T15:45:00.123Z");

const POSTS: MinimalConfigEntity = {
  slug: "posts",
  tableName: "dc_posts",
  fields: [{ name: "description", type: "text", required: true }],
};
const POSTS_RENAMED: MinimalConfigEntity = {
  slug: "posts",
  tableName: "dc_posts",
  fields: [{ name: "summary", type: "text", required: true }],
};
const POSTS_WITH_EXCERPT: MinimalConfigEntity = {
  slug: "posts",
  tableName: "dc_posts",
  fields: [
    { name: "description", type: "text", required: true },
    { name: "excerpt", type: "text" },
  ],
};
const PAGES: MinimalConfigEntity = {
  slug: "pages",
  tableName: "dc_pages",
  fields: [{ name: "title", type: "text" }],
};

describe("generateMigration's deletions", () => {
  let migrationsDir: string;

  /**
   * The latest snapshot holds `entities`, written by a first run as a project's first migration is,
   * so it records each entity as well as its table.
   */
  async function snapshotOf(entities: MinimalConfigEntity[]): Promise<void> {
    await generateMigration({
      name: "initial",
      dialect: "postgresql",
      migrationsDir,
      collections: entities,
      singles: [],
      components: [],
      nonInteractive: true,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
  }

  /** The `.sql` files in the folder and the snapshots in `meta`. */
  async function written(): Promise<string[]> {
    const top = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"));
    const meta = await readdir(join(migrationsDir, "meta"));
    return [...top, ...meta.map(f => `meta/${f}`)].sort();
  }

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), "nextly-generate-deletions-"));
  });

  it("judges a removed entity's table before writing, then names it in the header", async () => {
    await snapshotOf([POSTS, PAGES]);
    const before = await written();
    let judged: readonly Deletion[] = [];
    let filesWhenJudged: string[] = [];

    const result = await generateMigration({
      name: "remove_posts",
      dialect: "postgresql",
      migrationsDir,
      collections: [PAGES],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
      judgeDeletions: async deletions => {
        judged = deletions;
        filesWhenJudged = await written();
      },
    });

    // No reason: a run given no entity record cannot tell an entity's table from another table.
    expect(judged).toEqual([{ kind: "table", table: "dc_posts" }]);
    expect(filesWhenJudged).toEqual(before);
    expect(result!.deletions).toEqual(judged);
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql).toContain('DROP TABLE "dc_posts"');
    expect(sql).toContain("-- Deletes: table dc_posts");
    expect(sql).toMatch(/^-- Destructive: .*--accept-data-loss=dc_posts /m);
  });

  it("writes nothing when the judge refuses", async () => {
    await snapshotOf([POSTS, PAGES]);
    const before = await written();
    const refusal = new Error("refused");

    await expect(
      generateMigration({
        name: "remove_posts",
        dialect: "postgresql",
        migrationsDir,
        collections: [PAGES],
        singles: [],
        components: [],
        nonInteractive: true,
        now: NOW,
        judgeDeletions: () => Promise.reject(refusal),
      })
    ).rejects.toBe(refusal);
    expect(await written()).toEqual(before);
  });

  it("names a rename a run that cannot ask declined", async () => {
    await snapshotOf([POSTS]);
    const result = await generateMigration({
      name: "rename_description",
      dialect: "postgresql",
      migrationsDir,
      collections: [POSTS_RENAMED],
      singles: [],
      components: [],
      nonInteractive: true,
      autoAcceptRenames: false,
      now: NOW,
    });
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql).toContain(
      "-- Deletes: column dc_posts.description: rename to summary declined"
    );
  });

  it("judges a type change as nextly migrate will, naming the change", async () => {
    await snapshotOf([POSTS]);
    let judged: readonly Deletion[] = [];
    const result = await generateMigration({
      name: "description_to_number",
      dialect: "postgresql",
      migrationsDir,
      collections: [
        {
          ...POSTS,
          fields: [{ name: "description", type: "number", required: true }],
        },
      ],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
      judgeDeletions: deletions => {
        judged = deletions;
        return Promise.resolve();
      },
    });
    expect(judged).toEqual([
      expect.objectContaining({
        kind: "column",
        table: "dc_posts",
        column: "description",
        reason: expect.stringMatching(/^type changes from text to /),
      }),
    ]);
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql).toMatch(
      /^-- Deletes: column dc_posts\.description: type changes from text to /m
    );
  });

  it("names a translation move as one: values moved or archived before the drop", async () => {
    const translated: MinimalConfigEntity = {
      slug: "docs",
      tableName: "dc_docs",
      localized: true,
      fields: [{ name: "body", type: "text", localized: true }],
    };
    const plain: MinimalConfigEntity = {
      slug: "docs",
      tableName: "dc_docs",
      fields: [{ name: "body", type: "text" }],
    };
    const judgedFor = async (
      first: MinimalConfigEntity,
      next: MinimalConfigEntity
    ) => {
      const dir = await mkdtemp(join(tmpdir(), "nextly-generate-moves-"));
      const run = (
        entity: MinimalConfigEntity,
        name: string,
        at: string,
        judge?: (d: readonly Deletion[]) => Promise<void>
      ) =>
        generateMigration({
          name,
          dialect: "sqlite",
          migrationsDir: dir,
          defaultLocale: "en",
          collections: [entity],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date(at),
          ...(judge === undefined ? {} : { judgeDeletions: judge }),
        });
      await run(first, "one", "2026-10-16T10:00:00.000Z");
      let judged: readonly Deletion[] = [];
      await run(next, "two", "2026-10-16T11:00:00.000Z", d => {
        judged = d;
        return Promise.resolve();
      });
      return judged;
    };

    expect(await judgedFor(plain, translated)).toEqual([
      {
        kind: "column",
        table: "dc_docs",
        column: "body",
        reason:
          "translation turned on for docs; its values move to dc_docs_locales first",
      },
    ]);
    expect(await judgedFor(translated, plain)).toEqual([
      {
        kind: "table",
        table: "dc_docs_locales",
        reason:
          "translation turned off for docs; the default language's values move back and the others are kept in the archive",
      },
    ]);
  });

  it("asks nothing and marks nothing when nothing is deleted", async () => {
    await snapshotOf([POSTS]);
    let asked = false;
    const result = await generateMigration({
      name: "add_excerpt",
      dialect: "postgresql",
      migrationsDir,
      collections: [POSTS_WITH_EXCERPT],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
      judgeDeletions: () => {
        asked = true;
        return Promise.resolve();
      },
    });
    expect(asked).toBe(false);
    expect(result!.deletions).toEqual([]);
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql).not.toMatch(/^-- (Destructive|Deletes):/m);
  });

  it("records the hash of the file as marked", async () => {
    await snapshotOf([POSTS, PAGES]);
    const result = await generateMigration({
      name: "remove_posts",
      dialect: "postgresql",
      migrationsDir,
      collections: [PAGES],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });
    const sql = await readFile(result!.sqlPath, "utf-8");
    const snapshot = JSON.parse(await readFile(result!.snapshotPath, "utf-8"));
    expect(sql).toContain("-- Deletes: table dc_posts");
    expect(snapshot.migrationHash).toBe(computeMigrationHash(sql));
  });

  it("judges a dry run's deletions too, and writes nothing", async () => {
    await snapshotOf([POSTS, PAGES]);
    const before = await written();
    let judged: readonly Deletion[] = [];
    const result = await generateMigration({
      name: "remove_posts",
      dialect: "postgresql",
      migrationsDir,
      collections: [PAGES],
      singles: [],
      components: [],
      nonInteractive: true,
      dryRun: true,
      now: NOW,
      judgeDeletions: deletions => {
        judged = deletions;
        return Promise.resolve();
      },
    });
    expect(judged).toHaveLength(1);
    expect(result!.sqlContent).toContain("-- Deletes: table dc_posts");
    expect(await written()).toEqual(before);
  });
});
