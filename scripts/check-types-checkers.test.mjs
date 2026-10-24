// Every package type-checks with the same number of TypeScript 7 checkers.
//
// The checkers split a program's files between parallel workers, and the
// compiler's own release notes say the split can occasionally change results:
// a diagnostic that depends on the order in which types are first seen can
// differ between `--checkers 2` and `--checkers 4`. So one value is pinned for
// every `check-types`, and it is 4: TypeScript's own default, which the
// editor's language server also uses, so the command line and the editor see
// the same order. Measured on the whole repository, uncached and with no build
// info, `check-types` took 149 s at 1, 83 s at 2 and 55 s at 4, and nextly's
// own run peaked at 4.3, 4.7 and 5.5 GB.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

/** The number of checkers every `check-types` passes to `tsc`. */
export const CHECKERS = 4;

/**
 * The `tsc` commands in a script that do not pass `--checkers CHECKERS`. A
 * script is split into its commands at `&&`, `||` and `;`, and a command is a
 * `tsc` run when its first word is `tsc`.
 */
export function unpinnedTscCommands(script, checkers = CHECKERS) {
  return script
    .split(/&&|\|\||;/)
    .map(command => command.trim())
    .filter(command => command.split(/\s+/)[0] === "tsc")
    .filter(command => {
      const words = command.split(/\s+/);
      const at = words.indexOf("--checkers");
      return at === -1 || words[at + 1] !== String(checkers);
    });
}

/** Every tracked workspace manifest, with its `check-types` script if it has one. */
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

describe("the number of checkers check-types runs with", () => {
  it(`is ${String(CHECKERS)} in every tsc command of every package`, () => {
    const scripts = checkTypesScripts();
    // The scan reaches the packages: nextly's own script is among them.
    expect(scripts.map(entry => entry.file)).toContain(
      "packages/nextly/package.json"
    );
    const unpinned = scripts.flatMap(({ file, script }) =>
      unpinnedTscCommands(script).map(command => `${file}: ${command}`)
    );
    expect(unpinned).toEqual([]);
  });

  it("reports a tsc command that passes no value or another one, and nothing else", () => {
    expect(
      unpinnedTscCommands(
        "next typegen && tsc --noEmit --checkers 4 && tsc --noEmit -p tsconfig.tests.json"
      )
    ).toEqual(["tsc --noEmit -p tsconfig.tests.json"]);
    expect(unpinnedTscCommands("tsc --noEmit --checkers 2")).toEqual([
      "tsc --noEmit --checkers 2",
    ]);
    // `turbo run check-types` at the root is not a tsc command.
    expect(
      unpinnedTscCommands("node scripts/bounded.mjs turbo run check-types")
    ).toEqual([]);
  });
});
