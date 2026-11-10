/**
 * Each command that can delete data hands its data-loss judgement the CLI's
 * one answer to "may I ask?" (`canPrompt`). At a terminal with `CI` set or
 * `--non-interactive` given, the judgement is told nobody can be asked: the
 * run refuses and names the consent rather than prompting. The same run at a
 * terminal with neither is asked, which shows the terminal the cases fake is
 * one the commands would ask at.
 *
 * Each command runs through its entry point with its database, configuration
 * and the work past the judgement stood in for, so the judgement is what is
 * left to observe.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { setNonInteractive } from "../../domains/schema/migrate/can-prompt";
import { NO_CONSENT } from "../../domains/schema/migrate/data-loss-consent";
import { runMigrateDown } from "../commands/migrate-down";
import { runPluginUninstall } from "../commands/plugin-lifecycle-runner";
import { runPruneCommand } from "../commands/prune";
import type { CommandContext } from "../program";

const seen = vi.hoisted(() => ({
  confirm: vi.fn(),
  uninstallInteractive: [] as unknown[],
  ledger: [] as unknown[],
  migrationsDir: "",
}));

vi.mock("@clack/prompts", async importOriginal => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  confirm: seen.confirm,
}));

// `../program` imports every command; these need only its types.
vi.mock("../program", () => ({}));

const adapter = vi.hoisted(() => ({
  dialect: "sqlite",
  getCapabilities: () => ({ dialect: "sqlite" }),
  getDrizzle: () => ({}),
  setTableResolver: () => {},
  listTables: () => Promise.resolve(["dc_nw_old"]),
  tableExists: () => Promise.resolve(true),
  disconnect: () => Promise.resolve(),
}));

/** The database the commands are pointed at, which is never opened. */
const DATABASE_ENV = vi.hoisted(() => ({
  dialect: "sqlite",
  databaseUrl: "file:never-opened.db",
}));

vi.mock("../utils/command-prerequisites", () => ({
  requireDatabaseEnv: () => DATABASE_ENV,
  connectOrExit: () => Promise.resolve(adapter),
  // The shared openings the commands go through, answering as the pieces
  // above and the config loader below answer.
  openOrConnect: () => Promise.resolve(adapter),
  openMigrationCommand: async () => ({
    dbValidation: DATABASE_ENV,
    configResult: await configResult(),
    cwd: seen.migrationsDir,
    migrationsDir: seen.migrationsDir,
    adapter,
  }),
}));

vi.mock("../utils/adapter", async importOriginal => ({
  ...(await importOriginal<typeof import("../utils/adapter")>()),
  createCliAdapter: () => Promise.resolve(adapter),
}));

/** The configuration every command loads: no collections, no plugins. */
function configResult() {
  return Promise.resolve({
    config: {
      collections: [],
      plugins: [],
      db: { migrationsDir: seen.migrationsDir },
    },
    appConfig: { collections: [], plugins: [], db: {} },
    projectRoot: seen.migrationsDir,
  });
}

vi.mock("../utils/config-loader", () => ({
  loadConfig: () => configResult(),
}));

// prune: one collection the configuration no longer has.
vi.mock(
  "../../domains/collections/services/collection-registry-service",
  () => ({
    CollectionRegistryService: class {
      findOrphanedCollections() {
        return Promise.resolve([{ slug: "nw_old", tableName: "dc_nw_old" }]);
      }
    },
  })
);
vi.mock(
  "../../domains/field-groups/services/register-field-group-schemas",
  () => ({ registerComponentSchemas: () => Promise.resolve() })
);

// migrate:down: one applied migration whose DOWN drops a table.
vi.mock("../../domains/schema/events/schema-events-repository", () => ({
  SchemaEventsRepository: class {
    listFileApplies() {
      return Promise.resolve(seen.ledger);
    }
    // No migration's removal is recorded.
    listFileRemovals() {
      return Promise.resolve([]);
    }
  },
}));
vi.mock(
  "../../domains/schema/ownership/schema-owners-repository",
  async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    schemaOwnersTableExists: () => Promise.resolve(false),
  })
);
vi.mock("../../domains/schema/ownership/drop-guard", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../domains/schema/ownership/drop-guard")
  >()),
  readLiveColumns: () => Promise.resolve(new Map()),
  readLiveElements: () => Promise.resolve(new Map()),
  readLiveTables: () => Promise.resolve(new Set()),
  readLiveIndexTables: () => Promise.resolve(new Map()),
}));
// `migrate:down` asks the app's history first; here it holds, so the
// command reaches its judgement.
vi.mock("../commands/migrate", async importOriginal => ({
  migrateExitCode: (
    await importOriginal<typeof import("../commands/migrate")>()
  ).migrateExitCode,
  assertAppHistoryHolds: () => Promise.resolve(),
}));

