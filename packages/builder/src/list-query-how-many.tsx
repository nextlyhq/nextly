"use client";

/**
 * How many of a collection list's entries show: the number of items and the
 * entries to skip, each a field that may be bound, the pages, the count of
 * matching entries, and what the canvas shows when none match.
 *
 * @module list-query-how-many
 */
import { listPageCount, NAMED_QUERY_TEXT } from "@nextlyhq/blocks-engine";
import { Input, Label, Switch } from "@nextlyhq/ui";
import * as React from "react";

import type { ContentServices, ListEntriesCount } from "./content-controls";
import { readBound } from "./list-query-model";
import { FieldError, GroupTitle } from "./list-query-parts";
import { issuesAt, LIST_QUERY_PROPS, type Issues } from "./list-query-reading";
import { useStoredDraft } from "./stored-draft";

/** The text a bound field opens with: the stored number, or the unset one. */
function boundText(stored: unknown, unsetValue: number | undefined): string {
  if (typeof stored === "number" || typeof stored === "string") {
    return String(stored);
  }
  return unsetValue === undefined ? "" : String(unsetValue);
}

/**
 * A bound field's draft: the text typed, the problem with it, and the send
 * that writes it once a save would take it. The shown unset value, sent back
 * unchanged, is what the list already reads, so it is no edit.
 */
function useBoundDraft(
  prop: "limit" | "offset",
  stored: unknown,
  unsetValue: number | undefined,
  onBound: (value: number | undefined) => void
): {
  draft: string;
  setDraft: (text: string) => void;
  problem: string | undefined;
  send: () => void;
} {
  const text = boundText(stored, unsetValue);
  // The inspector's own draft: an edit in progress from the first
  // keystroke, which Save pressed from here writes first and Escape puts back.
  const [draft, setDraft] = useStoredDraft(text);
  const [problem, setProblem] = React.useState<string | undefined>();
  React.useEffect(() => {
    setProblem(undefined);
  }, [text]);
  const send = () => {
    const read = readBound(prop, draft);
    if ("problem" in read) {
      // Refused here rather than written: the canvas keeps the last list.
      setProblem(read.problem);
      return;
    }
    setProblem(undefined);
    const unchanged =
      read.value === stored ||
      (stored === undefined && read.value === unsetValue);
    if (!unchanged) onBound(read.value);
  };
  return { draft, setDraft, problem, send };
}

/** Under a bound field: its problem, or, with none, its hint. */
function BoundFoot({
  errorId,
  problem,
  hint,
}: {
  errorId: string;
  problem: string | undefined;
  hint: string | undefined;
}): React.JSX.Element | null {
  if (problem !== undefined) {
    return <FieldError id={errorId}>{problem}</FieldError>;
  }
  if (hint === undefined) return null;
  // In the field's control column already, under the number it is about.
  return (
    <p className="nx-inspector__note nx-list-query__hint" role="status">
      {hint}
    </p>
  );
}

/** A number of entries typed, written once a save would take it. */
function BoundField({
  id,
  prop,
  words,
  stored,
  fallback,
  unsetValue,
  disabled,
  problem: storedProblem,
  hint,
  onBound,
}: {
  id: string;
  prop: "limit" | "offset";
  /** The field's label, and what it counts, said after the number. */
  words: { readonly label: string; readonly suffix?: string };
  stored: unknown;
  /** What the list reads when nothing is stored, shown as the placeholder. */
  fallback?: unknown;
  /**
   * What the list reads when nothing is stored, shown as the field's value:
   * for a number an author reads as a plain fact (skip 0) rather than a hint.
   * Sending it unchanged writes nothing, so nothing is stored for it.
   */
  unsetValue?: number;
  disabled: boolean;
  problem: string | undefined;
  /** A line under the field, said while it has no problem to say. */
  hint?: string | undefined;
  onBound: (value: number | undefined) => void;
}): React.JSX.Element {
  const { draft, setDraft, problem, send } = useBoundDraft(
    prop,
    stored,
    unsetValue,
    onBound
  );
  const shown = problem ?? storedProblem;
  const errorId = `${id}-error`;
  return (
    <div className="nx-inspector__field" data-content-control="number">
      <Label htmlFor={id}>{words.label}</Label>
      <div
        className="nx-list-query__bound"
        data-suffixed={words.suffix === undefined ? undefined : ""}
      >
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={prop === "limit" ? 1 : 0}
          max={prop === "limit" ? 100 : undefined}
          value={draft}
          placeholder={
            typeof fallback === "number" ? String(fallback) : undefined
          }
          disabled={disabled}
          aria-invalid={shown === undefined ? undefined : true}
          aria-describedby={shown === undefined ? undefined : errorId}
          onChange={event => setDraft(event.target.value)}
          onBlur={send}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              send();
            }
          }}
        />
        {words.suffix === undefined ? null : (
          <span className="nx-list-query__suffix" aria-hidden="true">
            {words.suffix}
          </span>
        )}
      </div>
      <BoundFoot errorId={errorId} problem={shown} hint={hint} />
    </div>
  );
}

