/**
 * Migration Discovery Utilities Tests
 *
 * Tests for shared migration discovery logic that groups dialect variants.
 * Ensures consistent behavior across migrate, migrate:status, and build commands.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import type { MigrationVariant } from "../migration-discovery";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  discoverMigrationGroups,
  readMigrationFolder,
  selectVariant,
  getSortedBaseNames,
} from "../migration-discovery";

/**
 * COVERAGE NOTE (AGENTS.md, deleted-test rule — "redundant").
 *
 * This file previously contained TWO top-level `describe("migration-discovery")`
 * blocks with the same four inner suites and the same cases:
 * `discoverMigrationGroups`, `selectVariant`, `getSortedBaseNames`, and the
 * dialect-split round-trip. The second was a verbatim duplicate of this one and
 * was removed.
 *
 * Every case it ran survives HERE, in the block below — nothing moved to
 * another file. A reader comparing this against the history will see the
 * deletion halve the file's line count without changing what is asserted, which
 * is the distinction this note exists to make: deduplication, not a loss of
 * discovery coverage.
 */
describe("migration-discovery", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextly-migration-discovery-test-")
    );
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  async function createMigrationFile(
    filename: string,
    content: string = "-- test migration"
  ) {
    await fs.writeFile(path.join(testDir, filename), content);
  }

  describe("discoverMigrationGroups", () => {
    it("should group base file only", async () => {
      await createMigrationFile("0001_000000_init.sql");

      const groups = await discoverMigrationGroups(testDir, "postgresql");

      expect(groups.size).toBe(1);
      expect(groups.has("0001_000000_init")).toBe(true);
      expect(groups.get("0001_000000_init")!.variants).toHaveLength(1);
      expect(
        groups.get("0001_000000_init")!.variants[0].dialect
      ).toBeUndefined();
    });

    it("should group dialect-specific files", async () => {
      await createMigrationFile("0001_000000_blog_schema.sql");
      await createMigrationFile("0001_000000_blog_schema.mysql.sql");
      await createMigrationFile("0001_000000_blog_schema.sqlite.sql");

      const groups = await discoverMigrationGroups(testDir, "postgresql");

      expect(groups.size).toBe(1);
      expect(groups.has("0001_000000_blog_schema")).toBe(true);

      const variants = groups.get("0001_000000_blog_schema")!.variants;
      expect(variants).toHaveLength(3);

      const variantFiles = variants.map(v => v.file).sort();
      expect(variantFiles).toEqual([
        "0001_000000_blog_schema.mysql.sql",
        "0001_000000_blog_schema.sql",
        "0001_000000_blog_schema.sqlite.sql",
      ]);
    });

    it("should handle mixed base and dialect-specific files", async () => {
      await createMigrationFile("0001_000000_init.sql");
      await createMigrationFile("0002_000000_posts.sql");
      await createMigrationFile("0002_000000_posts.mysql.sql");

      const groups = await discoverMigrationGroups(testDir, "postgresql");

      expect(groups.size).toBe(2);
      expect(groups.has("0001_000000_init")).toBe(true);
      expect(groups.has("0002_000000_posts")).toBe(true);

      // Base file only
      expect(groups.get("0001_000000_init")!.variants).toHaveLength(1);

      // Dialect variants
      expect(groups.get("0002_000000_posts")!.variants.length).toBeGreaterThan(
        0
      );
    });
  });

  describe("selectVariant", () => {
    const variants: MigrationVariant[] = [
      { file: "0001.sql", dialect: undefined },
      { file: "0001.mysql.sql", dialect: "mysql" },
      { file: "0001.sqlite.sql", dialect: "sqlite" },
    ];

    it("should prefer dialect-specific variant when dialect is provided", () => {
      const selected = selectVariant(variants, "mysql");
      expect(selected).toBe("0001.mysql.sql");
    });

    it("should fall back to base file when no dialect match", () => {
      const selected = selectVariant(variants, "postgresql");
      expect(selected).toBe("0001.sql");
    });

    it("should prefer base file when no dialect is specified", () => {
      const selected = selectVariant(variants);
      expect(selected).toBe("0001.sql");
    });

    it("should return undefined for empty variants", () => {
      const selected = selectVariant([]);
      expect(selected).toBeUndefined();
    });
  });

  describe("getSortedBaseNames", () => {
    it("should return sorted base names", () => {
      const groups = new Map([
        ["0002_posts", { baseName: "0002_posts", variants: [] }],
        ["0001_init", { baseName: "0001_init", variants: [] }],
        ["0003_users", { baseName: "0003_users", variants: [] }],
      ]);

      const names = getSortedBaseNames(groups);
      expect(names).toEqual(["0001_init", "0002_posts", "0003_users"]);
    });
  });

  describe("integration: dialect-split round-trip", () => {
    it("should report 3 dialect files as 1 logical migration", async () => {
      // This simulates the blog template with dialect split
      await createMigrationFile("0001_000000_blog_schema.sql");
      await createMigrationFile("0001_000000_blog_schema.mysql.sql");
      await createMigrationFile("0001_000000_blog_schema.sqlite.sql");

      const groups = await discoverMigrationGroups(testDir, "postgresql");

      // Should group 3 files into 1 logical migration
      expect(groups.size).toBe(1);

      const baseName = getSortedBaseNames(groups)[0];
      expect(baseName).toBe("0001_000000_blog_schema");

      // Each command should select the appropriate variant for its dialect
      const mysqlVariant = selectVariant(
        groups.get(baseName)!.variants,
        "mysql"
      );
      expect(mysqlVariant).toBe("0001_000000_blog_schema.mysql.sql");

      const sqliteVariant = selectVariant(
        groups.get(baseName)!.variants,
        "sqlite"
      );
      expect(sqliteVariant).toBe("0001_000000_blog_schema.sqlite.sql");

      const baseVariant = selectVariant(groups.get(baseName)!.variants);
      expect(baseVariant).toBe("0001_000000_blog_schema.sql");
    });
  });

  // Every reader reads the folder through this, so an old Schema Builder file
  // is taken out here once. One folder holds a file of each kind; each
  // assertion is the one a reader that skipped the classification fails.
  describe("readMigrationFolder", () => {
    const OLD = "1730000000000_create_posts.sql";
    const HAND = "1730000000001_create_notes.sql";
    const OLD_CONTENT = `CREATE TABLE "dc_posts" ("id" text PRIMARY KEY);`;

    beforeEach(async () => {
      await createMigrationFile("20260101_000000_000_init.sql");
      await createMigrationFile(OLD, OLD_CONTENT);
      // The Builder's name, but a statement on another entity's table.
      await createMigrationFile(
        HAND,
        `ALTER TABLE "dc_posts" ADD COLUMN "x" text;`
      );
    });

    it("takes an old Builder file out of the migrations and lists it apart", async () => {
      const folder = await readMigrationFolder(testDir, "postgresql");
      expect([...folder.groups.keys()].sort()).toEqual([
        "1730000000001_create_notes",
        "20260101_000000_000_init",
      ]);
      expect(folder.oldBuilderFiles).toEqual([
        { file: OLD, entity: "posts", checksum: expect.any(String) },
      ]);
    });

    it("keeps a file with only part of the signature, naming what it lacks", async () => {
      const folder = await readMigrationFolder(testDir, "postgresql");
      expect(folder.partialBuilderFiles).toEqual([
        { file: HAND, lacks: ["scope"], checksum: expect.any(String) },
      ]);
    });

    it("keeps an old Builder name with a snapshot beside it", async () => {
      await fs.mkdir(path.join(testDir, "meta"));
      await fs.writeFile(
        path.join(testDir, "meta", "1730000000000_create_posts.snapshot.json"),
        "{}"
      );
      const folder = await readMigrationFolder(testDir, "postgresql");
      expect(folder.groups.has("1730000000000_create_posts")).toBe(true);
      expect(folder.oldBuilderFiles).toEqual([]);
      expect(folder.partialBuilderFiles.map(f => f.file)).toContain(OLD);
    });

    // The Builder never wrote a dialect variant. A base file with one beside
    // it is one migration with the variant, so it stays in its group: taken
    // out, its ledger name would hide the variant's rows, and another
    // dialect would fall back to running the variant written for MySQL.
    it("keeps an old Builder name with a dialect variant beside it", async () => {
      const VARIANT = "1730000000000_create_posts.mysql.sql";
      await createMigrationFile(
        VARIANT,
        "CREATE TABLE `dc_posts` (`id` varchar(36) PRIMARY KEY);"
      );
      for (const dialect of ["postgresql", "mysql"] as const) {
        const folder = await readMigrationFolder(testDir, dialect);
        const group = folder.groups.get("1730000000000_create_posts");
        expect(selectVariant(group?.variants ?? [], "postgresql")).toBe(OLD);
        expect(selectVariant(group?.variants ?? [], "mysql")).toBe(VARIANT);
        expect(folder.oldBuilderFiles).toEqual([]);
        // The base lacks the variant's absence (on MySQL its Postgres quoting
        // is out of scope too); the variant is no Builder file, so it is not
        // named as one.
        const partial = folder.partialBuilderFiles.map(f => f.file);
        expect(partial).toEqual([OLD, HAND]);
        expect(folder.partialBuilderFiles[0]?.lacks).toContain("variant");
        expect(partial).not.toContain(VARIANT);
      }
    });

    // A snapshot that cannot be checked is not a missing one: reading it as
    // absent would set the file aside as an old Builder file. Windows ignores
    // the mode, and root reads past it, so neither can make the folder unreadable.
    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "refuses when whether a snapshot exists cannot be told",
      async () => {
        const meta = path.join(testDir, "meta");
        await fs.mkdir(meta);
        await fs.chmod(meta, 0o000);
        try {
          await expect(
            readMigrationFolder(testDir, "postgresql")
          ).rejects.toMatchObject({ code: "EACCES" });
        } finally {
          await fs.chmod(meta, 0o755);
        }
      }
    );

    // A folder that cannot be listed is not an empty one: read as empty, every
    // mark would name a deleted file and a changed marked file would go unseen.
    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "refuses when the folder cannot be listed",
      async () => {
        await fs.chmod(testDir, 0o000);
        try {
          await expect(
            readMigrationFolder(testDir, "postgresql")
          ).rejects.toMatchObject({ code: "EACCES" });
        } finally {
          await fs.chmod(testDir, 0o755);
        }
      }
    );

    it("reads a folder that is not there as holding no migrations", async () => {
      const folder = await readMigrationFolder(
        path.join(testDir, "absent"),
        "postgresql"
      );
      expect(folder.groups.size).toBe(0);
      expect(folder.oldBuilderFiles).toEqual([]);
    });

    it("sets aside a file on a declared junction table only when the set is handed in", async () => {
      // An update, where nothing but a declaration ties a custom junction to
      // the collection.
      const file = "1730000000002_update_tags.sql";
      await createMigrationFile(
        file,
        'ALTER TABLE "dc_tags" ADD COLUMN "x" text;\nALTER TABLE "tag_links" ADD COLUMN "y" text;'
      );
      const declared = await readMigrationFolder(testDir, "postgresql", {
        junctions: new Map([["tags", new Set(["tag_links"])]]),
      });
      expect(declared.oldBuilderFiles.map(f => f.file)).toContain(file);
      const none = await readMigrationFolder(testDir, "postgresql");
      expect(none.partialBuilderFiles.map(f => f.file)).toContain(file);
    });

    // `nextly/cli/utils` publishes this with a one-argument contract: called
    // without a dialect it lists every file as it always did, unclassified.
    it("discoverMigrationGroups keeps its one-argument contract", async () => {
      const groups = await discoverMigrationGroups(testDir);
      expect([...groups.keys()].sort()).toEqual([
        "1730000000000_create_posts",
        "1730000000001_create_notes",
        "20260101_000000_000_init",
      ]);
    });

    it("discoverMigrationGroups reads the same migrations", async () => {
      const groups = await discoverMigrationGroups(testDir, "postgresql");
      expect(groups.has("1730000000000_create_posts")).toBe(false);
      expect(groups.has("1730000000001_create_notes")).toBe(true);
    });
  });
});
