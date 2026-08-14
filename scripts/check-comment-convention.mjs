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
 * Here the scope is an argument, so a caller can narrow it without moving the check.
 *
 * Usage:
 *   node scripts/check-comment-convention.mjs             # DEFAULT_ROOTS, the repository-wide scan
 *   node scripts/check-comment-convention.mjs packages    # one root, for a faster local loop
 *
 * The allowlist's shrink check is skipped when roots are given explicitly, because a partial scan
 * cannot tell a fixed file from one it never opened.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
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
    // A numbered change, with or without a roadmap-item prefix: "PR 4 migration", "F11 PR 3".
    // Mechanically distinct from the deictic form below and far more common, because it survives
    // being copied between files - the number keeps naming a change nobody can now look up.
    pattern: /\b(?:[a-z]\d+\s+)?PR\s+\d+/i,
    why: "names a numbered change rather than the code",
    // Suppressed in review tooling, where a pull-request number is the subject matter.
    domainVocabulary: true,
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
    domainVocabulary: true,
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
export const EXCLUDED_FILES = new Set([
  // This file and its test, both of which necessarily contain what they forbid: the patterns
  // name the shapes, the prose explains why each was chosen, and the test holds fixtures of
  // every rejected form. Excluding two files by name is the honest fix; teaching the extractor
  // to tell a definition from a use would make it a parser, which is the unbounded surface this
  // deliberately is not.
  "scripts/check-comment-convention.mjs",
  "scripts/check-comment-convention.test.mjs",
]);

/**
 * Extensions this reads. The JS family is included because authored source lives there too —
 * config files, scripts, template sources — and a comment in one is as invisible to every other
 * check as a comment in a `.ts`.
 */
export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  // CSS is authored source that ships to users, and its block comments reach the same extractor.
  ".css",
];

/**
 * Options for reading one path, by dialect.
 *
 * CSS has block comments and no line comments. Reading `//` as one there would take an unquoted
 * `url(https://...)` - legal CSS - as a comment running to the end of the line, and report
 * whatever the rest of that URL happens to spell.
 */
export function readOptionsFor(path) {
  return {
    lineComments: !path.endsWith(".css"),
    domainVocabularyAllowed: isReviewDomain(path),
  };
}

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

/** The comments that predate this check, as a path to per-file count. */
export const ALLOWLIST_FILE = "scripts/comment-convention-allowlist.json";

/**
 * The allowlist, validated.
 *
 * It records what the repository already contained when the check went live, so the rule can be
 * enforced from the first commit without rewriting comments whose authors are better placed to
 * rewrite them. Counts are per file rather than a single total: a bare list would exempt a file
 * entirely, so a NEW offence added to an already-listed file would land unnoticed - which is the
 * case the check most needs to catch.
 *
 * A malformed file aborts rather than degrading to an empty allowlist. Empty would read as "no
 * exemptions", turn every pre-existing comment into a failure, and present a parse error as a
 * wave of unrelated findings.
 */
