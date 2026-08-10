/**
 * Comments describe the code, never the process that produced it.
 *
 * A comment that cites a tracker item, or defers to something someone asked
 * for, is dead on arrival for everyone who was not in the room: the tracker
 * moves, the request is unrecorded, and the reader is left knowing only that a
 * reason existed. The reason itself -- the thing worth writing down -- goes
 * missing precisely because a pointer to it felt like documentation.
 *
 * The exact shapes are in `META_REFERENCES` below, written as patterns rather
 * than spelled out in prose so this file does not trip its own rule.
 *
 * `AGENTS.md` states this rule. Stating it is not enforcing it, and ten
 * references had accumulated across the admin and ui packages by the time this
 * check was written.
 *
 * Only comment lines are read, so a string literal or an identifier that
 * happens to contain one of these words is not a violation.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../..");

const SCANNED = ["packages/ui/src", "packages/admin/src", "apps/playground"];
const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".css",
]);

/** A line that is a comment, in either JS or CSS syntax. */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*(?!\/)|\*\/)/;

/**
 * What a comment must not point at. Each is a reference to something outside
 * the codebase, which is what makes it unreadable later.
 */
const META_REFERENCES: Array<[RegExp, string]> = [
  [/\btask[-\s]?\d+/i, "a task number"],
  [/\bthe founder\b/i, "a conversation"],
  [/\breview (finding|feedback|comment)\b/i, "a review"],
  [/\bper (the )?(user|founder)('s)? (request|feedback|ask)\b/i, "a request"],
  [/\bas (requested|discussed|agreed)\b/i, "a conversation"],
  [/\bPR #\d+/i, "a pull request"],
  [/\bphase \d+\b/i, "a plan"],
];

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".next") {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (EXTENSIONS.has(extname(full))) found.push(full);
  }
  return found;
}

const sources = SCANNED.flatMap(root => walk(resolve(repo, root))).map(path =>
  relative(repo, path)
);

interface Violation {
  where: string;
  kind: string;
  text: string;
}

function violationsIn(path: string): Violation[] {
  const found: Violation[] = [];
  const lines: string[] = readFileSync(resolve(repo, path), "utf8").split("\n");
  lines.forEach((line: string, index: number) => {
    if (!COMMENT_LINE.test(line)) return;
    for (const [pattern, kind] of META_REFERENCES) {
      if (!pattern.test(line)) continue;
      found.push({
        where: `${path}:${index + 1}`,
        kind,
        text: line.trim().slice(0, 100),
      });
      return;
    }
  });
  return found;
}

describe("comments describe the code, not the process", () => {
  it("finds the sources to read", () => {
    // An empty scan satisfies the rule below without checking anything.
    expect(sources.length).toBeGreaterThan(100);
  });

  it("reads comment lines and not code", () => {
    // The patterns are ordinary English, so a check that read whole files
    // would fire on identifiers and strings and get switched off. Both
    // directions are pinned.
    expect(COMMENT_LINE.test("// see task 24")).toBe(true);
    expect(COMMENT_LINE.test(" * Phase 2 styles")).toBe(true);
    expect(COMMENT_LINE.test('const label = "Phase 2";')).toBe(false);
    expect(COMMENT_LINE.test("runTask24();")).toBe(false);
  });

  it("has no comment pointing outside the codebase", () => {
    const violations = sources.flatMap(violationsIn);

    expect(
      violations.map(v => `${v.where} references ${v.kind}: ${v.text}`),
      `A comment points at something a future reader cannot open. Write the ` +
        `REASON instead: what the code does and why it does it that way. If ` +
        `the reason is genuinely a decision record, it belongs in a document, ` +
        `not in a reference the code cannot resolve.`
    ).toEqual([]);
  });
});
