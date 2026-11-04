"use client";

/**
 * The Components panel: the site's components by name, a search, and placing
 * one where the Add panel would place a block.
 *
 * ## One placement path
 *
 * Every insert goes through the Add panel's own offers ({@link useInsertOffers})
 * with the components the host hands that panel, so a component placed from
 * here lands where its tile in Add would, refused where that tile is refused,
 * and by the same op. A drag starts through {@link beginEntryDrag}, the
 * function Add's tiles start theirs with. Two panels that inserted differently
 * would leave an author unable to predict either.
 *
 * ## A list of rows, not a listbox
 *
 * Add is a grid of tiles in a listbox. A component row also carries "Edit",
 * and a button cannot sit inside a listbox: its owned elements are options and
 * groups only, so the button would be invalid there and unreachable from the
 * arrow keys that move a listbox's highlight. Each row is therefore two
 * buttons in a list, reached with Tab. The arrow keys move between rows as a
 * shortcut, and Enter in the search places the first match, as it does in Add.
 *
 * ## What "Edit" opens
 *
 * The host's, because it knows the component's own view and whether this
 * author may update components. Absent, no row offers a way to change a
 * component, and placing one is all the panel does.
 *
 * @module components-panel
 */

import type { ComponentLookup, NestingSource } from "@nextlyhq/blocks-engine";
import { Input } from "@nextlyhq/ui";
import { CornerDownRight, PencilLine } from "lucide-react";
import * as React from "react";

import { BlockIconMark } from "./block-icon";
import type { EditorState } from "./editor-state";
import { EDITOR_WORDS } from "./editor-words";
import {
  beginEntryDrag,
  LibraryNotices,
  placementWords,
  tileAside,
  useInsertOffers,
  type EntryOffer,
  type InsertPanelProps,
  type LibraryTierState,
} from "./insert-panel";
import {
  filterEntries,
  unplaceableComponentEntries,
  type ComponentInsertEntry,
  type SavedComponent,
} from "./inserter";

export interface ComponentsPanelProps {
  /** The editor whose document this places into, as Add is given it. */
  editor: EditorState;
  /**
   * The site's components this author may read, as the Add panel is handed
   * them: the one catalogue both panels and the editor's search offer.
   */
  components: readonly SavedComponent[];
  /** The lookup the canvas resolves instances against, as Add is handed it. */
  componentDefinitions: ComponentLookup;
  /** Whether the read is still on its way: rows are drawn as placeholders. */
  loading?: boolean;
  /** Where the component read stands, and the retry, as Add says it. */
  library?: {
    readonly components?: LibraryTierState;
    readonly retry?: () => void;
  };
  /**
   * How many of the site's components the host left out because they cannot
   * go in the document being edited: the component itself, and those that
   * place it. With none offered, the panel says that rather than that the
   * site has none.
   */
  withheld?: number;
  /** How nesting is resolved. Defaults to the live registry, as in Add. */
  nesting?: NestingSource;
  /** The container a "+" chose to add inside, as Add is handed it. */
  inside?: string;
  /** Begins a drag onto the canvas, as Add's tiles do. */
  beginInsertDrag?: InsertPanelProps["beginInsertDrag"];
  /** Notified after a placement, with the node that was added. */
  onInsert?: InsertPanelProps["onInsert"];
  /**
   * Opens a component alone, in its own view. Absent where this author may
   * not update components, and then no row offers it.
   */
  onEditComponent?: (componentId: string) => void;
  /**
   * Whether this author may make a component, so the empty panel can say how.
   */
  mayCreate?: boolean;
}

/**
 * No blocks, for the offers: this panel offers components only, and judging
 * every registered block at every place would be work nothing shows.
 */
const NO_BLOCKS: NonNullable<InsertPanelProps["definitions"]> = [];

/** How many placeholder rows stand in while the read is on its way. */
const PLACEHOLDER_ROWS = 3;

/**
 * What the panel says of a component with nothing in it that can be placed:
 * one saved without content, or with none the canvas could draw. It is
 * listed so it can be opened and filled, and refused where Add leaves it out.
 */
const NOTHING_TO_PLACE = "Nothing in it can be placed yet.";

/**
 * Every row the panel lists, in the library's order, as Add offers its
 * component tiles: the catalogue's entry for a component, or for one it
 * offers none, its entry with nothing to place.
 */
function componentRows(
  components: readonly SavedComponent[],
  catalog: ReturnType<typeof useInsertOffers>["catalog"],
  unplaceable: readonly ComponentInsertEntry[],
  query: string
): readonly ComponentInsertEntry[] {
  const byId = new Map<string, ComponentInsertEntry>();
  for (const entry of [...unplaceable, ...catalog]) {
    if (entry.kind === "component") byId.set(entry.componentId, entry);
  }
  const rows = components.flatMap(component => {
    const entry = byId.get(component.id);
    return entry === undefined ? [] : [entry];
  });
  return filterEntries(rows, query);
}

