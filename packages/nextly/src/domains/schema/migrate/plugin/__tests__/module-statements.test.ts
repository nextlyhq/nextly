/**
 * A module's entries become the statements its executors run, the same way
 * whichever path reads them.
 */
import { describe, expect, it } from "vitest";

import { splitSqlStatements } from "../../split-sql";
import { moduleSql, pluginModuleStatements } from "../plugin-migration";

const module = (entries: string[]) => ({
  dialects: {
    postgresql: { up: entries, down: [] },
    mysql: { up: [], down: [] },
    sqlite: { up: [], down: [] },
  },
});

describe("a module's statements", () => {
  const entries = [
    'CREATE TABLE "fx__a" ("id" text) -- the notes table',
    'CREATE TABLE "fx__b" ("id" text)',
  ];

  it("keeps an entry ending in a line comment apart from the next", () => {
    // Joined before splitting, the comment swallows the separator and the two
    // entries reach the driver as one.
    expect(pluginModuleStatements(module(entries), "postgresql", "up")).toEqual(
      entries
    );
  });

  it("splits back from its text to exactly those statements", () => {
    // The reconcile and the rollback planner take the text and split it
    // again; they must run what the guards judged.
    const m = module([
      ...entries,
      'ALTER TABLE "fx__a" DROP CONSTRAINT "c"; ALTER TABLE "fx__a" ADD CONSTRAINT "c" CHECK (true)',
    ]);
    expect(
      splitSqlStatements(moduleSql(m, "postgresql", "up"), "postgresql")
    ).toEqual(pluginModuleStatements(m, "postgresql", "up"));
    expect(pluginModuleStatements(m, "postgresql", "up")).toHaveLength(4);
  });

  it("leaves out a BEGIN and COMMIT that wrap the whole module, though they are separate entries", () => {
    // Judged over the module, as a file is judged over its text: split
    // entry by entry, each bracket alone would look unpaired.
    expect(
      pluginModuleStatements(
        module(["BEGIN", entries[1], "COMMIT"]),
        "postgresql",
        "up"
      )
    ).toEqual([entries[1]]);
  });

  it("keeps every bracket of a module that commits part-way, and splits back to the same", () => {
    const m = module([
      "BEGIN",
      entries[0],
      "COMMIT",
      "BEGIN",
      entries[1],
      "COMMIT",
    ]);
    const statements = pluginModuleStatements(m, "postgresql", "up");
    expect(statements).toEqual([
      "BEGIN",
      entries[0],
      "COMMIT",
      "BEGIN",
      entries[1],
      "COMMIT",
    ]);
    expect(
      splitSqlStatements(moduleSql(m, "postgresql", "up"), "postgresql")
    ).toEqual(statements);
  });

  it("keeps a wrapping pair in a module marked transaction: false, for the refusal there", () => {
    expect(
      pluginModuleStatements(
        { ...module(["BEGIN", entries[1], "COMMIT"]), transaction: false },
        "postgresql",
        "up"
      )
    ).toEqual(["BEGIN", entries[1], "COMMIT"]);
  });
});
