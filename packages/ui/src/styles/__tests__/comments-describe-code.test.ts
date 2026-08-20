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

/**
 * One comment found in a source file, with the line it starts on.
 *
 * `startsLine` and `endsLine` record whether code shares the comment's opening
 * and closing lines. They are what separates a comment that CONTINUES onto the
 * next line from one that merely sits above another: two trailing comments on
 * consecutive statements are adjacent, but code stands between them, so they
 * are two remarks rather than one sentence.
 */
interface CommentSpan {
  line: number;
  text: string;
  startsLine: boolean;
  endsLine: boolean;
}

/** Whether only whitespace precedes `index` on its line. */
function onlySpaceBefore(source: string, index: number): boolean {
  for (let j = index - 1; j >= 0; j--) {
    const ch = source[j] as string;
    if (ch === "\n") return true;
    if (ch !== " " && ch !== "\t" && ch !== "\r") return false;
  }
  return true;
}

/** Whether only whitespace follows `index` on its line. */
function onlySpaceAfter(source: string, index: number): boolean {
  for (let j = index; j < source.length; j++) {
    const ch = source[j] as string;
    if (ch === "\n") return true;
    if (ch !== " " && ch !== "\t" && ch !== "\r") return false;
  }
  return true;
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
      found.push({
        line,
        text: source.slice(i, stop),
        startsLine: onlySpaceBefore(source, i),
        // A line comment runs to the newline by definition, so nothing can
        // follow it on its own line.
        endsLine: true,
      });
      i = stop;
      continue;
    }

    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      const text = source.slice(i, stop);
      found.push({
        line,
        text,
        startsLine: onlySpaceBefore(source, i),
        endsLine: onlySpaceAfter(source, stop),
      });
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
  // Narrating the edit as a sequence of attempts. Distinct from the patterns
  // above, which name the review's units: this names the CHANGE's own
  // instalments, and reads as helpful because it explains why the code looks
  // partial -- to anyone who did not watch it being written, it explains
  // nothing and dates the file.
  //
  // Kept narrow on purpose. "the fix is" and "fixes" are ordinary and stay
  // legal; only a fix described as arriving in parts is caught.
  //
  // "attempt" does not belong here: it cannot be separated from legitimate
  // algorithmic prose. "The first attempt to connect uses IPv6" describes
  // runtime behaviour rather than an edit, and this repository uses that
  // wording to explain an implementation. A pattern that fires on good
  // comments costs more than the narration it catches, because a check people
  // believe is wrong gets switched off entirely.
  [/\b(first|second|third) half of (a|the) fix\b/i, "an edit sequence"],
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

/** A comment line with its markers removed, so two can be joined as prose. */
const strip = (line: string): string =>
  line.replace(/^\s*(\/\*+|\*\/|\/\/|\*)\s*/, "").replace(/\s*\*\/\s*$/, "");

/**
 * A comment line reduced to the exact text the rule searches.
 *
 * The joined run and the offset that decides which line owns a match must be
 * measured in ONE coordinate space. Collapsing whitespace after joining, while
 * taking the offset from the raw text, makes the offset too large by however
 * much whitespace the first line held -- so a phrase beginning on the SECOND
 * line lands under the boundary, is charged to the first, and is then reported
 * again when the second line is reached. Normalising each line before it is
 * joined leaves nothing for the join to collapse, so the two agree by
 * construction rather than by being kept in step.
 */
const normalize = (line: string): string =>
  strip(line).replace(/\s+/g, " ").trim();

/**
 * Every PHYSICAL comment line in the file, in source order.
 *
 * A span is a poor unit to reason in, because the two comment syntaxes span
 * differently: a block comment holds all of its lines, while each `//` run is
 * a span of its own. Prose that wraps across two `//` lines is therefore two
 * spans, and anything looking one line ahead inside a span never sees it.
 *
 * Flattening first makes the two syntaxes indistinguishable to the rule below,
 * so a phrase is caught wherever it wraps rather than only where the syntax
 * happened to keep it together.
 */
function commentLines(spans: CommentSpan[]): CommentSpan[] {
  return spans.flatMap(span => {
    const lines = span.text.split("\n");
    return lines.map((text, offset) => ({
      line: span.line + offset,
      text,
      // Code can only sit before a comment's FIRST line and after its LAST.
      // Every line in between is bounded by the comment itself, so nothing
      // there can interrupt the prose.
      startsLine: offset === 0 ? span.startsLine : true,
      endsLine: offset === lines.length - 1 ? span.endsLine : true,
    }));
  });
}

