import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Code comments explain the code. They do not narrate the process that produced
 * it — no tasks, no plans, no conversations, no review findings.
 *
 * The convention is written in `AGENTS.md`, and a documented rule with nothing
 * enforcing it is not a control: the correct phrasing and the easy phrasing
 * differ, so the rule gets broken by people who know it. A comment that says
 * "this took four rounds to find" is invisible to every other check in the
 * repository — it compiles, it lints, it reads as insight — and it decays into
 * a reference to a conversation nobody can retrieve.
 *
 * The patterns below are deliberately narrow. A broad one ("PR", "issue") would
 * fire on ordinary prose about pull requests or issue codes and be silenced,
 * and a check that gets silenced is worth less than no check. These match the
 * specific shapes that have actually appeared: a count of review iterations, a
 * reference to a reviewer, and a deictic reference to the change itself.
 */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\b(review|codex|coderabbit)\s+round/i,
    why: "names a review iteration",
  },
  {
    pattern: /\brounds?\s+of\s+review\b/i,
    why: "names a review iteration",
  },
  {
    pattern: /\b(codex|coderabbit|greptile)\b/i,
    why: "names a review tool",
  },
  {
    pattern: /\b(this|the)\s+(PR|pull request)\b/i,
    why: "refers to the change rather than the code",
  },
  {
    pattern: /\breviewer\s+(said|asked|found|flagged)\b/i,
    why: "quotes a conversation",
  },
  {
    // Ordinal process narration: "the third instance", "the second time".
    // A comment counting how many times something has been found describes the
    // history of the work rather than the code, and that history is not
    // available to whoever reads the file next. It gets past the patterns above
    // because it narrates without naming a review or a tool.
    //
    // Deliberately requires a leading "the" and excludes "first", because
    // ordinary technical prose counts things: "the first occurrence sees the
    // `+` that leaves the first root" is a real comment in this package about
    // parsing, and a broader pattern flagged it. A check that fires on correct
    // prose gets silenced, and a silenced check is worth less than none.
    pattern: /\bthe\s+(second|third|fourth|fifth)\s+(time|instance)\b/i,
    why: "counts how often something was found, which is process history",
  },
];

/**
 * This file, which is excluded from its own scan.
 *
 * Its positive control holds comment SYNTAX inside string literals, and the
 * extractor below reads text rather than parsing, so it cannot tell a fixture
 * from prose — it flagged this file on the first run. Excluding one file by
 * name is the honest fix; teaching the extractor about string literals would
 * make it a parser, which is the unbounded surface this check deliberately is
 * not.
 */
const SELF = "comment-convention.test.ts";

/** Every `.ts` file under a directory, excluding build output. */
function sourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === "dist" || entry === SELF)
      continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Comment text only.
 *
 * Scanning whole lines would match a string literal — a test fixture naming a
 * reviewer, an error message mentioning a pull request — and the check would
 * then be reporting on data rather than on prose. This is a scan over syntax
 * and so has the usual limit: a comment spelled unusually escapes it. It is a
 * floor rather than a boundary, and worth having because the failure it catches
 * is one nothing else in the repository can see.
 */
function commentText(source: string): string[] {
  const comments: string[] = [];
  for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
    comments.push(match[0]);
  }
  for (const match of source.matchAll(/(^|[^:"'`\\])\/\/(.*)$/gm)) {
    comments.push(match[2]!);
  }
  return comments;
}

describe("code comments describe the code", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)));

  it("finds files to check", () => {
    // Without this, a broken walk reports every file clean by reading none —
    // the assertion below is satisfied by absence, which is exactly what it
    // must not be satisfied by.
    expect(sourceFiles(root).length).toBeGreaterThan(20);
  });

  it("names no review, tool or change", () => {
    const offences: string[] = [];
    for (const file of sourceFiles(root)) {
      for (const comment of commentText(readFileSync(file, "utf8"))) {
        for (const { pattern, why } of FORBIDDEN) {
          if (pattern.test(comment)) {
            offences.push(
              `${file.slice(root.length + 1)}: ${why} — ${comment.trim().slice(0, 80)}`
            );
          }
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("recognises an offending comment when it sees one", () => {
    // The positive control. A pattern list that matched nothing would pass the
    // assertion above on every input, including a file full of the prose it
    // exists to refuse.
    const offending = [
      "// this took four review rounds to find",
      "/* Codex flagged this */",
      "// the reviewer asked for a guard here",
      "// added in this PR",
      "// the third instance of this shape",
      "// broken for the second time this week",
    ];
    for (const sample of offending) {
      const [comment] = commentText(sample);
      expect(
        FORBIDDEN.some(({ pattern }) => pattern.test(comment ?? "")),
        `should have been refused: ${sample}`
      ).toBe(true);
    }

    // And the negative control: ordinary technical prose must pass, or the
    // check is one people route around rather than obey.
    const allowed = [
      "// Counted on discovery rather than on pop, so the cap is reached early.",
      "/* The descriptor reports an accessor without invoking it. */",
      "// A slot named `__proto__` survives JSON as an ordinary own key.",
      "// the first occurrence sees the `+` that leaves the first root",
    ];
    for (const sample of allowed) {
      const [comment] = commentText(sample);
      expect(
        FORBIDDEN.some(({ pattern }) => pattern.test(comment ?? "")),
        `should have been allowed: ${sample}`
      ).toBe(false);
    }
  });
});
