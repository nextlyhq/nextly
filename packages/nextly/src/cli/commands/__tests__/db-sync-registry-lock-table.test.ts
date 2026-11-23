/**
 * How a promote's or demote's registry write takes the schema lock, by whether the lock's table is
 * there (`withCollectionRegistryWrite`):
 *
 * - the table there: the lock is taken without creating anything, as before;
 * - the table missing: the lock is taken creating it, so the write holds the lock's row;
 * - the table missing and still missing after a refusal that came before the work ran: the role
 *   may not create tables, so the write goes on as before, without creating it, and says so once;
 * - any refusal once the table exists, or once the work started, is the write's own and is
 *   thrown, never retried, so the registry is never written twice.
 *
 * The lock is observed through `withMigrationExcluded`, the call the write makes; what holding
 * the lock does against another process is the integration suite's
 * (`demote-and-code-first-sync-never-interleave`).
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exclusion = vi.hoisted(() => ({
  calls: [] as boolean[],
  /** What each call does before or instead of running the work. */
  behave: [] as Array<"run" | "refuse" | "fail-in-work">,
}));

vi.mock("../../../domains/field-groups/migration/sync-guard", () => ({
  withMigrationExcluded: async (
    args: { mayCreateLock: boolean },
    work: () => Promise<unknown>
  ) => {
    exclusion.calls.push(args.mayCreateLock);
    const behaviour = exclusion.behave.shift() ?? "run";
    if (behaviour === "refuse") throw new Error("refused before the work");
    const value = await work();
    if (behaviour === "fail-in-work") throw new Error("failed in the work");
    return value;
  },
}));

import { withCollectionRegistryWrite } from "../db-sync-registry";

/** An adapter whose lock table is there from the `exists` answers on, one per question. */
function adapterAnswering(...exists: boolean[]): DrizzleAdapter {
  return {
    tableExists: vi.fn(async () => exists.shift() ?? false),
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

describe("a promote's or demote's registry write and the schema lock's table", () => {
  beforeEach(() => {
    exclusion.calls = [];
    exclusion.behave = [];
  });

  it("takes the lock creating nothing where the table is there", async () => {
    const log = logger();
    const work = vi.fn(async () => "written");

    await expect(
      withCollectionRegistryWrite(
        {
          adapter: adapterAnswering(true),
          logger: log as never,
          label: "db:sync --demote",
        },
        work
      )
    ).resolves.toBe("written");

    expect(exclusion.calls).toEqual([false]);
    expect(work).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("takes the lock creating its table where it is missing", async () => {
    const log = logger();
    const work = vi.fn(async () => "written");

    await expect(
      withCollectionRegistryWrite(
        {
          adapter: adapterAnswering(false),
          logger: log as never,
          label: "db:sync --demote",
        },
        work
      )
    ).resolves.toBe("written");

    expect(exclusion.calls).toEqual([true]);
    expect(work).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("goes on as before, saying so, where the table could not be created", async () => {
    exclusion.behave = ["refuse", "run"];
    const log = logger();
    const work = vi.fn(async () => "written");

    await expect(
      withCollectionRegistryWrite(
        {
          adapter: adapterAnswering(false, false),
          logger: log as never,
          label: "db:sync --demote",
        },
        work
      )
    ).resolves.toBe("written");

    expect(exclusion.calls).toEqual([true, false]);
    expect(work).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain("nextly_schema_lock");
  });

  it("throws a refusal that came once the table was made, and does not retry", async () => {
    exclusion.behave = ["refuse"];
    const log = logger();
    const work = vi.fn(async () => "written");

    await expect(
      withCollectionRegistryWrite(
        {
          adapter: adapterAnswering(false, true),
          logger: log as never,
          label: "db:sync --demote",
        },
        work
      )
    ).rejects.toThrow("refused before the work");

    expect(exclusion.calls).toEqual([true]);
    expect(work).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("throws a failure from the work itself, and never writes twice", async () => {
    exclusion.behave = ["fail-in-work"];
    const log = logger();
    const work = vi.fn(async () => "written");

    await expect(
      withCollectionRegistryWrite(
        {
          adapter: adapterAnswering(false, false),
          logger: log as never,
          label: "db:sync --demote",
        },
        work
      )
    ).rejects.toThrow("failed in the work");

    expect(exclusion.calls).toEqual([true]);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
