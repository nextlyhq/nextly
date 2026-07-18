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
  selectVariant,
  getSortedBaseNames,
} from "../migration-discovery";

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

      const groups = await discoverMigrationGroups(testDir);

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

      const groups = await discoverMigrationGroups(testDir);

      expect(groups.size).toBe(1);
      expect(groups.has("0001_000000_blog_schema")).toBe(true);

      const variants = groups.get("0001_000000_blog_schema")!.variants;
      expect(variants).toHaveLength(3);

      const variantFiles = variants.map(v => v.file).sort();
      expect(variantFiles).toEqual([
        "0001_000000_blog_schema.mysql.sql",
        "0001_000000_blog_schema.sqlite.sql",
        "0001_000000_blog_schema.sql",
      ]);
    });

    it("should handle mixed base and dialect-specific files", async () => {
      await createMigrationFile("0001_000000_init.sql");
      await createMigrationFile("0002_000000_posts.sql");
      await createMigrationFile("0002_000000_posts.mysql.sql");

      const groups = await discoverMigrationGroups(testDir);

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

      const groups = await discoverMigrationGroups(testDir);

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
});

describe("migration-discovery", () => {
  describe("discoverMigrationGroups", () => {
    it("should group base file only", async () => {
      const groups = await discoverMigrationGroups(
        "fixtures/migrations/base-only"
      );

      expect(groups.size).toBe(1);
      expect(groups.has("0001_000000_init")).toBe(true);
      expect(groups.get("0001_000000_init")!.variants).toHaveLength(1);
      expect(
        groups.get("0001_000000_init")!.variants[0].dialect
      ).toBeUndefined();
    });

    it("should group dialect-specific files", async () => {
      const groups = await discoverMigrationGroups(
        "fixtures/migrations/dialect-split"
      );

      expect(groups.size).toBe(1);
      expect(groups.has("0001_000000_blog_schema")).toBe(true);

      const variants = groups.get("0001_000000_blog_schema")!.variants;
      expect(variants).toHaveLength(3);

      const variantFiles = variants.map(v => v.file).sort();
      expect(variantFiles).toEqual([
        "0001_000000_blog_schema.mysql.sql",
        "0001_000000_blog_schema.sqlite.sql",
        "0001_000000_blog_schema.sql",
      ]);
    });

    it("should handle mixed base and dialect-specific files", async () => {
      const groups = await discoverMigrationGroups("fixtures/migrations/mixed");

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
      const groups = await discoverMigrationGroups(
        "fixtures/migrations/dialect-split"
      );

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
});
