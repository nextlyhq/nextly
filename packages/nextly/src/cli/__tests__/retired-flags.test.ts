/**
 * The retired `--force` spellings. Each one is honoured for one release, with
 * a notice naming the spelling that replaces it, and kept out of the help:
 * `migrate:fresh -f/--force` and `prune --force` are the data-loss consent
 * `--accept-data-loss`, and `generate:widget --force` is `--overwrite`.
 * `db:sync -f/--force` never did anything, so it is refused, naming
 * `--accept-data-loss`, before the sync starts. `migrate:fresh --yes` never
 * consents to deleting data, so it is refused the same way, at a terminal or
 * not, before the database is reached. `nextly init` is retired whole,
 * so its `-f/--force` keeps overwriting with no notice of its own.
 *
 * Each command is declared as the program declares it and run through
 * Commander, so the spelling is read by the option parser the CLI uses; the
 * database and the configuration are fakes, and what the run reached is read
 * off them.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { consentCovers } from "../../domains/schema/migrate/data-loss-consent";
import { registerDbSyncCommand } from "../commands/db-sync.command";
import { registerGenerateWidgetCommand } from "../commands/generate-widget.command";
import { registerInitCommand } from "../commands/init.command";
import { registerMigrateFreshCommand } from "../commands/migrate-fresh.command";
import { pruneConsent } from "../commands/prune";
import { registerPruneCommand } from "../commands/prune.command";

/** The version of the nextly these tests run, which a site's widget SDK must match. */
const NEXTLY_VERSION = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, "../../../package.json"), "utf8")
  ) as { version: string }
).version;

const connect = vi.hoisted(() => vi.fn());
const configRead = vi.hoisted(() => vi.fn());

// `../program` imports every command; a command run here needs only its
// context factory, which is the context module's.
vi.mock("../program", async () => ({
  createContext: (await import("../context")).createContext,
}));

// `migrate` is the largest command module, and nothing here runs it.
// Only the run itself is stood in for: what migrate:fresh reads from the module besides it
// (its exit status for a failure) stays the real one.
vi.mock("../commands/migrate", async importOriginal => ({
  ...(await importOriginal<typeof import("../commands/migrate")>()),
  runMigrate: vi.fn(),
}));

vi.mock("../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: "sqlite",
    databaseUrl: ":memory:",
    errors: [],
  }),
  getDialectDisplayName: () => "SQLite",
  // Reached only once a run is past its consent; the test stops there.
  createCliAdapter: connect,
}));

vi.mock("../utils/config-loader", () => ({
  loadConfig: configRead,
}));

