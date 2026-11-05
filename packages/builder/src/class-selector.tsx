/**
 * Apply a shared style to the selected block: a search field over the site's
 * shared styles, and the list it narrows. The inspector's bar opens it from
 * "Apply shared style".
 *
 * A surface over {@link class-library}, which holds every rule this draws, so
 * the rules stay testable without a DOM. It applies existing styles only: a
 * shared style is made from a block ("Save as shared style…"), so no typed
 * name becomes an empty one. Removing a style from the block is on its chip
 * in the bar, and renaming is in Design's Shared styles tab.
 *
 * Every control reports an intent and stores nothing: the block's classes are
 * written by the inspector through the editor.
 *
 * @module class-selector
 */

import type { NamedClass } from "@nextlyhq/blocks-engine";
import { Input } from "@nextlyhq/ui";
import * as React from "react";

import {
  nodeHasRoom,
  selectorOptions,
  unappliedNodeClassCount,
  withClassApplied,
  type ClassOption,
} from "./class-library";
import {
  searchSharedStyles,
  sharedStyleRows,
  sharedStylesOnly,
  sharedStyleSearchText,
} from "./shared-style-library";

/**
 * Why the last application did not land.
 *
 * - `node-full`: the block already lists as many as the page applies.
 * - `not-written`: the document refused the write (a page at its byte cap).
 */
type SelectorFailure = { readonly kind: "node-full" | "not-written" };

/**
 * The failure to show for this node, or `null` once it no longer describes it.
 *
 * Scoped by BOTH the node and what it holds: two blocks with no classes show
 * the same empty list, and the same block whose classes have since changed has
 * left the state the refusal was raised against.
 */
function liveFailure(
  failure: {
    about: string;
    whenIds: readonly string[];
    issue: SelectorFailure;
  } | null,
  nodeId: string,
  nodeClassIds: readonly string[]
): SelectorFailure | null {
  if (failure === null) return null;
  if (failure.about !== nodeId) return null;
  if (!sameClassIds(failure.whenIds, nodeClassIds)) return null;
  if (failure.issue.kind === "node-full" && nodeHasRoom(nodeClassIds)) {
    return null;
  }
  return failure.issue;
}

/** Two id lists by value, since a caller may hand a fresh `[]` every render. */
function sameClassIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** What the author is told, per cause. */
function failureMessage(failure: SelectorFailure): string {
  return failure.kind === "not-written"
    ? "This change could not be applied to the document."
    : "This block already lists as many shared styles as the page applies.";
}

/** Whether a write to the selected node's classes reached the document. */
export type ClassWriteOutcome = "applied" | "refused";

export interface ClassSelectorProps {
  /** Which block this is editing, to scope a refusal to it. */
  nodeId: string;
  /**
   * The site's shared styles, or `undefined` while there are none to show:
   * a read in flight or one that failed, which
   * {@link ClassSelectorProps.libraryAbsence} tells apart.
   */
  library: readonly NamedClass[] | undefined;
  /** Why there is no library, when there is none. */
  libraryAbsence?: "pending" | "failed";
  /** The class ids the selected node carries, as stored. */
  nodeClassIds: readonly string[];
  /**
   * The node's classes after an apply, and whether it landed: the document
   * can refuse a write these rules cannot anticipate, and the typed query is
   * kept when it does.
   */
  onNodeClassesChange: (classIds: string[]) => ClassWriteOutcome;
  /** Focus the search field when it mounts, as a picker just opened does. */
  autoFocus?: boolean;
}

/** A search over the site's shared styles that applies the one chosen. */
export function ClassSelector({
  nodeId,
  library,
  libraryAbsence,
  nodeClassIds,
  onNodeClassesChange,
  autoFocus = false,
}: ClassSelectorProps): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [failure, setFailure] = React.useState<{
    readonly about: string;
    readonly whenIds: readonly string[];
    readonly issue: SelectorFailure;
  } | null>(null);
  const listId = React.useId();
  // The shared styles any block may wear; a look is picked from its tiles.
  const offered = React.useMemo(
    () => (library === undefined ? undefined : sharedStylesOnly(library)),
    [library]
  );
  const matches = useStyleSearch(offered, query);

  // Cleared, not merely hidden, once it stops describing the node: React's
  // adjust-state-during-render, which converges once the state is null.
  if (failure !== null && liveFailure(failure, nodeId, nodeClassIds) === null) {
    setFailure(null);
  }

  if (library === undefined) {
    return (
      <div className="nx-classes">
        <p className="nx-inspector__note">
          {libraryAbsence === "failed"
            ? "This site's shared styles could not be read."
            : "Loading shared styles…"}
        </p>
      </div>
    );
  }

  const { options, hidden } = selectorOptions(
    offered ?? library,
    nodeClassIds,
    matches
  );
  const unapplied = unappliedNodeClassCount(nodeClassIds);
  const shown = liveFailure(failure, nodeId, nodeClassIds);
  // Clamped rather than reset on every keystroke, so narrowing the list keeps
  // a highlight instead of sending Enter back to the first row.
  const highlighted = Math.min(active, Math.max(options.length - 1, 0));
  const nameOf = (option: ClassOption): string => styleName(library, option);

  const commit = (option: ClassOption | undefined): void => {
    if (option === undefined) return;
    // The per-node bound lives in one place, asked rather than restated.
    const outcome = withClassApplied(nodeClassIds, option.choice.id);
    if (!outcome.ok) {
      setFailure({
        about: nodeId,
        whenIds: nodeClassIds,
        issue: { kind: "node-full" },
      });
      return;
    }
    if (onNodeClassesChange(outcome.classIds) === "refused") {
      // The query survives: nothing the author typed is lost to a refusal.
      setFailure({
        about: nodeId,
        whenIds: nodeClassIds,
        issue: { kind: "not-written" },
      });
      return;
    }
    setFailure(null);
    setQuery("");
    setActive(0);
  };

  return (
    <div className="nx-classes">
      <Input
        className="nx-classes__query"
        value={query}
        role="combobox"
        autoFocus={autoFocus}
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-activedescendant={
          options.length > 0 ? optionDomId(listId, highlighted) : undefined
        }
        aria-label="Search shared styles"
        placeholder="Search shared styles…"
        onChange={event => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={event =>
          handleKey(event, {
            count: options.length,
            highlighted,
            setActive,
            commit: () => commit(options[highlighted]),
          })
        }
      />
      <OptionList
        id={listId}
        options={options}
        highlighted={highlighted}
        nameOf={nameOf}
        onChoose={commit}
        onHighlight={setActive}
      />
      <SelectorNotes
        empty={options.length === 0}
        searched={query.trim() !== ""}
        hidden={hidden}
        failure={shown}
        unapplied={unapplied}
      />
    </div>
  );
}

