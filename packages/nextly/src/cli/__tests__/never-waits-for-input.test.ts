/**
 * A command never waits for input nobody can give.
 *
 * Every command that can ask a question asks `canPrompt()` first. Where it
 * says no (no terminal, `CI` set, or `--non-interactive`), the command stops
 * before changing anything, exits 1 and names the flag or variable that
 * gives the answer.
 *
 * Two halves:
 * - Each command runs as a shell runs it, in a process of its own in a
 *   scratch project. Its stdin is a pipe that stays open and never sends a
 *   byte, which is the strictest case: a prompt reading it would wait for
 *   ever rather than read the end of the input and give up. The run must end
 *   on its own, exit 1, name the answer, and leave the project folder and
 *   the database as they were.
 * - A process of its own has no terminal, so `--non-interactive` at a
 *   terminal is covered in process: stdin and stdout are made terminals,
 *   `--non-interactive` is recorded, and the command must still not ask.
 */
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { Command } from "commander";
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
import {
  ClackTerminalPromptDispatcher,
  TTYRequiredError,
} from "../../domains/schema/pipeline/prompt-dispatcher/clack-terminal";
import { NextlyError } from "../../errors/nextly-error";
import { createAdminAction } from "../commands/create-admin";
import { runDemote } from "../commands/db-sync-demote";
import { runPromote } from "../commands/db-sync-promote";
import { upgradeAction } from "../commands/upgrade";
import type { CommandContext } from "../program";

import { NEXTLY_RUN_TIMEOUT, runNextly } from "./helpers/run-nextly";

// ── in process: the prompts, recorded rather than shown ─────────────────────

const seen = vi.hoisted(() => ({
  text: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  createInterface: vi.fn(),
  stepRun: vi.fn(),
  reconciled: vi.fn(),
  openRegistry: vi.fn(),
  registry: {
    getCollectionBySlug: vi.fn(),
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
  note: () => {},
  intro: () => {},
  outro: () => {},
}));

vi.mock("node:readline", async importOriginal => ({
  ...(await importOriginal<typeof import("node:readline")>()),
  createInterface: seen.createInterface,
}));

// The commands below reach their questions only past a database, a lock and
// the work before the question; each is stood in for, so the question is the
// only thing left to observe.
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
  createCliAdapter: () =>
    Promise.resolve({
      getCapabilities: () => ({ dialect: "sqlite" }),
      getDrizzle: () => ({}),
      tableExists: () => Promise.resolve(false),
      dropTable: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
    }),
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

// The folder the in-process commands run in: empty, so `--promote` finds no
// configuration to append to and prints its snippet instead.
const emptyFolder = mkdtempSync(join(tmpdir(), "nextly-never-waits-cwd-"));
afterAll(() => rmSync(emptyFolder, { recursive: true, force: true }));

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
    getOptions: () => ({ verbose: false, noColor: true }),
  };
  return {
    logger,
    options,
    cwd: emptyFolder,
  } as unknown as CommandContext;
}

/** What a command's `process.exit` was asked for, thrown so the test sees it. */
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

function atATerminal() {
  for (const stream of [process.stdin, process.stdout]) {
    Object.defineProperty(stream, "isTTY", { value: true, configurable: true });
  }
}

function restoreTty(
  stream: NodeJS.ReadStream | NodeJS.WriteStream,
  was?: PropertyDescriptor
) {
  if (was) Object.defineProperty(stream, "isTTY", was);
  else delete (stream as { isTTY?: boolean }).isTTY;
}

