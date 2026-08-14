#!/usr/bin/env node

/**
 * Code comments explain the code. They do not narrate the process that produced it — no tasks,
 * no plans, no conversations, no review findings.
 *
 * The convention is written in `AGENTS.md`, and a documented rule with nothing enforcing it is
 * not a control: the correct phrasing and the easy phrasing differ, so the rule gets broken by
 * people who know it. A comment saying "this took four rounds to find" is invisible to every
 * other check in the repository — it compiles, it lints, it reads as insight — and it decays
 * into a reference to a conversation nobody can retrieve.
 *
 * WHY THIS IS A SCRIPT RATHER THAN A TEST, since the check began life as one:
 * the rule is repository-wide, and a test enforcing it necessarily roots itself somewhere. The
 * previous home, `packages/blocks-engine/src/comment-convention.test.ts`, rooted at its own
 * directory — so it read as repository coverage while never looking outside one package of
 * twenty-four. Widening it in place would have made a `blocks-engine` test walk the whole
 * repository, which is exactly the coupling that package's `layering.test.ts` exists to prevent.
 *
 * A check whose scope is an argument is also a check whose scope is reviewable, which the
 * implicit `dirname(import.meta.url)` root was not.
 *
 * Usage:
 *   node scripts/check-comment-convention.mjs [roots...]      # defaults to packages apps e2e
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The forbidden shapes, deliberately narrow.
 *
 * A broad pattern ("PR", "issue") would fire on ordinary prose about pull requests or issue
 * codes and be silenced, and a check that gets silenced is worth less than no check. These match
 * shapes that have actually appeared: a count of review iterations, a reference to a review
 * tool, a deictic reference to the change itself, a quoted conversation.
 *
 * Every one matches a NAME the code cannot own — a review tool, the pull request, the reviewer.
 * That is what makes them safe: those words carry no meaning inside a description of what the
 * code does, so matching them cannot reject a correct comment.
 *
 * ORDINAL PROCESS NARRATION IS NOT ENFORCED, and that is stated rather than left to be inferred
 * from its absence: "the third instance of this shape we have found" passes, and nothing else in
 * the repository covers it. The convention still forbids it; nothing mechanical catches it.
 *
 * The reason generalises. "The third instance of this shape we have found" is process history;
 * "the third instance in the array owns the separator" describes a parser. The difference is
 * intent, not vocabulary, so no expression over the words can separate them. Pairing the ordinal
 * with a discovery verb does not help either, because those verbs are ordinary technical words:
 * a cache MISSES, a guard CATCHES, a value is FOUND. This matches structure and leaves intent
 * unenforced, rather than pretending intent is detectable syntax.
 */
export const FORBIDDEN = [
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
 * Files this check does not read.
 *
 * Its own test holds comment SYNTAX inside string literals as fixtures, and the extractor below
 * reads text rather than parsing, so it cannot tell a fixture from prose. Excluding one file by
 * name is the honest fix; teaching the extractor about string literals would make it a parser,
 * which is the unbounded surface this deliberately is not.
 */
const EXCLUDED_FILES = new Set(["check-comment-convention.test.mjs"]);

/** Directories that hold generated or vendored code rather than authored source. */
const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage"]);

/** Every TypeScript source file under `root`. */
export function sourceFiles(root) {
  const found = [];
  for (const entry of readdirSync(root)) {
    if (EXCLUDED_DIRS.has(entry) || EXCLUDED_FILES.has(entry)) continue;
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
 * Scanning whole lines would match a string literal — a test fixture naming a reviewer, an error
 * message mentioning a pull request — and the check would then be reporting on data rather than
 * on prose. This is a scan over syntax and so has the usual limit: a comment spelled unusually
 * escapes it. It is a floor rather than a boundary, and worth having because the failure it
 * catches is one nothing else in the repository can see.
 */
export function commentText(source) {
  const comments = [];
  for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
    comments.push(match[0]);
  }
  for (const match of source.matchAll(/(^|[^:"'`\\])\/\/(.*)$/gm)) {
    comments.push(match[2]);
  }
  return comments;
}

/** Every forbidden shape found in `source`, as `{ why, comment }`. */
export function offencesIn(source) {
  const found = [];
  for (const comment of commentText(source)) {
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(comment)) {
        found.push({ why, comment: comment.trim().slice(0, 100) });
      }
    }
  }
  return found;
}

const DEFAULT_ROOTS = ["packages", "apps", "e2e"];

function main() {
  const roots = process.argv.slice(2);
  const scanned = (roots.length > 0 ? roots : DEFAULT_ROOTS).filter(root => {
    try {
      return statSync(root).isDirectory();
    } catch {
      return false;
    }
  });

  if (scanned.length === 0) {
    console.error(
      `No directories to scan. Looked for: ${(roots.length > 0 ? roots : DEFAULT_ROOTS).join(", ")}`
    );
    process.exit(1);
  }

  const files = scanned.flatMap(root => sourceFiles(root));

  // A control on the walk, before any verdict is read from it. A broken walk reports every file
  // clean by reading none — the check below is satisfied by absence, which is exactly what it
  // must not be satisfied by.
  if (files.length < 100) {
    console.error(
      `Only ${files.length} source files found under ${scanned.join(", ")}. This repository has ` +
        "thousands, so that is a broken walk rather than a clean result."
    );
    process.exit(1);
  }

  const offences = [];
  for (const file of files) {
    for (const { why, comment } of offencesIn(readFileSync(file, "utf8"))) {
      offences.push(`${relative(process.cwd(), file)}\n    ${why} — ${comment}`);
    }
  }

  if (offences.length > 0) {
    console.error(
      `${offences.length} comment(s) narrate the process rather than describe the code:\n`
    );
    for (const offence of offences) console.error(`  ${offence}\n`);
    console.error(
      "Comments describe the code only. Rewrite each to state what the code does and why, " +
        "with no reference to reviews, tools, or the change itself."
    );
    process.exit(1);
  }

  console.log(
    `${files.length} source files across ${scanned.join(", ")}: no comment names a review, tool or change.`
  );
}

// Only when run directly, so the test can import the parts without the process exiting.
if (process.argv[1] && process.argv[1].endsWith("check-comment-convention.mjs")) {
  main();
}
