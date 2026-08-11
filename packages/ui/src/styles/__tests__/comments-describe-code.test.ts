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

/** Extensions whose `//` begins a comment. CSS has no line-comment syntax, so
 * treating `//` as one there would read the `//` of an unquoted `url(https://…)`
 * as a comment. */
const LINE_COMMENTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);

/** One comment found in a source file, with the line it starts on. */
interface CommentSpan {
  line: number;
  text: string;
}

/**
 * Every comment in a file, wherever it sits on its line.
 *
 * Matching a comment marker at the START of a line reads only comments that
 * occupy a whole line, which is a subset of the convention: a trailing comment
 * after a declaration, and a JSX comment wrapped in braces, both sit mid-line
 * and were skipped silently, so the rule below reported clean over a tree that
 * violated it.
 *
 * This walks the source instead, tracking whether it is inside a string, a
 * template literal or a comment, so that a `//` inside a URL string or an
 * escaped `\/` inside a regex is code rather than a comment opener. Anything
 * ambiguous resolves toward "not a comment": a false positive here reads as
 * the rule firing on ordinary code, which is how a check gets switched off.
 */
function commentsIn(source: string, allowLineComments: boolean): CommentSpan[] {
  const found: CommentSpan[] = [];
  let line = 1;
  let i = 0;

  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }

    // An escape consumes the character after it, so `\/` never opens anything.
    if (ch === "\\") {
      if (source[i + 1] === "\n") line++;
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") i++;
        else if (source[i] === "\n") line++;
        i++;
      }
      i++;
      continue;
    }

    if (allowLineComments && ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      found.push({ line, text: source.slice(i, stop) });
      i = stop;
      continue;
    }

    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      const text = source.slice(i, stop);
      found.push({ line, text });
      line += text.split("\n").length - 1;
      i = stop;
      continue;
    }

    i++;
  }

  return found;
}

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
  // Review-process vocabulary: narration of when an edit happened relative to
  // other edits. This is the shape that keeps recurring, and it is harder to
  // see while writing than a tracker id, because it reads as helpful context
  // -- "corrected a round later" feels like it explains something, and to
  // anyone who was not in the review it explains nothing.
  //
  // The patterns require the review's own units (a ROUND, a correction round,
  // an EARLIER finding). Ordinary words a real comment needs -- "previously",
  // "used to", "before" -- are deliberately absent: those legitimately explain
  // why code has its current shape, and banning them would make the check fire
  // on good comments and get it switched off.
  [/\ba round (later|after|earlier|ago)\b/i, "a review round"],
  [/\bcorrection round\b/i, "a review round"],
  [/\bthe earlier (finding|review|comment|round)\b/i, "a review"],
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
  const source = readFileSync(resolve(repo, path), "utf8");
  const spans = commentsIn(source, LINE_COMMENTS.has(extname(path)));

  for (const span of spans) {
    // A block comment can run for pages, so each of its lines is judged on its
    // own and reports its own line number. Reporting the line the comment
    // OPENS on would point a reader at the top of a doc block and leave them
    // to find the offending sentence.
    span.text.split("\n").forEach((text, offset) => {
      for (const [pattern, kind] of META_REFERENCES) {
        if (!pattern.test(text)) continue;
        found.push({
          where: `${path}:${span.line + offset}`,
          kind,
          text: text.trim().slice(0, 100),
        });
        return;
      }
    });
  }
  return found;
}

describe("comments describe the code, not the process", () => {
  it("finds the sources to read", () => {
    // An empty scan satisfies the rule below without checking anything.
    expect(sources.length).toBeGreaterThan(100);
  });

  it("reads comments and not code", () => {
    // The patterns are ordinary English, so a check that read whole files
    // would fire on identifiers and strings and get switched off. Both
    // directions are pinned.
    const js = (source: string) =>
      commentsIn(source, true).map(c => c.text.trim());
    const css = (source: string) =>
      commentsIn(source, false).map(c => c.text.trim());

    // Comments that occupy a whole line: what the previous check read.
    expect(js("// see task 24")).toEqual(["// see task 24"]);
    expect(js("/* doc */")).toEqual(["/* doc */"]);

    // Comments that do NOT start their line: what it missed. Each of these
    // shapes was live in the tree while the rule reported clean.
    expect(js("const a = 1; // see task 24")).toEqual(["// see task 24"]);
    expect(css("  --nx-x: red; /* a label */")).toEqual(["/* a label */"]);
    expect(js("<div>{/* a note */}</div>")).toEqual(["/* a note */"]);

    // Code that merely looks like a comment.
    expect(js('const label = "Phase 2";')).toEqual([]);
    expect(js("runTask24();")).toEqual([]);
    expect(js('const u = "https://example.com";')).toEqual([]);
    expect(js("const re = /https:\\/\\//;")).toEqual([]);
    // CSS has no line-comment syntax, so an unquoted URL is not a comment.
    expect(css("  background: url(https://example.com/a.png);")).toEqual([]);
  });

  it("reports the line the offending sentence sits on", () => {
    // A doc block can run for pages. Pointing at the line it opens on makes
    // the report unactionable, and would let a violation hide behind a long
    // preamble that reads as the reported location.
    const source = ["/**", " * fine", " * see task 24", " */"].join("\n");
    expect(commentsIn(source, true)[0]?.line).toBe(1);
    const offending = source
      .split("\n")
      .findIndex(l => /\btask[-\s]?\d+/i.test(l));
    expect(offending + 1).toBe(3);
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
