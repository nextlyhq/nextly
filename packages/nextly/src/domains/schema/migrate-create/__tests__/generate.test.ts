// F11 PR 3: orchestrator unit tests for generateMigration.
//
// Covers the core decision tree:
// - No previous snapshot + non-empty config -> CREATE TABLE for each.
// - Previous snapshot matches config -> null (no changes).
// - Single rename detected, accepted -> RENAME COLUMN.
// - Single rename detected, declined -> drop + add (data loss).
// - Cross-dialect SQL generation through generateSQL.

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  applyRenameDecisionsForTest,
  buildDesiredSnapshotFromConfigForTest,
  generateMigration,
  type MinimalConfigEntity,
} from "../generate.js";
import { writeSnapshot } from "../snapshot-io.js";

const NOW = new Date("2026-04-29T15:45:00.123Z");

// NOTE: avoid `title` and `slug` field names because buildDesiredTableFromFields
// auto-injects them as reserved columns when the user hasn't defined them.
// That auto-injection makes a "rename of title" invisible to the diff because
// the reserved title takes its place. Use `description` and `summary` instead.

const POSTS_V1: MinimalConfigEntity = {
  slug: "posts",
  tableName: "dc_posts",
  fields: [{ name: "description", type: "text", required: true }],
};

const POSTS_V2_RENAMED: MinimalConfigEntity = {
  slug: "posts",
  tableName: "dc_posts",
  fields: [{ name: "summary", type: "text", required: true }],
};

const POSTS_V3_ADD_EXCERPT: MinimalConfigEntity = {
  slug: "posts",
  tableName: "dc_posts",
  fields: [
    { name: "description", type: "text", required: true },
    { name: "excerpt", type: "text" },
  ],
};

describe("generateMigration", () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), "nextly-generate-test-"));
  });

  it("first migration: no previous snapshot -> CREATE TABLE", async () => {
    const result = await generateMigration({
      name: "create_posts",
      dialect: "postgresql",
      migrationsDir,
      collections: [POSTS_V1],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });
    expect(result).not.toBeNull();
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql).toContain('CREATE TABLE "dc_posts"');
    expect(sql).toContain("-- Collections: posts");
    expect(sql).toContain("-- Generated at: 2026-04-29T15:45:00.123Z");
  });

  it("returns null when config matches latest snapshot (no changes)", async () => {
    // Seed a snapshot matching POSTS_V1.
    const desired = buildDesiredSnapshotFromConfigForTest(
      [POSTS_V1],
      [],
      [],
      "postgresql"
    );
    await writeSnapshot(
      join(migrationsDir, "meta"),
      "20260101_000000_000_initial",
      desired,
      ""
    );

    const result = await generateMigration({
      name: "no_op",
      dialect: "postgresql",
      migrationsDir,
      collections: [POSTS_V1],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });
    expect(result).toBeNull();
  });

  it("add column: emits ADD COLUMN against last snapshot", async () => {
    const desired = buildDesiredSnapshotFromConfigForTest(
      [POSTS_V1],
      [],
      [],
      "postgresql"
    );
    await writeSnapshot(
      join(migrationsDir, "meta"),
      "20260101_000000_000_initial",
      desired,
      ""
    );

    const result = await generateMigration({
      name: "add_excerpt",
      dialect: "postgresql",
      migrationsDir,
      collections: [POSTS_V3_ADD_EXCERPT],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });
    expect(result).not.toBeNull();
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql).toContain('ALTER TABLE "dc_posts" ADD COLUMN "excerpt"');
  });

  it("rename: non-interactive auto-accept emits RENAME COLUMN", async () => {
    const desired = buildDesiredSnapshotFromConfigForTest(
      [POSTS_V1],
      [],
      [],
      "postgresql"
    );
    await writeSnapshot(
      join(migrationsDir, "meta"),
      "20260101_000000_000_initial",
      desired,
      ""
    );

    const result = await generateMigration({
      name: "rename_title_to_name",
      dialect: "postgresql",
      migrationsDir,
      collections: [POSTS_V2_RENAMED],
      singles: [],
      components: [],
      nonInteractive: true,
      autoAcceptRenames: true,
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.renamesAccepted).toBe(1);
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql).toContain('RENAME COLUMN "description" TO "summary"');
    expect(sql).not.toContain("DROP COLUMN");
    expect(sql).not.toContain("ADD COLUMN");
  });

  it("rename: non-interactive auto-decline emits DROP + ADD", async () => {
    const desired = buildDesiredSnapshotFromConfigForTest(
      [POSTS_V1],
      [],
      [],
      "postgresql"
    );
    await writeSnapshot(
      join(migrationsDir, "meta"),
      "20260101_000000_000_initial",
      desired,
      ""
    );

    const result = await generateMigration({
      name: "drop_title_add_name",
      dialect: "postgresql",
      migrationsDir,
      collections: [POSTS_V2_RENAMED],
      singles: [],
      components: [],
      nonInteractive: true,
      autoAcceptRenames: false,
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.renamesAccepted).toBe(0);
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql).toContain('DROP COLUMN "description"');
    expect(sql).toContain('ADD COLUMN "summary"');
    expect(sql).not.toContain("RENAME COLUMN");
  });

  it("writes paired snapshot file with correct migrationHash", async () => {
    const result = await generateMigration({
      name: "create_posts",
      dialect: "postgresql",
      migrationsDir,
      collections: [POSTS_V1],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });
    expect(result).not.toBeNull();
    const sqlContent = await readFile(result!.sqlPath, "utf-8");
    const snapshotRaw = await readFile(result!.snapshotPath, "utf-8");
    const snapshot = JSON.parse(snapshotRaw);
    expect(snapshot.version).toBe(1);
    expect(snapshot.migrationHash).toMatch(/^[a-f0-9]{64}$/);
    // Recompute and verify
    const { computeMigrationHash } = await import("../snapshot-io.js");
    expect(snapshot.migrationHash).toBe(computeMigrationHash(sqlContent));
  });

  it("MySQL emits backtick-quoted identifiers", async () => {
    const result = await generateMigration({
      name: "create_posts",
      dialect: "mysql",
      migrationsDir,
      collections: [POSTS_V1],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });
    expect(result).not.toBeNull();
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql).toContain("CREATE TABLE `dc_posts`");
  });

  it("SQLite emits double-quoted identifiers", async () => {
    const result = await generateMigration({
      name: "create_posts",
      dialect: "sqlite",
      migrationsDir,
      collections: [POSTS_V1],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });
    expect(result).not.toBeNull();
    const sql = await readFile(result!.sqlPath, "utf-8");
    expect(sql).toContain('CREATE TABLE "dc_posts"');
  });
});

