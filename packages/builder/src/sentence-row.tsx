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

/** What the rows last asked of the stored list: a row written or removed. */
type RowEdit =
  | { readonly kind: "write"; readonly index: number }
  | { readonly kind: "remove"; readonly index: number };

/**
 * The drafts over the stored rows after the stored list changed, by what
 * changed it. A row written keeps every other draft where it is; a row removed
 * moves the drafts after it up one. A change these rows didn't make, such as
 * an undo, leaves no draft standing, since nothing says which row is which.
 */
function draftsAfter<Draft>(
  drafts: ReadonlyMap<number, Draft>,
  edit: RowEdit | undefined
): ReadonlyMap<number, Draft> {
  if (edit === undefined) return new Map();
  const next = new Map<number, Draft>();
  for (const [index, draft] of drafts) {
    if (index === edit.index) continue;
    next.set(
      edit.kind === "remove" && index > edit.index ? index - 1 : index,
      draft
    );
  }
  return next;
}

/**
 * The rows of a stored list being edited: each stored row, with any draft
 * over it, then the new rows not yet complete. A draft stays with its row
 * when another row is written or removed through these rows, and goes once
 * its own row is written, since the row then holds the draft; a change made
 * elsewhere, such as an undo, clears them, as nothing says which row is
 * which.
 */
export function useSentenceRows<Stored, Draft>(
  stored: readonly Stored[],
  toDraft: (stored: Stored) => Draft,
  empty: Draft
): SentenceRows<Draft> {
  // Drafts over stored rows, by index, with the stored list they were made
  // over: a list that has since changed is read through `draftsAfter`.
  const [overStored, setOverStored] = React.useState<{
    readonly basis: string;
    readonly drafts: ReadonlyMap<number, Draft>;
  }>(() => ({ basis: JSON.stringify(stored), drafts: new Map() }));
  const [added, setAdded] = React.useState<
    ReadonlyArray<{ key: string; draft: Draft }>
  >([]);
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  // The edit these rows last asked for, with the stored list it was asked
  // over, so it is read only for the change it makes.
  const lastEdit = React.useRef<
    { readonly edit: RowEdit; readonly over: string } | undefined
  >(undefined);
  const storedText = JSON.stringify(stored);
  const current =
    overStored.basis === storedText
      ? overStored.drafts
      : draftsAfter(overStored.drafts, lastEdit.current?.edit);
  // Settled once the change is drawn, so the edit is read for it alone.
  React.useEffect(() => {
    // Read here, not in the updater: React may run that on the next render,
    // when the line below has already spent the edit.
    const edit = lastEdit.current?.edit;
    setOverStored(state =>
      state.basis === storedText
        ? state
        : { basis: storedText, drafts: draftsAfter(state.drafts, edit) }
    );
    lastEdit.current = undefined;
  }, [storedText]);
  // An edit that changed nothing, a row written back to what it held, is
  // spent once drawn, so a later change made elsewhere isn't read as it.
  React.useEffect(() => {
    if (lastEdit.current?.over === storedText) lastEdit.current = undefined;
  });
  const setDraft = (index: number, draft: Draft | undefined): void => {
    setOverStored(() => {
      const drafts = new Map(current);
      if (draft === undefined) drafts.delete(index);
      else drafts.set(index, draft);
      return { basis: storedText, drafts };
    });
  };
  const nextKey = React.useRef(0);
  const rows: ShownRow<Draft>[] = [
    ...stored.map((each, index) => {
      const draft = current.get(index);
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
        // The caller writes this row next; every other draft stays put.
        lastEdit.current = { edit: { kind: "write", index }, over: storedText };
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
        // The caller removes this row next; the rows after it move up.
        lastEdit.current = {
          edit: { kind: "remove", index: row.index },
          over: storedText,
        };
        setDraft(row.index, undefined);
      }
      return row.index;
    },
  };
}
