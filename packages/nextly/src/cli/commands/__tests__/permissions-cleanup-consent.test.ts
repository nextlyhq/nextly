/**
 * `nextly permissions:cleanup` deletes the permissions of collections and
 * Singles that no longer exist, so it takes the data-loss consent. In this
 * release a run that cannot be asked still deletes, as it always has, and says
 * that the next release needs the consent; at a terminal it asks, and a no
 * stops it before anything is deleted.
 *
 * The cleanup itself is faked: whether it ran is what the command decided.
 */
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { permissionsCleanupAction } from "../permissions-cleanup";

const cleanup = vi.hoisted(() =>
  vi.fn(async () => ({ total: 0, created: 0, skipped: 0, errors: 0 }))
);
const confirm = vi.hoisted(() => vi.fn(async () => false));
const lines = vi.hoisted(() => [] as string[]);

vi.mock("@clack/prompts", () => ({
  confirm,
  isCancel: () => false,
}));

// `../program` imports every command; the action needs only its context factory.
vi.mock("../../program", () => {
  const push = (m: string) => lines.push(m);
  return {
    createContext: () => ({
      options: {},
      logger: {
        info: push,
        warn: push,
        error: push,
        success: push,
        getOptions: () => ({ noColor: true }),
      },
    }),
  };
});

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: "sqlite",
    databaseUrl: ":memory:",
    errors: [],
  }),
  createCliAdapter: async () => ({
    disconnect: async () => {},
  }),
  openCommandAdapter: async () => ({ disconnect: async () => {} }),
}));

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async () => ({ config: {} }),
}));

// The cleanup runs as it is: the adapter here is a fake with no database to lock, and what is
// under test is the consent, which comes before the lock.
vi.mock("../../../domains/field-groups/migration/sync-guard", () => ({
  withMigrationExcluded: (_options: unknown, work: () => Promise<unknown>) =>
    work(),
}));

vi.mock("../../../domains/auth/services/permission-seed-service", () => ({
  PermissionSeedService: class {
    cleanupOrphanedPermissions = cleanup;
  },
}));

class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${String(code)}`);
  }
}

const cmd = { optsWithGlobals: () => ({}) } as unknown as Command;

/** Every exit the run asked for, in order. */
const exits: Array<number | undefined> = [];

/**
 * Runs the action, returning the exit code it ended with and what it printed.
 * The stubbed exit throws, and the action's own catch then exits again, so the
 * code is the first one asked for.
 */
async function run(options: Record<string, unknown>) {
  lines.length = 0;
  exits.length = 0;
  await permissionsCleanupAction(options, cmd).catch((error: unknown) => {
    if (!(error instanceof Exited)) throw error;
  });
  return { code: exits[0], output: lines.join("\n") };
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

const NEXT_RELEASE =
  /next release needs --accept-data-loss \(or NEXTLY_ACCEPT_DATA_LOSS\)/;

describe("permissions:cleanup and the data-loss consent", () => {
  let saved: { consent?: string; ci?: string };

  beforeEach(() => {
    cleanup.mockClear();
    confirm.mockClear();
    saved = {
      consent: process.env.NEXTLY_ACCEPT_DATA_LOSS,
      ci: process.env.CI,
    };
    delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
    delete process.env.CI;
    terminal(false);
    vi.spyOn(console, "log").mockImplementation(() => {});
    // The error a run ends with is printed in the error shape on standard error.
    vi.spyOn(console, "error").mockImplementation((m: string) => {
      lines.push(m);
    });
    vi.spyOn(process, "exit").mockImplementation(code => {
      const status = code === undefined ? undefined : Number(code);
      exits.push(status);
      throw new Exited(status);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreTerminal();
    setNonInteractive(false);
    for (const [name, value] of [
      ["NEXTLY_ACCEPT_DATA_LOSS", saved.consent],
      ["CI", saved.ci],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it.each([
    ["with no terminal", () => terminal(false)],
    [
      "with CI set at a terminal",
      () => {
        terminal(true);
        process.env.CI = "true";
      },
    ],
    [
      "with --non-interactive at a terminal",
      () => {
        terminal(true);
        setNonInteractive(true);
      },
    ],
  ])(
    "deletes as before %s and no consent, saying the next release needs it",
    async (_case, arrange) => {
      arrange();
      const { code, output } = await run({});
      expect(code).toBe(0);
      expect(confirm).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(output).toMatch(NEXT_RELEASE);
    }
  );

  it("deletes with --accept-data-loss, with no notice", async () => {
    const { code, output } = await run({ acceptDataLoss: true });
    expect(code).toBe(0);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(output).not.toMatch(NEXT_RELEASE);
  });

  it("deletes with NEXTLY_ACCEPT_DATA_LOSS, with no notice", async () => {
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "1";
    const { code, output } = await run({});
    expect(code).toBe(0);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(output).not.toMatch(NEXT_RELEASE);
  });

  it.each([
    ["with no terminal", () => terminal(false)],
    ["at a terminal", () => terminal(true)],
  ])(
    "refuses a consent naming permissions alone %s, deleting nothing and naming role_permissions",
    async (_case, arrange) => {
      arrange();
      const { code, output } = await run({ acceptDataLoss: "permissions" });
      expect(code).toBe(1);
      expect(confirm).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
      expect(output).toContain("rows of role_permissions");
      expect(output).toContain("(DATA_LOSS_CONSENT_NOT_COVERED)");
      expect(output).not.toMatch(NEXT_RELEASE);
    }
  );

  it("asks at a terminal, and deletes on yes", async () => {
    terminal(true);
    confirm.mockResolvedValueOnce(true);
    const { code } = await run({});
    expect(code).toBe(0);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("exits 1 on a no at the terminal, deleting nothing and naming the consent", async () => {
    terminal(true);
    const { code, output } = await run({});
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(code).toBe(1);
    expect(cleanup).not.toHaveBeenCalled();
    expect(output).toContain("the deletion was not confirmed");
    expect(output).toContain("--accept-data-loss");
  });
});
