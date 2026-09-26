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
});
