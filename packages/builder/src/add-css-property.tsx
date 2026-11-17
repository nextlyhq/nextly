"use client";

/**
 * The Style tab's last section, "CSS properties": the properties the author
 * added, each with its value and a Remove, and "+ Add CSS property", which
 * opens a searchable list of the catalog properties that work on this block
 * now. While "Find a setting" is searching, the properties it finds that the
 * block can use but hasn't added are listed here with an "Add" each.
 *
 * What is drawn, offered and found is `css-properties`'s answer; this file
 * draws it. Only catalog properties are ever offered: the list is not a free
 * CSS box.
 *
 * @module add-css-property
 */
import { AccordionContent, AccordionItem } from "@nextlyhq/ui";
import * as React from "react";

import {
  addableRows,
  CSS_PROPERTIES_SECTION,
  cssPropertyRows,
  type CssPropertyRow,
} from "./css-properties";
import { SectionHeading } from "./panel-section";
import { SectionHeld } from "./section-held";
import { SettingSlot, sectionShown, useSettingsMatch } from "./settings-filter";
import { entryMatches } from "./settings-index";
import type { StyleFieldSurroundings } from "./style-field-surroundings";
import { useFieldTarget } from "./style-field-target";
import { StylePropertyFields } from "./style-property-fields";

/**
 * The properties the author added to one block, while it stays selected.
 * Panel state, like a section's folds: what the author chose to look at, not
 * anything the page stores. A property holding a value is drawn whatever this
 * says, so it hides nothing set; it starts empty for the next block.
 */
export function useAddedProperties(nodeId: string): {
  readonly added: ReadonlySet<string>;
  readonly add: (id: string) => void;
  readonly remove: (id: string) => void;
} {
  const [held, setHeld] = React.useState<{
    readonly nodeId: string;
    readonly ids: ReadonlySet<string>;
  }>(() => ({ nodeId, ids: new Set() }));
  const added = held.nodeId === nodeId ? held.ids : EMPTY;
  const change = (next: (ids: Set<string>) => void) =>
    setHeld(current => {
      const ids = new Set(current.nodeId === nodeId ? current.ids : EMPTY);
      next(ids);
      return { nodeId, ids };
    });
  return {
    added,
    add: id => change(ids => ids.add(id)),
    remove: id => change(ids => ids.delete(id)),
  };
}

const EMPTY: ReadonlySet<string> = new Set();

/** The props the section is drawn from. */
interface CssPropertiesSectionProps {
  /** Every property the block's sections don't show unasked. */
  readonly extras: readonly CssPropertyRow[];
  /** What the author added to this block, and how to change it. */
  readonly added: ReturnType<typeof useAddedProperties>;
  /** Why every control is read-only, which also withholds adding. */
  readonly readOnlyReason: string | undefined;
  readonly surroundings: StyleFieldSurroundings;
}

/** "CSS properties", the Style tab's last section. */
export function CssPropertiesSection({
  extras,
  added,
  readOnlyReason,
  surroundings,
}: CssPropertiesSectionProps): React.JSX.Element {
  const match = useSettingsMatch();
  const { key, label } = CSS_PROPERTIES_SECTION;
  return (
    <AccordionItem
      value={key}
      data-section={key}
      hidden={!sectionShown(match, "style", key)}
    >
      <SectionHeading
        label={label}
        holdsValues={extras.some(each => each.row.set)}
      />
      <AccordionContent>
        <CssPropertiesBody
          // Keyed by node: the list's search and where focus goes start
          // afresh for the next block.
          key={surroundings.nodeId}
          extras={extras}
          added={added}
          readOnlyReason={readOnlyReason}
          surroundings={surroundings}
        />
      </AccordionContent>
    </AccordionItem>
  );
}

/** Where focus goes once the rows are drawn again. */
type FocusNext = { readonly row: string } | "add" | undefined;

