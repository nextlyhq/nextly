/**
 * Where a removed entity's retirement stands, apart from the database: the
 * rule over the evidence, and the reading of the migrations folder that
 * gathers which files drop the entity's main table.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readRemovedFromCodeStates,
  removedFromCodeState,
  type RetirementAdapter,
} from "./removed-from-code-state";

describe("removedFromCodeState", () => {
  it("names migrate:create while its tables exist and no migration drops it", () => {
    expect(removedFromCodeState({ mainTablePresent: true, drops: [] })).toEqual(
      { state: "not-dropped" }
    );
  });

  it("names the unapplied file that drops it while its main table exists", () => {
    expect(
      removedFromCodeState({
        mainTablePresent: true,
        drops: [
          { file: "20261027_100000_drop_pages.sql", ledger: "pending" },
          { file: "20261028_100000_drop_again.sql", ledger: "pending" },
        ],
      })
    ).toEqual({
      state: "drop-pending",
      migration: "20261027_100000_drop_pages.sql",
    });
  });

  it("is half-retired once an applied migration dropped its main table", () => {
    expect(
      removedFromCodeState({
        mainTablePresent: false,
        drops: [{ file: "20261027_100000_drop_pages.sql", ledger: "applied" }],
      })
    ).toEqual({ state: "half-retired" });
  });

  it("names no step of these three for a stopped attempt, a lost table or a table back after its drop", () => {
    // A stopped attempt, with the table still there and with it gone.
    for (const mainTablePresent of [true, false]) {
      expect(
        removedFromCodeState({
          mainTablePresent,
          drops: [{ file: "a.sql", ledger: "stopped" }],
        })
      ).toEqual({ state: "other" });
    }
    // The main table gone with no applied migration dropping it, whether or
    // not an unapplied one would.
    expect(
      removedFromCodeState({ mainTablePresent: false, drops: [] })
    ).toEqual({ state: "other" });
    expect(
      removedFromCodeState({
        mainTablePresent: false,
        drops: [{ file: "a.sql", ledger: "pending" }],
      })
    ).toEqual({ state: "other" });
    // A table present again after an applied drop.
    expect(
      removedFromCodeState({
        mainTablePresent: true,
        drops: [{ file: "a.sql", ledger: "applied" }],
      })
    ).toEqual({ state: "other" });
  });
});

describe("readRemovedFromCodeStates", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "removed-state-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** An adapter whose database holds exactly `tables`, and no ledger. */
  function adapterWith(tables: string[]): RetirementAdapter {
    return {
      dialect: "sqlite",
      tableExists: async name => tables.includes(name),
      getDrizzle: () => {
        throw new Error("no ledger to read");
      },
    };
  }

  it("finds the file whose UP section drops the main table, and not one whose DOWN does", async () => {
    // The migration that created the table drops it in its DOWN, which
    // `nextly migrate` never runs forward: read as a drop, the entity would
    // be told to run a migration that already applied.
    await writeFile(
      join(dir, "20261001_000000_create_pages.sql"),
      '-- UP\nCREATE TABLE "dc_pages" ("id" text);\n\n-- DOWN\nDROP TABLE "dc_pages";\n'
    );
    await writeFile(
      join(dir, "20261027_000000_drop_pages.sql"),
      '-- UP\nDROP TABLE "dc_pages";\n\n-- DOWN\nSELECT 1;\n'
    );
    // Another entity's drop names nothing of this one.
    await writeFile(
      join(dir, "20261028_000000_drop_other.sql"),
      '-- UP\nDROP TABLE "dc_other";\n'
    );

    const states = await readRemovedFromCodeStates({
      adapter: adapterWith(["dc_pages", "single_banner"]),
      migrationsDir: dir,
      entities: [
        { kind: "collection", slug: "pages", tableName: "dc_pages" },
        { kind: "single", slug: "banner", tableName: "single_banner" },
      ],
    });

    expect(states.get("collection:pages")).toEqual({
      state: "drop-pending",
      migration: "20261027_000000_drop_pages.sql",
    });
    expect(states.get("single:banner")).toEqual({ state: "not-dropped" });
  });

  it("reads nothing when no entity is removed", async () => {
    const states = await readRemovedFromCodeStates({
      adapter: {
        dialect: "sqlite",
        tableExists: () => {
          throw new Error("read the database with nothing to describe");
        },
        getDrizzle: () => {
          throw new Error("read the ledger with nothing to describe");
        },
      },
      migrationsDir: join(dir, "absent"),
      entities: [],
    });
    expect(states.size).toBe(0);
  });
});
