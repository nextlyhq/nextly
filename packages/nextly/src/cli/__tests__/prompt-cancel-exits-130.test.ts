/**
 * A cancel (Ctrl+C) at any prompt the CLI asks ends the run with exit 130,
 * having changed nothing. A cancel is not a no: a no keeps the outcome its
 * command gives it (a declined deletion exits 1, a declined promote says
 * "Promote cancelled." and ends well), and only a cancel exits 130.
 *
 * Each prompt library reports a cancel its own way, and each is stood in
 * for here the way it reports one: @clack/prompts answers its cancel value,
 * @inquirer/prompts rejects with `ExitPromptError`, and readline emits
 * `SIGINT` on its interface.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Command } from "commander";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { setNonInteractive } from "../../domains/schema/migrate/can-prompt";
import { resolveDataLossConsent } from "../../domains/schema/migrate/data-loss-consent";
import { NextlyError } from "../../errors/nextly-error";
import { createAdminAction } from "../commands/create-admin";
import { runDemote } from "../commands/db-sync-demote";
import { runPromote } from "../commands/db-sync-promote";
import { generateWidgetAction } from "../commands/generate-widget";
import { runInit } from "../commands/init";
import { pruneApproval, runPrune } from "../commands/prune";
import { upgradeAction } from "../commands/upgrade";
import type { CommandContext } from "../program";
import { askToDeleteInTerminal } from "../utils/data-loss-consent";

// ── the prompts, answering as each test says ────────────────────────────────

/** The value @clack/prompts answers a cancelled prompt with. */
const CANCEL = vi.hoisted(() => Symbol("clack:cancel"));

const seen = vi.hoisted(() => ({
  text: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  inquirerInput: vi.fn(),
  inquirerConfirm: vi.fn(),
  createInterface: vi.fn(),
  connect: vi.fn(),
  stepRun: vi.fn(),
  reconciled: vi.fn(),
  openRegistry: vi.fn(),
  registry: {
    getCollectionBySlug: vi.fn(),
    // The deletion's own refusal, asked before a promote appends anything: none here.
    assertDeletable: vi.fn(),
    deleteCollection: vi.fn(),
    updateCollection: vi.fn(),
    registerCollection: vi.fn(),
  },
  printed: [] as string[],
}));

vi.mock("@clack/prompts", async importOriginal => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  text: seen.text,
  password: seen.password,
  select: seen.select,
  confirm: seen.confirm,
  isCancel: (value: unknown) => value === CANCEL,
  note: () => {},
  intro: () => {},
  outro: () => {},
  cancel: () => {},
}));

vi.mock("@inquirer/prompts", () => ({
  input: seen.inquirerInput,
  confirm: seen.inquirerConfirm,
}));

vi.mock("node:readline", async importOriginal => ({
  ...(await importOriginal<typeof import("node:readline")>()),
  createInterface: seen.createInterface,
}));

// The commands below reach their questions only past a database, a lock and
// the work before the question; each is stood in for, so the question and
// what follows it are all that is left to observe.
vi.mock("../program", () => ({
  createContext: () => recordingContext(),
}));

vi.mock("../utils/command-prerequisites", async importOriginal => ({
  ...(await importOriginal<typeof import("../utils/command-prerequisites")>()),
  requireDatabaseEnv: () => ({
    dialect: "sqlite",
    databaseUrl: "file:never-opened.db",
  }),
}));

vi.mock("../utils/adapter", () => ({
  createCliAdapter: (...args: unknown[]) => {
    seen.connect(...args);
    return Promise.resolve({
      getCapabilities: () => ({ dialect: "sqlite" }),
      getDrizzle: () => ({}),
      tableExists: () => Promise.resolve(false),
      dropTable: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
    });
  },
}));

vi.mock("../utils/config-loader", () => ({
  loadConfig: () =>
    Promise.resolve({
      // `db.migrationsDir` as the real loader fills it in.
      config: {
        collections: [{ slug: "nw_posts", fields: [] }],
        db: { migrationsDir: "./migrations" },
      },
    }),
}));

