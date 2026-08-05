/**
 * Adopting an existing database into migrations.
 *
 * The behaviour under test is an ORDER of decisions, not SQL: refuse a project
 * that is already migration-managed, refuse an empty database, and otherwise
 * record the LIVE schema — never the config's idea of it — as the starting
 * snapshot. Driven through injected dependencies for the same reason
 * `resolveMigration` is: none of these decisions need a database to be wrong.
 *
 * @module domains/schema/migrate/baseline.test
 */
import { describe, expect, it, vi } from "vitest";

import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

import { createBaseline, type CreateBaselineArgs } from "./baseline";

const LIVE: NextlySchemaSnapshot = {
  tables: [{ name: "dc_posts" }, { name: "dc_categories" }],
} as NextlySchemaSnapshot;

const NOW = new Date("2026-08-05T10:20:30.000Z");

function harness(over: Partial<CreateBaselineArgs> = {}): {
  args: CreateBaselineArgs;
  writeFiles: ReturnType<typeof vi.fn>;
  recordApplied: ReturnType<typeof vi.fn>;
  introspect: ReturnType<typeof vi.fn>;
} {
  const writeFiles = vi.fn(({ baseName }: { baseName: string }) =>
    Promise.resolve({
      sqlPath: `/m/${baseName}.sql`,
      snapshotPath: `/m/meta/${baseName}.json`,
    })
  );
  const recordApplied = vi.fn(() => Promise.resolve({ kind: "applied" }));
  const introspect = vi.fn(() => Promise.resolve(LIVE));
  const args: CreateBaselineArgs = {
    existingSnapshot: () => Promise.resolve(null),
    listManagedTables: () => Promise.resolve(["dc_posts", "dc_categories"]),
    introspect,
    writeFiles,
    recordApplied,
    now: NOW,
    formatTimestamp: () => "20260805_102030_000",
    ...over,
  } as CreateBaselineArgs;
  return { args, writeFiles, recordApplied, introspect };
}

describe("createBaseline", () => {
  it("records the live schema and marks the baseline applied", async () => {
    const { args, writeFiles, recordApplied, introspect } = harness();

    const result = await createBaseline(args);

    expect(result).toMatchObject({
      kind: "created",
      filename: "20260805_102030_000_baseline.sql",
      tableCount: 2,
    });
    // The snapshot written is the one introspection returned — the LIVE schema.
    // Deriving it from config instead is the whole defect being fixed.
    expect(introspect).toHaveBeenCalledWith(["dc_posts", "dc_categories"]);
    expect(writeFiles.mock.calls[0][0].snapshot).toBe(LIVE);
    // Recorded applied, never executed: the schema is already there.
    expect(recordApplied).toHaveBeenCalledTimes(1);
    expect(recordApplied.mock.calls[0][0]).toMatchObject({
      filename: "20260805_102030_000_baseline.sql",
      snapshot: LIVE,
    });
  });

  it("writes a migration body that applies nothing", async () => {
    // If this ever emitted CREATE statements, `migrate:fresh` would execute them
    // against an empty database and reproduce only what a snapshot can express.
    const { args, writeFiles } = harness();

    await createBaseline(args);

    const sql = writeFiles.mock.calls[0][0].sqlContent as string;
    expect(sql).toContain("-- Migration: baseline");
    expect(sql).toContain("2 existing table(s)");
    expect(sql.toUpperCase()).not.toContain("CREATE TABLE");
    expect(sql.toUpperCase()).not.toContain("ALTER TABLE");
  });

  it("refuses a project that already has a snapshot, writing nothing", async () => {
    // A second baseline records a second starting point, and every later
    // migrate:create would diff against whichever snapshot sorts last.
    const { args, writeFiles, recordApplied } = harness({
      existingSnapshot: () =>
        Promise.resolve({ filename: "20260101_000000_000_init.sql" }),
    });

    const result = await createBaseline(args);

    expect(result).toEqual({
      kind: "already-managed",
      filename: "20260101_000000_000_init.sql",
    });
    expect(writeFiles).not.toHaveBeenCalled();
    expect(recordApplied).not.toHaveBeenCalled();
  });

  it("refuses an empty database, writing nothing", async () => {
    // Nothing to adopt. A snapshot claiming no tables is what an un-baselined
    // project already has, only with a journal entry implying otherwise.
    const { args, writeFiles, recordApplied } = harness({
      listManagedTables: () => Promise.resolve([]),
    });

    const result = await createBaseline(args);

    expect(result).toEqual({ kind: "empty-database" });
    expect(writeFiles).not.toHaveBeenCalled();
    expect(recordApplied).not.toHaveBeenCalled();
  });

  it("checks for an existing snapshot BEFORE reading the database", async () => {
    // Order matters: an already-managed project must be refused without the
    // command touching the database at all.
    const seen: string[] = [];
    const { args } = harness({
      existingSnapshot: () => {
        seen.push("snapshot");
        return Promise.resolve({ filename: "init.sql" });
      },
      listManagedTables: () => {
        seen.push("tables");
        return Promise.resolve(["dc_posts"]);
      },
    });

    await createBaseline(args);

    expect(seen).toEqual(["snapshot"]);
  });

  it("surfaces an already-recorded baseline rather than reporting success blindly", async () => {
    const { args } = harness({
      recordApplied: () =>
        Promise.resolve({ kind: "noop", reason: "already marked applied." }),
    });

    const result = await createBaseline(args);

    expect(result).toMatchObject({
      kind: "created",
      note: "already marked applied.",
    });
  });
});
