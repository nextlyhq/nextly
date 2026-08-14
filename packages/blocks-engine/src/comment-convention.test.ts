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
 *
 * Every one of them matches a NAME the code cannot own — a review tool, the
 * pull request, the reviewer. That is what makes them safe: those words carry
 * no meaning inside a description of what the code does, so matching them
 * cannot reject a correct comment.
 *
 * ORDINAL PROCESS NARRATION IS NOT ENFORCED HERE, and that is stated rather
 * than left to be inferred from its absence: "the third instance of this shape
 * we have found" passes this suite, and no other check in the repository covers
 * it. The convention still forbids it; nothing mechanical catches it.
 *
 * The reason generalises. "The third instance of this shape we have found" is process
 * history; "the third instance in the array owns the separator" describes a
 * parser. The difference is intent, not vocabulary, so no expression over the
 * words can separate them. Pairing the ordinal with a discovery verb does not
 * help either, because those verbs are ordinary technical words: a cache
 * MISSES, a guard CATCHES, a value is FOUND. The negative controls below hold
 * sentences of exactly that shape which describe runtime behaviour. This file
 * matches structure and leaves intent unenforced, rather than pretending intent
 * is detectable syntax.
 *
 * Narrowing to first-person discovery — "we found", "I fixed" — looks like the
 * reliable version and is not. Measured against this repository, the first
 * expression of that shape matches `verify-credentials.ts`'s "of whether we
 * found a user", which describes what a lookup returned. The OBJECT of the verb
 * separates the two cases, and enumerating objects is the unbounded surface
 * again. That sample is a negative control below, so the next attempt fails on
 * it immediately rather than shipping and being silenced.
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
      "// the second time the callback runs, reuse the cached value",
      "// the third instance in the array owns the separator",
      // Ordinal counting beside a discovery verb, all three describing runtime
      // behaviour rather than the work that produced the file. They are what a
      // pattern keyed on that shape rejects, and are here so that adding one
      // fails.
      "// the second time the cache missed, refresh the credentials",
      "// the third instance found in the pool is the one that owns the lock",
      "// on the second retry the fixed backoff is replaced by the jittered one",
      // First-person discovery, taken verbatim from `verify-credentials.ts`. It
      // describes what a lookup returned, so a pattern keyed on "we found"
      // rejects working prose.
      "// of whether we found a user. Without this branch, the miss path returns",
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
