/**
 * Every core table says whether it holds secrets.
 *
 * A writer of archives, backups, exports and pulls leaves secrets behind by
 * asking `CORE_SECRET_ANSWERS`. A core table added without an answer is one
 * whose secrets nobody listed, so this fails until it has one, "nothing" being
 * an answer. The reverse is checked too: an answer for a table core no longer
 * has, or a column name a dialect does not have, is a rule that silently stops
 * matching anything.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { loadDialectTables } from "../../database/dialect-tables";
import { CORE_SECRET_ANSWERS } from "../../domains/data/secrets/core-secrets";
import { getCoreSchema, getCoreTableNames } from "../index";

// The unit setup loads only the run's own dialect; this file reads all three.
beforeAll(async () => {
  await Promise.all(
    ["postgresql", "mysql", "sqlite"].map(d => loadDialectTables(d))
  );
});

const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

describe("every core table says whether it holds secrets", () => {
  it("has an answer for every core table", () => {
    const missing = getCoreTableNames().filter(
      name => !Object.hasOwn(CORE_SECRET_ANSWERS, name)
    );
    // Named rather than counted, so the failure says which table to answer for.
    expect(missing).toEqual([]);
  });

  it("answers for no table core does not have", () => {
    const core = new Set(getCoreTableNames());
    expect(
      Object.keys(CORE_SECRET_ANSWERS).filter(name => !core.has(name))
    ).toEqual([]);
  });

  it.each(DIALECTS)("names only columns %s has", dialect => {
    const columns = new Map(
      getCoreSchema(dialect).tables.map(table => [
        table.name,
        new Set(table.columns.map(column => column.name)),
      ])
    );
    const absent: string[] = [];
    for (const [table, answer] of Object.entries(CORE_SECRET_ANSWERS)) {
      const named =
        answer.holds === "columns"
          ? answer.columns.map(column => column.name)
          : answer.holds === "some-rows"
            ? [answer.decidedBy]
            : [];
      for (const column of named) {
        if (!columns.get(table)?.has(column)) absent.push(`${table}.${column}`);
      }
    }
    expect(absent).toEqual([]);
  });
});
