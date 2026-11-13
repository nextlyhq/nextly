/**
 * What a unit's tries read before they start, and what of a kept statement a new session would
 * not have: the trigger list, trusted on MySQL only where the account may see every trigger, and
 * the statements that make state of their session alone.
 */
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { makesSessionState, triggerTables } from "../run-unit";

/** An adapter answering each query in turn with the rows given, recording how many were asked. */
function answering(...answers: unknown[][]) {
  const asked: SQL[] = [];
  return {
    asked,
    adapter: {
      queryStatement: <T>(query: SQL): Promise<T[]> => {
        asked.push(query);
        return Promise.resolve((answers[asked.length - 1] ?? []) as T[]);
      },
    },
  };
}

describe("triggerTables", () => {
  it("answers unseen on MySQL where the account holds no TRIGGER grant on the database, reading no list", async () => {
    const { adapter, asked } = answering([], [{ name: "audited" }]);

    expect(await triggerTables(adapter, "mysql")).toBe("unseen");
    // A list read without the grant leaves out the tables whose triggers it may not see.
    expect(asked).toHaveLength(1);
  });

  it("reads the list on MySQL where the account may see every trigger", async () => {
    const { adapter } = answering([{ seen: 1 }], [{ name: "Audited" }]);

    expect(await triggerTables(adapter, "mysql")).toEqual(new Set(["audited"]));
  });

  it("reads the list at once on PostgreSQL, whose catalog shows every trigger", async () => {
    const { adapter, asked } = answering([{ name: "audited" }]);

    expect(await triggerTables(adapter, "postgresql")).toEqual(
      new Set(["audited"])
    );
    expect(asked).toHaveLength(1);
  });
});

describe("makesSessionState", () => {
  it.each([
    ["CREATE TEMPORARY TABLE stage (id integer)", "mysql"],
    ["CREATE TEMP TABLE stage (id integer)", "postgresql"],
    ["CREATE LOCAL TEMPORARY TABLE stage (id integer)", "postgresql"],
    ["CREATE TEMP VIEW recent AS SELECT 1", "postgresql"],
    ["PREPARE fill AS INSERT INTO t VALUES ($1)", "postgresql"],
    ["DECLARE rows CURSOR FOR SELECT 1", "postgresql"],
  ] as const)("reads %j as making session state", (statement, dialect) => {
    expect(makesSessionState(statement, dialect)).toBe(true);
  });

  it.each([
    ["CREATE TABLE stage (id integer)", "mysql"],
    ["CREATE UNLOGGED TABLE stage (id integer)", "postgresql"],
    ["SET search_path TO app", "postgresql"],
    ["INSERT INTO stage VALUES (1)", "mysql"],
  ] as const)(
    "reads %j as lasting beyond its session",
    (statement, dialect) => {
      expect(makesSessionState(statement, dialect)).toBe(false);
    }
  );
});
