/**
 * Says that a text's source changed since the text was made from it: a dot and
 * the words, so the colour is never all that says it.
 *
 * @module components/features/translations/page/OutOfDateMark
 */

import type { JSX } from "react";

export function OutOfDateMark(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-warning-solid"
      />
      out of date
    </span>
  );
}
