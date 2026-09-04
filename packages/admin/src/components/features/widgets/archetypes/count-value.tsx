/**
 * How a count is written when it may be a FLOOR rather than a total.
 *
 * 🔴 One implementation, used by every archetype that draws a count. `metric`
 * and `stats` each formatted their own, and when `WidgetResult` gained
 * `atLeast` only one of them was taught about it — so the same query rendered
 * `2,000+` on a metric card and `2,000` on a stats cell, the second stating as
 * exact a number its own source had declined to vouch for. Two renderers of one
 * value agree on the day they are written; the drift is silent because each
 * reads correctly on its own.
 *
 * @module components/features/widgets/archetypes/count-value
 */

import type { JSX } from "react";

/**
 * `total`, with a trailing `+` when the source could only establish a floor.
 *
 * The marker is punctuation a screen reader may not voice, so the words are
 * given separately rather than relying on it: `aria-hidden` on the glyph and an
 * `sr-only` phrase beside it means both readings carry the same claim, and a
 * reader using assistive technology is not told a bounded number is a whole one.
 */
export function CountValue({
  total,
  atLeast,
}: {
  total: number;
  atLeast?: boolean;
}): JSX.Element {
  return (
    <>
      {total.toLocaleString()}
      {atLeast === true ? (
        <>
          <span aria-hidden="true">+</span>
          <span className="sr-only"> or more</span>
        </>
      ) : null}
    </>
  );
}