/** The section's rows, what search found to add, and the picker. */
function CssPropertiesBody({
  extras,
  added,
  readOnlyReason,
  surroundings,
}: CssPropertiesSectionProps): React.JSX.Element {
  const readOnly = readOnlyReason !== undefined;
  const rows = cssPropertyRows(extras, added.added);
  const addable = addableRows(extras, added.added);
  const body = React.useRef<HTMLFieldSetElement | null>(null);
  const addButton = React.useRef<HTMLButtonElement | null>(null);
  const [focusNext, setFocusNext] = React.useState<FocusNext>(undefined);
  React.useEffect(() => {
    if (focusNext === undefined) return;
    setFocusNext(undefined);
    if (focusNext === "add") {
      addButton.current?.focus();
      return;
    }
    focusValueOf(body.current, focusNext.row);
  }, [focusNext]);
  const add = (id: string) => {
    added.add(id);
    setFocusNext({ row: id });
  };
  const removed = (id: string) => {
    // To the row after it, or the one before where it was last, or to "+ Add
    // CSS property" where it was the only one.
    const index = rows.findIndex(each => each.id === id);
    const next = rows[index + 1] ?? rows[index - 1];
    added.remove(id);
    setFocusNext(next === undefined ? "add" : { row: next.id });
  };
  return (
    <fieldset className="nx-inspector__fields" disabled={readOnly} ref={body}>
      <SectionHeld.Provider value={readOnly}>
        {rows.map(each => (
          <SettingSlot
            key={`${surroundings.nodeId}:${each.id}`}
            tab="style"
            ids={[each.id]}
          >
            <CssPropertyLine
              entry={each}
              surroundings={surroundings}
              onRemoved={() => removed(each.id)}
            />
          </SettingSlot>
        ))}
        <FoundToAdd addable={addable} onAdd={add} />
        {readOnly ? null : (
          <AddCssProperty addable={addable} onAdd={add} button={addButton} />
        )}
      </SectionHeld.Provider>
    </fieldset>
  );
}

/**
 * Focus a row's value: its first text field or menu, else its first control
 * that is not its Remove. Never a control kept out of reach, such as the
 * native select a menu keeps hidden for forms.
 */
function focusValueOf(within: HTMLElement | null, id: string): void {
  const row = [
    ...(within?.querySelectorAll<HTMLElement>("[data-css-property]") ?? []),
  ].find(each => each.dataset.cssProperty === id);
  if (row === undefined) return;
  const reachable = (selector: string) =>
    [...row.querySelectorAll<HTMLElement>(selector)].find(
      each =>
        each.closest('[aria-hidden="true"]') === null && each.tabIndex >= 0
    );
  const value =
    reachable("input, textarea, [role='combobox']") ??
    reachable("button:not([data-remove])");
  value?.focus();
}

/** One added property: its fields, and its Remove. */
function CssPropertyLine({
  entry,
  surroundings,
  onRemoved,
}: {
  entry: CssPropertyRow;
  surroundings: StyleFieldSurroundings;
  onRemoved: () => void;
}): React.JSX.Element {
  const field = useFieldTarget({
    editor: surroundings.editor,
    nodeId: surroundings.nodeId,
    address: {
      state: surroundings.state,
      breakpoint: surroundings.breakpoint,
      property: entry.row.property,
      path: entry.path,
    },
    policy: surroundings.policy,
  });
  const remove = () => {
    // The value and the row go together: clearing is one edit, so one undo
    // brings both back. A refused clear keeps the row, saying why.
    if (field.stored !== undefined && field.commit(null) === "refused") return;
    onRemoved();
  };
  return (
    <div className="nx-css-property" data-css-property={entry.id}>
      <div className="nx-css-property__fields">
        <StylePropertyFields
          property={entry.row}
          namesSection={false}
          {...surroundings}
        />
      </div>
      <button
        type="button"
        className="nx-css-property__remove"
        data-remove=""
        aria-label={`Remove ${entry.cssName}`}
        onClick={remove}
      >
        <span aria-hidden="true">✕</span>
      </button>
      {field.issue === null ? null : (
        <p className="nx-inspector__note" role="alert">
          {field.issue}
        </p>
      )}
    </div>
  );
}

/** A property's CSS name, plain name and section, as the lists draw them. */
function PropertyNames({
  entry,
}: {
  entry: CssPropertyRow;
}): React.JSX.Element {
  return (
    // Spaced, so each is read as its own word.
    <>
      <span className="nx-css-picker__css">{entry.cssName}</span>{" "}
      <span className="nx-css-picker__plain">{entry.plainName}</span>{" "}
      <span className="nx-css-picker__section">{entry.section.label}</span>
    </>
  );
}

/**
 * While "Find a setting" is searching, the properties it found that the block
 * can use but hasn't added, each with "Add": listed while the design is held
 * too, as the tab's count says, with Add held by the section's fieldset.
 */
