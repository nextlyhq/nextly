/**
 * Split a rendered run of a source comparison into coloured pieces.
 *
 * Separate from `highlight-source` on purpose, and the split is what keeps the
 * renderer simple. Deciding WHICH construct a character belongs to needs the
 * language's grammar, which is heavy and arrives asynchronously; slicing a
 * string at boundaries somebody already worked out needs nothing at all. So the
 * grammar loads on demand and this stays with the renderer, which can then
 * paint every run through one path whether or not the grammar has arrived —
 * with no spans, every run comes back as one uncoloured piece.
 *
 * @module components/features/versions/diff/source-runs
 */

import type { CodeConstruct } from "@admin/lib/code-palette";

/** Where one construct runs, in columns of its own line. */
export interface ConstructSpan {
  from: number;
  to: number;
  construct: CodeConstruct;
}

/** One piece of a rendered run. `construct` absent means ordinary text. */
export interface SourceRun {
  text: string;
  construct?: CodeConstruct;
}

/**
 * Paint one run of a line, given where in that line it starts.
 *
 * Concatenating the result reproduces `text` exactly, and that property is the
 * whole safety of this module: a comparison that dropped or duplicated a
 * character while colouring it would show the reader something other than what
 * it compared.
 */
export function paintRun(
  text: string,
  spans: readonly ConstructSpan[],
  column: number
): SourceRun[] {
  const runs: SourceRun[] = [];
  let cursor = 0;
  for (const span of spans) {
    const start = Math.max(span.from - column, cursor);
    const end = Math.min(span.to - column, text.length);
    if (end <= start) continue;
    if (start > cursor) runs.push({ text: text.slice(cursor, start) });
    runs.push({ text: text.slice(start, end), construct: span.construct });
    cursor = end;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) });
  return runs;
}
