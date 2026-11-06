/**
 * Unit coverage for the `nextly webhooks:prune` glue. The pruning engine itself
 * is covered by `domains/webhooks/prune.test.ts` and the retention integration
 * suite; here we pin the branches unique to the command: a disabled retention
 * policy short-circuits before opening a database connection, and a pass that
 * deletes takes the data-loss consent, with this release's grace for a run
 * that cannot be asked.
 *
 * @module cli/commands/webhooks-prune.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setNonInteractive } from "../../domains/schema/migrate/can-prompt";
import type { CommandContext } from "../program";

import { runWebhooksPruneCommand } from "./webhooks-prune";

const retention = vi.hoisted(() => ({
  policy: null as null | Record<string, unknown>,
}));
// The pass itself: what it was asked to do is read off its calls.
const prunePass = vi.hoisted(() =>
  vi.fn(async () => ({
    events: { webhook: 0, audit: 0 },
    deliveries: 0,
    batches: 0,
    truncated: false,
  }))
);
// The answer given at the terminal, and whether the question was asked.
const confirm = vi.hoisted(() => vi.fn(async () => false));

vi.mock("@clack/prompts", () => ({
  confirm,
  isCancel: () => false,
}));

vi.mock("../utils/adapter", () => ({
  validateDatabaseEnv: vi.fn(() => ({
    valid: true,
    dialect: "sqlite",
    databaseUrl: "memory",
  })),
  createCliAdapter: vi.fn(async () => ({
    getCapabilities: () => ({ dialect: "sqlite" }),
    setTableResolver: () => {},
    disconnect: async () => {},
  })),
  // The dry run's read-only open, which answers the same stand-in.
  openCommandAdapter: vi.fn(async () => ({
    getCapabilities: () => ({ dialect: "sqlite" }),
    setTableResolver: () => {},
    disconnect: async () => {},
  })),
}));

vi.mock("../utils/config-loader", () => ({
  loadConfig: vi.fn(async () => ({
    config: { webhookRetention: retention.policy },
  })),
}));

vi.mock("../../domains/webhooks/prune", () => ({
  pruneWebhookData: prunePass,
}));

import { createCliAdapter, openCommandAdapter } from "../utils/adapter";

class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${String(code)}`);
  }
}

function fakeContext() {
  const lines: string[] = [];
  const push = (m: string) => lines.push(m);
  const logger = {
    header: vi.fn(),
    info: vi.fn(push),
    warn: vi.fn(push),
    error: vi.fn(push),
    success: vi.fn(push),
    getOptions: () => ({ noColor: true }),
  };
  return { lines, context: { logger } as unknown as CommandContext };
}

/** Runs the command; its error, when it ends with one, is returned rather than thrown. */
async function run(options: Record<string, unknown>) {
  const { lines, context } = fakeContext();
  const failure = await runWebhooksPruneCommand(options, context).then(
    () => undefined,
    (error: unknown) => error as { code?: string; what?: string; next?: string }
  );
  return { failure, output: lines.join("\n") };
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

/** Whether the pass ran for real, deleting, rather than as a dry run. */
const deleted = () =>
  prunePass.mock.calls.some(
    call =>
      (call as unknown as [unknown, unknown, { dryRun?: boolean }])[2]
        ?.dryRun === false
  );

const NEXT_RELEASE =
  /next release needs --accept-data-loss \(or NEXTLY_ACCEPT_DATA_LOSS\)/;

describe("runWebhooksPruneCommand", () => {
  let saved: { consent?: string; ci?: string };

  beforeEach(() => {
    vi.clearAllMocks();
    retention.policy = null;
    saved = {
      consent: process.env.NEXTLY_ACCEPT_DATA_LOSS,
      ci: process.env.CI,
    };
    delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
    delete process.env.CI;
    terminal(false);
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Exited(code === undefined ? undefined : Number(code));
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

  it("short-circuits without connecting when retention is disabled", async () => {
    const { output } = await run({});

    expect(createCliAdapter).not.toHaveBeenCalled();
    expect(output).toContain("disabled");
  });

  describe("the data-loss consent, in its release of grace", () => {
    beforeEach(() => {
      retention.policy = { maxBatchesPerRun: 1 };
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
        const { failure, output } = await run({});
        expect(failure).toBeUndefined();
        expect(confirm).not.toHaveBeenCalled();
        expect(deleted()).toBe(true);
        expect(output).toMatch(NEXT_RELEASE);
      }
    );

    it("deletes with --accept-data-loss, with no notice", async () => {
      const { failure, output } = await run({ acceptDataLoss: true });
      expect(failure).toBeUndefined();
      expect(deleted()).toBe(true);
      expect(output).not.toMatch(NEXT_RELEASE);
    });

    it("deletes with NEXTLY_ACCEPT_DATA_LOSS, with no notice", async () => {
      process.env.NEXTLY_ACCEPT_DATA_LOSS = "1";
      const { failure, output } = await run({});
      expect(failure).toBeUndefined();
      expect(deleted()).toBe(true);
      expect(output).not.toMatch(NEXT_RELEASE);
    });

    it.each([
      ["with no terminal", () => terminal(false)],
      ["at a terminal", () => terminal(true)],
    ])(
      "refuses a consent naming nextly_events alone %s, deleting nothing and naming nextly_webhook_deliveries",
      async (_case, arrange) => {
        arrange();
        const { failure, output } = await run({
          acceptDataLoss: "nextly_events",
        });
        expect(confirm).not.toHaveBeenCalled();
        expect(deleted()).toBe(false);
        expect(failure?.code).toBe("DATA_LOSS_CONSENT_NOT_COVERED");
        expect(`${failure?.what ?? ""}\n${failure?.next ?? ""}`).toContain(
          "nextly_webhook_deliveries"
        );
        expect(output).not.toMatch(NEXT_RELEASE);
      }
    );

    it("asks at a terminal, and deletes on yes", async () => {
      terminal(true);
      confirm.mockResolvedValueOnce(true);
      const { failure } = await run({});
      expect(failure).toBeUndefined();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(deleted()).toBe(true);
    });

    it("stops on a no at the terminal, deleting nothing and naming the consent", async () => {
      terminal(true);
      const { failure } = await run({});
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(deleted()).toBe(false);
      expect(failure?.what).toContain("the deletion was not confirmed");
      expect(failure?.next).toContain("--accept-data-loss");
    });

    it("takes no consent for a dry run, which deletes nothing", async () => {
      terminal(true);
      const { failure, output } = await run({ dryRun: true });
      expect(failure).toBeUndefined();
      expect(confirm).not.toHaveBeenCalled();
      expect(deleted()).toBe(false);
      expect(output).not.toMatch(NEXT_RELEASE);
      // It opens the database read-only, never with the writable connection.
      expect(openCommandAdapter).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true }),
        expect.anything()
      );
      expect(createCliAdapter).not.toHaveBeenCalled();
    });
  });
});