function FoundToAdd({
  addable,
  onAdd,
}: {
  addable: readonly CssPropertyRow[];
  onAdd: (id: string) => void;
}): React.JSX.Element | null {
  const match = useSettingsMatch();
  if (!match.active) return null;
  const kept = match.kept.get("style");
  const found = addable.filter(each => kept?.has(each.id) === true);
  if (found.length === 0) return null;
  return (
    <ul className="nx-css-found" aria-label="CSS properties you can add">
      {found.map(each => (
        <li key={each.id} className="nx-css-found__item">
          <span className="nx-css-found__names">
            <PropertyNames entry={each} />
          </span>
          <button
            type="button"
            className="nx-css-found__add"
            aria-label={`Add ${each.cssName}`}
            onClick={() => onAdd(each.id)}
          >
            Add
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Whether a picker entry answers what was typed, as "Find a setting" reads. */
function pickerMatches(entry: CssPropertyRow, query: string): boolean {
  return entryMatches(
    {
      tab: "style",
      section: entry.section.key,
      sectionLabel: entry.section.label,
      id: entry.id,
      label: entry.plainName,
      options: [],
      css: [entry.cssName],
      set: false,
    },
    query
  );
}

/**
 * "+ Add CSS property" and the list it opens: a search field over the
 * properties that work on this block now and aren't drawn yet, each named by
 * its CSS name, its plain name and its section. Inline under the button, so
 * it stays inside the panel at any width.
 */
function AddCssProperty({
  addable,
  onAdd,
  button,
}: {
  addable: readonly CssPropertyRow[];
  onAdd: (id: string) => void;
  button: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const pickerId = React.useId();
  return (
    <div className="nx-css-properties__add-wrap">
      <button
        ref={button}
        type="button"
        className="nx-css-properties__add"
        aria-expanded={open}
        aria-controls={open ? pickerId : undefined}
        onClick={() => setOpen(!open)}
      >
        + Add CSS property
      </button>
      {open ? (
        <CssPropertyPicker
          id={pickerId}
          addable={addable}
          onPick={id => {
            setOpen(false);
            onAdd(id);
          }}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/** The picker's search field and the list it narrows. */
function CssPropertyPicker({
  id,
  addable,
  onPick,
  onClose,
}: {
  id: string;
  addable: readonly CssPropertyRow[];
  onPick: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listId = `${id}-list`;
  const search = React.useRef<HTMLInputElement | null>(null);
  // Into the search as the list opens, so the author types at once.
  React.useEffect(() => search.current?.focus(), []);
  const listed = addable.filter(entry => pickerMatches(entry, query));
  const current = listed[Math.min(active, listed.length - 1)];
  const list = React.useRef<HTMLUListElement | null>(null);
  // The chosen option kept in view: focus stays in the search field, so
  // moving the choice from the keyboard doesn't scroll the list by itself.
  const currentId = current?.id;
  React.useEffect(() => {
    if (currentId === undefined) return;
    const option = [
      ...(list.current?.querySelectorAll<HTMLElement>("[data-css-id]") ?? []),
    ].find(each => each.dataset.cssId === currentId);
    option?.scrollIntoView({ block: "nearest" });
  }, [currentId]);
  const optionId = (entry: CssPropertyRow) => `${id}-${entry.id}`;
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined && listed.length > 0) {
      event.preventDefault();
      setActive((Math.max(active, 0) + step + listed.length) % listed.length);
    } else if (event.key === "Enter" && current !== undefined) {
      event.preventDefault();
      onPick(current.id);
    } else if (event.key === "Escape") {
      // Closed here, and kept from the canvas, which would take Escape as
      // leaving the block.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };
  return (
    <div className="nx-css-picker" id={id}>
      <input
        ref={search}
        type="search"
        className="nx-css-picker__search"
        role="combobox"
        aria-label="Search CSS properties"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          current === undefined ? undefined : optionId(current)
        }
        placeholder="Search properties"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={event => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul
        ref={list}
        className="nx-css-picker__list"
        id={listId}
        role="listbox"
        aria-label="CSS properties"
      >
        {listed.map(entry => (
          <li
            key={entry.id}
            id={optionId(entry)}
            role="option"
            aria-selected={entry === current}
            data-css-id={entry.id}
            className="nx-css-picker__option"
            // Kept from taking focus, so the search field keeps it.
            onMouseDown={event => event.preventDefault()}
            onClick={() => onPick(entry.id)}
          >
            <PropertyNames entry={entry} />
          </li>
        ))}
      </ul>
      {listed.length > 0 ? null : (
        <p className="nx-css-picker__empty">
          {addable.length === 0
            ? "Nothing left that applies here."
            : "No property matches."}
        </p>
      )}
      <p className="nx-css-picker__note">
        Only properties that work on this block are listed.
      </p>
    </div>
  );
}
