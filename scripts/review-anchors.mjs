/**
 * Which of a review's comments GitHub can anchor to a line of the diff, and
 * which have to open a file-level thread instead.
 *
 * GitHub refuses a whole review, with a 422 that does not say which comment,
 * when a single inline comment names a line the diff does not show. So every
 * comment is checked here, against the hunks GitHub itself lists for the
 * change, before the review is posted:
 *
 * - a comment whose line the diff shows stays inline;
 * - a comment that names no line, or a line the diff does not show, becomes a
 *   file-level comment on its file, which opens a thread as an inline one does;
 * - a comment on a file the diff does not change can open no thread at all, so
 *   it is refused, and nothing is posted: a finding with no thread is one
 *   nothing requires anyone to answer.
 *
 * `node scripts/review-anchors.mjs <review> <files> <inline review> <file comments>`
 * reads the review and GitHub's list of changed files, and writes the review
 * to post and its file-level comments to the last two paths.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isCliEntry } from "./cli-entry.mjs";

/**
 * How one line of a patch moves the two line counters, and the side it shows
 * a line on: an added line is the new file's, a removed line the old file's,
 * and a context line is the new file's too, since that is the side GitHub
 * anchors an unchanged line on.
 */
const LINE_KINDS = {
  "+": { side: "RIGHT", left: 0, right: 1 },
  "-": { side: "LEFT", left: 1, right: 0 },
  " ": { side: "RIGHT", left: 1, right: 1 },
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * The lines one file's patch shows, by side, each mapped to the hunk it is
 * in: a comment spanning several lines has to stay within one hunk. A line
 * outside every hunk, such as `\ No newline at end of file`, shows nothing.
 */
export function shownLines(patch) {
  const shown = { LEFT: new Map(), RIGHT: new Map() };
  const at = { left: 0, right: 0, hunk: -1 };
  for (const text of (patch ?? "").split("\n")) readLine(shown, at, text);
  return shown;
}

function readLine(shown, at, text) {
  const header = HUNK_HEADER.exec(text);
  if (header) Object.assign(at, { left: Number(header[1]), right: Number(header[2]), hunk: at.hunk + 1 });
  else if (at.hunk >= 0 && LINE_KINDS[text[0]]) advance(shown, at, LINE_KINDS[text[0]]);
}

function advance(shown, at, kind) {
  shown[kind.side].set(kind.side === "LEFT" ? at.left : at.right, at.hunk);
  at.left += kind.left;
  at.right += kind.right;
}

/**
 * Whether GitHub anchors an inline comment: its line is shown on its side, and
 * when it spans lines, its first line is shown on the same side, earlier, in
 * the same hunk. A comment that names no line is not an inline one.
 */
export function anchors(comment, shownByPath) {
  const shown = shownOnSide(comment, shownByPath);
  const hunk = shown.get(comment.line);
  if (hunk === undefined) return false;
  return comment.start_line === undefined || startsInHunk(comment, shown, hunk);
}

/** A comment's side, the new file's when it names none. */
const sideOf = comment => comment.side ?? "RIGHT";

/** The lines the diff shows on a comment's side of its file: none, for a file it does not change. */
function shownOnSide(comment, shownByPath) {
  return shownByPath.get(comment.path)?.[sideOf(comment)] ?? new Map();
}

function startsInHunk(comment, shown, hunk) {
  return (comment.start_side ?? sideOf(comment)) === sideOf(comment) && comment.start_line < comment.line && shown.get(comment.start_line) === hunk;
}

/**
 * The review with only the comments that anchor, and the others as file-level
 * comments on their files, each saying which lines it was about. Throws when
 * a comment is malformed or names a file the diff does not change.
 */
export function splitComments(review, files) {
  const shownByPath = new Map(files.map(file => [file.filename, shownLines(file.patch)]));
  for (const comment of review.comments) checkComment(comment, shownByPath);
  const inline = review.comments.filter(comment => anchors(comment, shownByPath));
  const elsewhere = review.comments.filter(comment => !inline.includes(comment));
  return { review: { ...review, comments: inline.map(withSides) }, fileComments: elsewhere.map(fileComment) };
}

/**
 * An inline comment with the sides it was checked on written out. Left out,
 * they would be GitHub's to supply, and GitHub documents no default for them,
 * so the comment could be refused, or placed on a side it was not checked on.
 * A range that anchors starts on the side it ends on.
 */
function withSides(comment) {
  const side = sideOf(comment);
  return comment.start_line === undefined ? { ...comment, side } : { ...comment, side, start_side: side };
}

/** Whether a payload entry has the two fields every comment needs. */
const isComment = comment => typeof comment?.path === "string" && typeof comment.body === "string";

function checkComment(comment, shownByPath) {
  if (!isComment(comment)) throw new Error("a comment is not an object with a string path and body");
  if (!shownByPath.has(comment.path)) throw new Error(`a comment is on ${comment.path}, which the diff does not change, so it could open no thread`);
}

function fileComment(comment) {
  if (comment.line === undefined) return { path: comment.path, body: comment.body };
  const lines = comment.start_line === undefined ? `line ${comment.line}` : `lines ${comment.start_line}–${comment.line}`;
  return { path: comment.path, body: `_About ${lines}, which the diff does not show inline._\n\n${comment.body}` };
}

if (isCliEntry(import.meta.url)) {
  const [reviewPath, filesPath, inlinePath, fileCommentsPath] = process.argv.slice(2);
  const read = path => JSON.parse(readFileSync(path, "utf8"));
  const { review, fileComments } = splitComments(read(reviewPath), read(filesPath));
  writeFileSync(inlinePath, JSON.stringify(review));
  writeFileSync(fileCommentsPath, JSON.stringify(fileComments));
  console.log(`${review.comments.length} inline, ${fileComments.length} file-level`);
}