/** Move focus to the row before or after `from`, or back to the search. */
function moveFocus(
  list: HTMLElement | null,
  search: HTMLElement | null,
  from: HTMLElement | null,
  step: 1 | -1
): void {
  const rows = Array.from(
    list?.querySelectorAll<HTMLElement>("[data-component-row-place]") ?? []
  );
  const at = from === null ? -1 : rows.indexOf(from);
  const next = at + step;
  if (next < 0) {
    search?.focus();
    return;
  }
  rows[Math.min(next, rows.length - 1)]?.focus();
}

export function ComponentsPanel({
  editor,
  components,
  componentDefinitions,
  loading = false,
  library,
  withheld = 0,
  nesting,
  inside,
  beginInsertDrag,
  onInsert,
  onEditComponent,
  mayCreate = false,
}: ComponentsPanelProps): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const { catalog, candidates, offers, blockSource, insert } = useInsertOffers({
    editor,
    definitions: NO_BLOCKS,
    components,
    componentDefinitions,
    nesting,
    inside,
    onInsert,
  });
  const unplaceable = React.useMemo(
    () => unplaceableComponentEntries(components, catalog),
    [components, catalog]
  );
  const listed = componentRows(components, catalog, unplaceable, "");
  const entries = componentRows(components, catalog, unplaceable, query);
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);

  // The heading, the placement line and the notes are drawn with Add's own
  // classes, so the two panels on one rail read as one design.
  const header = (
    <h2 className="nx-insert-panel__title">{EDITOR_WORDS.components}</h2>
  );
  const firstPlace = candidates[0];
  if (firstPlace === undefined) {
    // Only an `inside` can leave no place, as in Add.
    return (
      <div className="nx-components-panel" data-empty="unplaceable">
        {header}
        <p className="nx-insert-panel__note">
          The container chosen to add into is no longer on the page. Select a
          block to add after it, or clear the selection to add at the end of the
          page.
        </p>
      </div>
    );
  }

  const place = (entry: ComponentInsertEntry) => insert(offers.get(entry.id));
  const drag = (
    event: React.PointerEvent<HTMLElement>,
    entry: ComponentInsertEntry
  ) =>
    beginEntryDrag(event, entry, {
      begin: beginInsertDrag,
      definitions: blockSource,
      nesting,
      onInserted: onInsert,
    });
  const move = (from: HTMLElement | null, step: 1 | -1) =>
    moveFocus(listRef.current, searchRef.current, from, step);

  return (
    <div className="nx-components-panel" aria-busy={loading || undefined}>
      {header}
      <ComponentSearch
        query={query}
        onQuery={setQuery}
        inputRef={searchRef}
        onFirst={() => move(null, 1)}
        onPlaceFirst={() => {
          const first = entries[0];
          if (first !== undefined) place(first);
        }}
      />
      <p className="nx-insert-panel__placement" aria-live="polite">
        <CornerDownRight aria-hidden="true" size={14} />
        <span>{placementWords("Adding", editor.document, firstPlace)}</span>
      </p>
      <LibraryNotices library={library} tier="components" />
      <PanelBody
        loading={loading}
        anyListed={listed.length > 0}
        unavailable={library?.components === "unavailable"}
        query={query}
        matches={entries.length}
        empty={<EmptyComponents withheld={withheld} mayCreate={mayCreate} />}
      >
        <ul
          ref={listRef}
          className="nx-components-panel__list"
          aria-label={EDITOR_WORDS.components}
        >
          {entries.map((entry, index) => (
            <ComponentRow
              key={entry.id}
              entry={entry}
              offer={offers.get(entry.id)}
              document={editor.document}
              firstMatch={query.trim() !== "" && index === 0}
              onPlace={() => place(entry)}
              onDrag={event => drag(event, entry)}
              onMove={move}
              {...(onEditComponent === undefined
                ? {}
                : { onEdit: () => onEditComponent(entry.componentId) })}
            />
          ))}
        </ul>
      </PanelBody>
    </div>
  );
}

/**
 * The search: ArrowDown moves into the rows, and Enter with a query places
 * the first match, as Enter takes the first tile in Add.
 */
function ComponentSearch({
  query,
  onQuery,
  inputRef,
  onFirst,
  onPlaceFirst,
}: {
  query: string;
  onQuery: (query: string) => void;
  inputRef: React.Ref<HTMLInputElement>;
  onFirst: () => void;
  onPlaceFirst: () => void;
}): React.JSX.Element {
  const words = `Search ${EDITOR_WORDS.components.toLowerCase()}`;
  return (
    <div className="nx-components-panel__search">
      <Input
        ref={inputRef}
        type="search"
        value={query}
        onChange={event => onQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            onFirst();
          } else if (event.key === "Enter" && query.trim() !== "") {
            event.preventDefault();
            onPlaceFirst();
          }
        }}
        placeholder={words}
        aria-label={words}
      />
    </div>
  );
}

