/**
 * A command that may finish without a database starts with a line of its
 * own, and names its database only when it reaches one.
 *
 * `setup-token --generate` touches nothing, and `webhooks:prune` with
 * retention switched off ends before connecting. A prune that will delete
 * still names its database before it asks to. Each runs here through the
 * real program and its real action, in a folder whose `.env` names a SQLite
 * database, and what it wrote is read back. The project's config is handed
 * over resolved as the loader resolves it (`sanitizeConfig`), since the test
 * runner cannot load a `nextly.config.ts` the way the CLI does.
 *
 * What would separate a correct program from a broken one:
 * - a run that reaches no database printing `Database: …` all the same (the
 *   line the program prints first for a command declared to use one);
 * - a start line missing, or another line first;
 * - the `Database: …` line lost from a run that does reach its database,
 *   which the dry runs here are the control for;
 * - consent to delete asked before the run says which database it deletes from.
 *
 * That the start line comes before the command's code loads is held for every
 * command by `first-line-before-loading.test.ts`.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Command } from "commander";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { NextlyConfig } from "../../config";
import { loadCliEnvironment } from "../environment";
import { createProgram } from "../program";

/** The project's config the next run loads, as written in `nextly.config.ts`. */
const project = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));
vi.mock("../utils/config-loader", async importOriginal => {
  const { sanitizeConfig } = await import("../../config");
  return {
    ...(await importOriginal<typeof import("../utils/config-loader")>()),
    loadConfig: async () => ({
      config: sanitizeConfig(project.config as NextlyConfig),
      dependencies: [],
    }),
  };
});

/** What standard error held when a run asked for consent to delete, and the run's stderr so far. */
const consent = vi.hoisted(() => ({
  stderr: "",
  asked: undefined as string | undefined,
}));
vi.mock("../utils/data-loss-consent", async importOriginal => ({
  ...(await importOriginal<typeof import("../utils/data-loss-consent")>()),
  // The question is where the run stops: nothing is deleted, nothing connected.
  judgeDataLossWithGrace: async () => {
    consent.asked = consent.stderr;
    throw new Error("exit at the consent");
  },
}));

/** The variables the environment step may set, put back after the file. */
const KEPT = [
  "DATABASE_URL",
  "DB_DIALECT",
  "NODE_ENV",
  "NEXTLY_TELEMETRY_DISABLED",
  "XDG_CONFIG_HOME",
] as const;

const DATABASE_LINE = /^Database: SQLite .*start-line\.db \(/;

let folder: string;
let kept: Partial<Record<(typeof KEPT)[number], string>>;

beforeAll(() => {
  kept = Object.fromEntries(KEPT.map(name => [name, process.env[name]]));
  folder = realpathSync(mkdtempSync(join(tmpdir(), "nextly-start-line-")));
  writeFileSync(
    join(folder, ".env"),
    "DB_DIALECT=sqlite\nDATABASE_URL=file:./start-line.db\n"
  );
  // Once, before the first run: Next.js's loader reads the files on its first
  // call and hands later calls what it read then, so what it set stays set.
  delete process.env.DATABASE_URL;
  delete process.env.DB_DIALECT;
  process.env.XDG_CONFIG_HOME = folder;
  process.env.NEXTLY_TELEMETRY_DISABLED = "1";
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  // Next.js's types declare NODE_ENV read-only, yet its loader sets it, so it
  // is put back like the others through the environment's plain record.
  const env: Record<string, string | undefined> = process.env;
  for (const name of KEPT) {
    if (kept[name] === undefined) delete env[name];
    else env[name] = kept[name];
  }
  rmSync(folder, { recursive: true, force: true });
});

/** The project's config, for the runs that read one. */
function useConfig(config: Record<string, unknown>): void {
  project.config = config;
}

/** What a run wrote, and how it ended. */
interface Run {
  /** The lines it wrote to standard error that are not blank, in order. */
  lines: string[];
  /** Everything it wrote to either stream, and its exit, for a failure's message. */
  said: string;
  /** Whether its output holds `text` on either stream. */
  says(text: string): boolean;
}

/**
 * Runs `args` through the real program and the command's real action, in the
 * test's folder. A run the action ends with `process.exit` stops there.
 */
async function run(args: readonly string[]): Promise<Run> {
  const program = createProgram({
    beforeAction: (parsed: Command) =>
      loadCliEnvironment(parsed.opts<{ mode?: string }>().mode, folder),
  });
  let stderr = "";
  let stdout = "";
  consent.stderr = "";
  consent.asked = undefined;
  vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
    stderr += String(chunk);
    consent.stderr = stderr;
    return true;
  });
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    stdout += String(chunk);
    return true;
  });
  // The command's logger writes through the console, which the test runner
  // takes before it reaches the streams; its output is the run's own.
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
      stdout += `${parts.map(String).join(" ")}\n`;
    });
  }
  vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  const ended = await program
    .parseAsync(["node", "nextly", "--cwd", folder, ...args])
    .then(
      () => "returned",
      (error: unknown) => {
        if (!(error as Error).message.startsWith("exit ")) throw error;
        return (error as Error).message;
      }
    );
  const all = `${stderr}${stdout}`;
  return {
    lines: stderr
      .split("\n")
      .map(line => line.trim())
      .filter(line => line !== ""),
    said: `${all}\n(${ended})`,
    says: text => all.includes(text),
  };
}

describe("a command that may finish without a database starts with its own line", () => {
  it("setup-token --generate says what it is doing and names no database", async () => {
    const { lines, said, says } = await run(["setup-token", "--generate"]);

    expect(lines[0], said).toBe("Setting up the setup token...");
    // The run reached its answer, so the missing line is one it never printed.
    expect(says("NEXTLY_SETUP_TOKEN="), said).toBe(true);
    expect(
      lines.filter(line => line.startsWith("Database:")),
      said
    ).toEqual([]);
  });

  it("setup-token --dry-run names its database once it reaches it", async () => {
    useConfig({});
    const { lines, said } = await run(["setup-token", "--dry-run"]);

    expect(lines[0], said).toBe("Setting up the setup token...");
    expect(
      lines.filter(line => DATABASE_LINE.test(line)),
      said
    ).toHaveLength(1);
  });

  it("webhooks:prune with retention switched off names no database", async () => {
    useConfig({ webhooks: { retention: false } });
    const { lines, said, says } = await run(["webhooks:prune"]);

    expect(lines[0], said).toBe("Pruning webhook deliveries...");
    // The run reached its answer, so the missing line is one it never printed.
    expect(says("Webhook retention is disabled"), said).toBe(true);
    expect(
      lines.filter(line => line.startsWith("Database:")),
      said
    ).toEqual([]);
  });

  it("webhooks:prune names its database before it asks to delete from it", async () => {
    useConfig({});
    const { lines, said } = await run(["webhooks:prune"]);

    expect(lines[0], said).toBe("Pruning webhook deliveries...");
    expect(consent.asked, `${said}\n(consent never asked)`).toBeDefined();
    expect(
      (consent.asked ?? "")
        .split("\n")
        .filter(line => DATABASE_LINE.test(line)),
      said
    ).toHaveLength(1);
  });

  it("webhooks:prune --dry-run names its database once it reaches it", async () => {
    useConfig({});
    const { lines, said } = await run(["webhooks:prune", "--dry-run"]);

    expect(lines[0], said).toBe("Pruning webhook deliveries...");
    expect(
      lines.filter(line => DATABASE_LINE.test(line)),
      said
    ).toHaveLength(1);
  });
});