describe("--non-interactive at a terminal", () => {
  let errors: Mock;

  beforeEach(() => {
    vi.stubEnv("CI", undefined);
    atATerminal();
    setNonInteractive(true);
    seen.printed.length = 0;
    // The error shape is printed with `console.error`; kept here for its wording.
    errors = vi.fn();
    vi.spyOn(console, "error").mockImplementation(errors);
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Exited(code);
    });
    // Each prompt, if reached, answers yes, so a question asked shows as
    // work done rather than as a hang.
    seen.text.mockResolvedValue("asked@example.com");
    seen.password.mockResolvedValue("asked-password-1234");
    seen.select.mockResolvedValue("accept");
    seen.confirm.mockResolvedValue(true);
    seen.createInterface.mockImplementation(() => ({
      question: (_q: string, answer: (a: string) => void) => answer("y"),
      close: () => {},
    }));
    seen.stepRun.mockResolvedValue(1);
    seen.openRegistry.mockResolvedValue({
      registry: seen.registry,
      adapter: { disconnect: vi.fn().mockResolvedValue(undefined) },
    });
    seen.registry.getCollectionBySlug.mockResolvedValue({
      slug: "nw_posts",
      fields: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const mock of [
      seen.text,
      seen.password,
      seen.select,
      seen.confirm,
      seen.createInterface,
      seen.stepRun,
      seen.reconciled,
      seen.openRegistry,
      ...Object.values(seen.registry),
    ]) {
      mock.mockReset();
    }
    restoreTty(process.stdin, originalTty.stdin);
    restoreTty(process.stdout, originalTty.stdout);
    setNonInteractive(false);
    process.exitCode = undefined;
  });

  const printedError = () =>
    errors.mock.calls.map(call => String(call[0])).join("\n");

  it("users:create-admin asks for nothing and names --email", async () => {
    await createAdminAction(() => recordingContext())({}, new Command());
    expect(seen.text).not.toHaveBeenCalled();
    expect(seen.password).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(printedError()).toContain("--email");
  });

  it("upgrade's backup question is not asked, nothing runs, and --confirm-backed-up is named", async () => {
    await upgradeAction({}, new Command());
    expect(seen.createInterface).not.toHaveBeenCalled();
    expect(seen.stepRun).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(printedError()).toContain("--confirm-backed-up");
  });

  it("upgrade --reconcile-core does not ask, changes nothing, and says the confirmation needs a terminal", async () => {
    await upgradeAction({ reconcileCore: true }, new Command());
    expect(seen.createInterface).not.toHaveBeenCalled();
    expect(seen.reconciled).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(
      [...seen.printed, printedError()].join("\n").toLowerCase()
    ).toContain("this confirmation needs a terminal");
    // Its own code, not the one a "no" typed at the prompt ends with.
    expect(printedError()).toContain("(CORE_DESTRUCTIVE_NEEDS_TERMINAL)");
  });

  it("the schema push's terminal prompts are not shown, and a terminal is asked for", async () => {
    const dispatcher = new ClackTerminalPromptDispatcher(() => {});
    await expect(
      dispatcher.dispatch({
        candidates: [
          {
            tableName: "nw_posts",
            fromColumn: "title",
            toColumn: "headline",
            fromType: "text",
            toType: "text",
            typesCompatible: true,
            preservesValues: true,
            defaultSuggestion: "rename",
          },
        ],
        events: [],
        classification: "interactive",
        channel: "terminal",
      })
    ).rejects.toBeInstanceOf(TTYRequiredError);
    expect(seen.select).not.toHaveBeenCalled();
  });

  it("db:sync --promote does not ask, changes nothing, and names --yes", async () => {
    await expect(
      runPromote("nw_posts", recordingContext())
    ).rejects.toMatchObject({ code: 1 });
    // Refused before the database is opened, not after.
    expect(seen.openRegistry).not.toHaveBeenCalled();
    expect(seen.select).not.toHaveBeenCalled();
    expect(seen.confirm).not.toHaveBeenCalled();
    expect(seen.registry.deleteCollection).not.toHaveBeenCalled();
    expect(printedError()).toContain("--yes");
    expect(printedError()).toContain("(SYNC_CONFIRMATION_REQUIRED)");
  });

  it("db:sync --demote does not ask, changes nothing, and names --yes", async () => {
    await expect(
      runDemote("nw_posts", recordingContext())
    ).rejects.toMatchObject({ code: 1 });
    // Refused before the database is opened, not after.
    expect(seen.openRegistry).not.toHaveBeenCalled();
    expect(seen.confirm).not.toHaveBeenCalled();
    expect(seen.registry.registerCollection).not.toHaveBeenCalled();
    expect(seen.registry.updateCollection).not.toHaveBeenCalled();
    expect(printedError()).toContain("--yes");
    expect(printedError()).toContain("(SYNC_CONFIRMATION_REQUIRED)");
  });

  it("db:sync --promote --yes answers its confirmation yes without asking", async () => {
    await runPromote("nw_posts", recordingContext({ yes: true }));
    expect(seen.select).not.toHaveBeenCalled();
    expect(seen.confirm).not.toHaveBeenCalled();
    expect(seen.registry.deleteCollection).toHaveBeenCalledWith("nw_posts");
  });

  it("db:sync --demote --yes answers its confirmation yes without asking", async () => {
    seen.registry.getCollectionBySlug.mockResolvedValue(null);
    await runDemote("nw_posts", recordingContext({ yes: true }));
    expect(seen.confirm).not.toHaveBeenCalled();
    expect(seen.registry.registerCollection).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "nw_posts", source: "ui" })
    );
  });
});

