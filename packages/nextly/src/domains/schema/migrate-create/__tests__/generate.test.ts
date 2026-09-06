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
} from "../generate";
import { buildInverseOperations } from "../down-generator";
import { writeSnapshot } from "../snapshot-io";

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

  it("writes a -- DOWN section that drops the table the UP creates", async () => {
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
    expect(sql).toContain("-- UP");
    expect(sql).toContain("-- DOWN");
    expect(sql.indexOf("-- UP")).toBeLessThan(sql.indexOf("-- DOWN"));
    // DOWN inverts the CREATE TABLE.
    expect(sql.toUpperCase()).toContain("DROP TABLE");
    expect(sql).toContain("dc_posts");
  });

  it("appends a metadata upsert only when its table is touched (§4.12.7)", async () => {
    const result = await generateMigration({
      name: "create_posts",
      dialect: "postgresql",
      migrationsDir,
      collections: [POSTS_V1],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
      metadataUpserts: [
        {
          tableName: "dc_posts",
          sql: 'INSERT INTO "dynamic_collections" /*posts*/',
        },
        {
          tableName: "dc_unrelated",
          sql: 'INSERT INTO "dynamic_collections" /*nope*/',
        },
      ],
    });
    expect(result).not.toBeNull();
    const sql = await readFile(result!.sqlPath, "utf-8");
    // dc_posts is created → its upsert is appended.
    expect(sql).toContain("/*posts*/");
    // dc_unrelated has no operation → its upsert is omitted.
    expect(sql).not.toContain("/*nope*/");
    // The upsert follows the CREATE TABLE DDL.
    expect(sql.indexOf("/*posts*/")).toBeGreaterThan(
      sql.indexOf('CREATE TABLE "dc_posts"')
    );
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

  it("renaming an indexed field: the new index is created after the rename", async () => {
    // Accepting the rename collapses the (drop_column, add_column) pair, so
    // the new column only comes into existence via RENAME COLUMN. An
    // add_index left after the raw column ops would then run before that
    // rename and reference a column the table does not have yet.
    const before: MinimalConfigEntity = {
      slug: "posts",
      tableName: "dc_posts",
      fields: [
        { name: "description", type: "text", required: true },
        { name: "heroImage", type: "text", index: true },
      ],
    };
    const after: MinimalConfigEntity = {
      slug: "posts",
      tableName: "dc_posts",
      fields: [
        { name: "description", type: "text", required: true },
        { name: "image", type: "text", index: true },
      ],
    };
    const desired = buildDesiredSnapshotFromConfigForTest(
      [before],
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
      name: "rename_hero_image",
      dialect: "postgresql",
      migrationsDir,
      collections: [after],
      singles: [],
      components: [],
      nonInteractive: true,
      autoAcceptRenames: true,
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.renamesAccepted).toBe(1);

    const sql = await readFile(result!.sqlPath, "utf-8");
    const up = sql.slice(sql.indexOf("-- UP"), sql.indexOf("-- DOWN"));
    const renameAt = up.indexOf('RENAME COLUMN "hero_image" TO "image"');
    const createIndexAt = up.indexOf(
      'CREATE INDEX IF NOT EXISTS "idx_dc_posts_image"'
    );
    expect(renameAt).toBeGreaterThan(-1);
    expect(createIndexAt).toBeGreaterThan(-1);
    expect(renameAt).toBeLessThan(createIndexAt);
  });

  it("removing an indexed field: UP drops the index before the column, DOWN re-adds in reverse", async () => {
    // SQLite refuses ALTER TABLE ... DROP COLUMN while an index still covers
    // the column, so the generated statement order is load-bearing, not
    // cosmetic. The DOWN section must mirror it: column first, then index.
    const withUnique: MinimalConfigEntity = {
      slug: "posts",
      tableName: "dc_posts",
      fields: [
        { name: "description", type: "text", required: true },
        { name: "heroImage", type: "text", unique: true },
      ],
    };
    const desired = buildDesiredSnapshotFromConfigForTest(
      [withUnique],
      [],
      [],
      "sqlite"
    );
    await writeSnapshot(
      join(migrationsDir, "meta"),
      "20260101_000000_000_initial",
      desired,
      ""
    );

    const result = await generateMigration({
      name: "drop_hero_image",
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

    const dropIndexAt = sql.indexOf(
      'DROP INDEX IF EXISTS "uq_dc_posts_hero_image"'
    );
    const dropColumnAt = sql.indexOf('DROP COLUMN "hero_image"');
    expect(dropIndexAt).toBeGreaterThan(-1);
    expect(dropColumnAt).toBeGreaterThan(-1);
    expect(dropIndexAt).toBeLessThan(dropColumnAt);

    const addColumnAt = sql.indexOf('ADD COLUMN "hero_image"');
    const addIndexAt = sql.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS "uq_dc_posts_hero_image"'
    );
    expect(addColumnAt).toBeGreaterThan(-1);
    expect(addIndexAt).toBeGreaterThan(-1);
    expect(addColumnAt).toBeLessThan(addIndexAt);
  });

  it("rename: non-interactive auto-accept emits RENAME COLUMN (description -> summary)", async () => {
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
      name: "rename_description_to_summary",
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
    const { computeMigrationHash } = await import("../snapshot-io");
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
          preservesValues: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: true,
      },
    ];
    const out = applyRenameDecisionsForTest(ops, decisions);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("rename_column");
  });

  it("carries the type change when the rename crosses types", () => {
    // 🔴 A generated migration used to receive the rename ALONE. A rename moves the column without
    // changing what it is, so the committed UP left `text` where the snapshot and the runtime expect
    // JSON, and its DOWN omitted the reverse — a file that passes review and diverges at apply time.
    const ops = [
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "_body",
        columnType: "text",
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: { name: "body", type: "jsonb", nullable: true },
      },
    ];
    const decisions = [
      {
        candidate: {
          tableName: "dc_posts",
          fromColumn: "_body",
          toColumn: "body",
          fromType: "text",
          toType: "jsonb",
          typesCompatible: true,
          preservesValues: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: true,
      },
    ];

    const out = applyRenameDecisionsForTest(ops, decisions, "postgresql");

    // Three, in this order. The DROP DEFAULT is not decoration: `ALTER COLUMN … TYPE jsonb USING …`
    // converts stored ROWS and leaves the DEFAULT expression alone, so a text default on a column
    // becoming JSON makes PostgreSQL reject the whole statement — every row can be valid JSON and
    // the conversion still fails.
    expect(out.map(o => o.type)).toEqual([
      "rename_column",
      "change_column_default",
      "change_column_type",
    ]);
    expect(out[1]).toMatchObject({
      columnName: "body",
      toDefault: undefined,
    });
    // Against the NEW name: the conversion follows the rename, so the column no longer answers to
    // the one it had.
    expect(out[2]).toMatchObject({
      tableName: "dc_posts",
      columnName: "body",
      toType: "jsonb",
    });
  });

  it("keeps the target default and records the source one for rollback", () => {
    // 🔴 The collapsed add_column is the ONLY statement of what the column must END UP being, and
    // the previous snapshot is the only record of what it WAS. Discarding either leaves a generated
    // migration whose UP drops a default the snapshot still declares, and whose DOWN emits a second
    // DROP DEFAULT instead of putting the original back.
    const ops = [
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "_body",
        columnType: "text",
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: {
          name: "body",
          type: "jsonb",
          nullable: false,
          default: "'{}'::jsonb",
        },
      },
    ];
    const decisions = [
      {
        candidate: {
          tableName: "dc_posts",
          fromColumn: "_body",
          toColumn: "body",
          fromType: "text",
          toType: "jsonb",
          typesCompatible: true,
          preservesValues: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: true,
      },
    ];
    const previous = {
      tables: [
        {
          name: "dc_posts",
          columns: [
            { name: "_body", type: "text", nullable: true, default: "'{}'" },
          ],
          indexes: [],
        },
      ],
    };

    const out = applyRenameDecisionsForTest(
      ops,
      decisions,
      "postgresql",
      previous as never
    );

    // Five, in this order. The nullability op is here because this fixture's column also becomes
    // required — PostgreSQL preserves nullability across a type change, so it needs its own
    // statement.
    expect(out.map(o => o.type)).toEqual([
      "rename_column",
      "change_column_default",
      "change_column_type",
      "change_column_nullable",
      "change_column_default",
    ]);
    // The old default is RECORDED on the drop, because buildInverseOperations inverts a default
    // change by assigning `toDefault: op.fromDefault`. Left undefined, the rollback would drop the
    // default a second time rather than restore it.
    expect(out[1]).toMatchObject({ fromDefault: "'{}'", toDefault: undefined });
    // And the desired default goes back on once the type is right.
    expect(out[4]).toMatchObject({ toDefault: "'{}'::jsonb" });
  });

  it("changes PostgreSQL nullability when the repair coincides with becoming required", () => {
    // PostgreSQL PRESERVES nullability across a type change, so nothing about converting the column
    // makes it required — the UP would contradict the snapshot it was generated from, and the DOWN
    // could not restore what was there. MySQL needs no equivalent because its MODIFY restates
    // nullability with the type, which is why the same fact travels differently per dialect.
    const ops = [
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "_body",
        columnType: "text",
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: { name: "body", type: "jsonb", nullable: false },
      },
    ];
    const decisions = [
      {
        candidate: {
          tableName: "dc_posts",
          fromColumn: "_body",
          toColumn: "body",
          fromType: "text",
          toType: "jsonb",
          typesCompatible: true,
          preservesValues: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: true,
      },
    ];
    const previous = {
      tables: [
        {
          name: "dc_posts",
          columns: [{ name: "_body", type: "text", nullable: true }],
          indexes: [],
        },
      ],
    };

    const out = applyRenameDecisionsForTest(
      ops,
      decisions,
      "postgresql",
      previous as never
    );

    const nullability = out.find(o => o.type === "change_column_nullable");
    expect(nullability).toMatchObject({
      columnName: "body",
      fromNullable: true,
      toNullable: false,
    });

    // Invertible, which is the point of emitting an operation rather than a statement: the DOWN
    // restores the original setting rather than leaving the column as the UP left it.
    const back = buildInverseOperations(out, previous as never).find(
      o => o.type === "change_column_nullable"
    );
    expect(back).toMatchObject({ fromNullable: false, toNullable: true });
  });

  it("emits no nullability change when requiredness did not move", () => {
    // The positive control. Emitting one unconditionally would add a pointless ALTER to every
    // repair, and would assert a setting the snapshot never changed.
    const ops = [
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "_body",
        columnType: "text",
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: { name: "body", type: "jsonb", nullable: true },
      },
    ];
    const decisions = [
      {
        candidate: {
          tableName: "dc_posts",
          fromColumn: "_body",
          toColumn: "body",
          fromType: "text",
          toType: "jsonb",
          typesCompatible: true,
          preservesValues: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: true,
      },
    ];
    const previous = {
      tables: [
        {
          name: "dc_posts",
          columns: [{ name: "_body", type: "text", nullable: true }],
          indexes: [],
        },
      ],
    };

    expect(
      applyRenameDecisionsForTest(
        ops,
        decisions,
        "postgresql",
        previous as never
      ).map(o => o.type)
    ).not.toContain("change_column_nullable");
  });

  it("returns a MySQL column to its original definition on rollback", () => {
    // 🔴 The DOWN is where MySQL's MODIFY bites a second time. The inverse converts the type back,
    // and restates the whole column while doing it — so a rollback that carried only the types would
    // return the column to `text` while silently dropping the NOT NULL and default it originally
    // had. Asserted through buildInverseOperations rather than by reading the forward op, because
    // the forward op looking right is exactly what made this invisible.
    const ops = [
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "_body",
        columnType: "text",
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: { name: "body", type: "json", nullable: false },
      },
    ];
    const decisions = [
      {
        candidate: {
          tableName: "dc_posts",
          fromColumn: "_body",
          toColumn: "body",
          fromType: "text",
          toType: "json",
          typesCompatible: true,
          preservesValues: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: true,
      },
    ];
    const previous = {
      tables: [
        {
          name: "dc_posts",
          columns: [
            { name: "_body", type: "text", nullable: false, default: "'{}'" },
          ],
          indexes: [],
        },
      ],
    };

    const forward = applyRenameDecisionsForTest(
      ops,
      decisions,
      "mysql",
      previous as never
    );
    const inverse = buildInverseOperations(forward, previous as never);

    const back = inverse.find(o => o.type === "change_column_type");
    expect(back).toMatchObject({
      toType: "text",
      // The definition the column is being returned TO, restated because MySQL deletes what a
      // MODIFY omits.
      nullable: false,
      columnDefault: "'{}'",
    });
  });

  it("carries requiredness into the MySQL conversion", () => {
    // MySQL spells the type change `MODIFY COLUMN <name> <type>`, which RESTATES the whole
    // definition — so a required column becomes nullable unless its nullability travels with the
    // type. There is no second statement that could put it back: change_column_nullable cannot be
    // rendered for MySQL at all.
    const ops = [
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "_body",
        columnType: "text",
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: { name: "body", type: "json", nullable: false },
      },
    ];
    const decisions = [
      {
        candidate: {
          tableName: "dc_posts",
          fromColumn: "_body",
          toColumn: "body",
          fromType: "text",
          toType: "json",
          typesCompatible: true,
          preservesValues: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: true,
      },
    ];

    const out = applyRenameDecisionsForTest(ops, decisions, "mysql");

    expect(out.map(o => o.type)).toEqual([
      "rename_column",
      "change_column_type",
    ]);
    expect(out[1]).toMatchObject({ nullable: false });
  });

  it("emits no type change when the rename keeps the type", () => {
    // The positive control. Without it, appending a conversion unconditionally would satisfy the
    // case above while adding a pointless ALTER to every ordinary rename.
    const ops = [
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "_body",
        columnType: "text",
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: { name: "body", type: "text", nullable: true },
      },
    ];
    const decisions = [
      {
        candidate: {
          tableName: "dc_posts",
          fromColumn: "_body",
          toColumn: "body",
          fromType: "text",
          toType: "text",
          typesCompatible: true,
          preservesValues: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: true,
      },
    ];

    expect(
      applyRenameDecisionsForTest(ops, decisions, "postgresql").map(o => o.type)
    ).toEqual(["rename_column"]);
  });

  it("emits no type change on SQLite, which stores JSON as text", () => {
    // Not an omission: SQLite has no ALTER that changes a column's type, and needs none here — the
    // two sides of the one convertible change name the same storage. Asking for one would raise
    // for a column that is already correct.
    const ops = [
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "_body",
        columnType: "text",
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: { name: "body", type: "jsonb", nullable: true },
      },
    ];
    const decisions = [
      {
        candidate: {
          tableName: "dc_posts",
          fromColumn: "_body",
          toColumn: "body",
          fromType: "text",
          toType: "jsonb",
          typesCompatible: true,
          preservesValues: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: true,
      },
    ];

    expect(
      applyRenameDecisionsForTest(ops, decisions, "sqlite").map(o => o.type)
    ).toEqual(["rename_column"]);
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
          preservesValues: true,
          defaultSuggestion: "rename" as const,
        },
        accepted: false,
      },
    ];
    const out = applyRenameDecisionsForTest(ops, decisions);
    expect(out).toHaveLength(2);
    expect(out.map(o => o.type)).toEqual(["drop_column", "add_column"]);
  });

  it("dedupes Cartesian acceptances: only first-accepting decision wins (F11 PR 3 review fix #2)", () => {
    // Setup: table dc_posts has drops [a, b] and adds [x, y]. The
    // RegexRenameDetector emits 4 candidates (a→x, a→y, b→x, b→y).
    // If user accepts (a→x) AND (a→y), we should emit RENAME a→x ONLY
    // and leave the second accept's drop+add as a normal pair so apply
    // doesn't try to RENAME the same column twice.
    const ops = [
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "a",
        columnType: "text",
      },
      {
        type: "drop_column" as const,
        tableName: "dc_posts",
        columnName: "b",
        columnType: "text",
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: { name: "x", type: "text", nullable: true },
      },
      {
        type: "add_column" as const,
        tableName: "dc_posts",
        column: { name: "y", type: "text", nullable: true },
      },
    ];
    const candidate = (from: string, to: string) => ({
      candidate: {
        tableName: "dc_posts",
        fromColumn: from,
        toColumn: to,
        fromType: "text",
        toType: "text",
        typesCompatible: true,
        preservesValues: true,
        defaultSuggestion: "rename" as const,
      },
      accepted: true,
    });
    const decisions = [
      candidate("a", "x"),
      candidate("a", "y"), // overlapping drop column
      candidate("b", "x"), // overlapping add column (x already claimed)
      candidate("b", "y"), // both columns still free, should be accepted
    ];

    const out = applyRenameDecisionsForTest(ops, decisions);

    // Two RENAME COLUMN ops produced: a→x and b→y. The other two
    // overlapping decisions are skipped silently.
    const renames = out.filter(o => o.type === "rename_column");
    expect(renames).toHaveLength(2);
    expect(renames).toContainEqual(
      expect.objectContaining({ fromColumn: "a", toColumn: "x" })
    );
    expect(renames).toContainEqual(
      expect.objectContaining({ fromColumn: "b", toColumn: "y" })
    );

    // No leftover drop/add ops because both drops + both adds were
    // claimed (first acceptance wins for each column).
    expect(out.filter(o => o.type === "drop_column")).toHaveLength(0);
    expect(out.filter(o => o.type === "add_column")).toHaveLength(0);
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
          preservesValues: true,
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

/*
 * 🔴 The entity header is the only per-file record of which entities a
 * migration carries, and `migrate` reads it to decide whether a registry row is
 * still waiting on something. Written from the whole config, every migration
 * claims every entity — which answers that question identically for all of them
 * and so answers it for none.
 */
describe("the entity header names what the migration changes", () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), "nextly-header-scope-"));
  });

  const AUTHORS: MinimalConfigEntity = {
    slug: "authors",
    tableName: "dc_authors",
    fields: [{ name: "description", type: "text", required: true }],
  };

  it("omits a collection this migration does not touch", async () => {
    // Both exist in the config; only `posts` is new, so only `posts` is
    // waiting on this file.
    await generateMigration({
      name: "create_authors",
      dialect: "postgresql",
      migrationsDir,
      collections: [AUTHORS],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });

    const second = await generateMigration({
      name: "create_posts",
      dialect: "postgresql",
      migrationsDir,
      collections: [AUTHORS, POSTS_V1],
      singles: [],
      components: [],
      nonInteractive: true,
      now: new Date("2026-04-29T15:46:00.123Z"),
    });

    expect(second).not.toBeNull();
    const sql = await readFile(second!.sqlPath, "utf-8");
    // The control: the entity it DOES carry is still named, so this cannot
    // pass by emitting no header at all.
    expect(sql).toContain("-- Collections: posts");
    expect(sql).not.toContain("authors");
  });
});
