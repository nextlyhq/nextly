// Every package type-checks with as many TypeScript 7 checkers as the machine
// should run, and no package picks its own.
//
// The checkers split a program's files between parallel workers. The
// compiler's release notes say the split can occasionally change results, so
// one machine runs every package with the same number; and four of them peak at
// 5.5 GB on nextly alone, so the number follows the machine. Measured on the
// whole repository, uncached and with no build info, `check-types` took 149 s
// at 1, 83 s at 2 and 55 s at 4, and nextly's own run peaked at 4.3, 4.7 and
// 5.5 GB. `local-limits.mjs` holds the rule and `scripts/tsc.mjs` applies it,
// so every `check-types` runs the compiler through `scripts/tsc.mjs`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { deriveLimits } from "./local-limits.mjs";

const ROOT = join(import.meta.dirname, "..");
const WRAPPER = join(ROOT, "scripts", "tsc.mjs");
const GIB = 1024 ** 3;

/** A script's commands, split at `&&`, `||` and `;`. */
const commandsOf = script =>
  script
    .split(/&&|\|\||;/)
    .map(command => command.trim())
    .filter(Boolean);

/**
 * What is wrong with how a script, run from `packageDir`, starts the compiler:
 * a bare `tsc`, which would take the compiler's own default of four; the
 * wrapper reached by a path that is not it; or a `--checkers` of its own.
 */
export function checkerProblems(script, packageDir) {
  return commandsOf(script).flatMap(command =>
    commandProblems(command, packageDir)
  );
}

/** Whether a command's words run `scripts/tsc.mjs` by some path. */
const callsWrapper = words =>
  words[0] === "node" && /(^|\/)scripts\/tsc\.mjs$/.test(words[1] ?? "");

/** One command's problems: a bare `tsc`, or the wrapper's below. */
function commandProblems(command, packageDir) {
  const words = command.split(/\s+/);
  if (words[0] === "tsc") return [`bare tsc: ${command}`];
  return callsWrapper(words) ? wrapperProblems(command, words, packageDir) : [];
}

/** A wrapper call that reaches another file, or passes its own `--checkers`. */
function wrapperProblems(command, words, packageDir) {
  return [
    resolve(packageDir, words[1]) !== WRAPPER && `not the wrapper: ${command}`,
    words.includes("--checkers") && `own --checkers: ${command}`,
  ].filter(Boolean);
}

/** Every tracked workspace manifest's `check-types` script. */
function checkTypesScripts() {
  return execFileSync(
    "git",
    ["ls-files", "package.json", "*/package.json", "*/*/package.json"],
    { cwd: ROOT, encoding: "utf8" }
  )
    .split("\n")
    .filter(file => file && !file.startsWith("templates/"))
    .map(file => ({
      file,
      script: JSON.parse(readFileSync(join(ROOT, file), "utf8")).scripts?.[
        "check-types"
      ],
    }))
    .filter(entry => typeof entry.script === "string");
}

describe("the number of checkers a tsc run uses", () => {
  const checkersAt = (gib, env = {}) =>
    deriveLimits({ totalBytes: gib * GIB, cpus: 8, env }).checkers;

  it("is 4 on a 16 GB machine, 2 below that, and 1 when workers are held to one", () => {
    expect(checkersAt(8)).toBe(2);
    expect(checkersAt(12)).toBe(2);
    // What GitHub's 16 GB runners report once the VM has taken its share.
    expect(checkersAt(15.2)).toBe(4);
    expect(checkersAt(16)).toBe(4);
    expect(checkersAt(48)).toBe(4);
    expect(checkersAt(48, { NEXTLY_LOCAL_MAX_WORKERS: "1" })).toBe(1);
    expect(checkersAt(8, { NEXTLY_LOCAL_MAX_WORKERS: "1" })).toBe(1);
    // Only one worker means one checker: two workers are no such request.
    expect(checkersAt(48, { NEXTLY_LOCAL_MAX_WORKERS: "2" })).toBe(4);
  });
});

describe("how check-types starts the compiler", () => {
  it("is through scripts/tsc.mjs in every package, with no checkers of its own", () => {
    const scripts = checkTypesScripts();
    // The scan reaches the packages: nextly's own script is among them.
    expect(scripts.map(entry => entry.file)).toContain(
      "packages/nextly/package.json"
    );
    const problems = scripts.flatMap(({ file, script }) =>
      checkerProblems(script, join(ROOT, dirname(file))).map(
        problem => `${file}: ${problem}`
      )
    );
    expect(problems).toEqual([]);
  });

  it("reports a bare tsc, a wrapper path that is not the wrapper, and a checkers of its own", () => {
    const at = join(ROOT, "packages", "nextly");
    expect(
      checkerProblems(
        "node ../../scripts/tsc.mjs --noEmit && tsc --noEmit -p tsconfig.tests.json",
        at
      )
    ).toEqual(["bare tsc: tsc --noEmit -p tsconfig.tests.json"]);
    expect(checkerProblems("node ../scripts/tsc.mjs --noEmit", at)).toEqual([
      "not the wrapper: node ../scripts/tsc.mjs --noEmit",
    ]);
    expect(
      checkerProblems("node ../../scripts/tsc.mjs --noEmit --checkers 4", at)
    ).toEqual([
      "own --checkers: node ../../scripts/tsc.mjs --noEmit --checkers 4",
    ]);
    // The root's `turbo run check-types` starts no compiler itself.
    expect(
      checkerProblems("node scripts/bounded.mjs turbo run check-types", ROOT)
    ).toEqual([]);
  });
});