// plugins uninstall: what the command hands its judgement is recorded, and
// the uninstall stops there.
vi.mock("../commands/plugin-lifecycle", async importOriginal => ({
  ...(await importOriginal<typeof import("../commands/plugin-lifecycle")>()),
  runPluginUninstallCommand: (
    _name: string,
    _opts: unknown,
    deps: { interactive?: boolean }
  ) => {
    seen.uninstallInteractive.push(deps.interactive);
    return Promise.resolve();
  },
}));

const project = mkdtempSync(join(tmpdir(), "nextly-judgement-asks-"));
seen.migrationsDir = project;
const MIGRATION = "20261020_120000_drop_old.sql";
writeFileSync(
  join(project, MIGRATION),
  "-- UP\nCREATE TABLE dc_nw_old (id integer);\n-- DOWN\nDROP TABLE dc_nw_old;\n"
);
afterAll(() => rmSync(project, { recursive: true, force: true }));

/** A context whose logger keeps nothing. */
function quietContext(): CommandContext {
  const none = () => {};
  return {
    logger: {
      header: none,
      newline: none,
      keyValue: none,
      debug: none,
      info: none,
      warn: none,
      error: none,
      success: none,
      getOptions: () => ({ verbose: false, noColor: true }),
    },
    options: {},
    cwd: project,
  } as unknown as CommandContext;
}

// A test worker's streams are not terminals and carry no `isTTY` at all, so
// each case makes them terminals, and the original (usually absent) is put
// back after.
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

beforeEach(() => {
  vi.stubEnv("CI", undefined);
  vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", undefined);
  for (const stream of [process.stdin, process.stdout]) {
    Object.defineProperty(stream, "isTTY", { value: true, configurable: true });
  }
  seen.confirm.mockReset().mockResolvedValue(false);
  seen.uninstallInteractive.length = 0;
  seen.ledger = [
    {
      id: "applied",
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename: MIGRATION,
      sha256: null,
      scopeKind: null,
      scopeSlug: null,
      startedAt: new Date(1000),
      endedAt: new Date(1000),
      durationMs: null,
      note: null,
      statementsExecuted: null,
      supersededEventIds: null,
      supersededBy: null,
    },
  ];
});

afterEach(() => {
  vi.unstubAllEnvs();
  restoreTty(process.stdin, originalTty.stdin);
  restoreTty(process.stdout, originalTty.stdout);
  setNonInteractive(false);
});

/** What a run ended with, thrown or not. */
async function outcome(run: Promise<void>): Promise<unknown> {
  return run.then(
    () => undefined,
    (thrown: unknown) => thrown
  );
}

const nobodyToAsk = [
  ["--non-interactive", () => setNonInteractive(true)],
  ["CI", () => vi.stubEnv("CI", "true")],
] as const;

describe("prune", () => {
  const prune = () => outcome(runPruneCommand({}, quietContext()));

  it.each(nobodyToAsk)(
    "with %s at a terminal, refuses and names the consent without asking",
    async (_case, arrange) => {
      arrange();
      const ended = await prune();
      expect(seen.confirm).not.toHaveBeenCalled();
      expect(ended).toMatchObject({ code: "DATA_LOSS_CONSENT_REQUIRED" });
      expect(String((ended as { next?: string }).next)).toContain(
        "--accept-data-loss"
      );
    }
  );

  it("asks at a terminal with neither", async () => {
    const ended = await prune();
    expect(seen.confirm).toHaveBeenCalledTimes(1);
    expect(ended).toMatchObject({ code: "DATA_LOSS_DECLINED" });
  });
});

describe("migrate:down", () => {
  const down = () => outcome(runMigrateDown({}, quietContext()));

  it.each(nobodyToAsk)(
    "with %s at a terminal, refuses and names the consent without asking",
    async (_case, arrange) => {
      arrange();
      const ended = await down();
      expect(seen.confirm).not.toHaveBeenCalled();
      expect(String((ended as Error).message)).toContain(
        "Deleting data needs consent"
      );
      expect(String((ended as Error).message)).toContain("--accept-data-loss");
    }
  );

  it("asks at a terminal with neither", async () => {
    const ended = await down();
    expect(seen.confirm).toHaveBeenCalledTimes(1);
    expect(ended).toMatchObject({ code: "DATA_LOSS_DECLINED" });
  });
});

describe("plugins uninstall", () => {
  const uninstall = () =>
    runPluginUninstall(
      "@acme/x",
      { keepData: false, yes: false, consent: NO_CONSENT },
      quietContext()
    );

  it.each(nobodyToAsk)(
    "with %s at a terminal, tells its judgement nobody can be asked",
    async (_case, arrange) => {
      arrange();
      await uninstall();
      expect(seen.uninstallInteractive).toEqual([false]);
    }
  );

  it("tells it a person can be asked at a terminal with neither", async () => {
    await uninstall();
    expect(seen.uninstallInteractive).toEqual([true]);
  });
});
