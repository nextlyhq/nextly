/**
 * Unit tests for reset.ts. Covers the file-state wipe and the SQLite
 * file deletion. The Postgres/MySQL DB wipes hit a network and are
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { wipeDbSqlite, wipeFileState } from "../reset";

const TMP = path.join("/tmp", "playground-reset-test");

describe("wipeFileState", () => {
  beforeEach(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
    await fs.mkdir(path.join(TMP, "public/uploads"), { recursive: true });
    await fs.writeFile(path.join(TMP, "public/uploads/file.txt"), "x");
    await fs.mkdir(path.join(TMP, ".next"), { recursive: true });
    await fs.writeFile(path.join(TMP, ".next/build.json"), "{}");
    await fs.mkdir(path.join(TMP, ".turbo"), { recursive: true });
    await fs.mkdir(path.join(TMP, "src/types"), { recursive: true });
    await fs.writeFile(path.join(TMP, "src/types/nextly-types.ts"), "// gen");
    await fs.mkdir(path.join(TMP, "src/db/migrations"), { recursive: true });
    await fs.writeFile(path.join(TMP, "src/db/migrations/0000.sql"), "-- m");
  });

  afterEach(() => fs.rm(TMP, { recursive: true, force: true }));

  it("removes uploads, .next, .turbo, generated types, and migrations", async () => {
    await wipeFileState(TMP);
    await expect(fs.access(path.join(TMP, "public/uploads"))).rejects.toThrow();
    await expect(fs.access(path.join(TMP, ".next"))).rejects.toThrow();
    await expect(fs.access(path.join(TMP, ".turbo"))).rejects.toThrow();
    await expect(
      fs.access(path.join(TMP, "src/types/nextly-types.ts"))
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(TMP, "src/db/migrations"))
    ).rejects.toThrow();
  });

  it("succeeds on directories that don't exist", async () => {
    await fs.rm(path.join(TMP, ".next"), { recursive: true });
    await fs.rm(path.join(TMP, ".turbo"), { recursive: true });
    await expect(wipeFileState(TMP)).resolves.toBeUndefined();
  });
});

describe("wipeDbSqlite", () => {
  beforeEach(() => fs.rm(TMP, { recursive: true, force: true }));
  afterEach(() => fs.rm(TMP, { recursive: true, force: true }));

  it("deletes the SQLite db file", async () => {
    await fs.mkdir(path.join(TMP, "data"), { recursive: true });
    await fs.writeFile(path.join(TMP, "data/playground.db"), "sqlite-bytes");
    await wipeDbSqlite(path.join(TMP, "data/playground.db"));
    await expect(
      fs.access(path.join(TMP, "data/playground.db"))
    ).rejects.toThrow();
  });

  it("deletes WAL and journal sidecar files when present", async () => {
    await fs.mkdir(path.join(TMP, "data"), { recursive: true });
    const dbPath = path.join(TMP, "data/playground.db");
    await fs.writeFile(dbPath, "main");
    await fs.writeFile(dbPath + "-wal", "wal");
    await fs.writeFile(dbPath + "-shm", "shm");
    await fs.writeFile(dbPath + "-journal", "journal");
    await wipeDbSqlite(dbPath);
    await expect(fs.access(dbPath)).rejects.toThrow();
    await expect(fs.access(dbPath + "-wal")).rejects.toThrow();
    await expect(fs.access(dbPath + "-shm")).rejects.toThrow();
    await expect(fs.access(dbPath + "-journal")).rejects.toThrow();
  });

  it("succeeds when the db file doesn't exist", async () => {
    await expect(
      wipeDbSqlite(path.join(TMP, "data/nope.db"))
    ).resolves.toBeUndefined();
  });
});
