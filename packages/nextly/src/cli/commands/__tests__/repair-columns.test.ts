/**
 * `nextly repair-columns` as the CLI runs it: what reaches standard output, and the exit code.
 *
 * With `--json` standard output holds the one document and nothing else, whatever the run met; the
 * error shape goes to standard error only without it. These cases stop before any database is
 * reached; the report of a database is the integration suite's.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command as CommanderCommand, type Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createContext } from "../../context";
import { repairColumnsAction } from "../repair-columns";
import { registerRepairColumnsCommand } from "../repair-columns.command";

/** What the command was given, as Commander would hand it over. */
const command = (globals: Record<string, unknown>) =>
  ({ optsWithGlobals: () => globals }) as unknown as Command;

describe("repair-columns output and exit code", () => {
  let stdout: string[];
  let stderr: string[];
  const env = {
    url: process.env.DATABASE_URL,
    dialect: process.env.DB_DIALECT,
  };

  beforeEach(() => {
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.join(" "));
    });
    vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
      stderr.push(String(chunk));
      return true;
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderr.push(args.join(" "));
    });
    delete process.env.DATABASE_URL;
    delete process.env.DB_DIALECT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    if (env.url !== undefined) process.env.DATABASE_URL = env.url;
    if (env.dialect !== undefined) process.env.DB_DIALECT = env.dialect;
  });

  it("with --json, writes one document and nothing else to standard output, and exits 1 when it could not run", async () => {
    await repairColumnsAction(createContext)(
      { json: true },
      command({ cwd: process.cwd() })
    );
    expect(stdout).toHaveLength(1);
    const document = JSON.parse(stdout[0]) as Record<string, unknown>;
    expect(document).toMatchObject({
      schema: "nextly.repair-columns/1",
      command: "repair-columns",
      ok: false,
      exitCode: 1,
      result: null,
    });
    expect(document.errors).toEqual([
      expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
      }),
    ]);
    expect(process.exitCode).toBe(1);
  });

  // Loading the configuration and opening the database log through the run's logger, which
  // writes to standard output; under --json it keeps to errors, which go to standard error.
  it("with --json, keeps whatever the run logs off standard output", async () => {
    let logger: ReturnType<typeof createContext>["logger"] | undefined;
    await repairColumnsAction(options => {
      const context = createContext(options);
      logger = context.logger;
      return context;
    })({ json: true }, command({ cwd: process.cwd() }));
    stdout = [];
    logger?.info("Loading the configuration");
    logger?.warn("A notice");
    logger?.success("Connected");
    expect(stdout).toEqual([]);
  });

  // `--verbose` turns on the configuration loader's own diagnostics, which it writes with
  // console.log; under --json they would come before the document.
  it("with --json and --verbose, still writes only the document to standard output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repair-columns-json-"));
    process.env.DATABASE_URL = `file:${join(dir, "site.db")}`;
    process.env.DB_DIALECT = "sqlite";
    try {
      await repairColumnsAction(createContext)(
        { json: true },
        command({ cwd: dir, verbose: true })
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0])).toMatchObject({
      schema: "nextly.repair-columns/1",
    });
  });

  it("declares --apply, off unless given, and says what it does", () => {
    const program = new CommanderCommand();
    registerRepairColumnsCommand(program, createContext);
    const declared = program.commands.find(c => c.name() === "repair-columns");
    const apply = declared?.options.find(o => o.long === "--apply");
    expect(apply?.defaultValue).toBe(false);
    expect(apply?.description).toMatch(/convert/i);
    expect(declared?.description()).toMatch(/--apply/);
  });

  it("declares --lock-timeout and --lock-timeout-total, the bounds of the wait for a busy table", () => {
    const program = new CommanderCommand();
    registerRepairColumnsCommand(program, createContext);
    const declared = program.commands.find(c => c.name() === "repair-columns");
    const longs = declared?.options.map(o => o.long) ?? [];
    expect(longs).toContain("--lock-timeout");
    expect(longs).toContain("--lock-timeout-total");
  });

  it("refuses a --lock-timeout outside its range before anything runs, as a run that could not run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repair-columns-bounds-"));
    process.env.DATABASE_URL = `file:${join(dir, "site.db")}`;
    process.env.DB_DIALECT = "sqlite";
    try {
      await repairColumnsAction(createContext)(
        { json: true, lockTimeout: "0" },
        command({ cwd: dir })
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(stdout).toHaveLength(1);
    const document = JSON.parse(stdout[0]) as {
      exitCode: number;
      errors: Array<{ message: string }>;
    };
    expect(document.exitCode).toBe(1);
    expect(document.errors[0]?.message).toMatch(/--lock-timeout/);
  });

  it("without --json, prints the error shape to standard error and nothing to standard output", async () => {
    await repairColumnsAction(createContext)(
      {},
      command({ cwd: process.cwd() })
    );
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toMatch(/DATABASE_URL/);
    expect(process.exitCode).toBe(1);
  });
});
