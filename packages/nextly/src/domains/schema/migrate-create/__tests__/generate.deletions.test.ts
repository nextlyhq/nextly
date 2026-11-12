// A generated migration that deletes data: its deletions are judged before
// anything is written, a refusal writes nothing, and the file it writes names
// every deletion in its header, under the hash its snapshot records.
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { Deletion } from "../../migrate/data-loss-consent";
import {
  buildDesiredSnapshotFromConfigForTest,
  generateMigration,
  type MinimalConfigEntity,
} from "../generate";
import { computeMigrationHash, writeSnapshot } from "../snapshot-io";

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

  /** The latest snapshot holds `entities`, as a project whose last migration created them. */
  async function snapshotOf(entities: MinimalConfigEntity[]): Promise<void> {
    await writeSnapshot(
      join(migrationsDir, "meta"),
      "20260101_000000_000_initial",
      buildDesiredSnapshotFromConfigForTest(entities, [], [], "postgresql"),
      ""
    );
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

    expect(judged).toEqual([
      { kind: "table", table: "dc_posts", reason: "no longer in the config" },
    ]);
    expect(filesWhenJudged).toEqual(before);
    expect(result!.deletions).toEqual(judged);
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql).toContain('DROP TABLE "dc_posts"');
    expect(sql).toContain(
      "-- Deletes: table dc_posts: no longer in the config"
    );
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