vi.mock("../commands/db-sync-registry", async importOriginal => ({
  ...(await importOriginal<typeof import("../commands/db-sync-registry")>()),
  openCollectionRegistry: seen.openRegistry,
  // The write runs as it is: these fakes have no database to lock, and what is under test here
  // is the prompt, which comes before the lock.
  withCollectionRegistryWrite: (_args: unknown, work: () => Promise<unknown>) =>
    work(),
}));

// `upgrade --reconcile-core` asks the app's history before its reconcile;
// here it holds, so the run reaches the question.
vi.mock("../commands/migrate", async importOriginal => ({
  maybeForceUnlock: () => Promise.resolve(),
  assertAppHistoryHolds: () => Promise.resolve(),
  migrateExitCode: (
    await importOriginal<typeof import("../commands/migrate")>()
  ).migrateExitCode,
}));

vi.mock("../../domains/schema/pipeline/locks", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../domains/schema/pipeline/locks")
  >()),
  withMigrateLock: async <T>(
    _adapter: unknown,
    _dialect: unknown,
    fn: () => Promise<T>
  ) => ({ ran: true as const, value: await fn() }),
}));

vi.mock("../commands/upgrade-steps", () => ({
  UPGRADE_STEPS: [
    {
      title: "a step with work",
      pending: () => Promise.resolve(1),
      run: seen.stepRun,
    },
  ],
}));

vi.mock("../../domains/schema/events/legacy-detection", () => ({
  assertNoLegacyBookkeeping: () => Promise.resolve(),
}));

vi.mock("../../domains/field-groups/storage/resolve-storage-names", () => ({
  resolveRegistryNameFromCatalog: () => Promise.resolve("nextly_field_groups"),
}));

// The reconcile asks before its destructive change, and refuses as the real
// one does when the answer is no; `reconciled` records that it went ahead.
vi.mock("../../domains/schema/migrate/core-reconcile", () => ({
  reconcileCore: async (deps: {
    confirmDestructive: (reasons: string[]) => Promise<boolean>;
  }) => {
    if (!(await deps.confirmDestructive(["drop column nextly_users.legacy"]))) {
      throw new NextlyError({
        code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
        publicMessage:
          "Core schema reconciliation aborted: destructive operations were not confirmed: drop column nextly_users.legacy.",
      });
    }
    seen.reconciled();
  },
}));

/**
 * A readline interface that answers `typed`, or, for `CANCEL`, receives
 * Ctrl+C: it emits `SIGINT` on itself, as readline does at a terminal. With
 * nothing listening for it, readline only pauses, and the question is never
 * answered; that is said here rather than left to hang the test.
 */
function readlineTyping(typed: string | typeof CANCEL) {
  return () => {
    const listeners = new Map<string, Array<() => void>>();
    const rl = {
      on(event: string, listener: () => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return rl;
      },
      question(_question: string, answer: (typed: string) => void) {
        if (typeof typed === "string") return answer(typed);
        const heard = listeners.get("SIGINT") ?? [];
        if (heard.length === 0) {
          throw new Error(
            "Ctrl+C went unheard: nothing listens for SIGINT on the prompt"
          );
        }
        for (const listener of heard) listener();
      },
      close: () => {},
    };
    return rl;
  };
}

/** The error @inquirer/prompts rejects a prompt with when Ctrl+C closes it. */
function inquirerForceClosed(): Error {
  const error = new Error("User force closed the prompt with SIGINT");
  error.name = "ExitPromptError";
  return error;
}

