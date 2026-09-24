/**
 * What the husky hooks must clear before they run anything, and why.
 *
 * Git exports GIT_DIR into every hook. In a linked worktree that names the
 * worktree's admin directory rather than a plain .git, and turbo — which
 * shells out to git to hash its inputs — inherits it and hangs forever:
 * `turbo run build` printed its task list and then held at ~2s of CPU over 25
 * minutes. Measured four ways: the same build in the same worktree finishes
 * with GIT_DIR unset, hangs with it set, finishes again when the hook clears
 * it, and never hangs from the main checkout, where GIT_DIR is an ordinary
 * .git. Pushing from any worktree was impossible until the hook cleared it.
 *
 * pre-commit clears it too, and not because it hangs: its own two commands,
 * gitleaks and lint-staged, both drive the git CLI, which resolves the pointer
 * correctly — committing from a worktree completes either way, including
 * lint-staged's stash-and-restore. That is a fact about those two commands and
 * it lapses the moment either changes or a third joins them, with turbo
 * standing as proof that a git-shelling tool can take the pointer badly.
 * Clearing it in both hooks makes the invariant belong to the hooks rather
 * than to whatever they happen to call, and leaves nothing asserted about
 * third-party internals.
 *
 * Both hooks are POSIX sh — husky invokes them with `sh -e`, which is dash on
 * Ubuntu, the system sh on macOS, and Git Bash's sh on Windows. These cases
 * pin both halves: that the variable is cleared at all, and that it is cleared
 * before the first tool runs — clearing it afterwards would leave the hang in
 * place while looking like a fix.
 *
 * @module husky-hooks.test
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const hook = async name =>
  readFile(path.join(HERE, "..", ".husky", name), "utf-8");

/**
 * Comments are prose, and every pattern below describes a shell construct, so
 * the comments are removed before any of them run.
 *
 * Both hooks are more comment than command, and the words these patterns match
 * are ordinary English: "the source of truth" is phrasing this repository
 * reaches for, and it contains no `source` command. A guard that fails on a
 * sentence, under a message about dash on Ubuntu, sends the next reader hunting
 * for a construct that was never written — and a guard that cries wolf gets
 * deleted rather than fixed.
 *
 * Trailing comments go too. That can only ever remove text a pattern might
 * have matched, so the failure direction is a missed bashism inside a comment,
 * never a rejected correct hook.
 */
