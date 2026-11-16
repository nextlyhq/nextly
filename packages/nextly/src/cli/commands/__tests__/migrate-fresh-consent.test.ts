/**
 * `migrate:fresh` deletes every table, so it takes the data-loss consent in
 * the form without targets, and with no terminal and no consent it refuses
 * before it connects to the database. `--yes` is never that consent: it is
 * refused, at a terminal or not, whatever else is given.
 *
 * The adapter is faked so that reaching it is the observable: a run allowed
 * to proceed connects, and a refused one never does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import type { CommandContext } from "../../program";
import { runMigrateFresh } from "../migrate-fresh";

const connect = vi.hoisted(() => vi.fn());
// The answer typed at the prompt (null for Ctrl+C), and whether the prompt
// was reached.
const prompt = vi.hoisted(() => ({
  answer: "no" as string | null,
  asked: 0,
}));

// Ctrl+C reaches readline as `SIGINT` on its interface; with nothing
// listening, readline only pauses and the question is never answered, which
// is said here rather than left to hang the test.
vi.mock("node:readline", () => ({
  createInterface: () => {
    const interrupted: Array<() => void> = [];
    const rl = {
      on: (event: string, listener: () => void) => {
        if (event === "SIGINT") interrupted.push(listener);
        return rl;
      },
      question: (_question: string, answer: (typed: string) => void) => {
        prompt.asked += 1;
        if (prompt.answer !== null) return answer(prompt.answer);
        if (interrupted.length === 0) {
          throw new Error("Ctrl+C went unheard: nothing listens for SIGINT");
        }
        for (const listener of interrupted) listener();
      },
      close: () => {},
    };
    return rl;
  },
}));

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

/** Every status `process.exit` was called with, the first being the one a run ends on. */
const exits: Array<number | undefined> = [];

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
    getOptions: () => ({ noColor: true }),
  };
  // The error a run ends with is printed in the error shape on standard error.
  vi.spyOn(console, "error").mockImplementation((m: string) => push(m));
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

// A test worker's streams carry no `isTTY` of their own, so each run sets it
// and the original descriptor is put back after.
const ttyDescriptors = {
  stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
  stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
};

/** Sets both ends of the run to terminals, or not, until `restoreTerminal`. */
function terminal(attached: boolean) {
  for (const stream of [process.stdin, process.stdout]) {
    Object.defineProperty(stream, "isTTY", {
      value: attached,
      configurable: true,
    });
  }
}

function restoreTerminal() {
  for (const [stream, was] of [
    [process.stdin, ttyDescriptors.stdin],
    [process.stdout, ttyDescriptors.stdout],
  ] as const) {
    if (was) Object.defineProperty(stream, "isTTY", was);
    else delete (stream as { isTTY?: boolean }).isTTY;
  }
}

describe("migrate:fresh and the data-loss consent", () => {
  let savedEnv: string | undefined;
  let savedCi: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.NEXTLY_ACCEPT_DATA_LOSS;
    delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
    savedCi = process.env.CI;
    delete process.env.CI;
    prompt.asked = 0;
    prompt.answer = "no";
    terminal(false);
    connect.mockReset();
    // Past the consent the run connects; stopping there keeps the test off
    // any database.
    connect.mockRejectedValue(new Error("connected"));
    exits.length = 0;
    vi.spyOn(process, "exit").mockImplementation(code => {
      exits.push(code === undefined ? undefined : Number(code));
      throw new Exited(code === undefined ? undefined : Number(code));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreTerminal();
    setNonInteractive(false);
    if (savedEnv === undefined) delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
    else process.env.NEXTLY_ACCEPT_DATA_LOSS = savedEnv;
    if (savedCi === undefined) delete process.env.CI;
    else process.env.CI = savedCi;
  });

  it("exits 1 when the prompt is declined, before connecting, naming the consent", async () => {
    terminal(true);
    const { code, output } = await fresh({});
    expect(prompt.asked).toBe(1);
    expect(code).toBe(1);
    expect(connect).not.toHaveBeenCalled();
    expect(output).toContain("the deletion was not confirmed");
    expect(output).toContain("--accept-data-loss");
  });

  it("exits 130 when the prompt is cancelled (Ctrl+C), before connecting", async () => {
    terminal(true);
    prompt.answer = null;
    await fresh({});
    expect(prompt.asked).toBe(1);
    expect(exits[0]).toBe(130);
    expect(connect).not.toHaveBeenCalled();
  });

  it("proceeds when the prompt is answered yes", async () => {
    terminal(true);
    prompt.answer = "yes";
    await fresh({});
    expect(prompt.asked).toBe(1);
    expect(connect).toHaveBeenCalled();
  });

  it("does not ask a terminal under --non-interactive: it refuses, naming the consent", async () => {
    terminal(true);
    setNonInteractive(true);
    const { code, output } = await fresh({});
    expect(prompt.asked).toBe(0);
    expect(code).toBe(1);
    expect(connect).not.toHaveBeenCalled();
    expect(output).toContain("(DATA_LOSS_CONSENT_REQUIRED)");
  });

  it("refuses with no terminal and no consent, before connecting, naming the consent", async () => {
    const { code, output } = await fresh({});
    expect(code).toBe(1);
    expect(connect).not.toHaveBeenCalled();
    expect(output).toContain("every table in the database");
    expect(output).toContain("--accept-data-loss");
    expect(output).toContain("(DATA_LOSS_CONSENT_REQUIRED)");
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
    expect(output).toContain("(DATA_LOSS_CONSENT_NOT_COVERED)");
  });

  it.each([
    ["with no terminal", false],
    ["at a terminal", true],
  ])(
    "refuses --yes %s, before asking or connecting, naming the consent",
    async (_where, attached) => {
      terminal(attached);
      const { code, output } = await fresh({ yes: true });
      expect(code).toBe(1);
      expect(prompt.asked).toBe(0);
      expect(connect).not.toHaveBeenCalled();
      expect(output).toContain(
        "--yes does not consent to deleting data: give --accept-data-loss (or NEXTLY_ACCEPT_DATA_LOSS)"
      );
      expect(output).toContain("(INPUT_REFUSED)");
    }
  );

  it("refuses --yes beside the consent too", async () => {
    const { code } = await fresh({ yes: true, acceptDataLoss: true });
    expect(code).toBe(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it("honours --force, naming it deprecated", async () => {
    const { output } = await fresh({ force: true });
    expect(connect).toHaveBeenCalled();
    expect(output).toMatch(
      /migrate:fresh's --force is deprecated.*--accept-data-loss/
    );
  });
});
