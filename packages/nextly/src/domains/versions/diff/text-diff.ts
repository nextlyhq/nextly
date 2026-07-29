/**
 * Word-level text diff for string-like fields.
 *
 * Runs server-side so the client never diffs: the engine ships pre-computed
 * segments and the renderer just paints them. Uses `@sanity/diff-match-patch`
 * (a maintained TypeScript fork of Google's diff-match-patch) with the semantic
 * cleanup pass, which coalesces the raw character diff into human-readable runs.
 *
 * @module domains/versions/diff/text-diff
 */

import { cleanupSemantic, makeDiff } from "@sanity/diff-match-patch";

import type { TextSegment } from "./types";

/**
 * Diff two strings into ordered segments. Each segment's `op` is -1 (present
 * only in `before`), 0 (unchanged), or 1 (present only in `after`) — the
 * diff-match-patch convention, which `TextSegment` mirrors exactly.
 *
 * Concatenating the non-insert segments reproduces `before`; concatenating the
 * non-delete segments reproduces `after`.
 */
export function diffText(before: string, after: string): TextSegment[] {
  const diffs = cleanupSemantic(makeDiff(before, after));
  return diffs.map(([op, text]) => ({ op, text }));
}
