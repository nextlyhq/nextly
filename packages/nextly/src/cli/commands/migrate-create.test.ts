// F11 PR 2 regression test: forward-only model means generated migration
// files MUST NOT contain a `-- DOWN` section. Without this guard, the
// next refactor of the formatter (PR 3 will reorganize this code into
// `domains/schema/migrate-create/format-file.ts`) could silently
// re-introduce a `-- DOWN` line and nobody would know until manual smoke.

import { describe, expect, it } from "vitest";

import {
  formatMigrationFileForTest,
  generateBlankMigrationContentForTest,
} from "./migrate-create.js";

describe("migrate-create file emission (F11 PR 2 forward-only)", () => {
  describe("generateBlankMigrationContent", () => {
    it("emits a -- UP section", () => {
      const content = generateBlankMigrationContentForTest(
        "custom_seed",
        "postgresql"
      );
      expect(content).toContain("-- UP");
    });

    it("does NOT emit a -- DOWN section (Q4=A: forward-only)", () => {
      const content = generateBlankMigrationContentForTest(
        "custom_seed",
        "postgresql"
      );
      expect(content).not.toContain("-- DOWN");
      expect(content).not.toContain("rollback");
    });

    it("includes the dialect name in the header", () => {
      const content = generateBlankMigrationContentForTest(
        "custom_seed",
        "mysql"
      );
      expect(content).toContain("-- Dialect: MySQL");
    });
  });

  describe("formatMigrationFile", () => {
    const fixtureMigration = {
      name: "20260429_154500_001_add_excerpt",
      up: 'ALTER TABLE "dc_posts" ADD COLUMN "excerpt" TEXT;',
      down: 'ALTER TABLE "dc_posts" DROP COLUMN "excerpt";', // populated but ignored
      checksum: "abc123",
      description: "add_excerpt",
      dialect: "postgresql" as const,
      generatedAt: new Date("2026-04-29T15:45:00.001Z"),
    };
    const fixtureCollection = {
      id: "posts",
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      tableName: "dc_posts",
      fields: [],
      timestamps: true,
      description: undefined,
      source: "code" as const,
      locked: true,
      schemaHash: "",
      schemaVersion: 1,
      migrationStatus: "pending" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("emits the -- UP section with the up SQL", () => {
      const content = formatMigrationFileForTest(fixtureMigration, [
        fixtureCollection,
      ]);
      expect(content).toContain("-- UP");
      expect(content).toContain(
        'ALTER TABLE "dc_posts" ADD COLUMN "excerpt" TEXT;'
      );
    });

    it("does NOT emit a -- DOWN section even when migration.down is populated (Q4=A)", () => {
      // The MigrationGenerator still populates `down:` (decommissioning
      // is PR 3 scope). The formatter must ignore it.
      const content = formatMigrationFileForTest(fixtureMigration, [
        fixtureCollection,
      ]);
      expect(content).not.toContain("-- DOWN");
      expect(content).not.toContain('DROP COLUMN "excerpt"');
    });

    it("emits the -- Collections: header for the dynamic_collections linkage (Q6=A)", () => {
      const content = formatMigrationFileForTest(fixtureMigration, [
        fixtureCollection,
      ]);
      expect(content).toContain("-- Collections: posts");
    });
  });
});
