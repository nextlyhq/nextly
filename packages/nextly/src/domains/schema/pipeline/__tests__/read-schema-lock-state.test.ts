/**
 * Reading the schema lock without taking it: free, held, or unknown.
 *
 * Unknown is the case that matters here. A database user that may not read one of the lock tables
 * has not shown that nothing holds it, so the answer is unknown, with which lock and why, never
 * free. A held lock still wins over one that could not be read, and a lock table that does not
 * exist yet is free.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it } from "vitest";

import { readSchemaLockState } from "../schema-lock";

/** A driver error with PostgreSQL's code, as Drizzle hands it over: wrapped once. */
function driverError(code: string): Error {
  return Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error(code), { code }),
  });
}

const DENIED = "42501";
const MISSING = "42P01";

/**
 * A PostgreSQL adapter whose lock tables answer as `tables` says: rows to return, or a code to
 * fail with. A query is matched to its table by the table's name in the statement.
 */
function adapter(
  tables: Record<string, { rows?: unknown[]; fails?: string }>
): DrizzleAdapter {
  return {
    getCapabilities: () => ({ dialect: "postgresql" }),
    queryStatement: (query: unknown) => {
      const text = JSON.stringify(query);
      const name = Object.keys(tables).find(table =>
        text.includes(`"${table}"`)
      );
      const answer = name === undefined ? { rows: [] } : tables[name];
      return answer.fails === undefined
        ? Promise.resolve(answer.rows ?? [])
        : Promise.reject(driverError(answer.fails));
    },
  } as unknown as DrizzleAdapter;
}

const SCHEMA = "nextly_schema_lock";
const EARLIER = "nextly_migrate_lock";
const FIELD_GROUP = "nextly_field_group_lock";

describe("readSchemaLockState", () => {
  it("is free when every lock reads empty", async () => {
    expect(await readSchemaLockState(adapter({}))).toEqual({ state: "free" });
  });

  it("is free when no run has created the lock tables yet", async () => {
    expect(
      await readSchemaLockState(
        adapter({
          [SCHEMA]: { fails: MISSING },
          [EARLIER]: { fails: MISSING },
          [FIELD_GROUP]: { fails: MISSING },
        })
      )
    ).toEqual({ state: "free" });
  });

  it("is unknown, naming the lock and the code, when the user may not read the schema lock", async () => {
    expect(
      await readSchemaLockState(adapter({ [SCHEMA]: { fails: DENIED } }))
    ).toEqual({
      state: "unknown",
      reason: `the schema lock could not be read (${DENIED})`,
    });
  });

  it("is unknown when the user may not read the field-group lock", async () => {
    const reading = await readSchemaLockState(
      adapter({ [FIELD_GROUP]: { fails: DENIED } })
    );
    expect(reading.state).toBe("unknown");
    expect(reading.state === "unknown" && reading.reason).toMatch(
      /^the field-group lock could not be read/
    );
  });

  it("is held when one lock is held, though another could not be read", async () => {
    const reading = await readSchemaLockState(
      adapter({
        [SCHEMA]: { fails: DENIED },
        [EARLIER]: { rows: [{ owner: "host:42#a", lapses_in: 30 }] },
      })
    );
    expect(reading).toEqual({
      state: "held",
      holder: {
        kind: "earlier-migrate-lock",
        owner: "host:42#a",
        lapsesInSeconds: 30,
      },
    });
  });
});
