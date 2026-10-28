/**
 * `migrate:fresh` deletes every table, so it takes the data-loss consent in
 * the form without targets, and with no terminal and no consent it refuses
 * before it connects to the database.
 *
 * The adapter is faked so that reaching it is the observable: a run allowed
 * to proceed connects, and a refused one never does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandContext } from "../../program";
import { runMigrateFresh } from "../migrate-fresh";

const connect = vi.hoisted(() => vi.fn());

// `../program` imports every command, `migrate` with its whole graph among
// them; the commands under test need only its context factory.
vi.mock("../../program", () => ({
  createContext: () => ({
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
  }),
}));

// `migrate` is the largest command module, and nothing here runs it.
vi.mock("../migrate", () => ({
  runMigrate: vi.fn(),
  parseSqlSections: vi.fn(),
}));

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: "sqlite",
    databaseUrl: ":memory:",
    errors: [],
  }),
  getDialectDisplayName: () => "SQLite",
  // Reached only once the consent has been given; the test stops there.
  createCliAdapter: connect,
}));

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async () => ({ config: { db: {} }, configPath: undefined }),
}));

class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${String(code)}`);
  }
}

function capture() {
  const lines: string[] = [];
  const push = (m: string) => lines.push(m);
  const logger = {
    header: () => {},
    debug: () => {},
    info: push,
    warn: push,
    error: push,
    success: push,
    newline: () => {},
    keyValue: () => {},
  };
  return { lines, context: { logger } as unknown as CommandContext };
}

/** Runs the command, returning its exit code and what it printed. */
async function fresh(options: Record<string, unknown>) {
  const { lines, context } = capture();
  const code = await runMigrateFresh(options, context).then(
    () => undefined,
    (error: unknown) => {
      if (error instanceof Exited) return error.code;
      throw error;
    }
  );
  return { code, output: lines.join("\n") };
}

describe("migrate:fresh and the data-loss consent", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.NEXTLY_ACCEPT_DATA_LOSS;
    delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
    connect.mockReset();
    // Past the consent the run connects; stopping there keeps the test off
    // any database.
    connect.mockRejectedValue(new Error("connected"));
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Exited(code === undefined ? undefined : Number(code));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedEnv === undefined) delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
    else process.env.NEXTLY_ACCEPT_DATA_LOSS = savedEnv;
  });

  it("refuses with no terminal and no consent, before connecting, naming the consent", async () => {
    const { code, output } = await fresh({});
    expect(code).toBe(1);
    expect(connect).not.toHaveBeenCalled();
    expect(output).toContain("every table in the database");
    expect(output).toContain("--accept-data-loss");
  });

  it("proceeds with --accept-data-loss, listing what it deletes", async () => {
    const { output } = await fresh({ acceptDataLoss: true });
    expect(connect).toHaveBeenCalled();
    expect(output).toMatch(/with consent:\n {2}- every table in the database/);
  });

  it("proceeds with NEXTLY_ACCEPT_DATA_LOSS", async () => {
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "1";
    await fresh({});
    expect(connect).toHaveBeenCalled();
  });

  it("refuses a consent naming tables: it deletes every one", async () => {
    const { code, output } = await fresh({ acceptDataLoss: "posts" });
    expect(code).toBe(1);
    expect(connect).not.toHaveBeenCalled();
    expect(output).toContain("only by the consent without targets");
  });

  it("honours --force, naming it deprecated", async () => {
    const { output } = await fresh({ force: true });
    expect(connect).toHaveBeenCalled();
    expect(output).toMatch(
      /migrate:fresh's --force is deprecated.*--accept-data-loss/
    );
  });
});