/**
 * What stands under the placement line: placeholders while the read is on
 * its way, the empty panel, a search that matched nothing, or the rows.
 *
 * A read that failed says so in its notice above and nothing here, since
 * "none yet" beside "could not be loaded" would be false.
 */
function PanelBody({
  loading,
  anyListed,
  unavailable,
  query,
  matches,
  empty,
  children,
}: {
  loading: boolean;
  anyListed: boolean;
  unavailable: boolean;
  query: string;
  /** How many rows the search leaves. */
  matches: number;
  empty: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element | null {
  if (loading && !anyListed) {
    return (
      <div className="nx-components-panel__body">
        <p role="status" className="nx-sr-only">
          Loading {EDITOR_WORDS.components.toLowerCase()}…
        </p>
        <ul aria-hidden="true" className="nx-components-panel__list">
          {Array.from({ length: PLACEHOLDER_ROWS }, (_, index) => (
            <li key={index} className="nx-components-panel__placeholder" />
          ))}
        </ul>
      </div>
    );
  }
  if (!anyListed) return unavailable ? null : <>{empty}</>;
  if (matches === 0) {
    return (
      <p className="nx-insert-panel__note">
        No {EDITOR_WORDS.components.toLowerCase()} match “{query.trim()}”.
      </p>
    );
  }
  return <>{children}</>;
}

/**
 * One component: the button that places it, by click, Enter or a drag, and
 * Edit at the row's end when the host offers it.
 *
 * The button is NAMED by the component and DESCRIBED by where it goes (when
 * past the placement line, or why it cannot go here) and then its sentence,
 * as Add's tiles are, so a screen reader hears the name alone first.
 */
function ComponentRow({
  entry,
  offer,
  document,
  firstMatch,
  onPlace,
  onDrag,
  onMove,
  onEdit,
}: {
  entry: ComponentInsertEntry;
  offer: EntryOffer | undefined;
  document: EditorState["document"];
  /** Whether Enter in the search places this row. */
  firstMatch: boolean;
  onPlace: () => void;
  onDrag: (event: React.PointerEvent<HTMLElement>) => void;
  onMove: (from: HTMLElement, step: 1 | -1) => void;
  onEdit?: () => void;
}): React.JSX.Element {
  const id = React.useId();
  // Every entry the catalogue holds has an offer; one without is a component
  // with nothing to place.
  const placeable = offer !== undefined;
  const aside = placeable ? tileAside(offer, document) : NOTHING_TO_PLACE;
  const described = [
    aside === undefined ? undefined : `${id}-where`,
    entry.description === "" ? undefined : `${id}-what`,
  ]
    .filter(part => part !== undefined)
    .join(" ");
  return (
    <li
      className="nx-components-panel__row"
      data-refused={
        placeable && offer.refusal === undefined ? undefined : "true"
      }
      data-first-match={firstMatch ? "true" : undefined}
    >
      <button
        type="button"
        className="nx-components-panel__place"
        data-component-row-place=""
        aria-label={entry.label}
        aria-describedby={described === "" ? undefined : described}
        onClick={onPlace}
        onKeyDown={event => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          onMove(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
        }}
        onPointerDown={onDrag}
      >
        <BlockIconMark icon={entry.icon} size={16} />
        <span className="nx-components-panel__text">
          <span className="nx-components-panel__name">{entry.label}</span>
          {aside === undefined ? null : (
            <span id={`${id}-where`} className="nx-components-panel__aside">
              {aside}
            </span>
          )}
          {entry.description === "" ? null : (
            <span
              id={`${id}-what`}
              className="nx-components-panel__description"
            >
              {entry.description}
            </span>
          )}
        </span>
      </button>
      {onEdit === undefined ? null : (
        <button
          type="button"
          className="nx-components-panel__edit"
          aria-label={`Edit ${entry.label}`}
          title="Edit component"
          onClick={onEdit}
        >
          <PencilLine aria-hidden="true" size={14} />
        </button>
      )}
    </li>
  );
}

/**
 * The panel with nothing to offer: that the site has no components, or that
 * none of them can go in the component being edited, and how to make one.
 */
function EmptyComponents({
  withheld,
  mayCreate,
}: {
  withheld: number;
  mayCreate: boolean;
}): React.JSX.Element {
  if (withheld > 0) {
    return (
      <p className="nx-insert-panel__note">
        No other component can be placed inside this one.
      </p>
    );
  }
  return (
    <div className="nx-insert-panel__note" data-empty="none">
      <p>This site has no components yet.</p>
      <p>
        A component is a group of blocks made once and placed on many pages. A
        change to it reaches every page that places it.
      </p>
      {mayCreate ? (
        <p>
          {/* The menu item's own name, so the author can find it. */}
          To make one, select blocks on the page and choose Turn into component
          in the block’s menu.
        </p>
      ) : null}
    </div>
  );
}
