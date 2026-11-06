"use client";

/**
 * A row that reads as one sentence and opens in place into its controls, and
 * the state of a list of them: what a list's filters and a block's
 * visibility conditions are both edited with, so the two read and behave as
 * one control.
 *
 * @module sentence-row
 */
import { Button } from "@nextlyhq/ui";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import * as React from "react";

/** A row as one sentence, in its three parts. */
export interface RowSentence {
  readonly field: string;
  readonly operator: string;
  readonly value: string;
}

/** What a sentence row is drawn with, closed or open. */
export interface SentenceRowProps {
  readonly id: string;
  /** What the row is called in its buttons' names: "filter", "condition". */
  readonly noun: string;
  readonly open: boolean;
  readonly disabled: boolean;
  readonly sentence: RowSentence;
  /** The sentence as one line, for the row's title and accessible name. */
  readonly line: string;
  readonly problem: string | undefined;
  /** The row's field picker, labelled by `labelId`. */
  readonly field: (labelId: string) => React.ReactNode;
  /** The operator and value, once a field is chosen; `null` before. */
  readonly body: (labelId: string, errorId: string) => React.ReactNode;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onRemove: () => void;
}

/** The button that removes a row, named by its sentence. */
function RemoveRow({
  noun,
  line,
  disabled,
  onRemove,
}: {
  noun: string;
  line: string;
  disabled: boolean;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={`Remove ${noun}: ${line}`}
      disabled={disabled}
      onClick={onRemove}
    >
      <X aria-hidden="true" size={14} />
    </Button>
  );
}

/** A refused row's message, under it. */
function RowError({
  id,
  problem,
}: {
  id: string;
  problem: string | undefined;
}): React.JSX.Element | null {
  return problem === undefined ? null : (
    <p id={id} className="nx-inspector__error nx-list-query__error">
      {problem}
    </p>
  );
}

