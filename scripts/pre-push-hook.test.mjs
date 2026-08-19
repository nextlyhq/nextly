/**
 * What the pre-push hook must clear before it runs anything, and why.
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
 * The hook is `#!/usr/bin/env sh`, so it runs under dash on Ubuntu, under the
 * system sh on macOS, and under Git Bash's sh on Windows. These cases pin both
 * halves: that the variable is cleared at all, and that it is cleared before
 * the first tool runs — clearing it afterwards would leave the hang in place
 * while looking like a fix.
 *
 * @module pre-push-hook.test
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, "..", ".husky", "pre-push");

const hook = async () => readFile(HOOK, "utf-8");

describe("the pre-push hook", () => {
  it("clears GIT_DIR", async () => {
    expect(await hook()).toMatch(/^unset .*\bGIT_DIR\b/m);
  });

  it("clears GIT_WORK_TREE alongside it, since git reads the two as a pair", async () => {
    expect(await hook()).toMatch(/^unset .*\bGIT_WORK_TREE\b/m);
  });

  it("clears it before invoking any tool, not after", async () => {
    const source = await hook();

    const unsetAt = source.search(/^unset .*\bGIT_DIR\b/m);
    const firstTool = source.search(/^\s*(pnpm|npx|node|turbo)\b/m);

    expect(unsetAt).toBeGreaterThan(-1);
    expect(firstTool).toBeGreaterThan(-1);
    expect(unsetAt).toBeLessThan(firstTool);
  });

  it("still short-circuits in CI before doing any of it", async () => {
    const source = await hook();

    const ciGuard = source.search(/if \[ -n "\$CI" \]/);
    const unsetAt = source.search(/^unset .*\bGIT_DIR\b/m);

    expect(ciGuard).toBeGreaterThan(-1);
    expect(ciGuard).toBeLessThan(unsetAt);
  });
});

describe("portability", () => {
  it("declares a POSIX shell, so dash and Git Bash both accept it", async () => {
    expect(await hook()).toMatch(/^#!\/usr\/bin\/env sh\r?\n/);
  });

  it("uses no bashisms the Ubuntu default shell would reject", async () => {
    const source = await hook();

    // dash is not bash: these are the constructs that silently work on a
    // developer's bash and fail on Ubuntu, where /bin/sh is dash.
    expect(source).not.toMatch(/\[\[/); // [[ ... ]]
    expect(source).not.toMatch(/^\s*function\s+\w+/m); // function foo()
    expect(source).not.toMatch(/\$\(\(.*\+\+/); // $((i++))
    expect(source).not.toMatch(/\bsource\s+/); // source, not .
  });
});