// The folder each in-process command runs in, emptied between tests.
let folder = mkdtempSync(join(tmpdir(), "nextly-cancel-130-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

/** A context whose logger keeps what it prints, for the wording. */
function recordingContext(
  options: Record<string, unknown> = {}
): CommandContext {
  const keep = (message: string) => seen.printed.push(message);
  const logger = {
    debug: keep,
    info: keep,
    warn: keep,
    error: keep,
    success: keep,
    header: keep,
    newline: () => {},
    divider: () => {},
    getOptions: () => ({ verbose: false, noColor: true }),
  };
  return { logger, options, cwd: folder } as unknown as CommandContext;
}

/** What a command's `process.exit` was asked for, thrown so the run stops there. */
class Exited extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

// A test worker's streams are not terminals and carry no `isTTY` at all, so
// each case sets it, and the original (usually absent) is put back after.
const originalTty = {
  stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
  stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
};

function restoreTty(
  stream: NodeJS.ReadStream | NodeJS.WriteStream,
  was?: PropertyDescriptor
) {
  if (was) Object.defineProperty(stream, "isTTY", was);
  else delete (stream as { isTTY?: boolean }).isTTY;
}

/** The project folder's entries: what a run wrote, if anything. */
const written = () => readdirSync(folder, { recursive: true }).map(String);

describe("a cancelled prompt exits 130 and changes nothing", () => {
  /** Every status `process.exit` was called with, the first being the one a run ends on. */
  let exits: Array<number | string | null | undefined>;
  /** Every signal `process.kill` was asked to send, and to whom. */
  let kills: Array<[number, string | number | undefined]>;
  let errors: Mock;

  beforeEach(() => {
    rmSync(folder, { recursive: true, force: true });
    folder = mkdtempSync(join(tmpdir(), "nextly-cancel-130-"));
    vi.stubEnv("CI", undefined);
    for (const stream of [process.stdin, process.stdout]) {
      Object.defineProperty(stream, "isTTY", {
        value: true,
        configurable: true,
      });
    }
    setNonInteractive(false);
    seen.printed.length = 0;
    exits = [];
    errors = vi.fn();
    vi.spyOn(console, "error").mockImplementation(errors);
    vi.spyOn(process, "exit").mockImplementation(code => {
      exits.push(code);
      throw new Exited(code);
    });
    // A signal sent to this process would end the test worker: recorded instead.
    kills = [];
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      kills.push([pid, signal]);
      return true;
    });
    seen.openRegistry.mockResolvedValue({
      registry: seen.registry,
      adapter: { disconnect: vi.fn().mockResolvedValue(undefined) },
    });
    seen.registry.getCollectionBySlug.mockResolvedValue({
      slug: "nw_posts",
      fields: [],
    });
    seen.stepRun.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const mock of [
      seen.text,
      seen.password,
      seen.select,
      seen.confirm,
      seen.inquirerInput,
      seen.inquirerConfirm,
      seen.createInterface,
      seen.connect,
      seen.stepRun,
      seen.reconciled,
      seen.openRegistry,
      ...Object.values(seen.registry),
    ]) {
      mock.mockReset();
    }
    restoreTty(process.stdin, originalTty.stdin);
    restoreTty(process.stdout, originalTty.stdout);
    process.exitCode = undefined;
  });

  /** Runs `work` to its end, or to the `process.exit` that stopped it. */
  async function run(work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (!(error instanceof Exited)) throw error;
    }
  }

  const printedError = () =>
    errors.mock.calls.map(call => String(call[0])).join("\n");

  /** Two orphaned tables, whose drops are recorded. */
  function orphanedDatabase() {
    const executed: string[] = [];
    const deleted: string[] = [];
    const tables = ["dc_a", "dc_b"];
    return {
      executed,
      deleted,
      registry: {
        findOrphanedCollections: async () => [
          { slug: "a", tableName: "dc_a" },
          { slug: "b", tableName: "dc_b" },
        ],
        deleteCollection: async (slug: string) => {
          deleted.push(slug);
        },
        assertNothingDependsOn: async () => {},
      },
      adapter: {
        dialect: "sqlite" as const,
        getCapabilities: () => ({ dialect: "sqlite" }),
        listTables: async () => tables,
        tableExists: async (name: string) => tables.includes(name),
        executeQuery: async (statement: string) => {
          executed.push(statement);
          return [];
        },
      },
    };
  }

  /** `nextly prune` asking the data-loss question at the terminal. */
  function pruneAtTheTerminal(db: ReturnType<typeof orphanedDatabase>) {
    return runPrune({
      registry: db.registry as never,
      adapter: db.adapter as never,
      currentSlugs: [],
      // Runs the drop as it is: this fake has no database to lock, and what is under test here is
      // the cancelled prompt, which comes before the lock.
      lock: work => work(),
      approve: pruneApproval({
        consent: resolveDataLossConsent({ env: {} }),
        interactive: true,
        ask: askToDeleteInTerminal,
        print: () => {},
        db: undefined,
        dialect: "sqlite",
      }),
    });
  }

  describe("the data-loss prompt", () => {
    it("a cancel exits 130 and drops nothing", async () => {
      seen.confirm.mockResolvedValue(CANCEL);
      const db = orphanedDatabase();
      await run(() => pruneAtTheTerminal(db));
      expect(exits[0]).toBe(130);
      expect(db.executed).toEqual([]);
      expect(db.deleted).toEqual([]);
    });

    it("under a held lock, a cancel hands Ctrl+C back to the lock, which lets go first", async () => {
      // The schema locks listen for SIGINT while held: they release, then
      // re-raise it to end the run. An exit here would skip the release.
      const lockListening = () => {};
      process.once("SIGINT", lockListening);
      vi.useFakeTimers();
      try {
        vi.mocked(process.exit).mockImplementation(code => {
          exits.push(code);
          return undefined as never;
        });
        seen.confirm.mockResolvedValue(CANCEL);
        const db = orphanedDatabase();
        let settled = false;
        void pruneAtTheTerminal(db).finally(() => {
          settled = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(kills).toEqual([[process.pid, "SIGINT"]]);
        expect(exits).toEqual([]);
        expect(process.exitCode).toBe(130);
        expect(settled).toBe(false);
        expect(db.executed).toEqual([]);
        // A listener that never ends the run does not leave it waiting.
        await vi.advanceTimersByTimeAsync(10_000);
        expect(exits).toEqual([130]);
        expect(db.executed).toEqual([]);
      } finally {
        process.off("SIGINT", lockListening);
        vi.useRealTimers();
      }
    });

    it("a no still ends as a declined deletion, not 130", async () => {
      seen.confirm.mockResolvedValue(false);
      const db = orphanedDatabase();
      await expect(pruneAtTheTerminal(db)).rejects.toMatchObject({
        code: "DATA_LOSS_DECLINED",
      });
      expect(exits).toEqual([]);
      expect(db.executed).toEqual([]);
    });
  });

  describe("db:sync --promote", () => {
    it("a cancel at its action prompt exits 130 and removes nothing", async () => {
      seen.select.mockResolvedValue(CANCEL);
      await run(() => runPromote("nw_posts", recordingContext()));
      expect(exits[0]).toBe(130);
      expect(seen.registry.deleteCollection).not.toHaveBeenCalled();
      expect(seen.printed).not.toContain("Promote cancelled.");
      expect(written()).toEqual([]);
    });

    it("a cancel at its confirmation after the preview exits 130 and removes nothing", async () => {
      seen.select.mockResolvedValue("preview");
      seen.confirm.mockResolvedValue(CANCEL);
      await run(() => runPromote("nw_posts", recordingContext()));
      expect(exits[0]).toBe(130);
      expect(seen.registry.deleteCollection).not.toHaveBeenCalled();
    });

    it("choosing Cancel still says 'Promote cancelled.' and ends well", async () => {
      seen.select.mockResolvedValue("decline");
      await runPromote("nw_posts", recordingContext());
      expect(exits).toEqual([]);
      expect(seen.printed).toContain("Promote cancelled.");
      expect(seen.registry.deleteCollection).not.toHaveBeenCalled();
    });

    it("a no after the preview still says 'Promote cancelled.' and ends well", async () => {
      seen.select.mockResolvedValue("preview");
      seen.confirm.mockResolvedValue(false);
      await runPromote("nw_posts", recordingContext());
      expect(exits).toEqual([]);
      expect(seen.printed).toContain("Promote cancelled.");
    });
  });

  describe("db:sync --demote", () => {
    it("a cancel exits 130 and writes no record", async () => {
      seen.confirm.mockResolvedValue(CANCEL);
      await run(() => runDemote("nw_posts", recordingContext()));
      expect(exits[0]).toBe(130);
      expect(seen.registry.registerCollection).not.toHaveBeenCalled();
      expect(seen.registry.updateCollection).not.toHaveBeenCalled();
      expect(seen.printed).not.toContain("Demote cancelled.");
    });

    it("a no still says 'Demote cancelled.' and ends well", async () => {
      seen.confirm.mockResolvedValue(false);
      await runDemote("nw_posts", recordingContext());
      expect(exits).toEqual([]);
      expect(seen.printed).toContain("Demote cancelled.");
      expect(seen.registry.registerCollection).not.toHaveBeenCalled();
    });
  });

  describe("init", () => {
    const initAtTheTerminal = () =>
      runInit({ cwd: folder }, recordingContext());

    it("a cancel exits 130 and writes nothing", async () => {
      seen.inquirerInput.mockRejectedValue(inquirerForceClosed());
      await run(initAtTheTerminal);
      expect(exits[0]).toBe(130);
      expect(written()).toEqual([]);
    });

    it("a prompt that fails for another reason is not taken for a cancel", async () => {
      const broken = new Error("the terminal went away");
      seen.inquirerInput.mockRejectedValue(broken);
      await expect(initAtTheTerminal()).rejects.toBe(broken);
      expect(exits).toEqual([]);
      expect(written()).toEqual([]);
    });
  });

  it("users:create-admin: a cancel exits 130 before it connects", async () => {
    seen.text.mockResolvedValue(CANCEL);
    await run(() =>
      createAdminAction(() => recordingContext())({}, {
        optsWithGlobals: () => ({}),
      } as unknown as Command)
    );
    expect(exits[0]).toBe(130);
    expect(seen.connect).not.toHaveBeenCalled();
  });

  it("generate:widget: a cancel exits 130, writes nothing, and still says what it left undone", async () => {
    writeFileSync(join(folder, "nextly.config.ts"), "export default {};\n");
    seen.text.mockResolvedValue(CANCEL);
    await run(() =>
      generateWidgetAction(undefined, {}, {
        optsWithGlobals: () => ({ cwd: folder, quiet: true }),
      } as unknown as Command)
    );
    expect(exits[0]).toBe(130);
    expect(written()).toEqual(["nextly.config.ts"]);
    expect(printedError()).toContain("(WIDGET_GENERATE_CANCELLED)");
  });

  describe("upgrade", () => {
    it("a cancel at the backup question exits 130 and runs no step", async () => {
      seen.createInterface.mockImplementation(readlineTyping(CANCEL));
      await run(() =>
        upgradeAction({}, {
          optsWithGlobals: () => ({}),
        } as unknown as Command)
      );
      expect(exits[0]).toBe(130);
      expect(seen.stepRun).not.toHaveBeenCalled();
    });

    it("a no at the backup question still ends as a cancelled upgrade, exit 1", async () => {
      seen.createInterface.mockImplementation(readlineTyping("n"));
      await upgradeAction({}, {
        optsWithGlobals: () => ({}),
      } as unknown as Command);
      expect(exits).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(printedError()).toContain("(UPGRADE_CANCELLED)");
      expect(seen.stepRun).not.toHaveBeenCalled();
    });

    it("a cancel at the --reconcile-core question exits 130 and reconciles nothing", async () => {
      seen.createInterface.mockImplementation(readlineTyping(CANCEL));
      await run(() =>
        upgradeAction({ reconcileCore: true }, {
          optsWithGlobals: () => ({}),
        } as unknown as Command)
      );
      expect(exits[0]).toBe(130);
      expect(seen.reconciled).not.toHaveBeenCalled();
    });

    it("a no at the --reconcile-core question still ends as a refusal, exit 1", async () => {
      seen.createInterface.mockImplementation(readlineTyping("n"));
      await upgradeAction({ reconcileCore: true }, {
        optsWithGlobals: () => ({}),
      } as unknown as Command);
      expect(exits).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(seen.reconciled).not.toHaveBeenCalled();
    });
  });
});
