/**
 * The snapshots `nextly migrate` registers entities from are the ones whose
 * migration was written: a snapshot left alone in `meta/`, by a writer
 * stopped before its `.sql`, records entities no migration made.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadSnapshots,
  newestApplied,
  type MigrationSnapshot,
} from "../snapshot-source";

let migrationsDir: string;

beforeEach(() => {
  migrationsDir = mkdtempSync(join(tmpdir(), "nextly-snapshot-source-"));
});

afterEach(() => {
  rmSync(migrationsDir, { recursive: true, force: true });
});

/** A snapshot recording one collection, `slug`, in the folder's `meta/`. */
function snapshotOf(base: string, slug: string): void {
  const snapshot: MigrationSnapshot = {
    version: 1,
    collections: [{ slug, tableName: `dc_${slug}`, fields: [] }],
  };
  mkdirSync(join(migrationsDir, "meta"), { recursive: true });
  writeFileSync(
    join(migrationsDir, "meta", `${base}.snapshot.json`),
    JSON.stringify(snapshot)
  );
}

describe("the snapshots nextly migrate reads", () => {
  it("leave out one whose migration file was never written", async () => {
    snapshotOf("20260101_000000_000_posts", "posts");
    writeFileSync(join(migrationsDir, "20260101_000000_000_posts.sql"), "");
    // As a writer stopped between its two files leaves the folder.
    snapshotOf("20260102_000000_000_pages", "pages");

    const loaded = await loadSnapshots({ migrationsDir });

    expect(loaded.map(snapshot => snapshot.file)).toEqual([
      "20260101_000000_000_posts.snapshot.json",
    ]);
  });

  it("so an applied migration's entity is not withheld behind a newer snapshot nothing wrote", async () => {
    snapshotOf("20260101_000000_000_posts", "posts");
    writeFileSync(join(migrationsDir, "20260101_000000_000_posts.sql"), "");
    // The same collection again, in a snapshot whose migration never came.
    snapshotOf("20260102_000000_000_posts_again", "posts");

    const loaded = await loadSnapshots({
      migrationsDir,
      isApplied: async file => file === "20260101_000000_000_posts.sql",
    });
    const registrable = newestApplied(loaded, snapshot => snapshot.collections);

    expect(registrable.map(collection => collection.slug)).toEqual(["posts"]);
  });
});