export function readAllowlist(root = process.cwd()) {
  const raw = JSON.parse(readFileSync(join(root, ALLOWLIST_FILE), "utf8"));
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${ALLOWLIST_FILE} must be an object mapping each path to its entry`);
  }
  for (const [path, entry] of Object.entries(raw)) {
    const shaped =
      entry !== null &&
      typeof entry === "object" &&
      Number.isInteger(entry.count) &&
      entry.count >= 1 &&
      typeof entry.digest === "string" &&
      entry.digest.length > 0;
    if (!shaped) {
      throw new Error(
        `${ALLOWLIST_FILE}: ${path} must be { count: positive integer, digest: string }`
      );
    }
  }
  return new Map(Object.entries(raw));
}

/**
 * A stable identity for the offences recorded against one file.
 *
 * A count alone cannot tell a recorded comment from a different one that replaced it: deleting the
 * exempted comment and adding a new offence in the same change leaves the total unchanged, so a
 * count comparison accepts it and the shrink check sees no reduction either. Hashing the offences
 * themselves closes that, because the substitution changes the digest even when the number is
 * identical.
 *
 * Sorted so a reordering is not a change, and whitespace-collapsed so reflowing a comment across
 * lines is not either. Both would otherwise fail as new offences and teach people to regenerate
 * the file, which is the habit that turns a record into a rubber stamp.
 */
/** One line, capped, for display only - never for the digest, which needs the whole text. */
function shorten(text) {
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

export function digestOffences(offences) {
  const normalised = offences
    .map(one => one.replace(/\s+/g, " ").trim())
    .sort()
    .join("\u0000");
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}

/**
 * Every authored source file under `root`, taken from git's index rather than from the
 * filesystem.
 *
 * A directory walk reads whatever is on disk, and what is on disk depends on which build and
 * test commands the machine has run. `apps/playground/.next-e2e/` holds compiled bundles that
 * embed the comments of every module they bundle, so a walk reports them as findings, attributes
 * them to a generated path, and does so only on machines where that directory happens to exist -
 * clean in a fresh worktree, twenty findings after an e2e run, from identical sources.
 *
 * Extending the excluded-name list cannot close that. `.next` was listed and `.next-e2e` was
 * not, and the next tool to add an output directory reopens it. Tracked-ness is the property
 * actually wanted: generated output is ignored, authored source is committed, and git already
 * holds that answer exactly.
 *
 * `-z` because a path may contain a newline, and `--` so a root that looks like a flag is still
 * read as a path.
 */
export function sourceFiles(root) {
  const listed = execFileSync("git", ["ls-files", "-z", "--", root], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return listed
    .split("\0")
    .filter(Boolean)
    .filter(path => SOURCE_EXTENSIONS.some(ext => path.endsWith(ext)))
    .filter(path => {
      const parts = path.split("/");
      return (
        !parts.some(part => EXCLUDED_DIRS.has(part)) &&
        // Matched on the whole repository-relative path. A basename comparison would exempt any
        // file anywhere in the monorepo that happened to share the name, so a package adding its
        // own copy would drop out of the scan without the exclusion list changing.
        !EXCLUDED_FILES.has(path)
      );
    });
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
export function commentText(source, { lineComments = true } = {}) {
  // A single left-to-right pass rather than a chain of replacements, because what a character
  // MEANS depends on what preceded it and a regular expression cannot carry that.
  //
  // Three cases forced it, each of which a replacement chain gets wrong in a different direction:
  //
  //   - a template's `${...}` holds executable code, so blanking the template whole hides any
  //     comment written inside the interpolation;
  //   - a template inside that interpolation nests, so no fixed pattern closes at the right
  //     backtick;
  //   - `/` opens a regular expression in some positions and divides in others, and only the
  //     preceding token separates them. Blanking none reads `/[//] x/` as a comment; blanking
  //     every `/.../` eats division.
  //
  // Comment TEXT is returned from the original source, so quoted narration inside a genuine
  // comment survives — `// "Codex flagged this"` is an offence and reads as one.
  const comments = [];
  const n = source.length;
  // Brace depth per open template, so an interpolation ends at ITS matching `}` and not at the
  // first one. An empty stack means no template is open.
  const templates = [];
  let previous = ""; // last significant character, for the regex-or-division decision
  let i = 0;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      comments.push(source.slice(i, stop));
      i = stop;
      previous = "";
      continue;
    }

    if (c === "/" && next === "/" && lineComments) {
      let stop = source.indexOf("\n", i);
      if (stop === -1) stop = n;
      comments.push(source.slice(i + 2, stop));
      i = stop;
      previous = "";
      continue;
    }

    if (c === '"' || c === "'") {
      i = skipQuoted(source, i, c);
      previous = c;
      continue;
    }

    if (c === "`") {
      templates.push(0);
      i += 1;
      previous = "";
      continue;
    }

    if (templates.length > 0 && c === "$" && next === "{") {
      templates[templates.length - 1] += 1;
      i += 2;
      previous = "";
      continue;
    }

    if (templates.length > 0 && templates[templates.length - 1] === 0) {
      // Raw template text: skip it, honouring escapes, and close on the backtick.
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") templates.pop();
      i += 1;
      continue;
    }

    if (templates.length > 0 && c === "}") {
      templates[templates.length - 1] -= 1;
      i += 1;
      previous = "}";
      continue;
    }

    if (c === "/" && startsRegex(previous)) {
      i = skipRegex(source, i);
      previous = "/";
      continue;
    }

    if (!/\s/.test(c)) previous = c;
    i += 1;
  }

  return comments;
}

