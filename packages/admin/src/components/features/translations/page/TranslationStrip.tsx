/**
 * What is being translated, and how much of it is behind its source: one line
 * above the cards.
 *
 * @module components/features/translations/page/TranslationStrip
 */

import type { JSX, ReactNode } from "react";

export interface TranslationStripProps {
  /** The language translated from; absent where nothing has a source. */
  sourceLabel: string | undefined;
  targetLabel: string;
  /** How many fields have a source that changed since. */
  outOfDate: number;
  /** An action at the line's end, such as one showing what changed. */
  action?: ReactNode;
}

/** "1 field out of date", "3 fields out of date". */
function fieldsOutOfDate(count: number): string {
  return `${count} ${count === 1 ? "field" : "fields"} out of date`;
}

export function TranslationStrip({
  sourceLabel,
  targetLabel,
  outOfDate,
  action,
}: TranslationStripProps): JSX.Element {
  return (
    <div
      data-slot="translation-strip"
      className="mb-4 flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-2 text-sm"
    >
      <p>
        {sourceLabel === undefined ? (
          <>
            Writing <strong className="font-semibold">{targetLabel}</strong> as
            original content
          </>
        ) : (
          <>
            Translating from{" "}
            <strong className="font-semibold">{sourceLabel}</strong> into{" "}
            <strong className="font-semibold">{targetLabel}</strong>
          </>
        )}
        {outOfDate > 0 ? ` · ${fieldsOutOfDate(outOfDate)}` : null}
      </p>
      {action}
    </div>
  );
}
