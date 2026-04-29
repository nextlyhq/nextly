// F11 PR 3: snapshot-io tests.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeMigrationHash,
  EMPTY_SNAPSHOT,
  loadLatestSnapshot,
  parseSnapshotFile,
  SnapshotFileError,
  verifyMigrationHash,
  writeSnapshot,
  type SnapshotFile,
} from "../snapshot-io.js";

describe("snapshot-io", () => {
  let metaDir: string;

  beforeEach(async () => {
    metaDir = await mkdtemp(join(tmpdir(), "nextly-snapshot-test-"));
  });

  afterEach(async () => {
    // Cleanup is best-effort; vitest's tmpdir is auto-cleaned by the OS.
  });

  describe("loadLatestSnapshot", () => {
    it("returns null when meta directory doesn't exist", async () => {
      const result = await loadLatestSnapshot(join(metaDir, "does-not-exist"));
      expect(result).toBeNull();
    });

    it("returns null when meta directory is empty", async () => {
      const result = await loadLatestSnapshot(metaDir);
      expect(result).toBeNull();
    });

    it("ignores non-snapshot files", async () => {
      await writeFile(join(metaDir, "README.md"), "ignore me", "utf-8");
      const result = await loadLatestSnapshot(metaDir);
      expect(result).toBeNull();
    });

    it("returns the alphabetically last snapshot file", async () => {
      const fileA: SnapshotFile = {
        version: 1,
        migrationHash: "a".repeat(64),
        snapshot: { tables: [{ name: "dc_a", columns: [] }] },
      };
      const fileB: SnapshotFile = {
        version: 1,
        migrationHash: "b".repeat(64),
        snapshot: { tables: [{ name: "dc_b", columns: [] }] },
      };
      await writeFile(
        join(metaDir, "20260101_120000_001_first.snapshot.json"),
        JSON.stringify(fileA),
        "utf-8"
      );
      await writeFile(
        join(metaDir, "20260102_120000_001_second.snapshot.json"),
        JSON.stringify(fileB),
        "utf-8"
      );
      const result = await loadLatestSnapshot(metaDir);
      expect(result).not.toBeNull();
      expect(result!.filename).toBe("20260102_120000_001_second.snapshot.json");
      expect(result!.data.snapshot.tables[0].name).toBe("dc_b");
    });
  });

  describe("writeSnapshot", () => {
    it("writes a deterministic envelope with version + migrationHash + snapshot", async () => {
      const snapshot = {
        tables: [
          {
            name: "dc_posts",
            columns: [
              { name: "id", type: "uuid", nullable: false },
              { name: "title", type: "text", nullable: false },
            ],
          },
        ],
      };
      const sqlContent = "CREATE TABLE dc_posts (id uuid PRIMARY KEY);";
      const path = await writeSnapshot(
        metaDir,
        "20260429_154500_001_create_posts",
        snapshot,
        sqlContent
      );
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw) as SnapshotFile;
      expect(parsed.version).toBe(1);
      expect(parsed.migrationHash).toMatch(/^[a-f0-9]{64}$/);
      expect(parsed.migrationHash).toBe(computeMigrationHash(sqlContent));
      expect(parsed.snapshot.tables[0].name).toBe("dc_posts");
    });

    it("sorts tables and columns alphabetically for reproducibility", async () => {
      const snapshot = {
        tables: [
          {
            name: "dc_zebra",
            columns: [
              { name: "z_col", type: "text", nullable: true },
              { name: "a_col", type: "text", nullable: true },
            ],
          },
          {
            name: "dc_alpha",
            columns: [{ name: "id", type: "text", nullable: false }],
          },
        ],
      };
      const path = await writeSnapshot(metaDir, "test", snapshot, "");
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw) as SnapshotFile;
      expect(parsed.snapshot.tables.map(t => t.name)).toEqual([
        "dc_alpha",
        "dc_zebra",
      ]);
      expect(parsed.snapshot.tables[1].columns.map(c => c.name)).toEqual([
        "a_col",
        "z_col",
      ]);
    });

    it("creates the meta directory if missing", async () => {
      const nestedMetaDir = join(metaDir, "nested", "meta");
      await writeSnapshot(nestedMetaDir, "test", { tables: [] }, "");
      const result = await loadLatestSnapshot(nestedMetaDir);
      expect(result).not.toBeNull();
    });

    it("writes JSON with sorted keys at the top level", async () => {
      const path = await writeSnapshot(metaDir, "test", { tables: [] }, "");
      const raw = await readFile(path, "utf-8");
      // The first key should be "migrationHash" (m comes before s and v
      // alphabetically). If keys weren't sorted, "version" might come first.
      const firstKeyMatch = raw.match(/^\{\s*"([^"]+)"/);
      expect(firstKeyMatch?.[1]).toBe("migrationHash");
    });
  });

  describe("computeMigrationHash", () => {
    it("returns a 64-char hex SHA-256", () => {
      const hash = computeMigrationHash("hello world");
      expect(hash).toBe(
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
      );
    });

    it("is deterministic", () => {
      const a = computeMigrationHash("CREATE TABLE foo;");
      const b = computeMigrationHash("CREATE TABLE foo;");
      expect(a).toBe(b);
    });

    it("differs for different content", () => {
      expect(computeMigrationHash("a")).not.toBe(computeMigrationHash("b"));
    });
  });

  describe("verifyMigrationHash", () => {
    it("returns ok=true when content matches recorded hash", async () => {
      const sql = "CREATE TABLE foo (id text);";
      await writeSnapshot(
        metaDir,
        "20260429_154500_001_test",
        { tables: [] },
        sql
      );
      const result = await verifyMigrationHash(
        metaDir,
        "20260429_154500_001_test.sql",
        sql
      );
      expect(result.ok).toBe(true);
      expect(result.expected).toBe(result.actual);
    });

    it("returns ok=false when content was modified", async () => {
      const original = "CREATE TABLE foo (id text);";
      await writeSnapshot(
        metaDir,
        "20260429_154500_001_test",
        { tables: [] },
        original
      );
      const tampered = "CREATE TABLE foo (id text); DROP TABLE foo;";
      const result = await verifyMigrationHash(
        metaDir,
        "20260429_154500_001_test.sql",
        tampered
      );
      expect(result.ok).toBe(false);
      expect(result.actual).not.toBe(result.expected);
    });

    it("returns ok=false with no expected when snapshot file is missing", async () => {
      const result = await verifyMigrationHash(
        metaDir,
        "no_paired_snapshot.sql",
        "anything"
      );
      expect(result.ok).toBe(false);
      expect(result.expected).toBeUndefined();
    });
  });

  describe("EMPTY_SNAPSHOT", () => {
    it("is the well-known empty schema", () => {
      expect(EMPTY_SNAPSHOT).toEqual({ tables: [] });
    });
  });

  describe("parseSnapshotFile (F11 PR 3 review fix #4)", () => {
    const VALID_HASH = "a".repeat(64);

    it("accepts a well-formed envelope", () => {
      const json = JSON.stringify({
        version: 1,
        migrationHash: VALID_HASH,
        snapshot: { tables: [] },
      });
      expect(() => parseSnapshotFile(json, "test.snapshot.json")).not.toThrow();
    });

    it("throws SnapshotFileError on invalid JSON", () => {
      expect(() => parseSnapshotFile("not json", "test.snapshot.json")).toThrow(
        SnapshotFileError
      );
    });

    it("throws on non-object root", () => {
      expect(() => parseSnapshotFile("[]", "test.snapshot.json")).toThrow(
        /expected a JSON object/
      );
    });

    it("throws on missing version", () => {
      expect(() =>
        parseSnapshotFile(
          JSON.stringify({
            migrationHash: VALID_HASH,
            snapshot: { tables: [] },
          }),
          "test.snapshot.json"
        )
      ).toThrow(/expected version: 1/);
    });

    it("throws on wrong version (e.g. future v2 snapshot)", () => {
      expect(() =>
        parseSnapshotFile(
          JSON.stringify({
            version: 2,
            migrationHash: VALID_HASH,
            snapshot: { tables: [] },
          }),
          "test.snapshot.json"
        )
      ).toThrow(/expected version: 1, got 2/);
    });

    it("throws on missing migrationHash", () => {
      expect(() =>
        parseSnapshotFile(
          JSON.stringify({ version: 1, snapshot: { tables: [] } }),
          "test.snapshot.json"
        )
      ).toThrow(/migrationHash to be a 64-char hex SHA-256/);
    });

    it("throws on bad-shape migrationHash (too short)", () => {
      expect(() =>
        parseSnapshotFile(
          JSON.stringify({
            version: 1,
            migrationHash: "abc",
            snapshot: { tables: [] },
          }),
          "test.snapshot.json"
        )
      ).toThrow(/64-char hex SHA-256/);
    });

    it("throws on missing snapshot.tables", () => {
      expect(() =>
        parseSnapshotFile(
          JSON.stringify({
            version: 1,
            migrationHash: VALID_HASH,
            snapshot: {},
          }),
          "test.snapshot.json"
        )
      ).toThrow(/snapshot.tables to be an array/);
    });

    it("includes the filename in the error message for findability", () => {
      try {
        parseSnapshotFile(
          "garbage",
          "20260429_154500_001_oopsie.snapshot.json"
        );
        throw new Error("expected throw");
      } catch (err) {
        expect((err as Error).message).toContain(
          "20260429_154500_001_oopsie.snapshot.json"
        );
      }
    });
  });
});