/** Index just past a `'`/`"` literal opened at `start`, honouring escapes and unterminated input. */
function skipQuoted(source, start, quote) {
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    // A newline ends an unterminated quote rather than consuming the rest of the file, so one
    // stray apostrophe in prose cannot swallow every comment below it.
    if (c === quote || c === "\n") return i + 1;
    i += 1;
  }
  return i;
}

/** Index just past a regular-expression literal opened at `start`, including its character class. */
function skipRegex(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "\n") return i;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    // A `/` inside `[...]` is data, which is what makes `/[//] Codex/` a literal and not a comment.
    else if (c === "/" && !inClass) return i + 1;
    i += 1;
  }
  return i;
}

/**
 * Whether a `/` in this position opens a regular expression rather than dividing.
 *
 * Decided by the preceding significant character: division follows a VALUE — an identifier, a
 * number, or a closing bracket — and everything else is a position where a value is expected.
 * Being wrong towards "regex" would consume code as literal text, so the value set is the one
 * enumerated and the default is division.
 */
function startsRegex(previous) {
  if (previous === "") return true;
  return !/[\w$)\]]/.test(previous);
}

/** Blank a span, preserving its length and any newlines so later offsets still line up. */
function blankSpan(match) {
  return match.replace(/[^\n]/g, " ");
}