const shellCode = source =>
  source
    .split("\n")
    .map(line => line.replace(/\s#.*$/, ""))
    .filter(line => !/^\s*#/.test(line))
    .join("\n");

/**
 * The first command either hook spawns. `command -v` counts: it is how
 * pre-commit reaches gitleaks, and a clear placed after it would already be
 * too late for anything that call touched. So does `exec`: it is how pre-push
 * hands itself to `scripts/bounded.mjs`, and turbo runs under what that
 * inherits.
 */
const FIRST_TOOL =
  /^\s*(?:if\s+command\s+-v\s+|exec\s+)?(?:pnpm|npx|node|turbo|gitleaks)\b/m;

/**
 * The first GATE pre-push runs. Not the same as the first tool: the hand-over
 * to `scripts/bounded.mjs` runs this same hook again, and that second run
 * reaches the gates.
 */
const FIRST_GATE = /^\s*pnpm\b/m;
const CLEARS_GIT_DIR = /^unset .*\bGIT_DIR\b/m;

describe.each(["pre-push", "pre-commit"])("the %s hook", name => {
  it("clears GIT_DIR", async () => {
    expect(shellCode(await hook(name))).toMatch(CLEARS_GIT_DIR);
  });

  it("clears GIT_WORK_TREE alongside it, since git reads the two as a pair", async () => {
    expect(shellCode(await hook(name))).toMatch(/^unset .*\bGIT_WORK_TREE\b/m);
  });

  it("clears it before invoking any tool, not after", async () => {
    const source = shellCode(await hook(name));

    const unsetAt = source.search(CLEARS_GIT_DIR);
    const firstTool = source.search(FIRST_TOOL);

    expect(unsetAt).toBeGreaterThan(-1);
    expect(firstTool).toBeGreaterThan(-1);
    expect(unsetAt).toBeLessThan(firstTool);
  });

  it("uses no bashisms the Ubuntu default shell would reject", async () => {
    const source = shellCode(await hook(name));

    // dash is not bash: these are the constructs that silently work on a
    // developer's bash and fail on Ubuntu, where /bin/sh is dash.
    expect(source).not.toMatch(/\[\[/); // [[ ... ]]
    expect(source).not.toMatch(/^\s*function\s+\w+/m); // function foo()
    expect(source).not.toMatch(/\$\(\(.*\+\+/); // $((i++))
    expect(source).not.toMatch(/\bsource\s+/); // source, not .
  });
});

describe("the pre-push hook specifically", () => {
  it("still short-circuits in CI before doing any of it", async () => {
    const source = shellCode(await hook("pre-push"));

    const ciGuard = source.search(/^case "\$\{CI:-\}" in/m);
    const unsetAt = source.search(CLEARS_GIT_DIR);

    expect(ciGuard).toBeGreaterThan(-1);
    expect(ciGuard).toBeLessThan(unsetAt);
  });

  it("declares a POSIX shell, so dash and Git Bash both accept it", async () => {
    expect(await hook("pre-push")).toMatch(/^#!\/usr\/bin\/env sh\r?\n/);
  });

  it("does not let the repo-wide typecheck refuse the push", async () => {
    /*
     * The only gate here whose scope is the whole repository, so it can be red
     * for a package the author never touched. A hook that refuses over someone
     * else's breakage is one people pass `--no-verify` to, which costs every
     * gate rather than this one. CI blocks on the same command.
     */
    const source = shellCode(await hook("pre-push"));

    expect(source).toMatch(/^set \+e\n\s*pnpm turbo check-types/m);
    expect(source).toMatch(/^TYPES_STATUS=\$\?/m);
    // Reported, so it is not silent either.
    expect(source).toMatch(/if \[ "\$TYPES_STATUS" -ne 0 \]/);
  });

  it("typechecks the whole repo, which nothing here did before", async () => {
    // `lint` and `build` above already run repo-wide, so types were the one
    // whole-repo question this hook was not asking — and an API or type break
    // is how a shared package breaks the packages that depend on it.
    expect(shellCode(await hook("pre-push"))).toMatch(
      /^\s*pnpm turbo check-types\b/m
    );
  });

  it("typechecks AFTER the build, which is what makes it answerable", async () => {
    /*
     * `check-types` depends on `^check-types` and never builds, so it reads
     * whatever `dist` survived. Run before the build it fails on an unbuilt
     * tree for a reason that has nothing to do with the diff — a red that
     * teaches the next person to stop reading this hook's output.
     */
    const source = shellCode(await hook("pre-push"));

    const buildAt = source.search(/^\s*pnpm run build\b/m);
    const typesAt = source.search(/^\s*pnpm turbo check-types\b/m);

    expect(buildAt).toBeGreaterThan(-1);
    expect(typesAt).toBeGreaterThan(-1);
    expect(buildAt).toBeLessThan(typesAt);
  });

  it("lints AFTER the build, which is what lets a fresh checkout pass", async () => {
    /*
     * `import-x/no-unresolved` and every type-aware rule resolve a workspace
     * import through the sibling's `dist`. Linting first refused every push
     * from a checkout that had never been built — 16 of 23 lint tasks, all on
     * unresolved imports — and a new worktree is exactly that checkout.
     */
    const source = shellCode(await hook("pre-push"));

    const buildAt = source.search(/^\s*pnpm run build\b/m);
    const lintAt = source.search(/^\s*pnpm turbo lint\b/m);

    expect(buildAt).toBeGreaterThan(-1);
    expect(lintAt).toBeGreaterThan(-1);
    expect(buildAt).toBeLessThan(lintAt);
  });

  it("records what is uncommitted BEFORE the first gate runs", async () => {
    /*
     * Every gate here runs against the working tree while Git pushes HEAD, so
     * a green describes a different tree whenever anything is uncommitted.
     * Reading the status after the gates would let lint-staged, a formatter or
     * a build artefact decide the answer.
     */
    const source = shellCode(await hook("pre-push"));

    const recordAt = source.search(/^DIRTY=/m);
    const firstGate = source.search(FIRST_GATE);

    expect(recordAt).toBeGreaterThan(-1);
    expect(recordAt).toBeLessThan(firstGate);
  });

  it("reports it LAST, so it is still on screen when the push proceeds", async () => {
    const source = shellCode(await hook("pre-push"));

    const recordAt = source.search(/^DIRTY=/m);
    const reportAt = source.search(/^if \[ -n "\$DIRTY" \]/m);

    expect(reportAt).toBeGreaterThan(-1);
    expect(reportAt).toBeGreaterThan(recordAt);
    // Nothing runs after it, which is the whole point of where it sits.
    expect(source.slice(reportAt)).not.toMatch(FIRST_TOOL);
  });

  it("does not refuse the push over a status it could not read", async () => {
    // A hook that cannot answer a question it only WARNS about must not turn
    // that into a refusal — this runs under `set -e`.
    expect(shellCode(await hook("pre-push"))).toMatch(
      /^DIRTY=.*\|\| true\)"?$/m
    );
  });
});

/*
 * What pre-push does before any gate, run for real.
 *
 * `node` and `pnpm` are replaced on PATH by stubs that print what they were
 * asked and exit 99. Nothing here can start a gate: the first command that
 * would is a stub, and its exit status says how far the hook got. Run from the
 * repository root, as husky runs it, and without CI, which skips the hook.
 */
describe("the pre-push hook before its gates", () => {
  const ROOT = path.join(HERE, "..");
  let stubs;

  beforeAll(() => {
    stubs = mkdtempSync(path.join(tmpdir(), "pre-push-stubs-"));
    for (const name of ["node", "pnpm"]) {
      const file = path.join(stubs, name);
      writeFileSync(file, `#!/bin/sh\necho "stub ${name} $*" >&2\nexit 99\n`);
      chmodSync(file, 0o755);
    }
  });

  afterAll(() => rmSync(stubs, { recursive: true, force: true }));

  const ZERO = "0".repeat(40);
  const SHA = "a".repeat(40);
  const deletion = branch => `refs/heads/${branch} ${ZERO} refs/heads/${branch} ${SHA}\n`;
  const update = branch => `refs/heads/${branch} ${SHA} refs/heads/${branch} ${ZERO}\n`;

  function push(stdin, extra = {}) {
    const { CI: _ci, NEXTLY_BOUNDED: _nested, ...env } = process.env;
    return spawnSync("sh", ["-e", ".husky/pre-push", "origin", "git@example.com:o/r.git"], {
      cwd: ROOT,
      input: stdin,
      encoding: "utf8",
      env: { ...env, PATH: `${stubs}${path.delimiter}${env.PATH}`, ...extra },
    });
  }

  it.runIf(process.platform !== "win32")("lets a push that only deletes branches through without a gate", () => {
    const result = push(deletion("gone") + deletion("also-gone"));
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/only deleting remote branches/);
    expect(result.stderr).not.toMatch(/stub/);
  });

  it.runIf(process.platform !== "win32")("hands a push that carries code to the bounded runner", () => {
    const result = push(update("feature"));
    expect(result.status).toBe(99);
    expect(result.stderr).toMatch(/^stub node scripts\/bounded\.mjs sh -e \.husky\/pre-push origin /m);
  });

  it.runIf(process.platform !== "win32")("gates a push that deletes one branch and updates another", () => {
    expect(push(deletion("gone") + update("feature")).status).toBe(99);
  });

  /*
   * "Every ref is a deletion" is true of no refs at all. Reading that as an
   * all-clear is the vacuous pass this repository keeps finding, so an empty
   * list — and a line with no sha to judge — is gated.
   */
  it.runIf(process.platform !== "win32")("does not read an empty or malformed ref list as only deletions", () => {
    expect(push("").status).toBe(99);
    expect(push("refs/heads/feature\n").status).toBe(99);
  });

  /*
   * "CI" means what `detectIsCi` in packages/telemetry says: set, and neither
   * "0" nor "false". A presence test skipped every gate for a developer with
   * CI=false in their environment.
   */
  it.runIf(process.platform !== "win32")("skips in CI, and gates a machine whose CI is set to false or 0", () => {
    const skipped = push(update("feature"), { CI: "true" });
    expect(skipped.status).toBe(0);
    expect(skipped.stdout).toMatch(/skipped in CI/);
    for (const value of ["false", "0", ""]) {
      expect(push(update("feature"), { CI: value }).status).toBe(99);
    }
  });

  it.runIf(process.platform !== "win32")("goes straight to the gates in the run the runner started", () => {
    const result = push(deletion("gone"), { NEXTLY_BOUNDED: "1" });
    expect(result.status).toBe(99);
    expect(result.stderr).toMatch(/^stub node scripts\/local-limits\.mjs/m);
  });
});
