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
 * A SCRIPT rather than a test, because the rule is repository-wide and a test enforcing it
 * necessarily roots itself somewhere. A test rooted at its own directory covers one package
 * while reading, from the outside, exactly like repository coverage — and one reaching beyond
 * its package coupples that package to every other, which is what `layering.test.ts` guards
 * against elsewhere.
 *
 * Here the scope is an argument, so what is covered is visible at the call site.
 *
 * Usage:
 *   node scripts/check-comment-convention.mjs [roots...]      # defaults to packages apps e2e
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

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
    // Deliberately broad, and only safe because of REVIEW_DOMAIN_PATHS below. In code that does
    // not work on pull requests, naming one describes the change rather than the code. In code
    // that DOES, the same words are the subject matter: "the head comes from the REF, not from
    // the pull request object" and "has nothing to do with this pull request" are both correct
    // descriptions, and no expression over the words separates them from narration because only
    // the file's role differs. The role is declared by path instead of guessed at by pattern.
    pattern: /\b(this|the)\s+(PR|pull request)\b/i,
    why: "refers to the change rather than the code",
  },
  {
    // The ACTOR carries the verdict, not the verb. "the operator asked", "the caller asked" and
    // "the probe asked" are ordinary descriptions of a query; the same verb after a review actor
    // is a conversation. Anchoring on the verb alone would reject the first three, and anchoring
    // on neither would miss "the control Codex asked for".
    pattern:
      /\b(?:reviewer|reviewers|founder|maintainer)\s+(?:said|asked|requested|wanted|suggested|flagged|found)\b/i,
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
const EXCLUDED_FILES = new Set([
  // This file and its test, both of which necessarily contain what they forbid: the patterns
  // name the shapes, the prose explains why each was chosen, and the test holds fixtures of
  // every rejected form. Excluding two files by name is the honest fix; teaching the extractor
  // to tell a definition from a use would make it a parser, which is the unbounded surface this
  // deliberately is not.
  "check-comment-convention.mjs",
  "check-comment-convention.test.mjs",
]);

/**
 * Extensions this reads. The JS family is included because authored source lives there too —
 * config files, scripts, template sources — and a comment in one is as invisible to every other
 * check as a comment in a `.ts`.
 */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/** Directories that hold generated or vendored code rather than authored source. */
const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage"]);

/**
 * Paths whose SUBJECT is the review and release process, where this convention does not apply.
 *
 * The patterns match a name the code cannot own — a review tool, a pull request, a reviewer.
 * That reasoning holds for code that does something else, and inverts for code that works ON
 * pull requests: there the same words are the domain vocabulary, and "the head comes from the
 * REF, not from the pull request object" is a correct description of a value's origin. The text
 * is identical in both cases and only the file's role differs, so no expression over the words
 * can separate them.
 *
 * Declaring the role by path is therefore the honest form. The alternative is a pattern that
 * rejects correct prose in this tooling, and a check that rejects correct prose gets silenced -
 * which costs more detection than the narrower scope does.
 *
 * Matched as a path PREFIX against the repository-relative path, so a directory entry covers
 * everything beneath it.
 */
const REVIEW_DOMAIN_PATHS = [
  "scripts/ci-verdict",
  "scripts/verify-merge",
  "scripts/release/",
  ".claude/rules/",
];

/** True when `file` sits in tooling whose subject matter is the review or release process. */
export function isReviewDomain(file) {
  const path = relative(process.cwd(), file).split(sep).join("/");
  return REVIEW_DOMAIN_PATHS.some(prefix => path.startsWith(prefix));
}

/** Every TypeScript source file under `root`. */
export function sourceFiles(root) {
  const found = [];
  for (const entry of readdirSync(root)) {
    if (EXCLUDED_DIRS.has(entry) || EXCLUDED_FILES.has(entry)) continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some(ext => entry.endsWith(ext))) {
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
  // String, template and regex literals are blanked FIRST, preserving length and newlines. Their
  // contents can be comment-shaped — a fixture, an error message quoting one — and extracting
  // that reports on DATA rather than on prose. Blanking rather than removing keeps the following
  // patterns matching at the right offsets.
  const withoutLiterals = source
    .replace(/"(?:[^"\\\n]|\\.)*"/g, blankSpan)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, blankSpan)
    .replace(/`(?:[^`\\]|\\.)*`/g, blankSpan);

  const comments = [];
  for (const match of withoutLiterals.matchAll(/\/\*[\s\S]*?\*\//g)) {
    comments.push(match[0]);
  }
  for (const match of withoutLiterals.matchAll(/(^|[^:"'`\\])\/\/(.*)$/gm)) {
    comments.push(match[2]);
  }
  return comments;
}