/** Every forbidden shape found in `source`, as `{ why, comment }`. */
export function offencesIn(source, options) {
  // A review-domain file is exempt from the pull-request VOCABULARY and from nothing else.
  // Naming a review tool or quoting a reviewer is narration wherever it appears, including in
  // the tooling that reads pull requests, so skipping the whole pattern set there left a hole
  // exactly the size of the rule.
  const patterns = options?.domainVocabularyAllowed
    ? FORBIDDEN.filter(entry => entry.domainVocabulary !== true)
    : FORBIDDEN;
  const found = [];
  for (const comment of commentText(source, options)) {
    for (const { pattern, why } of patterns) {
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
/**
 * The default scan.
 *
 * `.` is first and covers the other five, which are kept because they are what the scope MEANS:
 * a reader checking whether a directory is enforced can see it named, and the accompanying test
 * asserts each one contributes files. Paths are de-duplicated in `main`, so the overlap costs a
 * set insertion and nothing else.
 *
 * Without `.` the two tracked config files at the repository root - `eslint.config.mjs` and
 * `lint-staged.config.mjs` - sit outside every named root, so a forbidden comment in either
 * leaves the repository-wide gate reporting clean.
 */
export const DEFAULT_ROOTS = [
  ".",
  "packages",
  "apps",
  "e2e",
  "templates",
  "scripts",
];

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

  // De-duplicated because the default roots overlap deliberately: `.` covers the named ones, and
  // a file listed twice would be scanned twice and counted twice against its allowlist entry.
  const files = [...new Set(roots.flatMap(root => sourceFiles(root)))];

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

  const byFile = new Map();
  let skipped = 0;
  for (const file of files) {
    // Review tooling is READ, not skipped. It is exempt from the pull-request vocabulary only,
    // which readOptionsFor carries; every other pattern still applies to it.
    if (isReviewDomain(file)) skipped += 1;
    for (const { why, comment } of offencesIn(readFileSync(file, "utf8"), readOptionsFor(file))) {
      // Stored WHOLE, and shortened only where it is printed.
      //
      // The digest is taken over these strings, so anything dropped here is text the identity
      // check cannot see: truncating first would let the tail of a long comment be rewritten
      // while its first hundred characters, and therefore its digest, stayed the same.
      //
      // Whitespace is collapsed because that is not a difference worth failing on - a comment
      // reflowed across lines is the same comment - and doing it here keeps the stored form and
      // the hashed form identical rather than normalising twice.
      const text = comment.replace(/\s+/g, " ").trim();
      const path = relative(process.cwd(), file).split(sep).join("/");
      byFile.set(path, [...(byFile.get(path) ?? []), `${why} — ${text}`]);
    }
  }

  const allowlist = readAllowlist();
  const failures = [];

  for (const [path, found] of byFile) {
    const entry = allowlist.get(path);
    if (!entry) {
      failures.push(
        `${path} — ${found.length} offence(s), 0 allowed:\n` +
          found.map(one => `      ${shorten(one)}`).join("\n")
      );
      continue;
    }
    if (found.length > entry.count) {
      failures.push(
        `${path} — ${found.length} offence(s), ${entry.count} allowed:\n` +
          found.map(one => `      ${shorten(one)}`).join("\n")
      );
      continue;
    }
    // Same count, different comments. Without this a file may trade its exempted comment for a
    // new one and the totals still agree, which is the one substitution a counted baseline cannot
    // see.
    if (found.length === entry.count && digestOffences(found) !== entry.digest) {
      failures.push(
        `${path} — ${found.length} offence(s) as recorded, but not the same ones:\n` +
          found.map(one => `      ${shorten(one)}`).join("\n")
      );
    }
  }

  // Entries whose file now holds fewer offences than recorded, which is what makes the allowlist
  // shrink rather than merely stop growing.
  //
  // Checked only on the DEFAULT scan. An explicit root deliberately reads part of the repository,
  // so every allowlisted path outside it holds zero offences as far as that scan can tell, and
  // treating those as fixed would walk the allowlist to nothing on the strength of files nobody
  // opened.
  if (!explicit) {
    for (const [path, entry] of allowlist) {
      const allowed = entry.count;
      const found = byFile.get(path)?.length ?? 0;
      if (found >= allowed) continue;
      failures.push(
        found === 0
          ? `${path} — no offences remain; delete its entry from ${ALLOWLIST_FILE}`
          : `${path} — ${found} offence(s) remain but ${allowed} allowed; lower it to ${found}`
      );
    }
  }

  if (failures.length > 0) {
    console.error(`${failures.length} file(s) disagree with ${ALLOWLIST_FILE}:\n`);
    for (const failure of failures) console.error(`  ${failure}\n`);
    console.error(
      "Comments describe the code only: state what the code does and why, with no reference to " +
        "reviews, tools, or the change itself.\n" +
        "The allowlist records what predated this check and may only shrink. Do not add an entry " +
        "to silence a new comment; rewrite the comment."
    );
    process.exit(1);
  }

  // Both counts are reported rather than left implicit. A file the scan declined to read and a
  // file it read and cleared produce the same silence, so without these a growing allowlist or a
  // widening path exemption would shrink what is actually checked while this line kept saying the
  // same thing.
  const exempt = [...allowlist.values()].reduce((sum, entry) => sum + entry.count, 0);
  console.log(
    `${files.length - skipped} of ${files.length} source files across ${roots.join(", ")}: ` +
      "no new comment names a review, tool or change" +
      (skipped > 0 ? `; ${skipped} read with the pull-request vocabulary allowed` : "") +
      (exempt > 0 ? `; ${exempt} pre-existing offence(s) still allowlisted` : "") +
      "."
  );
}

// Only when run directly, so the test can import the parts without the process exiting.
if (process.argv[1] && process.argv[1].endsWith("check-comment-convention.mjs")) {
  main();
}
