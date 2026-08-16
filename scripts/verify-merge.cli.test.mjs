// Runs `scripts/verify-merge.mjs` AS A PROGRAM.
//
// Its sibling suite imports the pure judgements and calls them, and where it
// reaches `runCli` it passes its OWN `run` — so `main`, the entry guard, the
// requests and the process exit have no coverage at all. That is the same
// blind spot the verdict gate had: a suite can be entirely green while the
// command crashes before reaching any of it.
//
// Two properties are worth starting a process for.
//
// The ENTRY GUARD, because its failure is silent in the worst direction: the
// module declines to run and the process exits 0 having verified nothing,
// which a caller cannot tell from a clean pass. It accepts two URL forms
// because symlink resolution is a runtime option, so both have to be
// exercised — covering one leaves the other's half removable with the suite
// green.
//
// The THREE-WAY EXIT, because callers depend on `2` never reading as a pass.
// `0` passed, `1` blocked, `2` could not answer; the third is not a softer
// second, and nothing until now checked that a failed request produces it
// rather than a rejection.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "verify-merge.mjs");

let root;

/** A `gh` that always fails, so every request is a refusal to answer. */
const FAILING_GH = `#!/usr/bin/env node
process.stderr.write("gh: HTTP 502\\n");
process.exit(1);
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "verify-merge-cli-"));
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), FAILING_GH);
  chmodSync(join(bin, "gh"), 0o755);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/**
 * Start the command and return its status and streams.
 *
 * Every variable the program reads is pinned rather than inherited. An
 * inherited `NODE_OPTIONS` would supply the symlink flag to the cases that
 * exist to run WITHOUT it, which removes the contrast they are drawing.
 */
const run = ({ args, entry = ENTRY, nodeOptions = "" }) => {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      NODE_OPTIONS: nodeOptions,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

describe("verify-merge as a command", () => {
  it("runs and refuses an argument it cannot use", () => {
    // Asserted on the USAGE message rather than the status alone. A guard that
    // failed to match would exit 0 having executed nothing, and "exited 0
    // having done nothing" is the same status as a pass — only output the
    // program alone emits separates them.
    const result = run({ args: [] });

    expect(result.stderr).toMatch(/^usage: /);
    expect(result.status).toBe(2);
  });

  it("runs when invoked through a symlink the runtime resolves", () => {
    // The default mode: `import.meta.url` is resolved through symlinks while
    // `argv[1]` is not, so a guard comparing only the raw form never matches.
    const link = join(root, "linked-default.mjs");
    rmSync(link, { force: true });
    symlinkSync(ENTRY, link);

    const result = run({ args: [], entry: link });

    expect(result.stderr).toMatch(/^usage: /);
    expect(result.status).toBe(2);
  });

  it("runs when invoked through a symlink the runtime does not resolve", () => {
    // `--preserve-symlinks-main` inverts it: the link survives in
    // `import.meta.url` and the RESOLVED form is the one that never matches.
    // `NODE_OPTIONS` can set this from outside the command line, so the
    // program cannot know which mode it is in.
    const link = join(root, "linked-preserved.mjs");
    rmSync(link, { force: true });
    symlinkSync(ENTRY, link);

    const result = run({
      args: [],
      entry: link,
      nodeOptions: "--preserve-symlinks-main",
    });

    expect(result.stderr).toMatch(/^usage: /);
    expect(result.status).toBe(2);
  });

  it("exits 2 rather than 1 when it cannot reach the API", () => {
    // The distinction callers gate on. A failed request means the answer is
    // UNAVAILABLE, which is not a rejection: reporting 1 would tell a caller
    // the pull request was judged and refused, and reporting 0 would let it
    // merge on a question nobody managed to ask.
    const result = run({ args: ["1"] });

    expect(result.status).toBe(2);
    expect(result.status).not.toBe(1);
    expect(result.stderr).toMatch(/could not complete the check/);
  });
});
