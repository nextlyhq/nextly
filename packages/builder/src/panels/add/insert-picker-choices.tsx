"use client";

/**
 * The in-place picker's choices: the six most used as a grid of three
 * columns at rest, and the search's results as a list. Each is the element
 * the search field controls, with the highlighted choice as its active
 * descendant, so focus stays in the search while the arrows move.
 *
 * @module insert-picker-choices
 */

import * as React from "react";

import { BlockIconMark } from "../../block-icon";

import { gridRows } from "./insert-picker-keys";
import { categoryHeading, type InsertEntry } from "./inserter";

/** What every choice is drawn and chosen with. */
interface ChoicesProps {
  /** The id the search field's `aria-controls` names. */
  readonly id: string;
  readonly entries: readonly InsertEntry[];
  readonly highlighted: number;
  /** A choice's own id, for `aria-activedescendant`. */
  readonly choiceId: (index: number) => string;
  /** Where each choice goes, or why not, said after its name. */
  readonly whereOf: (entry: InsertEntry) => string | undefined;
  readonly onHighlight: (index: number) => void;
  readonly onChoose: (index: number) => void;
}

/**
 * A press keeps focus in the search: the choice is taken on the click, and
 * the field the arrows and typing work in stays the one with focus.
 */
function keepSearchFocus(event: React.MouseEvent): void {
  event.preventDefault();
}

/** The six at rest, three to a row, as a grid. */
export function MostUsedGrid(props: ChoicesProps): React.JSX.Element {
  const rows = gridRows(
    props.entries.map((entry, index) => ({ entry, index }))
  );
  return (
    <div
      id={props.id}
      role="grid"
      aria-label="Most used blocks"
      className="nx-insert-picker__grid"
    >
      {rows.map(row => (
        <div role="row" key={row[0]?.index} className="nx-insert-picker__row">
          {row.map(({ entry, index }) => (
            <Choice key={entry.id} role="gridcell" {...props} index={index}>
              <BlockIconMark icon={entry.icon} size={18} />
              <span className="nx-insert-picker__name">{entry.label}</span>
            </Choice>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The search's results, one to a line, with the group each is in. */
export function ResultList(props: ChoicesProps): React.JSX.Element {
  return (
    <div
      id={props.id}
      role="listbox"
      aria-label="Matching blocks"
      className="nx-insert-picker__list"
    >
      {props.entries.map((entry, index) => (
        <Choice key={entry.id} role="option" {...props} index={index}>
          <BlockIconMark icon={entry.icon} size={16} />
          <span className="nx-insert-picker__name">{entry.label}</span>
          <span className="nx-insert-picker__group" aria-hidden="true">
            {categoryHeading(entry.category)}
          </span>
        </Choice>
      ))}
    </div>
  );
}

/**
 * One choice: named by its block, described by where it goes, marked
 * selected while highlighted. A pointer moving over it highlights it, as
 * the arrows do, so the line names the place before the click.
 */
function Choice({
  role,
  index,
  entries,
  highlighted,
  choiceId,
  whereOf,
  onHighlight,
  onChoose,
  children,
}: ChoicesProps & {
  readonly role: "gridcell" | "option";
  readonly index: number;
  readonly children: React.ReactNode;
}): React.JSX.Element | null {
  const entry = entries[index];
  if (entry === undefined) return null;
  const id = choiceId(index);
  const where = whereOf(entry);
  return (
    <div
      id={id}
      role={role}
      aria-selected={index === highlighted}
      aria-label={entry.label}
      aria-describedby={where === undefined ? undefined : `${id}-where`}
      data-highlighted={index === highlighted ? "" : undefined}
      className="nx-insert-picker__choice"
      onPointerMove={() => {
        if (index !== highlighted) onHighlight(index);
      }}
      onMouseDown={keepSearchFocus}
      onClick={() => onChoose(index)}
    >
      {children}
      {where === undefined ? null : (
        <span id={`${id}-where`} className="nx-sr-only">
          {where}
        </span>
      )}
    </div>
  );
}
