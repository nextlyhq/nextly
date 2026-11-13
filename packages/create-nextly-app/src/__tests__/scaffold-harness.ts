/**
 * Runs the real `create-nextly-app` program in-process against a temporary
 * folder, with fake package managers first on PATH. Each fake records the
 * arguments it was run with and, for `install`, writes its own lockfile, so a
 * test sees which manager installed, with what, and what it left behind,
 * offline and in milliseconds. The prompts and telemetry are mocked by the
 * test file itself (vi.mock is per file); this module only reads what they
 * recorded.
 */
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { vi } from "vitest";

import { buildProgram } from "../program";

/** The repository's templates, read in place so nothing is downloaded. */
export const TEMPLATES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates"
);

/** The version each fake manager reports. */
export const FAKE_VERSIONS = {
  npm: "10.9.0",
  pnpm: "10.18.0",
  yarn: "4.9.2",
  bun: "1.1.30",
} as const;

export const LOCKFILES = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
  bun: "bun.lock",
} as const;

export const USER_AGENTS = {
  npm: "npm/10.9.0 node/v24.21.0 linux x64",
  pnpm: "pnpm/10.18.0 npm/? node/v24.21.0 linux x64",
  yarn: "yarn/4.9.2 npm/? node/v24.21.0 linux x64",
  bun: "bun/1.1.30 npm/? node/v24.21.0 linux x64",
} as const;

export type Manager = keyof typeof FAKE_VERSIONS;

const FAKE_PM = `
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const [manager, ...args] = process.argv.slice(2);
appendFileSync(process.env.FAKE_PM_LOG, JSON.stringify({ manager, args, cwd: process.cwd() }) + "\\n");
const versions = ${JSON.stringify(FAKE_VERSIONS)};
const lockfiles = ${JSON.stringify(LOCKFILES)};
if (args[0] === "--version" || args[0] === "-v") {
  process.stdout.write(versions[manager] + "\\n");
} else if (args[0] === "install" || args[0] === "add" || args[0] === "i") {
  // A tool that fails quoting a value it was given, as a driver may.
  if (process.env.FAKE_PM_FAIL_WITH) {
    process.stderr.write("install failed: " + process.env.FAKE_PM_FAIL_WITH + "\\n");
    process.exit(1);
  }
  writeFileSync(path.join(process.cwd(), lockfiles[manager]), "fake lockfile\\n");
}
`;

export interface FakeRun {
  /** Every call to a fake manager, in order. */
  calls(): Promise<{ manager: string; args: string[]; cwd: string }[]>;
}

/** Puts npm, pnpm, Yarn and Bun fakes first on PATH; undone by restoreEnv. */
export async function installFakeManagers(dir: string): Promise<FakeRun> {
  const bin = path.join(dir, "fake-bin");
  const log = path.join(dir, "fake-pm.log");
  await mkdir(bin, { recursive: true });
  await writeFile(log, "");
  await writeFile(path.join(bin, "fake-pm.mjs"), FAKE_PM);
  for (const manager of Object.keys(FAKE_VERSIONS)) {
    const unix = path.join(bin, manager);
    await writeFile(
      unix,
      `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-pm.mjs" ${manager} "$@"\n`
    );
    await chmod(unix, 0o755);
    await writeFile(
      path.join(bin, `${manager}.cmd`),
      `@"${process.execPath}" "%~dp0fake-pm.mjs" ${manager} %*\r\n`
    );
  }
  vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH ?? ""}`);
  vi.stubEnv("FAKE_PM_LOG", log);
  return {
    async calls() {
      const text = await readFile(log, "utf-8");
      return text
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line) as never);
    },
  };
}

export async function makeWorkdir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

/**
 * Runs `create-nextly-app <args>` in `cwd`, with `stdin` as its standard input
 * (no terminal unless `tty`). Resolves with the exit code: 0 when the action
 * returned, otherwise the code `process.exit` was called with.
 */
export async function runCli(
  args: string[],
  options: { cwd: string; stdin?: string; tty?: boolean }
): Promise<number> {
  const input = Readable.from(
    options.stdin === undefined ? [] : [options.stdin]
  ) as Readable & { isTTY?: boolean };
  if (options.tty) input.isTTY = true;
  vi.spyOn(process, "cwd").mockReturnValue(options.cwd);
  let exitCode: number | undefined;
  vi.spyOn(process, "exit").mockImplementation(code => {
    exitCode ??= Number(code ?? 0);
    throw new ExitCalled(Number(code ?? 0));
  });
  process.exitCode = undefined;
  try {
    await buildProgram({ stdin: input })
      .exitOverride()
      .configureOutput({
        writeOut: text => recordOutput(text),
        writeErr: text => recordOutput(text),
      })
      .parseAsync(args, { from: "user" });
  } catch (error) {
    if (exitCode !== undefined) return exitCode;
    if (error instanceof ExitCalled) return error.code;
    const code = (error as { exitCode?: number }).exitCode;
    if (typeof code === "number") return code;
    throw error;
  } finally {
    // Set by the program where it must not exit early; never the test's.
    const set = process.exitCode;
    process.exitCode = undefined;
    if (exitCode === undefined && set !== undefined) exitCode = Number(set);
  }
  return exitCode ?? 0;
}

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

/** Everything the run printed, through any route the tests capture. */
export const printed: string[] = [];

export function recordOutput(...parts: unknown[]): void {
  printed.push(parts.map(part => String(part)).join(" "));
}

/** Routes console and raw stream writes into `printed`. */
export function captureConsole(): void {
  printed.length = 0;
  for (const method of ["log", "error", "warn", "info"] as const) {
    vi.spyOn(console, method).mockImplementation((...parts) =>
      recordOutput(...parts)
    );
  }
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    recordOutput(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
    recordOutput(chunk);
    return true;
  });
}

/** The flags that make a run touch nothing outside its folder. */
export const HERMETIC = ["--local-template", TEMPLATES, "--no-skills"];