/** The engine's issues about one prop, of one code, in its words. */
export function codedIssues(
  issues: Issues,
  prop: string,
  code: string
): string[] {
  return issues
    .filter(
      issue => issue.path.endsWith(`/props/${prop}`) && issue.code === code
    )
    .map(issue => issue.message);
}

/**
 * What splitting into pages makes of the count: "24 entries match, so 3
 * pages of 10.", or what a switch turned on will do when nothing is counted.
 */
function pagesWords(
  counted: ListEntriesCount | undefined,
  values: Readonly<Record<string, unknown>>,
  limitFallback: unknown
): string {
  const stored = values.limit ?? limitFallback;
  const limit = typeof stored === "number" && stored >= 1 ? stored : 10;
  const each = `${String(limit)} ${limit === 1 ? "entry" : "entries"}`;
  if (counted === undefined) {
    return `Shows ${each} on each page, at /page/2, /page/3 and on.`;
  }
  const offset = typeof values.offset === "number" ? values.offset : 0;
  const pages = listPageCount(counted.matching, offset, limit);
  const match =
    counted.matching === 1
      ? "1 entry matches"
      : `${String(counted.matching)} entries match`;
  return `${match}, so ${pages === 1 ? "1 page" : `${String(pages)} pages`} of ${each}.`;
}

/** The How many group: the number of items, the entries to skip, and pages. */
/**
 * How many entries the list's query matches and how many it shows, counted
 * once per query: drawn again with the same query, nothing is read again,
 * and an answer for a query since changed is dropped.
 */