/** The rule itself, over source text, so both directions can be pinned. */
function violationsInSource(
  source: string,
  allowLineComments: boolean,
  label: string
): Violation[] {
  const found: Violation[] = [];
  // A block comment can run for pages, so each of its lines is judged on its
  // own and reports its own line number. Reporting the line the comment OPENS
  // on would point a reader at the top of a doc block and leave them to find
  // the offending sentence.
  const lines = commentLines(commentsIn(source, allowLineComments));

  lines.forEach((current, index) => {
    // Each line is searched joined to the WHOLE uninterrupted run that follows
    // it, with comment markers stripped, because prose wraps and a pattern is
    // not a line. Matching per line lets any phrase escape through a line
    // break -- an escape hatch that opens by accident whenever a comment is
    // reflowed.
    //
    // The run is what makes that airtight, and a PAIR does not: a pair only
    // sees a phrase that breaks once, so "second" / "half of a" / "fix" across
    // three lines walks through a rule that joins two, and every further wrap
    // is another way out. Accumulating the run removes the limit rather than
    // raising it, so the number of breaks stops mattering.
    //
    // A run continues only where the prose is UNINTERRUPTED: adjacent lines,
    // the earlier reaching the end of its line, the later beginning with its
    // comment. Physical adjacency is not continuity -- two trailing comments
    // on consecutive statements have code between them, and joining those
    // turns two innocent remarks into a phrase neither of them made.
    //
    // A rule that invents its own violations gets switched off faster than one
    // that misses some, so both directions are pinned below.
    // A BLANK comment line ends the paragraph. It satisfies every continuity
    // test above -- adjacent, reaching its newline, beginning with its marker
    // -- so nothing else here stops a run reading across the gap between two
    // paragraphs and building a phrase out of the end of one and the start of
    // the next, neither of which said it.
    //
    // Nothing else INTENTIONALLY, at least. An empty line normalises to "",
    // which puts a second space in the join, and every pattern above wants a
    // single literal space -- so today the gap is bridged by an accident of
    // the pattern list rather than by a decision. This makes it a decision,
    // and keeps it true for a pattern written with `\s+`.
    const parts = [normalize(current.text)];
    for (let j = index; ; j++) {
      const here = lines[j];
      const after = lines[j + 1];
      if (here === undefined || after === undefined) break;
      if (after.line !== here.line + 1) break;
      if (!here.endsLine || !after.startsLine) break;
      const text = normalize(after.text);
      if (text === "") break;
      parts.push(text);
    }
    const joined = parts.join(" ");

    // Every line of a run searches the same tail, so requiring the match to
    // BEGIN inside this line's own text keeps the report on the line a reader
    // should open, instead of repeating one phrase against every line above
    // it. A blank comment line has nothing to start on and matches nothing.
    const ownLength = (parts[0] as string).length;

    for (const [pattern, kind] of META_REFERENCES) {
      const match = pattern.exec(joined);
      if (match === null || match.index >= ownLength) continue;
      found.push({
        where: `${label}:${current.line}`,
        kind,
        text: current.text.trim().slice(0, 100),
      });
      return;
    }
  });
  return found;
}

