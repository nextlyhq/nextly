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
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
 * too late for anything that call touched.
 */
const FIRST_TOOL =
  /^\s*(?:if\s+command\s+-v\s+)?(?:pnpm|npx|node|turbo|gitleaks)\b/m;
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

    const ciGuard = source.search(/if \[ -n "\$CI" \]/);
    const unsetAt = source.search(CLEARS_GIT_DIR);

    expect(ciGuard).toBeGreaterThan(-1);
    expect(ciGuard).toBeLessThan(unsetAt);
  });

  it("declares a POSIX shell, so dash and Git Bash both accept it", async () => {
    expect(await hook("pre-push")).toMatch(/^#!\/usr\/bin\/env sh\r?\n/);
  });
});
