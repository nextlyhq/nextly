import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createContext } from "../context";
import { dryRunLines } from "../dry-run";

import { buildInstallArgs, runAdd } from "./add";

// The code the package manager ends with, and the commands it was run as.
const install = vi.hoisted(() => ({
  code: 0 as number | null,
  runs: [] as string[][],
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    spawn: (command: string, args: string[]) => {
      install.runs.push([command, ...args]);
      const child = new EventEmitter();
      setImmediate(() => child.emit("close", install.code));
      return child;
    },
  };
});

// `../program` imports every command; `add` needs only its context factory.
vi.mock("../program", async () => ({
  createContext: (await import("../context")).createContext,
}));

class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${String(code)}`);
  }
}

describe("buildInstallArgs (nextly add, D70)", () => {
  it("uses `add` for pnpm/yarn and `install` for npm", () => {
    expect(buildInstallArgs("pnpm", "@acme/p", false)).toEqual([
      "add",
      "@acme/p",
    ]);
    expect(buildInstallArgs("yarn", "@acme/p", false)).toEqual([
      "add",
      "@acme/p",
    ]);
    expect(buildInstallArgs("npm", "@acme/p", false)).toEqual([
      "install",
      "@acme/p",
    ]);
  });

  it("inserts the dev flag before the package", () => {
    expect(buildInstallArgs("pnpm", "@acme/p", true)).toEqual([
      "add",
      "-D",
      "@acme/p",
    ]);
    expect(buildInstallArgs("npm", "@acme/p", true)).toEqual([
      "install",
      "-D",
      "@acme/p",
    ]);
  });
});

describe("nextly add, when the install fails", () => {
  let project: string;
  let output: string[];

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "nextly-add-"));
    // The lockfile picks the package manager.
    await writeFile(join(project, "pnpm-lock.yaml"), "");
    install.runs = [];
    output = [];
    const record = (...parts: unknown[]) => {
      output.push(parts.map(String).join(" "));
    };
    vi.spyOn(console, "log").mockImplementation(record);
    vi.spyOn(console, "error").mockImplementation(record);
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Exited(code === undefined ? undefined : Number(code));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(project, { recursive: true, force: true });
  });

  /** Runs `nextly add @acme/p`, returning the exit code it ended with. */
  async function add(): Promise<number | undefined> {
    try {
      await runAdd(
        "@acme/p",
        { cwd: project },
        createContext({ noColor: true })
      );
      return undefined;
    } catch (error) {
      if (error instanceof Exited) return error.code;
      throw error;
    }
  }

  it("exits 1 whatever code the package manager ended with, naming it", async () => {
    install.code = 254;
    expect(await add()).toBe(1);
    expect(install.runs).toEqual([["pnpm", "add", "@acme/p"]]);
    const printed = output.join("\n");
    expect(printed).toMatch(/pnpm exited [^\n]*254/);
    expect(printed).toContain("(PACKAGE_INSTALL_FAILED)");
  });

  it("exits 1 when the package manager was stopped without a code", async () => {
    install.code = null;
    expect(await add()).toBe(1);
  });

  it("does not exit when the install succeeds", async () => {
    install.code = 0;
    expect(await add()).toBeUndefined();
  });
});

describe("nextly add --dry-run", () => {
  let project: string;
  let output: string[];

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "nextly-add-dry-"));
    await writeFile(join(project, "pnpm-lock.yaml"), "");
    install.runs = [];
    install.code = 0;
    output = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      output.push(parts.map(String).join(" "));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(project, { recursive: true, force: true });
  });

  /** What the logger printed as info, without its symbol. */
  const info = () =>
    output.filter(line => line.startsWith("ℹ ")).map(line => line.slice(2));

  it("names the install command it would run, runs nothing, and shows the wiring", async () => {
    await runAdd(
      "@acme/p",
      { cwd: project, dev: true, dryRun: true },
      createContext({ noColor: true })
    );

    expect(install.runs).toEqual([]);
    expect(info().slice(-2)).toEqual(
      dryRunLines({
        changes: [{ action: "run", target: "pnpm add -D @acme/p" }],
      })
    );
    expect(output.join("\n")).toContain('import p from "@acme/p";');
  });

  it("with --skip-install, says nothing would change and still shows the wiring", async () => {
    await runAdd(
      "@acme/p",
      { cwd: project, skipInstall: true, dryRun: true },
      createContext({ noColor: true })
    );

    expect(install.runs).toEqual([]);
    expect(info().slice(-2)).toEqual(dryRunLines({ changes: [] }));
    expect(output.join("\n")).toContain('import p from "@acme/p";');
  });

  it("runs the same command it names when not a dry run", async () => {
    await runAdd(
      "@acme/p",
      { cwd: project, dev: true },
      createContext({ noColor: true })
    );

    expect(install.runs).toEqual([["pnpm", "add", "-D", "@acme/p"]]);
    expect(info()).not.toContain("Dry run: nothing was changed.");
  });
});