function violationsIn(path: string): Violation[] {
  return violationsInSource(
    readFileSync(resolve(repo, path), "utf8"),
    LINE_COMMENTS.has(extname(path)),
    path
  );
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

  it("matches a phrase that wraps, in either comment syntax", () => {
    const kinds = (source: string) =>
      violationsInSource(source, true, "x.ts").map(v => `${v.where} ${v.kind}`);

    // Unwrapped: the baseline the patterns were written against.
    expect(kinds("// this is the second half of a fix")).toEqual([
      "x.ts:1 an edit sequence",
    ]);

    // Wrapped inside one block comment: all of its lines live in one span.
    expect(
      kinds(
        ["/**", " * this is the second half of a", " * fix", " */"].join("\n")
      )
    ).toEqual(["x.ts:2 an edit sequence"]);

    // Wrapped across two line comments. Each `//` run is a SEPARATE span, so a
    // rule that looks ahead only within a span never sees this pair, and every
    // pattern here can be evaded by pressing return.
    expect(
      kinds(["// this is the second half of a", "// fix"].join("\n"))
    ).toEqual(["x.ts:1 an edit sequence"]);

    // A trailing comment wrapping into a standalone one, which is how a real
    // comment grows past the line width.
    expect(
      kinds(["const a = 1; // the second half of a", "// fix"].join("\n"))
    ).toEqual(["x.ts:1 an edit sequence"]);

    // Comments that are not physically adjacent must NOT be joined. Splicing
    // every comment onto the next one in source order would manufacture
    // phrases nobody wrote, anywhere in a file.
    expect(
      kinds(["// the second half of a", "const a = 1;", "// fix"].join("\n"))
    ).toEqual([]);

    // Two TRAILING comments on consecutive statements are adjacent lines but
    // not continuous prose: code separates them, so they are two remarks about
    // two declarations. Joining them invents a phrase out of both halves and
    // fails CI on comments that are individually fine.
    expect(
      kinds(
        ["const a = 1; // see phase", "const b = 2; // 2 of the run"].join("\n")
      )
    ).toEqual([]);

    // The mirror case: prose can only continue where the first comment runs to
    // the end of its line. Here code follows the block comment, so what comes
    // next is a new thought and not a continuation.
    expect(
      kinds(["const a = /* phase */ 1;", "// 2 of the run"].join("\n"))
    ).toEqual([]);

    // THREE lines, and four. A rule that joins a line to its single successor
    // catches neither, and each further wrap would be another way out -- so
    // what is pinned here is that the count of breaks does not matter.
    expect(
      kinds(["// this is the second", "// half of a", "// fix"].join("\n"))
    ).toEqual(["x.ts:1 an edit sequence"]);
    expect(
      kinds(
        ["/**", " * this is the second", " * half of", " * a fix", " */"].join(
          "\n"
        )
      )
    ).toEqual(["x.ts:2 an edit sequence"]);

    // A run is searched from every line in it, so the phrase must be reported
    // ONCE, against the line it starts on -- not against each line above it.
    expect(
      kinds(["// nothing here", "// or here", "// see task 24"].join("\n"))
    ).toEqual(["x.ts:3 a task number"]);

    // Interrupting the run still stops it, however long the run is.
    expect(
      kinds(
        [
          "// this is the second",
          "// half of a",
          "const a = 1;",
          "// fix",
        ].join("\n")
      )
    ).toEqual([]);

    // A BLANK comment line ends the paragraph, so a run cannot read across the
    // gap and build a phrase from the end of one paragraph and the start of
    // the next.
    //
    // These two cases cannot currently FAIL, and that is worth saying rather
    // than leaving for someone to discover. Without the explicit stop, a blank
    // line still separates the paragraphs by accident: it normalises to an
    // empty string, which contributes a SECOND space to the join, and every
    // pattern above matches a single literal space. So the guard is protecting
    // against a property of the pattern list, not against a live defect --
    // add one pattern written with `\s+` and the accident stops holding while
    // the guard keeps working. Pinned as a regression guard on that basis.
    expect(
      kinds(
        ["// an explanation ending in phase", "//", "// 2 starts a topic"].join(
          "\n"
        )
      )
    ).toEqual([]);
    expect(
      kinds(
        [
          "/**",
          " * an explanation ending in phase",
          " *",
          " * 2 starts a topic",
          " */",
        ].join("\n")
      )
    ).toEqual([]);

    // Whitespace inside a line must not move which line owns a match. This
    // first line normalises far shorter than it reads, and a boundary measured
    // on the raw text would charge the phrase below to it -- then report the
    // same phrase again on the line that actually contains it.
    expect(
      kinds(["//    spaced     out     here", "// see task 24"].join("\n"))
    ).toEqual(["x.ts:2 a task number"]);
  });

  // Timed out against vitest's 5s default on a loaded CI runner while taking
  // ~200ms locally — a 25x margin, so the threshold was measuring the machine
  // rather than the code. This walk reads every source file under three trees
  // and grows with the repository, and there is nothing here whose SPEED is
  // the property under test, so the budget is stated generously on purpose.
  it("has no comment pointing outside the codebase", () => {
    const violations = sources.flatMap(violationsIn);

    expect(
      violations.map(v => `${v.where} references ${v.kind}: ${v.text}`),
      `A comment points at something a future reader cannot open. Write the ` +
        `REASON instead: what the code does and why it does it that way. If ` +
        `the reason is genuinely a decision record, it belongs in a document, ` +
        `not in a reference the code cannot resolve.`
    ).toEqual([]);
  }, 60_000);
});
