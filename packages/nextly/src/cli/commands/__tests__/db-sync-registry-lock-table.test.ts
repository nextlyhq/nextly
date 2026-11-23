/**
 * How a promote's or demote's registry write takes the schema lock, by whether the lock's table is
 * there (`withCollectionRegistryWrite`):
 *
 * - the table there: the lock is taken without creating anything, as before;
 * - the table missing: the lock is taken creating it, so the write holds the lock's row;
 * - a refusal of the creation for the role's rights, before the work ran: the lock is taken again
 *   without creating anything, as before. Where another run has made the table since, that holds
 *   its row; where it is still missing, the write says once that it runs without it;
 * - any other failure before the work (a busy database, a lost connection, a held lock), and any
 *   failure once the work started, is thrown as it was, never retried: the write never runs
 *   without the lock it could have had, and the registry is never written twice.
 *
 * The lock is observed through `withMigrationExcluded`, the call the write makes; what holding
 * the lock does against another process is the integration suite's
 * (`demote-and-code-first-sync-never-interleave`).
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exclusion = vi.hoisted(() => ({
  calls: [] as boolean[],
  /** Each call's failure before the work, or `"in-work"` to fail after running it. */
  failures: [] as Array<unknown>,
}));

vi.mock("../../../domains/field-groups/migration/sync-guard", () => ({
  withMigrationExcluded: async (
    args: { mayCreateLock: boolean },
    work: () => Promise<unknown>
  ) => {
    exclusion.calls.push(args.mayCreateLock);
    const failure = exclusion.failures.shift();
    if (failure !== undefined && failure !== "in-work") throw failure;
    const value = await work();
    if (failure === "in-work") throw new Error("failed in the work");
    return value;
  },
}));

import { withCollectionRegistryWrite } from "../db-sync-registry";

/** A driver error carrying `fields`, wrapped as the adapters wrap one. */
function driverError(fields: Record<string, unknown>): Error {
  const cause = Object.assign(new Error("driver"), fields);
  return Object.assign(new Error("wrapped"), { cause });
}

/** PostgreSQL's refusal of a CREATE TABLE to a role without the right. */
const POSTGRES_DENIED = driverError({ code: "42501" });
/** MySQL's. */
const MYSQL_DENIED = driverError({
  code: "ER_TABLEACCESS_DENIED_ERROR",
  errno: 1142,
});

/** An adapter answering whether the lock's table is there, one answer per question. */
function adapterAnswering(...exists: Array<boolean | Error>): DrizzleAdapter {
  return {
    tableExists: vi.fn(async () => {
      const answer = exists.shift() ?? false;
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  } as unknown as DrizzleAdapter;
}

function logger() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

async function write(adapter: DrizzleAdapter) {
  const log = logger();
  const work = vi.fn(async () => "written");
  const result = withCollectionRegistryWrite(
    { adapter, logger: log as never, label: "db:sync --demote" },
    work
  );
  return { result, log, work };
}

describe("a promote's or demote's registry write and the schema lock's table", () => {
  beforeEach(() => {
    exclusion.calls = [];
    exclusion.failures = [];
  });

  it("takes the lock creating nothing where the table is there", async () => {
    const { result, log, work } = await write(adapterAnswering(true));

    await expect(result).resolves.toBe("written");
    expect(exclusion.calls).toEqual([false]);
    expect(work).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("takes the lock creating its table where it is missing", async () => {
    const { result, log, work } = await write(adapterAnswering(false));

    await expect(result).resolves.toBe("written");
    expect(exclusion.calls).toEqual([true]);
    expect(work).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["PostgreSQL", POSTGRES_DENIED],
    ["MySQL", MYSQL_DENIED],
  ])(
    "goes on as before, saying so, where %s refuses the role the table",
    async (_, denied) => {
      exclusion.failures = [denied];
      const { result, log, work } = await write(adapterAnswering(false, false));

      await expect(result).resolves.toBe("written");
      expect(exclusion.calls).toEqual([true, false]);
      expect(work).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(String(log.warn.mock.calls[0]?.[0])).toContain(
        "nextly_schema_lock"
      );
    }
  );

  it("takes the lock without creating anything, and says nothing, where another run made the table meanwhile", async () => {
    exclusion.failures = [POSTGRES_DENIED];
    const { result, log, work } = await write(adapterAnswering(false, true));

    await expect(result).resolves.toBe("written");
    expect(exclusion.calls).toEqual([true, false]);
    expect(work).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a busy database",
      Object.assign(new Error("busy"), { code: "SQLITE_BUSY" }),
    ],
    ["a lost connection", driverError({ code: "ECONNRESET" })],
    [
      "a held lock",
      Object.assign(new Error("held"), { code: "NEXTLY_MIGRATE_LOCK_BUSY" }),
    ],
  ])(
    "throws %s before the work as it was, and never writes without the lock",
    async (_, failure) => {
      exclusion.failures = [failure];
      const { result, log, work } = await write(adapterAnswering(false, false));

      await expect(result).rejects.toBe(failure);
      expect(exclusion.calls).toEqual([true]);
      expect(work).not.toHaveBeenCalled();
      expect(log.warn).not.toHaveBeenCalled();
    }
  );

  it("throws a failure from the work itself, and never writes twice", async () => {
    exclusion.failures = ["in-work"];
    const { result, work } = await write(adapterAnswering(false, false));

    await expect(result).rejects.toThrow("failed in the work");
    expect(exclusion.calls).toEqual([true]);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("keeps the refusal it was given where asking for the table then fails", async () => {
    exclusion.failures = [POSTGRES_DENIED];
    const { result, work } = await write(
      adapterAnswering(false, new Error("connection terminated"))
    );

    await expect(result).rejects.toBe(POSTGRES_DENIED);
    expect(work).not.toHaveBeenCalled();
  });
});
