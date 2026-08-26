/**
 * Renders a json or code comparison as numbered, highlighted lines.
 *
 * Monospaced, with a line number per side and a gutter mark — the shape every
 * developer already reads diffs in. That is a repair as much as a feature: a
 * code field used to be compared as running prose, so the comparison wrapped it
 * into a proportional paragraph and was HARDER to read than simply viewing the
 * version.
 *
 * Colour comes from `code-palette`, the same construct table the CodeMirror
 * surfaces and the rich-text code blocks read, so a string is the same colour
 * everywhere and a retheme moves all of them. Nothing here names a colour.
 *
 * Two colour systems overlap on a changed line and they say different things:
 * the token colours say what the code IS, the insert and delete tints say what
 * MOVED. They are composed rather than ranked — the tint is a background and
 * the tokens keep their own colour on top of it. Ranking them meant a wholly
 * added line rendered as a solid block of one colour, which is most of what a
 * comparison shows.
 *
 * The grammar arrives asynchronously and the lines do not wait for it: with no
 * constructs yet, every run paints as one uncoloured piece through the same
 * path, so there is no second rendering path to keep in step.
 *
 * @module components/features/versions/diff/SourceDiff
 */

import { useEffect, useMemo, useState } from "react";

import { codeClass } from "@admin/lib/code-palette";
import type {
  SourceFieldDiff,
  SourceLineDiff,
  TextSegment,
} from "@admin/services/versionApi";

import { FieldRow, NotComparable } from "./diff-primitives";
import { defineFieldDiff } from "./field-diff-registry";
import { paintRun, type ConstructSpan } from "./source-runs";

/** What a line with no tint and no mark looks like. */
const PLAIN_LINE = { row: "", sign: " " } as const;

/** Row tint and gutter sign for a line's status. */
const LINE_STYLE: Record<string, { row: string; sign: string }> = {
  added: { row: "bg-success-50 dark:bg-success-950", sign: "+" },
  removed: { row: "bg-destructive-50 dark:bg-destructive-950", sign: "-" },
  changed: { row: "bg-warning-50 dark:bg-warning-950", sign: "~" },
  unchanged: { row: "", sign: " " },
  unsupported: { row: "", sign: "?" },
};

/** A line with nothing recorded for it, so nothing is painted on it. */
const NO_SPANS: readonly ConstructSpan[] = [];

/** Both sides' constructs, each indexed by line number on that side. */
interface SourceSpans {
  before: ConstructSpan[][];
  after: ConstructSpan[][];
}

/**
 * One side's full text, rebuilt from the lines belonging to it.
 *
 * This DECODES the engine's own output rather than deriving the text a second
 * way: a line's runs are exactly its text split by what moved, so the runs on
 * one side, concatenated, are that side's line. Reading it back is what lets
 * the grammar parse each side WHOLE — which per-line parsing cannot do, and
 * which is the difference between colouring a docstring as prose and colouring
 * it as code.
 *
 * Null when a line carries no runs, which is a refusal the engine already
 * reported and there is nothing behind it to colour.
 */
function sideText(
  lines: readonly SourceLineDiff[],
  side: "from" | "to"
): string | null {
  const kept = side === "from" ? -1 : 1;
  const out: string[] = [];
  for (const line of lines) {
    const index = side === "from" ? line.fromLine : line.toLine;
    if (index === undefined) continue;
    if (line.segments === undefined) return null;
    out.push(
      line.segments
        .filter(s => s.op === 0 || s.op === kept)
        .map(s => s.text)
        .join("")
    );
  }
  return out.join("\n");
}

/**
 * Both sides' constructs, once the grammar has loaded.
 *
 * Null until then, and null for good where nothing here reads the language —
 * the comparison renders uncoloured in both cases rather than waiting. The
 * grammars are imported on demand so a comparison holding no code field never
 * pays for them.
 */
function useSourceSpans(node: SourceFieldDiff): SourceSpans | null {
  const before = useMemo(() => sideText(node.lines, "from"), [node.lines]);
  const after = useMemo(() => sideText(node.lines, "to"), [node.lines]);
  const [spans, setSpans] = useState<SourceSpans | null>(null);

  useEffect(() => {
    if (before === null || after === null) return;
    let live = true;
    void import("./highlight-source").then(({ highlightSource }) => {
      if (!live) return;
      const painted = {
        before: highlightSource(before, node.language),
        after: highlightSource(after, node.language),
      };
      if (painted.before !== null && painted.after !== null) {
        setSpans({ before: painted.before, after: painted.after });
      }
    });
    return () => {
      live = false;
    };
  }, [before, after, node.language]);

  return spans;
}

