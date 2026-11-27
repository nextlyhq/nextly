/**
 * What changed between two versions of a source text, word by word, for the
 * review of an out-of-date translation.
 *
 * Both texts are already in the browser, so the comparison is made here rather
 * than by the version history's server-side one; it answers in the same runs,
 * so both are drawn by the same marks.
 *
 * @module components/features/translations/review/source-text-diff
 */

import type { TextSegment } from "@admin/services/versionApi";

/**
 * The most pairs of pieces compared one by one. Past it a text is compared by
 * lines, and past it again as a whole: coarser marks, never wrong ones, and no
 * frozen page.
 */
const MAX_COMPARED_PAIRS = 1_000_000;

/** Present only in the earlier text, in both, or only in the later one. */
type Op = TextSegment["op"];

/**
 * The text's words, spaces and punctuation, in order; joined, they are the
 * text. Segmented where the runtime can, so a language written without spaces
 * still divides into words. Otherwise by letters with their combining marks,
 * so a vowel mark in Arabic stays with the word it is on.
 */
function wordsOf(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const words = new Intl.Segmenter(undefined, { granularity: "word" });
    return Array.from(words.segment(text), part => part.segment);
  }
  return text.match(/[\p{L}\p{M}\p{N}]+|\s+|[^\p{L}\p{M}\p{N}\s]/gu) ?? [];
}

/** The text's lines, each with its line break; joined, they are the text. */
function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

/** Appends a run, joining it to the last one where both are the same. */
function append(runs: TextSegment[], op: Op, text: string): void {
  if (text === "") return;
  const last = runs[runs.length - 1];
  if (last?.op === op) last.text += text;
  else runs.push({ op, text });
}

/** The pieces kept and changed, by their longest common subsequence. */
function comparePieces(
  before: readonly string[],
  after: readonly string[]
): TextSegment[] {
  const width = after.length + 1;
  // Each cell is the length of the longest sequence common to what is left of
  // both. It is at most the shorter side's length, so 16 bits hold it: the
  // product of the two is capped.
  const common = new Uint16Array((before.length + 1) * width);
  const at = (i: number, j: number): number => common[i * width + j];
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      common[i * width + j] =
        before[i] === after[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const runs: TextSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      append(runs, 0, before[i]);
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      append(runs, -1, before[i]);
      i++;
    } else {
      append(runs, 1, after[j]);
      j++;
    }
  }
  append(runs, -1, before.slice(i).join(""));
  append(runs, 1, after.slice(j).join(""));
  return runs;
}

/** How many pieces both lists begin with, and then how many both end with. */
function sharedEnds(
  before: readonly string[],
  after: readonly string[]
): { start: number; end: number } {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < shorter - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  return { start, end };
}

/** Compares in the finest pieces the two texts are short enough for. */
function compare(before: string, after: string): TextSegment[] {
  for (const piecesOf of [wordsOf, linesOf]) {
    const earlier = piecesOf(before);
    const later = piecesOf(after);
    // What both begin and end with needs no comparing, so one changed word in
    // a long text costs one word.
    const { start, end } = sharedEnds(earlier, later);
    const changedBefore = earlier.slice(start, earlier.length - end);
    const changedAfter = later.slice(start, later.length - end);
    if (changedBefore.length * changedAfter.length > MAX_COMPARED_PAIRS) {
      continue;
    }

    const runs: TextSegment[] = [];
    append(runs, 0, earlier.slice(0, start).join(""));
    for (const run of comparePieces(changedBefore, changedAfter)) {
      append(runs, run.op, run.text);
    }
    append(runs, 0, earlier.slice(earlier.length - end).join(""));
    return runs;
  }

  const runs: TextSegment[] = [];
  append(runs, -1, before);
  append(runs, 1, after);
  return runs;
}

/** What one stretch between two kept texts lost and gained. */
interface Stretch {
  removed: string;
  added: string;
}

const noChange = (): Stretch => ({ removed: "", added: "" });

const isReplacement = (stretch: Stretch | undefined): boolean =>
  stretch !== undefined && stretch.removed !== "" && stretch.added !== "";

/** A space that separates words, and not a line break between paragraphs. */
const onlySeparatesWords = (text: string): boolean =>
  /^[^\S\n\r\p{Zl}\p{Zp}]+$/u.test(text);

/**
 * The runs as a reader would mark them: each stretch's removal before its
 * addition, and a space that only separates two replaced words marked with
 * them, so replacing a phrase reads as one change and not one per word. A line
 * break the comparison kept stays kept: it holds paragraphs apart.
 */
function tidy(runs: readonly TextSegment[]): TextSegment[] {
  // Each kept text with the stretch before it, then the stretch that ends the
  // text.
  const parts: { stretch: Stretch; kept: string }[] = [];
  let stretch = noChange();
  for (const run of runs) {
    if (run.op === -1) stretch.removed += run.text;
    else if (run.op === 1) stretch.added += run.text;
    else {
      parts.push({ stretch, kept: run.text });
      stretch = noChange();
    }
  }
  const last = stretch;

  const out: TextSegment[] = [];
  let open = noChange();
  parts.forEach((part, index) => {
    open.removed += part.stretch.removed;
    open.added += part.stretch.added;
    const next = parts[index + 1]?.stretch ?? last;
    if (
      onlySeparatesWords(part.kept) &&
      isReplacement(part.stretch) &&
      isReplacement(next)
    ) {
      open.removed += part.kept;
      open.added += part.kept;
      return;
    }
    append(out, -1, open.removed);
    append(out, 1, open.added);
    append(out, 0, part.kept);
    open = noChange();
  });
  append(out, -1, open.removed + last.removed);
  append(out, 1, open.added + last.added);
  return out;
}

/**
 * The runs from `before` to `after`. Joining the runs that are not additions
 * gives `before`, and joining those that are not removals gives `after`.
 */
export function diffSourceText(before: string, after: string): TextSegment[] {
  return tidy(compare(before, after));
}

const passages = (count: number): string =>
  `${count} ${count === 1 ? "passage" : "passages"}`;

/**
 * The change in words, for a reader who cannot see the marks or tell them
 * apart: how many passages were removed and added, and how each is marked.
 * Undefined where nothing in the text changed.
 */
export function changeInWords(
  segments: readonly TextSegment[]
): string | undefined {
  const removed = segments.filter(segment => segment.op === -1).length;
  const added = segments.filter(segment => segment.op === 1).length;
  const parts = [
    removed > 0 ? `${passages(removed)} removed (struck through)` : "",
    added > 0 ? `${passages(added)} added (underlined)` : "",
  ].filter(part => part !== "");
  return parts.length > 0 ? `${parts.join(" and ")}.` : undefined;
}