/** A style as the Shared styles tab names it: its label, else its slug. */
function styleName(
  library: readonly NamedClass[],
  option: ClassOption
): string {
  const label = library
    .find(entry => entry.id === option.choice.id)
    ?.label?.trim();
  return label === undefined || label === "" ? option.choice.slug : label;
}

/** What the picker says under its list: nothing to show, more, or a refusal. */
function SelectorNotes({
  empty,
  searched,
  hidden,
  failure,
  unapplied,
}: {
  empty: boolean;
  searched: boolean;
  hidden: number;
  failure: SelectorFailure | null;
  unapplied: number;
}): React.ReactElement {
  return (
    <>
      {empty ? (
        <p className="nx-inspector__note">
          {searched
            ? "No shared style matches."
            : "This site has no other shared styles yet."}
        </p>
      ) : null}
      {hidden > 0 ? (
        <p className="nx-inspector__note">
          {`${hidden} more — keep typing to narrow the list.`}
        </p>
      ) : null}
      {failure !== null ? (
        <p className="nx-classes__issue" role="alert">
          {failureMessage(failure)}
        </p>
      ) : null}
      {unapplied > 0 ? (
        <p className="nx-classes__issue" role="status">
          {`This block lists ${unapplied} more shared ${unapplied === 1 ? "style" : "styles"} than the page applies. They style nothing, and removing one can bring another into use.`}
        </p>
      ) : null}
    </>
  );
}

/**
 * Which styles a query finds, by the Shared styles tab's own search: the name
 * as written and the class name, and any property or value, with case,
 * spaces and dashes aside. One rule, so a style is found the same way in the
 * tab and here. The searchable text is built once per library.
 */
function useStyleSearch(
  library: readonly NamedClass[] | undefined,
  query: string
): (choice: { id: string }) => boolean {
  const rows = React.useMemo(
    () => (library === undefined ? [] : sharedStyleRows(library, NO_IDS)),
    [library]
  );
  const texts = React.useMemo(
    () => new Map(rows.map(row => [row.id, sharedStyleSearchText(row)])),
    [rows]
  );
  const found = new Set(
    searchSharedStyles(rows, query, row => texts.get(row.id) ?? "").map(
      row => row.id
    )
  );
  return choice => found.has(choice.id);
}

/** No code-supplied ids: the picker lists what may be applied, from anywhere. */
const NO_IDS: ReadonlySet<string> = new Set();

/** The DOM id of one option row, for `aria-activedescendant`. */
function optionDomId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

/** The field's keys: arrows move the highlight, wrapping; Enter applies it. */
function handleKey(
  event: React.KeyboardEvent<HTMLInputElement>,
  ctx: {
    count: number;
    highlighted: number;
    setActive: (next: number) => void;
    commit: () => void;
  }
): void {
  if (ctx.count === 0) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    ctx.setActive((ctx.highlighted + 1) % ctx.count);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    ctx.setActive((ctx.highlighted - 1 + ctx.count) % ctx.count);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    ctx.commit();
  }
}

/** The styles the query matches, in the order Enter would take them. */
function OptionList({
  id,
  options,
  highlighted,
  nameOf,
  onChoose,
  onHighlight,
}: {
  id: string;
  options: readonly ClassOption[];
  highlighted: number;
  nameOf: (option: ClassOption) => string;
  onChoose: (option: ClassOption) => void;
  onHighlight: (index: number) => void;
}): React.ReactElement | null {
  if (options.length === 0) return null;
  return (
    <ul className="nx-classes__options" id={id} role="listbox">
      {options.map((option, index) => (
        <li
          key={option.choice.id}
          id={optionDomId(id, index)}
          role="option"
          // Not in the tab sequence: with `aria-activedescendant` focus stays
          // in the field and the arrows move the active row.
          tabIndex={-1}
          aria-selected={index === highlighted}
          className={
            index === highlighted
              ? "nx-classes__option nx-classes__option--active"
              : "nx-classes__option"
          }
          onMouseEnter={() => onHighlight(index)}
          onClick={() => onChoose(option)}
        >
          {/*
           * The name in the interface's own type and the class name in mono, each
           * cut short rather than broken mid-word, the whole of it in a tooltip.
           */}
          <span className="nx-classes__option-name" title={nameOf(option)}>
            {nameOf(option)}
          </span>
          <code
            className="nx-classes__option-class"
            title={`.${option.choice.className}`}
          >
            .{option.choice.className}
          </code>
        </li>
      ))}
    </ul>
  );
}
