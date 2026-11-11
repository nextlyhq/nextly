/**
 * The schema version's pure parts: how a stored version stands against the
 * build's, which migration is newest, the newest applied app migration the
 * ledger records, and what a production start says about each standing.
 *
 * The writes, the one read at a start and the transactions they share with the
 * registry rows are the integration suites' subject
 * (`schema-version-start.integration.test.ts`,
 * `schema-version-writers.integration.test.ts`).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { readMigrationFolderSync } from "../../../cli/utils/migration-discovery";
import { loadDialectTables } from "../../../database/dialect-tables";
import {
  newestMigrationIn,
  newestMigrationName,
} from "../build-schema-version";
import type { SchemaEventRow } from "../events/schema-events-repository";
import {
  compareSchemaVersion,
  newestAppliedAppMigration,
  reportSchemaVersionAtStart,
} from "../schema-version";

const OLDER = "20260101_000000_000_create_posts";
const NEWER = "20260301_120000_000_add_summary";

describe("compareSchemaVersion", () => {
  const stored = (migration: string | null) =>
    ({ present: true, version: { migration, seq: 4 } }) as const;

  it("compares nothing where the build names no migration", () => {
    expect(compareSchemaVersion(stored(OLDER), undefined)).toEqual({
      kind: "no-build",
    });
  });

  it("is equal where both name the same migration", () => {
    expect(compareSchemaVersion(stored(NEWER), NEWER)).toEqual({
      kind: "equal",
    });
  });

  it("is behind where the database holds an older migration than the build", () => {
    expect(compareSchemaVersion(stored(OLDER), NEWER)).toEqual({
      kind: "behind",
      stored: OLDER,
      build: NEWER,
    });
  });

  it("is behind where the database's rows name no migration yet", () => {
    expect(compareSchemaVersion(stored(null), NEWER)).toEqual({
      kind: "behind",
      stored: null,
      build: NEWER,
    });
  });

  it("is ahead where the database holds a newer migration than the build", () => {
    expect(compareSchemaVersion(stored(NEWER), OLDER)).toEqual({
      kind: "ahead",
      stored: NEWER,
      build: OLDER,
    });
  });

  it("is unknown where no version is stored, or the row holds something else", () => {
    expect(compareSchemaVersion({ present: false }, NEWER)).toEqual({
      kind: "unknown",
      build: NEWER,
    });
    expect(
      compareSchemaVersion({ present: true, version: undefined }, NEWER)
    ).toEqual({ kind: "unknown", build: NEWER });
  });
});

describe("the newest migration", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("is the one that runs last, whatever order the names come in", () => {
    expect(newestMigrationName([NEWER, OLDER])).toBe(NEWER);
    expect(newestMigrationName([OLDER, NEWER])).toBe(NEWER);
    expect(newestMigrationName([])).toBeUndefined();
  });

  it("in a folder, counts a dialect's variant as its base and ignores what is not SQL", () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-schema-version-"));
    for (const file of [
      `${OLDER}.sql`,
      `${NEWER}.mysql.sql`,
      `${NEWER}.sqlite.sql`,
      "99999999_999999_999_notes.md",
    ]) {
      writeFileSync(join(dir, file), "-- UP\n");
    }
    expect(newestMigrationIn(dir, "postgresql")).toBe(NEWER);
  });

  it("in a folder, is never a file an earlier Schema Builder wrote, which the runner sets aside", () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-schema-version-"));
    // A hand-named migration, which sorts before the Builder's 13-digit
    // millisecond names, and a file the Builder wrote for a collection.
    const handNamed = "0001_000000_init";
    const builderFile = "1730000000000_create_pages.sql";
    writeFileSync(join(dir, `${handNamed}.sql`), "-- UP\n");
    writeFileSync(
      join(dir, builderFile),
      'CREATE TABLE "dc_pages" ("id" text PRIMARY KEY);'
    );
    // The control: the runner's own reading sets the Builder file aside, so
    // the fixture reaches the classification this relies on.
    expect(
      readMigrationFolderSync(dir, "postgresql").oldBuilderFiles.map(
        file => file.file
      )
    ).toEqual([builderFile]);
    expect(newestMigrationIn(dir, "postgresql")).toBe(handNamed);
  });

  it("is none for a folder that is not there", () => {
    expect(
      newestMigrationIn(
        join(tmpdir(), "nextly-no-such-folder-schema-version"),
        "postgresql"
      )
    ).toBeUndefined();
  });
});

describe("newestAppliedAppMigration", () => {
  const row = (
    filename: string,
    status: "applied" | "rolled_back",
    startedAt: string,
    supersededEventIds: string[] | null = null
  ) =>
    ({
      eventType: "file_apply",
      status,
      filename,
      startedAt: new Date(startedAt),
      supersededEventIds,
    }) as unknown as SchemaEventRow;

  it("is the newest app migration still applied, plugin modules left out", () => {
    const rows = [
      row(`${OLDER}.sql`, "applied", "2026-01-01T00:00:00Z"),
      row(`${NEWER}.sql`, "applied", "2026-03-01T00:00:00Z"),
      // Rolled back since: no longer the newest applied.
      row(`${NEWER}.sql`, "rolled_back", "2026-03-02T00:00:00Z", ["x"]),
      row(
        "plugin:@acme/blog/99999999_9999_mod",
        "applied",
        "2026-04-01T00:00:00Z"
      ),
    ];
    expect(newestAppliedAppMigration(rows)).toBe(OLDER);
  });

  it("is null where no app migration is applied", () => {
    expect(newestAppliedAppMigration([])).toBeNull();
  });
});

describe("reportSchemaVersionAtStart", () => {
  beforeAll(async () => {
    await loadDialectTables("sqlite");
  });

  /** A Drizzle handle whose one read answers `rows`, counting reads. */
  function handleAnswering(rows: { value: unknown }[] | Error) {
    const reads = vi.fn(async () => {
      if (rows instanceof Error) throw rows;
      return rows;
    });
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({ then: (...a: never[]) => reads().then(...a) }),
          }),
        }),
      }),
    };
    return { db, reads };
  }

  const stored = (migration: string | null) => [
    { value: JSON.stringify({ migration, seq: 2 }) },
  ];

  async function report(
    rows: { value: unknown }[] | Error,
    build: string | undefined
  ) {
    const { db, reads } = handleAnswering(rows);
    const logger = { warn: vi.fn(), info: vi.fn() };
    const standing = await reportSchemaVersionAtStart({
      db,
      dialect: "sqlite",
      build,
      logger,
    });
    return { standing, logger, reads };
  }

  it("warns once, naming both versions and `nextly migrate`, where the database is behind", async () => {
    const { logger, reads } = await report(stored(OLDER), NEWER);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const message = String(logger.warn.mock.calls[0][0]);
    expect(message).toContain(OLDER);
    expect(message).toContain(NEWER);
    expect(message).toContain("nextly migrate");
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("notes once, at info, where the database is ahead", async () => {
    const { logger } = await report(stored(NEWER), OLDER);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(String(logger.info.mock.calls[0][0])).toContain(NEWER);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("says nothing where they agree", async () => {
    const { logger, standing } = await report(stored(NEWER), NEWER);
    expect(standing).toEqual({ kind: "equal" });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("warns that the version is unknown where none is stored, or the table cannot be read", async () => {
    for (const rows of [[], new Error("no such table: nextly_meta")]) {
      const { logger } = await report(rows, NEWER);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(String(logger.warn.mock.calls[0][0])).toContain("nextly migrate");
    }
  });

  it("reads nothing and says nothing where the build names no migration", async () => {
    const { logger, reads, standing } = await report(stored(OLDER), undefined);
    expect(standing).toEqual({ kind: "no-build" });
    expect(reads).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