describe("applyRenameDecisions (rename collapsing)", () => {
  it("replaces matching drop+add pair with rename_column on accept", () => {
    const ops = [
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "title",
        columnType: "text",
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: { name: "name", type: "text", nullable: false },
      },
    ];
    const decisions = [
      {
        candidate: {
          tableName: "dc_posts",
          fromColumn: "title",
          toColumn: "name",
          fromType: "text",
          toType: "text",
          typesCompatible: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: true,
      },
    ];
    const out = applyRenameDecisionsForTest(ops, decisions);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("rename_column");
  });

  it("leaves drop+add intact on decline", () => {
    const ops = [
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "title",
        columnType: "text",
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: { name: "name", type: "text", nullable: false },
      },
    ];
    const decisions = [
      {
        candidate: {
          tableName: "dc_posts",
          fromColumn: "title",
          toColumn: "name",
          fromType: "text",
          toType: "text",
          typesCompatible: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: false,
      },
    ];
    const out = applyRenameDecisionsForTest(ops, decisions);
    expect(out).toHaveLength(2);
    expect(out.map(o => o.type)).toEqual(["drop_column", "add_column"]);
  });

  it("preserves non-rename ops untouched", () => {
    const ops = [
      {
        type: "add_table" as const,
        table: { name: "dc_new", columns: [] },
      },
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "title",
        columnType: "text",
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: { name: "name", type: "text", nullable: false },
      },
    ];
    const decisions = [
      {
        candidate: {
          tableName: "dc_posts",
          fromColumn: "title",
          toColumn: "name",
          fromType: "text",
          toType: "text",
          typesCompatible: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: true,
      },
    ];
    const out = applyRenameDecisionsForTest(ops, decisions);
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe("add_table");
    expect(out[1].type).toBe("rename_column");
  });
});
