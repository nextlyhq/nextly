/**
 * The half of the contract a shape assertion cannot reach.
 *
 * `pnpm-invocation.test.mjs` pins the object `pnpmInvocation` returns, which
 * covers the branching but proves nothing about a shell. Two of its claims are
 * claims about the real world: that a bare "pnpm" with shell: true actually
 * RESOLVES on Windows, where there is no pnpm.exe, and that `quoteForCmd`'s
 * output survives cmd.exe's tokenizer on the way to pnpm.CMD, which is a batch
 * file cmd parses rather than a program that gets a command line. If the
 * escaping were subtly wrong, every shape assertion would still pass.
 *
 * So these spawn. The precedent is `verify-merge.cli.test.mjs`, which exists
 * for the same reason -- a suite can be entirely green while the command
 * crashes before reaching any of it -- and the platform that matters is
 * covered by `dev-script-smoke`, whose windows-latest leg treats Windows as
 * the subject and ubuntu as the control.
 *
 * These run on every platform on purpose. On POSIX they are the control: the
 * same arguments, no shell, no quoting, and the same round-trip.
 *
 * @module pnpm-invocation.cli.test
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pnpmInvocation } from "./pnpm-invocation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..");

// Cold pnpm plus a Node boot; generous so a slow runner reports a failure
// rather than a timeout that reads like one.
const SPAWN_TIMEOUT = 120_000;

/**
 * Run a real pnpm sub-command and collect what it did.
 *
 * @param {string[]} args - arguments to pnpm.
 * @param {string} cwd - directory to run in.
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} result.
 */
function runPnpm(args, cwd) {
  const { command, args: argv, shell } = pnpmInvocation(args);

  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { cwd, shell, stdio: "pipe" });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => (stdout += chunk));
    child.stderr.on("data", chunk => (stderr += chunk));

    // ENOENT and EINVAL -- the two failures this module exists to prevent --
    // arrive here, not as an exit code.
    child.on("error", reject);
    child.on("close", code => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

describe("spawning pnpm for real", () => {
  it(
    "resolves the bare command name on this platform",
    async () => {
      // On Windows this is the ENOENT/EINVAL pair in one assertion: no
      // pnpm.exe exists, so only the shell finds pnpm.CMD, and the shell is
      // the only way Node will run a .cmd at all since the BatBadBut fix.
      const { code, stdout } = await runPnpm(["--version"], REPO_ROOT);

      expect(code).toBe(0);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    },
    SPAWN_TIMEOUT
  );
});

describe("an argument with a space, through the real shell", () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let script;

  beforeAll(async () => {
    // The space is in the directory name as well as the file name, so the
    // path splits in two places if the quoting is wrong.
    dir = await mkdtemp(path.join(tmpdir(), "pnpm invocation "));
    script = path.join(dir, "echo args.mjs");
    await writeFile(
      script,
      "console.log(JSON.stringify(process.argv.slice(1)));\n",
      "utf-8"
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it(
    "arrives as one argument, not several",
    async () => {
      // The shape the seed step has: pnpm, a sub-command, and an absolute
      // path that the checkout name puts a space into.
      const probe = path.join(dir, "a seed.ts");

      const { code, stdout, stderr } = await runPnpm(
        ["exec", "node", script, probe],
        REPO_ROOT
      );

      expect(stderr).toBe("");
      expect(code).toBe(0);

      // pnpm prints its own line first; the payload is the JSON one.
      const printed = stdout
        .trim()
        .split(/\r?\n/)
        .filter(line => line.startsWith("["));

      expect(JSON.parse(printed.at(-1))).toEqual([script, probe]);
    },
    SPAWN_TIMEOUT
  );
});
