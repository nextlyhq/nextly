// The TypeScript compiler's own command line, run and read, for tests that ask
// the compiler a question: does this compile, and with which errors; how does a
// config resolve; which files does its program load.
//
// The command line and its `--pretty false` diagnostics read the same on
// TypeScript 5.x and 7.x, where the compiler's JavaScript API does not exist in
// 7. The exit status does not agree between them (5.x exits 2 on type errors,
// 7.x exits 1), so a run is judged by what it printed: diagnostics are an
// answer, and a failed run that printed none could not be asked.
//
// `NEXTLY_TSC` names another `tsc` entry script to run these checks with, such
// as TypeScript 7's while the repository still installs 5.x.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

/** The `tsc` entry script: `NEXTLY_TSC`, or the one the installed `typescript` declares. */
export function tscEntry() {
  if (process.env.NEXTLY_TSC) return resolve(process.env.NEXTLY_TSC);
  const manifest = createRequire(import.meta.url).resolve(
    "typescript/package.json"
  );
  const { bin } = JSON.parse(readFileSync(manifest, "utf8"));
  return join(dirname(manifest), typeof bin === "string" ? bin : bin.tsc);
}

/**
 * Runs `tsc` with `args` from `cwd`, through this Node so it starts the same
 * way on every platform, and returns its exit status and everything it printed.
 */
function runTsc(args, cwd) {
  const result = spawnSync(process.execPath, [tscEntry(), ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

let major;

/**
 * The major version of the `tsc` these checks run, for the few expectations
 * that differ between versions; read once from `tsc -v`.
 */
export function tscMajor() {
  if (major === undefined) {
    const { output } = runTsc(["-v"], process.cwd());
    const found = /Version (\d+)\./.exec(output);
    if (!found) throw new Error(`tsc -v printed no version:\n${output}`);
    major = Number(found[1]);
  }
  return major;
}

const DIAGNOSTIC = /^(?:(.+?)\((\d+),(\d+)\): )?error (TS\d+): (.*)$/;

/**
 * The diagnostics in `--pretty false` output, in order: the file as printed
 * (undefined for one about the configuration as a whole), its line and column,
 * the code, and the message with its indented continuation lines.
 */
export function diagnosticsIn(output) {
  const found = [];
  for (const line of output.split(/\r?\n/)) {
    const match = DIAGNOSTIC.exec(line);
    if (match) {
      const [, file, row, column, code, message] = match;
      found.push({
        file: file?.replaceAll("\\", "/"),
        line: row === undefined ? undefined : Number(row),
        column: column === undefined ? undefined : Number(column),
        code,
        message,
      });
    } else if (found.length > 0 && /^\s+\S/.test(line)) {
      found.at(-1).message += `\n${line.trim()}`;
    }
  }
  return found;
}

/**
 * Compiles with `args` (files and options, `--noEmit` added) and returns the
 * diagnostics. A run that failed without printing one could not compile at
 * all, which is reported rather than read as a clean result.
 *
 * `--incremental false` because the shared base config turns incremental on:
 * a build-info file another program wrote answers from that program's state,
 * and an error count read from it can be stale.
 */
export function compile(args, cwd) {
  const { status, output } = runTsc(
    ["--noEmit", "--incremental", "false", "--pretty", "false", ...args],
    cwd
  );
  const diagnostics = diagnosticsIn(output);
  if (status !== 0 && diagnostics.length === 0) {
    throw new Error(
      `tsc ${args.join(" ")} failed with no diagnostics:\n${output}`
    );
  }
  return diagnostics;
}

/** Runs a read-only `tsc -p config` question that must succeed, and returns what it printed. */
function askConfig(configPath, flag) {
  const { status, output } = runTsc(
    ["-p", configPath, flag],
    dirname(configPath)
  );
  if (status !== 0) {
    throw new Error(`tsc -p ${configPath} ${flag} failed:\n${output}`);
  }
  return output;
}

/** A config as `tsc` resolves it: `extends` followed and the file list matched. */
export function showConfig(configPath) {
  return JSON.parse(askConfig(configPath, "--showConfig"));
}

/** The files a config's program loads, as absolute paths with forward slashes. */
export function listedFiles(configPath) {
  return askConfig(configPath, "--listFilesOnly")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(file => resolve(dirname(configPath), file).replaceAll("\\", "/"));
}