class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${String(code)}`);
  }
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

let output: string[] = [];
let saved: { consent?: string; ci?: string };

beforeEach(() => {
  output = [];
  saved = {
    consent: process.env.NEXTLY_ACCEPT_DATA_LOSS,
    ci: process.env.CI,
  };
  delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
  // No terminal, so nothing is asked: a run either has what it needs or stops.
  terminal(false);
  connect.mockReset();
  connect.mockRejectedValue(new Error("connected"));
  configRead.mockReset();
  configRead.mockResolvedValue({ config: { db: {} }, configPath: undefined });
  const record = (...parts: unknown[]) => {
    output.push(parts.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(record);
  vi.spyOn(console, "error").mockImplementation(record);
  vi.spyOn(console, "warn").mockImplementation(record);
  vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Exited(code === undefined ? undefined : Number(code));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreTerminal();
  for (const [name, value] of [
    ["NEXTLY_ACCEPT_DATA_LOSS", saved.consent],
    ["CI", saved.ci],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** A program declaring one command as the CLI does, with the global options it reads. */
function program(register: (root: Command) => void): Command {
  const root = new Command()
    .exitOverride()
    .option("-c, --config <path>")
    .option("--cwd <path>")
    .option("--verbose", "", false)
    .option("-q, --quiet", "", false);
  register(root);
  return root;
}

/** Runs `args` through `root`, returning the exit code it ended with, if any. */
async function run(root: Command, args: string[]): Promise<number | undefined> {
  try {
    await root.parseAsync(args, { from: "user" });
    return undefined;
  } catch (error) {
    if (error instanceof Exited) return error.code;
    throw error;
  }
}

function help(root: Command, name: string): string {
  const command = root.commands.find(c => c.name() === name);
  if (!command) throw new Error(`no command ${name}`);
  return command.helpInformation();
}

const printed = () => output.join("\n");

describe("migrate:fresh -f/--force", () => {
  it.each([["-f"], ["--force"]])(
    "%s consents to dropping every table, naming --accept-data-loss",
    async spelling => {
      const root = program(registerMigrateFreshCommand);
      await run(root, ["migrate:fresh", spelling]);
      // With no terminal and no other consent, only the spelling lets the run
      // reach the database.
      expect(connect).toHaveBeenCalled();
      expect(printed()).toMatch(
        /migrate:fresh's --force is deprecated and will be removed: use --accept-data-loss/
      );
    }
  );

  it("is not listed in the help", () => {
    const text = help(program(registerMigrateFreshCommand), "migrate:fresh");
    expect(text).toContain("--accept-data-loss");
    expect(text).not.toContain("--force");
    expect(text).not.toMatch(/-f,/);
  });
});

describe("migrate:fresh --yes", () => {
  it.each([
    ["with no terminal", false],
    ["at a terminal", true],
  ])(
    "is refused %s, before the database is reached, naming --accept-data-loss",
    async (_where, attached) => {
      terminal(attached);
      const code = await run(program(registerMigrateFreshCommand), [
        "migrate:fresh",
        "--yes",
      ]);
      expect(code).toBe(1);
      expect(connect).not.toHaveBeenCalled();
      expect(printed()).toContain(
        "--yes does not consent to deleting data: give --accept-data-loss (or NEXTLY_ACCEPT_DATA_LOSS)"
      );
      expect(printed()).toContain("(INPUT_REFUSED)");
    }
  );

  it("is not listed in the help", () => {
    const text = help(program(registerMigrateFreshCommand), "migrate:fresh");
    expect(text).not.toContain("--yes");
  });
});

describe("prune --force", () => {
  it("is the consent to dropping an orphan, naming --accept-data-loss", async () => {
    const root = program(registerPruneCommand);
    const prune = root.commands.find(c => c.name() === "prune");
    // The options Commander hands the action, without running it.
    prune?.action(() => {});
    await run(root, ["prune", "--force"]);
    const warn = vi.fn();
    const consent = pruneConsent(prune?.opts() ?? {}, warn);
    expect(consentCovers(consent, { kind: "table", table: "dc_a" })).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /prune's --force is deprecated and will be removed: use --accept-data-loss/
      )
    );
  });

  it("is not listed in the help", () => {
    const text = help(program(registerPruneCommand), "prune");
    expect(text).toContain("--accept-data-loss");
    expect(text).not.toContain("--force");
  });
});

describe("generate:widget --force", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nextly-retired-force-"));
    await writeFile(
      join(dir, "nextly.config.ts"),
      'import { defineConfig } from "nextly/config";\n\nexport default defineConfig({\n  collections: [],\n});\n'
    );
    await writeFile(
      join(dir, "package.json"),
      `${JSON.stringify({ name: "app", dependencies: { nextly: NEXTLY_VERSION } })}\n`
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const declaration = () =>
    join(dir, "src", "dashboard", "open-orders.widget.ts");

  it("overwrites files that exist, naming --overwrite", async () => {
    const generate = (...flags: string[]) =>
      run(program(registerGenerateWidgetCommand), [
        "--cwd",
        dir,
        "generate:widget",
        "open-orders",
        "--no-collection",
        ...flags,
      ]);
    expect(await generate("--view", "figure")).toBeUndefined();
    await writeFile(declaration(), "// mine\n");
    output = [];
    expect(await generate("--view", "list", "--force")).toBeUndefined();
    expect(await readFile(declaration(), "utf8")).toContain('view: "list"');
    expect(printed()).toMatch(
      /generate:widget's --force is deprecated and will be removed: use --overwrite/
    );
  });

  it("is not listed in the help, which lists --overwrite", () => {
    const text = help(
      program(registerGenerateWidgetCommand),
      "generate:widget"
    );
    expect(text).toContain("--overwrite");
    expect(text).not.toContain("--force");
  });
});

describe("db:sync -f/--force", () => {
  it.each([["-f"], ["--force"]])(
    "%s is refused before the sync starts, naming --accept-data-loss",
    async spelling => {
      const code = await run(program(registerDbSyncCommand), [
        "db:sync",
        spelling,
      ]);
      expect(code).toBe(1);
      // Refused before the configuration is read or the database reached.
      expect(configRead).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
      expect(printed()).toMatch(/db:sync's --force .*--accept-data-loss/s);
    }
  );

  it("is not listed in the help", () => {
    const text = help(program(registerDbSyncCommand), "db:sync");
    expect(text).not.toContain("--force");
    expect(text).not.toMatch(/-f,/);
  });
});

describe("nextly init --force", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nextly-init-force-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("overwrites the existing configuration, with no notice about the flag", async () => {
    await writeFile(join(dir, "nextly.config.ts"), "// mine\n");
    const code = await run(program(registerInitCommand), [
      "--cwd",
      dir,
      "init",
      "--yes",
      "--force",
    ]);
    expect(code).toBeUndefined();
    expect(await readFile(join(dir, "nextly.config.ts"), "utf8")).not.toBe(
      "// mine\n"
    );
    expect(printed()).not.toMatch(/--force (is|was) (deprecated|retired)/);
    expect(printed()).not.toMatch(/use --(overwrite|accept-data-loss)/);
  });
});