// ── as a shell runs it ──────────────────────────────────────────────────────

/**
 * How long a refusal may take. Each run compiles the CLI from source, which
 * takes most of this; a command waiting on its open stdin never ends, and
 * the run is killed at `NEXTLY_RUN_TIMEOUT`, far past it.
 */
const ENDS_WITHIN_MS = 45_000;

const CONFIG_WITH = (collections: string) => `
export default {
  collections: [${collections}],
  db: { migrationsDir: "./migrations" },
};
`;

const POSTS = `{ slug: "nw_posts", fields: [{ name: "title", type: "text" }] }`;

// The configuration loader's compile cache: every command that loads the
// configuration writes it, and it holds nothing of the project's own.
const LOADER_CACHE = join("node_modules", ".cache");

/** Every file under `folder` with its bytes, the database's and the loader cache aside. */
function folderState(folder: string, except: string): Record<string, string> {
  const state: Record<string, string> = {};
  for (const name of readdirSync(folder, { recursive: true })) {
    const path = join(folder, String(name));
    if (path === except || path.startsWith(`${except}-`)) continue;
    if (
      String(name) === "node_modules" ||
      String(name).startsWith(LOADER_CACHE)
    )
      continue;
    state[String(name)] = statSync(path).isDirectory()
      ? "<dir>"
      : readFileSync(path, "base64");
  }
  return state;
}

/**
 * Every table in the SQLite file with its rows, or null when there is no file.
 * The schema locks' own tables are left out: taking a lock creates them, and
 * a command that refuses under its lock still took it. What matters of them
 * is that the lock was let go, which `expectRefusal` checks on its own.
 */
function databaseState(file: string): Record<string, unknown[]> | null {
  try {
    statSync(file);
  } catch {
    return null;
  }
  const db = new Database(file, { readonly: true });
  try {
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all() as Array<{ name: string }>
    ).filter(({ name }) => !LOCK_TABLES.includes(name));
    return Object.fromEntries(
      tables.map(({ name }) => [
        name,
        db.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).all(),
      ])
    );
  } finally {
    db.close();
  }
}

/** The schema locks' bookkeeping tables. */
const LOCK_TABLES = ["nextly_schema_lock", "nextly_field_group_lock"];

/** Each lock's holder in the SQLite file: null for a lock let go. */
function lockHolders(file: string): unknown[] {
  try {
    statSync(file);
  } catch {
    return [];
  }
  const db = new Database(file, { readonly: true });
  try {
    const present = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map(({ name }) => name)
    );
    return LOCK_TABLES.filter(name => present.has(name)).flatMap(name =>
      (
        db.prepare(`SELECT owner FROM "${name}"`).all() as Array<{
          owner: unknown;
        }>
      ).map(row => row.owner)
    );
  } finally {
    db.close();
  }
}

