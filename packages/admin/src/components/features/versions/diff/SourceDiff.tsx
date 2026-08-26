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
 * Two colour systems overlap on a changed line and they mean different things:
 * the token colours say what the code IS, the insert/delete marks say what
 * MOVED. Marks win where they overlap, since a reader scanning a comparison is
 * looking for the change first.
 *
 * @module components/features/versions/diff/SourceDiff
 */

import { codeClass } from "@admin/lib/code-palette";
import type {
  SourceFieldDiff,
  SourceLineDiff,
  TextSegment,
} from "@admin/services/versionApi";

import { FieldRow, NotComparable } from "./diff-primitives";
import { defineFieldDiff } from "./field-diff-registry";
import { tokenizeJsonLine } from "./json-tokens";

/** Row tint and gutter sign for a line's status. */
const LINE_STYLE: Record<string, { row: string; sign: string }> = {
  added: { row: "bg-success-50 dark:bg-success-950", sign: "+" },
  removed: { row: "bg-destructive-50 dark:bg-destructive-950", sign: "-" },
  changed: { row: "bg-warning-50 dark:bg-warning-950", sign: "~" },
  unchanged: { row: "", sign: " " },
  unsupported: { row: "", sign: "?" },
};

/**
 * One line's text, syntax-coloured. Only json is tokenized: a `code` field
 * holds an arbitrary language, and guessing at its grammar would colour some
 * of it wrongly, which is worse than colouring none of it. Both are
 * monospaced and both carry the diff marks either way.
 */
function Highlighted({ text, language }: { text: string; language: string }) {
  if (language !== "json") return <>{text}</>;
  return (
    <>
      {tokenizeJsonLine(text).map((token, index) => (
        <span
          key={index}
          className={token.construct ? codeClass(token.construct) : undefined}
        >
          {token.text}
        </span>
      ))}
    </>
  );
}

/**
 * A changed line's runs. An unchanged run is highlighted by the language; an
 * inserted or deleted run takes the semantic mark instead, because on a line
 * that moved, what moved is the thing being read for.
 */
function LineRuns({
  segments,
  language,
}: {
  segments: readonly TextSegment[];
  language: string;
}) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.op === 0) {
          return (
            <Highlighted key={index} text={segment.text} language={language} />
          );
        }
        if (segment.op === 1) {
          return (
            <ins
              key={index}
              className="rounded-sm no-underline bg-success-100 text-success-800 dark:bg-success-900 dark:text-success-100"
            >
              {segment.text}
            </ins>
          );
        }
        return (
          <del
            key={index}
            className="rounded-sm bg-destructive-100 text-destructive-800 dark:bg-destructive-900 dark:text-destructive-100"
          >
            {segment.text}
          </del>
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

function Line({ line, language }: { line: SourceLineDiff; language: string }) {
  const style = LINE_STYLE[line.status] ?? LINE_STYLE.unchanged;
  return (
    <div className={`flex ${style?.row ?? ""}`}>
      <LineNumber value={line.fromLine} />
      <LineNumber value={line.toLine} />
      <span
        aria-hidden="true"
        className="w-3 shrink-0 select-none pl-1 text-muted-foreground"
      >
        {style?.sign ?? " "}
      </span>
      <span className="min-w-0 whitespace-pre-wrap break-all">
        {line.status === "unsupported" ? (
          <NotComparable what="value" />
        ) : (
          <LineRuns segments={line.segments ?? []} language={language} />
        )}
      </span>
    </div>
  );
}

export function SourceDiff({ node }: { node: SourceFieldDiff }) {
  return (
    <FieldRow label={node.label} status={node.status}>
      <div className="overflow-x-auto rounded-md border border-border bg-muted/40">
        <div className="min-w-max p-2 font-mono text-xs leading-relaxed">
          {node.lines.map((line, index) => (
            // Index-keyed: a line has no identity beyond its position in this
            // one comparison.
            <Line key={index} line={line} language={node.language} />
          ))}
        </div>
      </div>
    </FieldRow>
  );
}

defineFieldDiff(["source"], node => (
  <SourceDiff node={node as SourceFieldDiff} />
));