/** A closed row: its sentence as one button, and its remove button. */
function ClosedRow({
  props,
  lineRef,
}: {
  props: SentenceRowProps;
  lineRef: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const { sentence, line, problem } = props;
  const errorId = `${props.id}-error`;
  return (
    <li
      className="nx-list-filter"
      data-invalid={problem === undefined ? undefined : ""}
    >
      <button
        ref={lineRef}
        type="button"
        className="nx-list-filter__line"
        aria-expanded={false}
        aria-describedby={problem === undefined ? undefined : errorId}
        title={line}
        disabled={props.disabled}
        onClick={props.onOpen}
      >
        <ChevronRight aria-hidden="true" size={14} />
        <span className="nx-list-filter__sentence">
          <span className="nx-list-filter__field">{sentence.field}</span>{" "}
          <span className="nx-list-filter__op">{sentence.operator}</span>{" "}
          <span
            className="nx-list-filter__said"
            data-missing={sentence.value === "no value" ? "" : undefined}
          >
            {sentence.value}
          </span>
        </span>
      </button>
      <RemoveRow
        noun={props.noun}
        line={line}
        disabled={props.disabled}
        onRemove={props.onRemove}
      />
      <RowError id={errorId} problem={problem} />
    </li>
  );
}

/** An open row: its field, the operator and value, and its error. */
function OpenRow({
  props,
  onClose,
}: {
  props: SentenceRowProps;
  onClose: () => void;
}): React.JSX.Element {
  const { id, noun, line, problem, disabled } = props;
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const capital = noun.charAt(0).toUpperCase() + noun.slice(1);
  return (
    <li
      className="nx-list-filter"
      data-open=""
      data-invalid={problem === undefined ? undefined : ""}
      onKeyDown={event => {
        // Escape closes the row, unless a menu inside it is taking it.
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <span id={labelId} className="nx-sr-only">
        {`${capital} ${line}`}
      </span>
      <div className="nx-list-filter__head">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-expanded={true}
          aria-label={`Close ${noun}: ${line}`}
          onClick={onClose}
        >
          <ChevronDown aria-hidden="true" size={14} />
        </Button>
        {props.field(labelId)}
        <RemoveRow
          noun={noun}
          line={line}
          disabled={disabled}
          onRemove={props.onRemove}
        />
      </div>
      {props.body(labelId, errorId)}
      <RowError id={errorId} problem={problem} />
    </li>
  );
}

/** One row: its sentence, opening in place into its controls. */
export function SentenceRow(props: SentenceRowProps): React.JSX.Element {
  const lineRef = React.useRef<HTMLButtonElement>(null);
  if (!props.open) return <ClosedRow props={props} lineRef={lineRef} />;
  return (
    <OpenRow
      props={props}
      onClose={() => {
        props.onClose();
        // Back on the line it opened from, so the keyboard keeps its place.
        requestAnimationFrame(() => lineRef.current?.focus());
      }}
    />
  );
}

/** A row as it stands: what is stored, or the draft over it. */
export interface ShownRow<Draft> {
  readonly key: string;
  /** The stored row it edits, or `undefined` for a new one. */
  readonly index: number | undefined;
  readonly draft: Draft;
  /** Whether this is a draft that differs from what is stored. */
  readonly drafted: boolean;
}

/** The rows of a list being edited, and how a row changes, closes or goes. */
export interface SentenceRows<Draft> {
  readonly rows: readonly ShownRow<Draft>[];
  readonly openKey: string | null;
  readonly setOpenKey: (key: string | null) => void;
  /** Add an empty row, opened. */
  readonly add: () => void;
  /**
   * A row's draft changed: stored at `index` when it completed, which the
   * caller writes, else kept as the row's draft.
   */
  readonly change: (
    row: ShownRow<Draft>,
    draft: Draft,
    completed: boolean
  ) => number;
  /** Remove a row: a draft goes, a stored row's index is answered to remove. */
  readonly remove: (row: ShownRow<Draft>) => number | undefined;
}

/**
 * Each stored row's key for its draft: what the row holds, and how many rows
 * holding the same came before it. Keyed by content rather than position, so
 * a draft stays with its row when another row is written or removed and the
 * rows after it move up, and goes once its own row is written, since the row
 * then holds something else.
 */
function draftKeysOf<Stored>(stored: readonly Stored[]): string[] {
  const seen = new Map<string, number>();
  return stored.map(each => {
    const text = JSON.stringify(each) ?? "";
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    return `${text}\u0000${String(count)}`;
  });
}

/**
 * The rows of a stored list being edited: each stored row, with any draft
 * over it, then the new rows not yet complete. A draft stays with its row
 * when another row is written or removed, and goes once its own row is
 * written, since the row then holds the draft.
 */
export function useSentenceRows<Stored, Draft>(
  stored: readonly Stored[],
  toDraft: (stored: Stored) => Draft,
  empty: Draft
): SentenceRows<Draft> {
  // Drafts over stored rows, by each row's content key: a draft whose row no
  // longer holds what it did is simply never read again.
  const [overStored, setOverStored] = React.useState<
    ReadonlyMap<string, Draft>
  >(() => new Map());
  const [added, setAdded] = React.useState<
    ReadonlyArray<{ key: string; draft: Draft }>
  >([]);
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const draftKeys = draftKeysOf(stored);
  const nextKey = React.useRef(0);
  const rows: ShownRow<Draft>[] = [
    ...stored.map((each, index) => {
      const draft = overStored.get(draftKeys[index] ?? "");
      return {
        key: `stored:${String(index)}`,
        index,
        draft: draft ?? toDraft(each),
        drafted: draft !== undefined,
      };
    }),
    ...added.map(each => ({
      key: each.key,
      index: undefined,
      draft: each.draft,
      drafted: true,
    })),
  ];
  // Only the drafts still over a stored row are kept when one is set, so the
  // map never holds more than the rows shown.
  const setDraft = (index: number, draft: Draft | undefined): void => {
    const live = new Set(draftKeys);
    const at = draftKeys[index];
    setOverStored(current => {
      const next = new Map([...current].filter(([key]) => live.has(key)));
      if (at === undefined) return next;
      if (draft === undefined) next.delete(at);
      else next.set(at, draft);
      return next;
    });
  };
  return {
    rows,
    openKey,
    setOpenKey,
    add: () => {
      nextKey.current += 1;
      const key = `new:${String(nextKey.current)}`;
      setAdded(current => [...current, { key, draft: empty }]);
      // A new row opens already open, its field menu with it.
      setOpenKey(key);
    },
    change: (row, draft, completed) => {
      const index = row.index ?? stored.length;
      if (completed) {
        if (row.index !== undefined) setDraft(row.index, undefined);
        if (row.index === undefined) {
          setAdded(current => current.filter(each => each.key !== row.key));
          if (openKey === row.key) setOpenKey(`stored:${String(index)}`);
        }
        return index;
      }
      if (row.index === undefined) {
        setAdded(current =>
          current.map(each =>
            each.key === row.key ? { ...each, draft } : each
          )
        );
      } else {
        setDraft(row.index, draft);
      }
      return index;
    },
    remove: row => {
      if (openKey === row.key) setOpenKey(null);
      if (row.index === undefined) {
        setAdded(current => current.filter(each => each.key !== row.key));
      } else {
        setDraft(row.index, undefined);
      }
      return row.index;
    },
  };
}