describe("a command run with no terminal", () => {
  let project: string;
  let dbFile: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "nextly-never-waits-"));
    dbFile = join(project, "data.db");
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  const nextly = (args: string[]) =>
    runNextly(args, project, {
      DATABASE_URL: `file:${dbFile}`,
      DB_DIALECT: undefined,
      CI: undefined,
    });

  /** A database the command must leave as it is: one table with a row. */
  function seedDatabase() {
    const db = new Database(dbFile);
    db.exec("CREATE TABLE nw_keep (id INTEGER PRIMARY KEY, note TEXT)");
    db.exec("INSERT INTO nw_keep (note) VALUES ('still here')");
    db.close();
  }

  /**
   * Runs `args` and asserts the refusal: it ended on its own within the
   * bound, exited 1, named `answer`, and changed neither the folder nor the
   * database.
   */
  async function expectRefusal(args: string[], answer: string) {
    const folderBefore = folderState(project, dbFile);
    const databaseBefore = databaseState(dbFile);
    const started = Date.now();
    const run = await nextly(args);
    const took = Date.now() - started;
    const output = `${run.stdout}\n${run.stderr}`;
    expect(took, output).toBeLessThan(ENDS_WITHIN_MS);
    expect(run.status, output).toBe(1);
    expect(output).toContain(answer);
    expect(folderState(project, dbFile)).toEqual(folderBefore);
    expect(databaseState(dbFile)).toEqual(databaseBefore);
    expect(lockHolders(dbFile).filter(owner => owner !== null)).toEqual([]);
  }

  /** The project's collection, made and applied by the CLI itself. */
  async function appliedPosts() {
    writeFileSync(join(project, "nextly.config.ts"), CONFIG_WITH(POSTS));
    const created = await nextly(["migrate:create", "posts"]);
    expect(created.status, `${created.stdout}\n${created.stderr}`).toBe(0);
    const applied = await nextly(["migrate"]);
    expect(applied.status, `${applied.stdout}\n${applied.stderr}`).toBe(0);
    expect(databaseState(dbFile)).toHaveProperty("dc_nw_posts");
  }

  /** The project's collection, pushed and registered by `db:sync`. */
  async function syncedPosts() {
    writeFileSync(join(project, "nextly.config.ts"), CONFIG_WITH(POSTS));
    const synced = await nextly(["db:sync"]);
    expect(synced.status, `${synced.stdout}\n${synced.stderr}`).toBe(0);
    expect(databaseState(dbFile)).toHaveProperty("dc_nw_posts");
  }

  it(
    "init stops before writing anything and names --yes",
    async () => {
      await expectRefusal(["init"], "--yes");
    },
    NEXTLY_RUN_TIMEOUT
  );

  it(
    "users:create-admin with no --email asks for nothing and names --email",
    async () => {
      writeFileSync(join(project, "nextly.config.ts"), CONFIG_WITH(""));
      seedDatabase();
      await expectRefusal(["users:create-admin"], "--email");
    },
    NEXTLY_RUN_TIMEOUT
  );

  it(
    "users:create-admin with no password asks for none and names NEXTLY_ADMIN_PASSWORD",
    async () => {
      writeFileSync(join(project, "nextly.config.ts"), CONFIG_WITH(""));
      seedDatabase();
      await expectRefusal(
        ["users:create-admin", "--email", "admin@example.com", "--name", "Ada"],
        "NEXTLY_ADMIN_PASSWORD"
      );
    },
    NEXTLY_RUN_TIMEOUT
  );

  it(
    "upgrade does not ask whether the database is backed up, and names --confirm-backed-up",
    async () => {
      writeFileSync(join(project, "nextly.config.ts"), CONFIG_WITH(""));
      seedDatabase();
      await expectRefusal(["upgrade"], "--confirm-backed-up");
    },
    NEXTLY_RUN_TIMEOUT
  );

  it(
    "migrate:fresh does not ask to drop every table, and names --accept-data-loss",
    async () => {
      writeFileSync(join(project, "nextly.config.ts"), CONFIG_WITH(POSTS));
      seedDatabase();
      await expectRefusal(["migrate:fresh"], "--accept-data-loss");
    },
    NEXTLY_RUN_TIMEOUT
  );

  it(
    "migrate:down does not ask to drop what the migration made, and names --accept-data-loss",
    async () => {
      await appliedPosts();
      await expectRefusal(["migrate:down"], "--accept-data-loss");
    },
    4 * NEXTLY_RUN_TIMEOUT
  );

  it(
    "prune does not ask to drop a collection the config no longer has, and names --accept-data-loss",
    async () => {
      // `migrate` leaves no registry row, which is what prune reads; a
      // `db:sync` registers the collection it pushes.
      await syncedPosts();
      writeFileSync(join(project, "nextly.config.ts"), CONFIG_WITH(""));
      await expectRefusal(["prune"], "--accept-data-loss");
    },
    4 * NEXTLY_RUN_TIMEOUT
  );

  it.each(["--promote", "--demote"])(
    "db:sync %s with no slug names the slug it needs",
    async flag => {
      writeFileSync(join(project, "nextly.config.ts"), CONFIG_WITH(POSTS));
      await expectRefusal(["db:sync", flag], `${flag} <slug>`);
    },
    NEXTLY_RUN_TIMEOUT
  );

  it.todo(
    "plugins uninstall does not ask to drop the plugin's tables (needs an installed plugin the scratch project can resolve)"
  );
});
