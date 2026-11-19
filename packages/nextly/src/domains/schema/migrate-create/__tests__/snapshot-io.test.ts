// F11 PR 3: snapshot-io tests.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeMigrationHash,
  EMPTY_SNAPSHOT,
  loadLatestSnapshot,
  newestSnapshotName,
  parseSnapshotFile,
  SnapshotFileError,
  snapshotFieldGroupNaming,
  snapshotPathOf,
  verifyMigrationHash,
  writeSnapshot,
  type SnapshotFile,
} from "../snapshot-io";

describe("snapshot-io", () => {
  let metaDir: string;

  beforeEach(async () => {
    // A migration folder's `meta/`, so a migration file has a folder of the
    // test's own to sit in beside it.
    metaDir = join(
      await mkdtemp(join(tmpdir(), "nextly-snapshot-test-")),
      "meta"
    );
    await mkdir(metaDir);
  });

  afterEach(async () => {
    // Cleanup is best-effort; vitest's tmpdir is auto-cleaned by the OS.
  });

  describe("snapshotPathOf", () => {
    it("is where writeSnapshot writes a migration's snapshot", async () => {
      // A dry run names the snapshot by this path without writing it, so the
      // writer must put it nowhere else.
      const written = await writeSnapshot(
        metaDir,
        "20260101000000_init",
        EMPTY_SNAPSHOT,
        "-- UP\n"
      );
      expect(written).toBe(snapshotPathOf(metaDir, "20260101000000_init"));
    });
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
      // Each beside its migration file, as a written migration leaves them.
      for (const base of [
        "20260101_120000_001_first",
        "20260102_120000_001_second",
      ]) {
        await writeFile(join(metaDir, "..", `${base}.sql`), "", "utf-8");
      }
      const result = await loadLatestSnapshot(metaDir);
      expect(result).not.toBeNull();
      expect(result!.filename).toBe("20260102_120000_001_second.snapshot.json");
      expect(result!.data.snapshot.tables[0].name).toBe("dc_b");
    });

    it("passes over a snapshot whose migration file was never written", async () => {
      // As a writer stopped between its two files leaves the folder: the
      // snapshot is there, and the migration it describes is not.
      const file = (table: string): SnapshotFile => ({
        version: 1,
        migrationHash: "a".repeat(64),
        snapshot: { tables: [{ name: table, columns: [] }] },
      });
      await writeFile(
        join(metaDir, "20260101_120000_001_first.snapshot.json"),
        JSON.stringify(file("dc_a")),
        "utf-8"
      );
      await writeFile(
        join(metaDir, "..", "20260101_120000_001_first.sql"),
        "",
        "utf-8"
      );
      await writeFile(
        join(metaDir, "20260102_120000_001_unwritten.snapshot.json"),
        JSON.stringify(file("dc_b")),
        "utf-8"
      );

      expect(await newestSnapshotName(metaDir)).toBe(
        "20260101_120000_001_first.snapshot.json"
      );
      const result = await loadLatestSnapshot(metaDir);
      expect(result!.data.snapshot.tables[0].name).toBe("dc_a");

      // Alone in the folder, it is no snapshot to start from at all.
      await rm(join(metaDir, "..", "20260101_120000_001_first.sql"));
      expect(await loadLatestSnapshot(metaDir)).toBeNull();
    });

    it("counts a snapshot whose migration is written for one dialect", async () => {
      await writeFile(
        join(metaDir, "0001_000000_schema.snapshot.json"),
        JSON.stringify({
          version: 1,
          migrationHash: "a".repeat(64),
          snapshot: { tables: [{ name: "dc_a", columns: [] }] },
        } satisfies SnapshotFile),
        "utf-8"
      );
      await writeFile(
        join(metaDir, "..", "0001_000000_schema.mysql.sql"),
        "",
        "utf-8"
      );

      expect(await newestSnapshotName(metaDir)).toBe(
        "0001_000000_schema.snapshot.json"
      );
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

    // A history on the legacy field-group names is written exactly as before the record existed.
    it("writes a legacy snapshot byte for byte as before the field-group naming record", async () => {
      const snapshot = {
        tables: [
          {
            name: "comp_card",
            columns: [
              { name: "_component_type", type: "text", nullable: true },
            ],
          },
        ],
      };
      const sql = "SELECT 1;";
      const unnamed = await readFile(
        await writeSnapshot(metaDir, "20260101_000000_000_a", snapshot, sql),
        "utf-8"
      );
      const named = await readFile(
        await writeSnapshot(
          metaDir,
          "20260101_000000_000_b",
          snapshot,
          sql,
          {},
          undefined,
          undefined,
          "legacy"
        ),
        "utf-8"
      );
      expect(named).toBe(unnamed);
      const parsed = JSON.parse(named) as Record<string, unknown>;
      expect(parsed.version).toBe(1);
      expect(parsed).not.toHaveProperty("fieldGroupStorage");
      expect(snapshotFieldGroupNaming(parseSnapshotFile(named, "a"))).toBe(
        "legacy"
      );
    });

    // An older CLI refuses any version but 1 ("upgrade your CLI"), so it stops at a history on the
    // current names instead of planning to drop each fg_ table and create its comp_ twin.
    it("writes a snapshot on the current field-group names as version 2, which an older CLI refuses", async () => {
      const raw = await readFile(
        await writeSnapshot(
          metaDir,
          "20260101_000000_000_c",
          { tables: [] },
          "SELECT 1;",
          {},
          undefined,
          undefined,
          "current"
        ),
        "utf-8"
      );
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed.version).toBe(2);
      expect(parsed.fieldGroupStorage).toBe("current");
      expect(snapshotFieldGroupNaming(parseSnapshotFile(raw, "c"))).toBe(
        "current"
      );
    });

    // Every declared permission, by owner, travels in the snapshot so it alone says what they were;
    // a snapshot written without the record keeps no key, which a reader takes as saying nothing.
    it("writes the permission record it is given, and none when given none", async () => {
      const permissions = {
        app: {},
        plugins: {
          "@nextlyhq/plugin-form-builder": {
            "export-submissions": {
              action: "export",
              resource: "submissions",
              name: "Export submissions",
              description: null,
              group: "Forms",
              danger: false,
            },
          },
        },
        collections: {},
        singles: {},
      };
      const withRecord = await writeSnapshot(
        metaDir,
        "20260429_154500_001_with",
        { tables: [] },
        "SELECT 1;",
        {},
        undefined,
        permissions
      );
      expect(
        parseSnapshotFile(await readFile(withRecord, "utf-8"), "x").permissions
      ).toEqual(permissions);
      const without = await writeSnapshot(
        metaDir,
        "20260429_154500_002_without",
        { tables: [] },
        "SELECT 1;"
      );
      expect(JSON.parse(await readFile(without, "utf-8"))).not.toHaveProperty(
        "permissions"
      );
    });

    it("says it records translated fields, with or without a translated table", async () => {
      // Without the statement, a snapshot with no translated table reads the same as one
      // written before snapshots recorded translated fields.
      const path = await writeSnapshot(
        metaDir,
        "20260429_154500_001_create_posts",
        { tables: [{ name: "dc_posts", columns: [] }] },
        "SELECT 1;"
      );
      const parsed = parseSnapshotFile(await readFile(path, "utf-8"), "x");
      expect(parsed.translatedFieldsRecorded).toBe(true);
    });

    it("persists indexes when present and leaves them undefined when absent", async () => {
      const snapshot = {
        tables: [
          {
            name: "dc_x",
            columns: [{ name: "id", type: "text", nullable: false }],
            indexes: [
              { name: "idx_dc_x_slug", columns: ["slug"], unique: true },
            ],
          },
          {
            name: "dc_y",
            columns: [{ name: "id", type: "text", nullable: false }],
            // no indexes key -> stays undefined (pre-C1 sentinel)
          },
        ],
      };
      await writeSnapshot(
        metaDir,
        "20260601_120000_001_idx",
        snapshot,
        "-- sql"
      );
      // Beside its migration file, as a written migration leaves it.
      await writeFile(
        join(metaDir, "..", "20260601_120000_001_idx.sql"),
        "",
        "utf-8"
      );
      const loaded = await loadLatestSnapshot(metaDir);
      const tables = loaded!.data.snapshot.tables;
      const x = tables.find(t => t.name === "dc_x")!;
      const y = tables.find(t => t.name === "dc_y")!;
      expect(x.indexes).toEqual([
        { name: "idx_dc_x_slug", columns: ["slug"], unique: true },
      ]);
      expect(y.indexes).toBeUndefined();
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
      await writeFile(join(nestedMetaDir, "..", "test.sql"), "", "utf-8");
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

    it("throws on a version it does not know (e.g. a future v3 snapshot)", () => {
      expect(() =>
        parseSnapshotFile(
          JSON.stringify({
            version: 3,
            migrationHash: VALID_HASH,
            snapshot: { tables: [] },
          }),
          "test.snapshot.json"
        )
      ).toThrow(/expected version: 1 or 2, got 3\. .*upgrade your CLI/);
    });

    // The field-group naming record and the version go together, so a file whose two disagree
    // was edited by hand and is refused rather than read by either one.
    it("accepts a version 2 snapshot on the current field-group names", () => {
      const parsed = parseSnapshotFile(
        JSON.stringify({
          version: 2,
          fieldGroupStorage: "current",
          migrationHash: VALID_HASH,
          snapshot: { tables: [] },
        }),
        "test.snapshot.json"
      );
      expect(snapshotFieldGroupNaming(parsed)).toBe("current");
    });

    it("refuses a version 2 snapshot that does not say it is on the current names", () => {
      expect(() =>
        parseSnapshotFile(
          JSON.stringify({
            version: 2,
            migrationHash: VALID_HASH,
            snapshot: { tables: [] },
          }),
          "test.snapshot.json"
        )
      ).toThrow(/fieldGroupStorage: "current" in a version 2 snapshot/);
    });

    it("refuses a version 1 snapshot that says it is on the current names", () => {
      expect(() =>
        parseSnapshotFile(
          JSON.stringify({
            version: 1,
            fieldGroupStorage: "current",
            migrationHash: VALID_HASH,
            snapshot: { tables: [] },
          }),
          "test.snapshot.json"
        )
      ).toThrow(/expected version: 2 for a snapshot on the current/);
    });

    it("refuses a field-group naming record it does not know", () => {
      expect(() =>
        parseSnapshotFile(
          JSON.stringify({
            version: 2,
            fieldGroupStorage: "legacy",
            migrationHash: VALID_HASH,
            snapshot: { tables: [] },
          }),
          "test.snapshot.json"
        )
      ).toThrow(/fieldGroupStorage to be "current" when present/);
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

    it("throws on a record of translated fields that isn't `true`", () => {
      expect(() =>
        parseSnapshotFile(
          JSON.stringify({
            version: 1,
            migrationHash: VALID_HASH,
            snapshot: { tables: [] },
            translatedFieldsRecorded: "yes",
          }),
          "test.snapshot.json"
        )
      ).toThrow(/translatedFieldsRecorded/);
    });

    it("throws on a permission record that is not one", () => {
      expect(() =>
        parseSnapshotFile(
          JSON.stringify({
            version: 1,
            migrationHash: VALID_HASH,
            snapshot: { tables: [] },
            permissions: { app: [], plugins: {} },
          }),
          "test.snapshot.json"
        )
      ).toThrow(/permissions/);
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
