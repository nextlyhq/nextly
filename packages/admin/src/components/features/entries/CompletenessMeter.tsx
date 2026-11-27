/**
 * How far along a set of translations is, as a bar.
 *
 * Translation mode shows one, counting FIELDS against the form's live values.
 *
 * `aria-hidden` deliberately: every caller states the same figure in words
 * beside it, and a bar announced as well would say it twice.
 *
 * @module components/features/entries/CompletenessMeter
 */

import type { JSX } from "react";

export function CompletenessMeter({
  translated,
  total,
}: {
  translated: number;
  total: number;
}): JSX.Element | null {
  if (total === 0) return null;
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-1.5 w-16 overflow-hidden rounded-sm bg-muted"
    >
      <span
        className="block bg-foreground"
        style={{ width: `${(translated / total) * 100}%` }}
      />
    </span>
  );
}
