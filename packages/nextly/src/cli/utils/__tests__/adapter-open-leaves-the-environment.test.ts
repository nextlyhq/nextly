/**
 * Opening a command's database leaves `process.env` as the caller had it, before, during and after
 * the open.
 *
 * An open can outlive the command that started it: `migrate:create` stops waiting for the
 * database it counts deletions in after a few seconds, while a PostgreSQL connect is still retrying,
 * and lets the open finish on its own. An open that set `DB_DIALECT` and `DATABASE_URL` to its
 * target for its duration, and put the earlier values back when it settled, put them back over
 * whatever the process had set since: in one test process, a MySQL case that started after a
 * PostgreSQL case's open had timed out was handed the PostgreSQL environment halfway through.
 *
 * The factory is replaced by an open that settles only when a test settles it, so each test holds
 * the open in flight for exactly as long as it needs, with no timing involved.
 *
 * @module cli/utils/__tests__/adapter-open-leaves-the-environment.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface PendingOpen {
  args: unknown[];
  dialectDuring: string | undefined;
  urlDuring: string | undefined;
  fail: (error: Error) => void;
}

const opens: PendingOpen[] = [];

/** An open that records the environment it ran under and waits to be failed. */
function pendingOpen(...args: unknown[]): Promise<never> {
  return new Promise<never>((_, reject) => {
    opens.push({
      args,
      dialectDuring: process.env.DB_DIALECT,
      urlDuring: process.env.DATABASE_URL,
      fail: reject,
    });
  });
}

vi.mock("../../../database/factory", () => ({
  createAdapter: pendingOpen,
  createAdapterFromEnv: pendingOpen,
}));

const { openDryRunAdapter } = await import("../adapter");

const POSTGRES = "postgres://unused:unused@localhost:1/unused";
const MYSQL = "mysql://unused:unused@localhost:1/unused";

let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
});

afterEach(() => {
  opens.length = 0;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});

/** The open under way, once the command has handed it to the factory. */
async function inFlight(): Promise<PendingOpen> {
  await vi.waitFor(() => expect(opens).toHaveLength(1));
  return opens[0];
}

describe("opening a command's database", () => {
  it("connects to the database it names without setting it in the environment", async () => {
    process.env.DB_DIALECT = "sqlite";
    process.env.DATABASE_URL = "file:./app.db";

    const opening = openDryRunAdapter({
      dialect: "postgresql",
      databaseUrl: POSTGRES,
    });
    const open = await inFlight();

    // The factory is told where to connect, so it does not depend on what the environment says.
    expect(open.args[0]).toMatchObject({ type: "postgresql", url: POSTGRES });
    expect({ dialect: open.dialectDuring, url: open.urlDuring }).toEqual({
      dialect: "sqlite",
      url: "file:./app.db",
    });

    open.fail(new Error("connect ECONNREFUSED 127.0.0.1:1"));
    await expect(opening).rejects.toMatchObject({
      code: "DATABASE_UNREACHABLE",
    });
  });

  it("keeps what the process set while it was in flight once it settles", async () => {
    process.env.DB_DIALECT = "postgresql";
    process.env.DATABASE_URL = POSTGRES;

    const opening = openDryRunAdapter({ dialect: "postgresql" });
    const open = await inFlight();

    // What the next command, or the next test in the same process, does while this open retries.
    process.env.DB_DIALECT = "mysql";
    process.env.DATABASE_URL = MYSQL;

    open.fail(new Error("connect ECONNREFUSED 127.0.0.1:1"));
    await expect(opening).rejects.toMatchObject({
      code: "DATABASE_UNREACHABLE",
    });
    expect({
      dialect: process.env.DB_DIALECT,
      url: process.env.DATABASE_URL,
    }).toEqual({ dialect: "mysql", url: MYSQL });
  });

  it("leaves a variable the process never set unset", async () => {
    delete process.env.DB_DIALECT;
    delete process.env.DATABASE_URL;

    const opening = openDryRunAdapter({
      dialect: "postgresql",
      databaseUrl: POSTGRES,
    });
    const open = await inFlight();
    open.fail(new Error("connect ECONNREFUSED 127.0.0.1:1"));
    await expect(opening).rejects.toMatchObject({
      code: "DATABASE_UNREACHABLE",
    });

    expect("DB_DIALECT" in process.env).toBe(false);
    expect("DATABASE_URL" in process.env).toBe(false);
  });
});
