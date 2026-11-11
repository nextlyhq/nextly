/**
 * The registry source is the newest applied app migration's snapshot, where
 * it records every entity's declaration. A later snapshot of a migration not
 * yet applied never stands in for it, and a newest applied snapshot that
 * records no declarations is no source at all, never an empty registry.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRegistrySource } from "../registry-source";

const HASH = "a".repeat(64);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-registry-source-"));
  mkdirSync(join(dir, "meta"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A snapshot beside migration `base`, recording `posts` with `title` as `description`. */
function snapshot(base: string, description?: string): void {
  writeFileSync(
    join(dir, "meta", `${base}.snapshot.json`),
    JSON.stringify({
      version: 1,
      migrationHash: HASH,
      snapshot: { tables: [] },
      ...(description === undefined
        ? {}
        : {
            entities: {
              collections: {
                posts: {
                  source: "code",
                  settings: { slug: "posts", description, fields: [] },
                },
              },
              singles: {},
              fieldGroups: {},
            },
          }),
    })
  );
}

const appliedOnly =
  (...applied: string[]) =>
  (file: string) =>
    Promise.resolve(applied.includes(file));

describe("readRegistrySource", () => {
  it("is the newest applied migration's recorded declarations", async () => {
    snapshot("20260101_000000_000_a", "first");
    snapshot("20260102_000000_000_b", "second");
    snapshot("20260103_000000_000_c", "pending");

    const source = await readRegistrySource({
      migrationsDir: dir,
      isApplied: appliedOnly(
        "20260101_000000_000_a.sql",
        "20260102_000000_000_b.sql"
      ),
    });

    expect(source).toMatchObject({
      kind: "snapshot",
      file: "20260102_000000_000_b.snapshot.json",
    });
    expect(
      source.kind === "snapshot" &&
        source.entities.collections.posts?.settings.description
    ).toBe("second");
  });

  it("is none where the newest applied snapshot records no declarations, even if an earlier one does", async () => {
    snapshot("20260101_000000_000_a", "first");
    snapshot("20260102_000000_000_b");

    const source = await readRegistrySource({
      migrationsDir: dir,
      isApplied: appliedOnly(
        "20260101_000000_000_a.sql",
        "20260102_000000_000_b.sql"
      ),
    });

    expect(source).toEqual({
      kind: "none",
      reason: "no-record",
      file: "20260102_000000_000_b.snapshot.json",
    });
  });

  it("is none where no applied migration has a snapshot", async () => {
    snapshot("20260101_000000_000_a", "first");
    const source = await readRegistrySource({
      migrationsDir: dir,
      isApplied: appliedOnly(),
    });
    expect(source).toEqual({ kind: "none", reason: "no-snapshot" });
  });

  it("is none, naming the file, where the newest applied snapshot cannot be read", async () => {
    snapshot("20260101_000000_000_a", "first");
    writeFileSync(
      join(dir, "meta", "20260102_000000_000_b.snapshot.json"),
      "{ not json"
    );
    const source = await readRegistrySource({
      migrationsDir: dir,
      isApplied: appliedOnly(
        "20260101_000000_000_a.sql",
        "20260102_000000_000_b.sql"
      ),
    });
    expect(source).toEqual({
      kind: "none",
      reason: "unreadable",
      file: "20260102_000000_000_b.snapshot.json",
    });
  });
});