/** One run of a line, split into its constructs and coloured. */
function Painted({
  text,
  spans,
  column,
}: {
  text: string;
  spans: readonly ConstructSpan[];
  column: number;
}) {
  return (
    <>
      {paintRun(text, spans, column).map((run, index) => (
        <span
          key={index}
          className={run.construct ? codeClass(run.construct) : undefined}
        >
          {run.text}
        </span>
      ))}
    </>
  );
}

/**
 * A line's runs, each coloured from the side it belongs to.
 *
 * An inserted run exists only on the "after" side and a deleted one only on
 * "before", so each reads its constructs from its own side at its own column.
 * The two columns are tracked separately because the sides desynchronise at the
 * first edit on the line.
 */
function LineRuns({
  segments,
  before,
  after,
  hasAfter,
}: {
  segments: readonly TextSegment[];
  before: readonly ConstructSpan[];
  after: readonly ConstructSpan[];
  hasAfter: boolean;
}) {
  let fromColumn = 0;
  let toColumn = 0;
  return (
    <>
      {segments.map((segment, index) => {
        const width = segment.text.length;
        if (segment.op === -1) {
          const column = fromColumn;
          fromColumn += width;
          return (
            <del
              key={index}
              className="rounded-sm bg-destructive-100 dark:bg-destructive-900/70"
            >
              <Painted text={segment.text} spans={before} column={column} />
            </del>
          );
        }
        if (segment.op === 1) {
          const column = toColumn;
          toColumn += width;
          return (
            <ins
              key={index}
              className="rounded-sm no-underline bg-success-100 dark:bg-success-900/70"
            >
              <Painted text={segment.text} spans={after} column={column} />
            </ins>
          );
        }
        // An unchanged run sits on both sides, so it reads from the side the
        // line actually has: a removed line has no "after" to take columns from.
        const column = hasAfter ? toColumn : fromColumn;
        fromColumn += width;
        toColumn += width;
        return (
          <Painted
            key={index}
            text={segment.text}
            spans={hasAfter ? after : before}
            column={column}
          />
        );
      })}
    </>
  );
}

/**
 * One side's line number, or blank where the line exists on the other side
 * only. `tabular-nums` keeps the column from shifting as the digit count grows.
 */
function LineNumber({ value }: { value: number | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="w-8 shrink-0 select-none pr-1 text-right tabular-nums text-muted-foreground"
    >
      {value === undefined ? "" : value + 1}
    </span>
  );
}

/** The constructs recorded for one side of one line, if any were. */
function spansFor(
  index: number | undefined,
  side: ConstructSpan[][] | undefined
): readonly ConstructSpan[] {
  if (index === undefined) return NO_SPANS;
  return side?.[index] ?? NO_SPANS;
}

function Line({
  line,
  spans,
}: {
  line: SourceLineDiff;
  spans: SourceSpans | null;
}) {
  // Resolved once, to a value that is always present: a status this does not
  // know renders as an ordinary line rather than as nothing.
  const style = LINE_STYLE[line.status] ?? PLAIN_LINE;
  return (
    <div className={`flex ${style.row}`}>
      <LineNumber value={line.fromLine} />
      <LineNumber value={line.toLine} />
      <span
        aria-hidden="true"
        className="w-3 shrink-0 select-none pl-1 text-muted-foreground"
      >
        {style.sign}
      </span>
      <span className="min-w-0 whitespace-pre-wrap break-all">
        {line.status === "unsupported" ? (
          <NotComparable what="value" />
        ) : (
          <LineRuns
            segments={line.segments ?? []}
            before={spansFor(line.fromLine, spans?.before)}
            after={spansFor(line.toLine, spans?.after)}
            hasAfter={line.toLine !== undefined}
          />
        )}
      </span>
    </div>
  );
}

export function SourceDiff({ node }: { node: SourceFieldDiff }) {
  const spans = useSourceSpans(node);
  return (
    <FieldRow label={node.label} status={node.status}>
      <div className="overflow-x-auto rounded-md border border-border bg-muted/40">
        <div className="min-w-max p-2 font-mono text-xs leading-relaxed">
          {node.lines.map((line, index) => (
            // Index-keyed: a line has no identity beyond its position in this
            // one comparison.
            <Line key={index} line={line} spans={spans} />
          ))}
        </div>
      </div>
    </FieldRow>
  );
}

defineFieldDiff(["source"], node => (
  <SourceDiff node={node as SourceFieldDiff} />
));