function useListCount(
  count: ContentServices["countListEntries"],
  values: Readonly<Record<string, unknown>>
): ListEntriesCount | undefined {
  const asked = JSON.stringify(
    LIST_QUERY_PROPS.map(name => values[name] ?? null)
  );
  const [answer, setAnswer] = React.useState<
    { readonly asked: string; readonly count: ListEntriesCount } | undefined
  >(undefined);
  React.useEffect(() => {
    if (count === undefined) return;
    let current = true;
    // The props the count is of, read back from the key, so the read and
    // the key it is kept under are one value.
    const read = JSON.parse(asked) as unknown[];
    const props = Object.fromEntries(
      LIST_QUERY_PROPS.flatMap((name, at) =>
        read[at] === null ? [] : [[name, read[at]]]
      )
    );
    count(props).then(
      found => {
        if (current && found !== undefined) setAnswer({ asked, count: found });
      },
      // A count that fails says nothing: the canvas's note says why the
      // list's read failed.
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [count, asked]);
  return answer?.asked === asked ? answer.count : undefined;
}

/** "4 entries match, so 3 show.", with one entry spoken of as one. */
function countWords(
  { matching, shown }: ListEntriesCount,
  named: boolean
): string {
  // A custom source's rows are not always entries: counted in its own words.
  if (named) return NAMED_QUERY_TEXT.counted(matching, shown);
  const match =
    matching === 1 ? "1 entry matches" : `${String(matching)} entries match`;
  const show = shown === 1 ? "1 shows" : `${String(shown)} show`;
  return `${match}, so ${show}.`;
}

export function HowManyGroup({
  id,
  values,
  limitFallback,
  issues,
  disabled,
  count,
  commit,
}: {
  id: string;
  values: Readonly<Record<string, unknown>>;
  /** The number of items the block reads when none is stored. */
  limitFallback: unknown;
  issues: Issues;
  disabled: boolean;
  /** The host's count of the list's matching entries, where it has one. */
  count: ContentServices["countListEntries"];
  commit: (changes: Readonly<Record<string, unknown>>) => void;
}): React.JSX.Element {
  const counted = useListCount(count, values);
  return (
    <section className="nx-list-query__group" aria-labelledby={`${id}-title`}>
      <GroupTitle id={`${id}-title`}>Entries shown</GroupTitle>
      <BoundField
        id={`${id}-limit`}
        prop="limit"
        words={{ label: "How many" }}
        stored={values.limit}
        fallback={limitFallback}
        disabled={disabled}
        problem={issuesAt(issues, ["limit"])[0]}
        hint={
          counted === undefined
            ? undefined
            : countWords(counted, values.namedQuery !== undefined)
        }
        onBound={limit => commit({ limit })}
      />
      <BoundField
        id={`${id}-offset`}
        prop="offset"
        words={{ label: "Skip", suffix: "entries" }}
        stored={values.offset}
        unsetValue={0}
        disabled={disabled}
        problem={issuesAt(issues, ["offset"])[0]}
        // Skipping none stores nothing, as a list that skips none always did.
        onBound={offset =>
          commit({ offset: offset === 0 ? undefined : offset })
        }
      />
      <PagesField
        id={`${id}-pages`}
        on={values.paginate === true}
        disabled={disabled}
        problem={issuesAt(issues, ["paginate"])[0]}
        hint={
          values.paginate === true
            ? pagesWords(counted, values, limitFallback)
            : undefined
        }
        // Off stores nothing, as a list that never paginated holds nothing.
        onChange={on => commit({ paginate: on ? true : undefined })}
      />
    </section>
  );
}

/**
 * Whether the list is split into pages, each at its own address: a switch,
 * with what it makes of the count under it while on, or why the page cannot
 * serve it.
 */
function PagesField({
  id,
  on,
  disabled,
  problem,
  hint,
  onChange,
}: {
  id: string;
  on: boolean;
  disabled: boolean;
  problem: string | undefined;
  hint: string | undefined;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  const errorId = `${id}-error`;
  return (
    <div className="nx-inspector__field" data-content-control="paginate">
      <Label htmlFor={id}>Split into pages</Label>
      <Switch
        id={id}
        checked={on}
        disabled={disabled}
        aria-invalid={problem === undefined ? undefined : true}
        aria-describedby={problem === undefined ? undefined : errorId}
        onCheckedChange={onChange}
      />
      <BoundFoot errorId={errorId} problem={problem} hint={hint} />
    </div>
  );
}

/**
 * When nothing matches: whether the canvas previews the list's empty message
 * in place of its entries. Editor state, never stored.
 */
export function CanvasShowsGroup({
  id,
  showsEmpty,
  onShowEmpty,
}: {
  id: string;
  showsEmpty: boolean;
  onShowEmpty: (empty: boolean) => void;
}): React.JSX.Element {
  const previewId = `${id}-canvas`;
  return (
    <section className="nx-list-query__group" aria-labelledby={`${id}-title`}>
      <GroupTitle id={`${id}-title`}>When nothing matches</GroupTitle>
      <div className="nx-inspector__field" data-content-control="canvasShows">
        <Label htmlFor={previewId}>Preview the empty message</Label>
        <Switch
          id={previewId}
          checked={showsEmpty}
          onCheckedChange={onShowEmpty}
        />
      </div>
      <p className="nx-inspector__note nx-list-query__hint nx-list-query__indented">
        {showsEmpty
          ? "Visitors see these blocks when no entry matches. Left empty, the list shows nothing."
          : "Turn on to design what visitors see when no entry matches."}
      </p>
    </section>
  );
}
