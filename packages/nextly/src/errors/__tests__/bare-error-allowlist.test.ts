/**
 * The bare-`Error` allowlist may only shrink.
 *
 * `eslint-bare-error-allowlist.js` exempts the files that still throw a bare `Error` so the guard
 * could land without a 107-file change. An exemption that outlives its reason turns the list into
 * folklore: the next reader cannot tell which entries are load-bearing and which are simply old,
 * so nobody removes any of them. This fails on a stale entry, which makes removal the path of
 * least resistance once a file is cleaned.
 *
 * Violations are counted by ESLINT, not by a regex over the source. The guard is an AST selector
 * (`ThrowStatement > NewExpression[callee.name='Error']`) and a text search is a second
 * implementation of the same question — it would disagree on a throw split across lines, or on
 * `const e = new Error(); throw e;`, and the disagreement would be silent in whichever direction
 * happened not to be tested. Asking the linter means there is one answer.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * Read as JSON rather than imported as a module: the list is data, and the config reads it the
 * same way. One file, two readers, no build step or declaration file between them.
 */
function readAllowlist(): readonly string[] {
  const parsed: unknown = JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../eslint-bare-error-allowlist.json"
      ),
      "utf8"
    )
  );
  // Narrowed rather than asserted. A malformed list would otherwise reach the loop below as an
  // empty or wrong-shaped value, and every assertion here is "count === 0" — so a file that
  // parsed to nothing would report a perfectly clean allowlist.
  if (
    !Array.isArray(parsed) ||
    !parsed.every((entry): entry is string => typeof entry === "string")
  ) {
    throw new TypeError(
      "eslint-bare-error-allowlist.json must be an array of file paths"
    );
  }
  return parsed;
}

const BARE_ERROR_ALLOWLIST = readAllowlist();

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

/** The guard's own selector, so the check and the rule cannot describe different things. */
const SELECTOR = "ThrowStatement > NewExpression[callee.name='Error']";

async function bareThrowCount(relativePath: string): Promise<number> {
  const eslint = new ESLint({
    cwd: packageRoot,
    // The repository config is KEPT, not replaced: it supplies the TypeScript parser, without
    // which nothing here parses and every count comes back zero. The rule is layered on as a
    // later block, which re-enables it for the files the repository config exempts — and those
    // exemptions are the thing under test.
    overrideConfig: {
      files: ["**/*.ts"],
      rules: {
        "no-restricted-syntax": ["error", { selector: SELECTOR, message: "x" }],
      },
    },
    // Without this the repository's ignore list would skip the very files being measured.
    ignore: false,
  });

  const results = await eslint.lintText(
    readFileSync(join(packageRoot, relativePath), "utf8"),
    { filePath: join(packageRoot, relativePath) }
  );
  const messages = results[0]?.messages ?? [];
  return messages.filter(m => m.ruleId === "no-restricted-syntax").length;
}

describe("the bare-Error allowlist", () => {
  it("counts a real violation, so an empty result means cleaned and not unmeasured", async () => {
    // The positive control, FIRST. Every assertion below is "count === 0"; if the counter
    // silently returned 0 for everything — a bad path, a parser failure, a rule that never
    // loaded — the suite would pass while measuring nothing at all.
    const withAThrow = BARE_ERROR_ALLOWLIST[0];
    expect(withAThrow).toBeDefined();
    expect(await bareThrowCount(withAThrow as string)).toBeGreaterThan(0);
  }, 30_000);

  it("lists no file that has already been cleaned", async () => {
    const stale: string[] = [];
    for (const entry of BARE_ERROR_ALLOWLIST) {
      if ((await bareThrowCount(entry)) === 0) stale.push(entry);
    }

    expect(
      stale,
      `these files no longer throw a bare Error and must be removed from ` +
        `eslint-bare-error-allowlist.js, so the guard starts protecting them: ` +
        `${stale.join(", ")}`
    ).toEqual([]);
  }, 180_000);
});
