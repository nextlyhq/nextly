/**
 * Splits an inline text diff into the two sides of a side-by-side comparison.
 *
 * The engine emits one sequence of runs carrying `op` -1 (present only on the
 * left), 0 (present on both) or 1 (present only on the right). An inline
 * rendering paints that sequence once; a two-column rendering needs the same
 * runs distributed to the side each one reaches. Kept separate from the
 * renderer so the distribution is testable without mounting anything.
 *
 * @module components/features/versions/diff/text-segment-sides
 */

import type { TextSegment } from "@admin/services/versionApi";

export interface TextSegmentSides {
  /** Runs the older version contained: common text and deletions. */
  before: TextSegment[];
  /** Runs the newer version contains: common text and insertions. */
  after: TextSegment[];
}

/**
 * The runs belonging to each side, with their `op` preserved.
 *
 * `op` is kept rather than flattened to plain text so the same segment
 * renderer still marks a deletion on the left and an insertion on the right —
 * the column says which version a run belongs to, and the mark says whether it
 * survived.
 */
export function splitTextSegments(
  segments: readonly TextSegment[]
): TextSegmentSides {
  return {
    before: segments.filter(segment => segment.op <= 0),
    after: segments.filter(segment => segment.op >= 0),
  };
}