/** Blank a span, preserving its length and any newlines so later offsets still line up. */
function blankSpan(match) {
  return match.replace(/[^\n]/g, " ");
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

/**
 * Scanned when no roots are given, which is how CI invokes it — so this list IS the enforced
 * scope, and anything missing from it is unchecked rather than checked elsewhere. `templates`
 * carries authored source that ships to users.
 */
export const DEFAULT_ROOTS = ["packages", "apps", "e2e", "templates", "scripts"];

function main() {
  const requested = process.argv.slice(2);
  const explicit = requested.length > 0;
  const roots = explicit ? requested : DEFAULT_ROOTS;

  const isDirectory = root => {
    try {
      return statSync(root).isDirectory();
    } catch {
      return false;
    }
  };

  // EVERY requested root must exist. Filtering the missing ones away lets a typo scan a smaller
  // scope than asked for and still report success — `packages templats` would check `packages`
  // and announce a clean result for a scope nobody requested.
  const missing = roots.filter(root => !isDirectory(root));
  if (missing.length > 0) {
    console.error(
      `Not a directory: ${missing.join(", ")}. Nothing was scanned; a partial scan would report ` +
        "a clean result for a scope that was never requested."
    );
    process.exit(1);
  }

  const files = roots.flatMap(root => sourceFiles(root));

  // A control on the walk, before any verdict is read from it: a broken walk reports every file
  // clean by reading none, and the check below is satisfied by absence.
  //
  // Applied only to the DEFAULT scan, whose expected size is a property of this repository. An
  // explicit root is a scope the caller chose and may legitimately hold a handful of files, so
  // the floor there is one — enough to catch a path that resolves to an empty directory.
  const floor = explicit ? 1 : 100;
  if (files.length < floor) {
    console.error(
      `Only ${files.length} source file(s) found under ${roots.join(", ")}, expected at least ` +
        `${floor}. That is a walk reading nothing rather than a clean result.`
    );
    process.exit(1);
  }

  const offences = [];
  let skipped = 0;
  for (const file of files) {
    if (isReviewDomain(file)) {
      skipped += 1;
      continue;
    }
    for (const { why, comment } of offencesIn(readFileSync(file, "utf8"))) {
      // Collapsed to one line and truncated. The extractor blanks string literals before
      // matching, so the stored text carries runs of spaces where data used to be; printing it
      // raw spreads a single finding over several ragged lines and buries which comment it is.
      const excerpt = comment.replace(/\s+/g, " ").trim().slice(0, 120);
      offences.push(`${relative(process.cwd(), file)}\n    ${why} — ${excerpt}`);
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

  // The skipped count is reported rather than left implicit: a file the scan declined to read
  // produces the same silence as a file it read and cleared, so a growing allowlist would shrink
  // what is actually checked while the summary line kept saying the same thing.
  console.log(
    `${files.length - skipped} of ${files.length} source files across ${roots.join(", ")}: ` +
      `no comment names a review, tool or change` +
      (skipped > 0 ? ` (${skipped} skipped as review-process tooling).` : ".")
  );
}

// Only when run directly, so the test can import the parts without the process exiting.
if (process.argv[1] && process.argv[1].endsWith("check-comment-convention.mjs")) {
  main();
}
