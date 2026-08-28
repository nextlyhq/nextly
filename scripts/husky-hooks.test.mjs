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

  it("records what is uncommitted BEFORE the first gate runs", async () => {
    /*
     * Every gate here runs against the working tree while Git pushes HEAD, so
     * a green describes a different tree whenever anything is uncommitted.
     * Reading the status after the gates would let lint-staged, a formatter or
     * a build artefact decide the answer.
     */
    const source = shellCode(await hook("pre-push"));

    const recordAt = source.search(/^DIRTY=/m);
    const firstTool = source.search(FIRST_TOOL);

    expect(recordAt).toBeGreaterThan(-1);
    expect(recordAt).toBeLessThan(firstTool);
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
