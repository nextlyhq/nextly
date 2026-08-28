"use client";

/**
 * The inserter: what an author can add, and adding it.
 *
 * **Draws what `inserter` decides and decides nothing itself.** Every question
 * with an answer worth testing — what may be offered here, what a query
 * matches, where the block lands, what node to build — lives in that module,
 * where it can be asserted without a DOM. This file is the surface: focus,
 * keyboard, markup and the words an author reads.
 *
 * **Interaction is composed from `@nextlyhq/ui`'s command primitives rather
 * than rebuilt.** They already own the roving focus, the ARIA listbox wiring
 * and the type-ahead that the command palette uses, so an inserter with its own
 * keyboard handling would be a second implementation of the same widget that
 * drifts from it the first time either is corrected — and the two sit one panel
 * apart in the same editor.
 *
 * `shouldFilter={false}` is the load-bearing half of that composition. cmdk
 * filters by default, so leaving it on would put a SECOND filter beside
 * `filterEntries` — two answers to "does this row match", disagreeing about
 * block names and keywords, with the tested one silently overruled.
 *
 * @module insert-panel
 */

import {
  allBlocks,
  getBlock,
  registryNestingSource,
  type AnyBlockDefinition,
  type BlockNode,
  type NestingSource,
} from "@nextlyhq/blocks-engine";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@nextlyhq/ui";
import * as React from "react";

import { BlockIconMark } from "./block-icon";
import type { EditorState } from "./editor-state";
import {
  allowedEntries,
  blockSourceFor,
  catalogFrom,
  entryById,
  filterEntries,
  gridNeighbour,
  groupByCategory,
  insertionPointFor,
  nodeForEntry,
  registrySlotSource,
  type GridStep,
  type InsertionPoint,
  type InsertEntry,
} from "./inserter";

export interface InsertPanelProps {
  /**
   * The editor whose document this inserts into.
   *
   * The whole state rather than a document and an `apply` separately, because
   * the panel needs the selection and the document to agree with the `apply`
   * it calls. Passed apart, a caller can hand a document from one render and an
   * `apply` bound to another, and the insert lands at a position computed
   * against a document that no longer exists.
   */
  editor: EditorState;
  /**
   * The blocks to offer. Defaults to everything registered.
   *
   * Read ONCE per mount rather than subscribed to: the registry is global
   * mutable state with no change notification, so there is nothing to subscribe
   * to. A plugin registering while the panel is open is not reflected until it
   * remounts, which is the honest behaviour rather than a stale cache — and it
   * is why the version to stamp travels on the entry rather than being looked
   * up again at insert time.
   */
  definitions?: readonly AnyBlockDefinition[];
  /** How nesting is resolved. Defaults to the live registry. */
  nesting?: NestingSource;
  /**
   * Category headings to offer first, in order.
   *
   * Supplied by the host rather than ranked here: categories are free strings
   * any plugin may contribute, and a panel that hardcoded an order would rank
   * the first-party library above whatever a user installed. Unranked
   * categories still appear, after these.
   */
  categoryOrder?: readonly string[];
  /** Notified after a successful insert, with the node that was added. */
  onInsert?: (node: BlockNode) => void;
}

/**
 * How many tiles sit in a row.
 *
 * A CONSTANT rather than a count derived from the panel's measured width, and
 * both consumers read this one value: the stylesheet through the custom
 * property set on each grid, and the arrow-key arithmetic through
 * `gridNeighbour`. Measured from a width would need the layout to have
 * happened before the keyboard could answer, and the two would disagree for
 * the frame after a drag.
 *
 * Three because the panel opens at 300px and its padding and gaps leave about
 * 86px per tile there — a glyph and a short word. It is also what keeps the
 * grid from REFLOWING while the author drags the panel's edge: a column count
 * that changed with the width would move a tile out from under the cursor
 * mid-drag.
 */
const GRID_COLUMNS = 3;

/**
 * Which arrow key means which direction, or `undefined` where the panel wants
 * nothing to do with the key.
 *
 * A table rather than a switch so the set is enumerable: the command
 * primitives bind their own meanings to Home, End and the modified arrows, and
 * a handler that claimed a key by pattern would take one of those the day it
 * was added.
 */
const ARROW_STEPS: Readonly<Record<string, GridStep>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * Whether the caret in the search field would move if this key reached it.
 *
 * Horizontal arrows belong to the TEXT FIELD first. Focus stays in the search
 * input while the highlight moves — that is how the command primitives work —
 * so a panel that claimed Left and Right outright would make the search box
 * uneditable: an author correcting a typo would move the tile selection
 * instead of the caret.
 *
 * So the panel takes those keys only once the field has no use for them:
 * nothing selected, and the caret already at the end it is being asked to move
 * past. That is the same rule a browser's address bar follows, and it never
 * takes a keystroke the field would have consumed.
 */
function caretWouldMove(target: EventTarget | null, back: boolean): boolean {
  if (!(target instanceof HTMLInputElement)) return false;
  const { selectionStart, selectionEnd } = target;
  // A field that reports no selection at all cannot say where its caret is, so
  // the safe answer is that it might move — leaving the key with the field.
  if (selectionStart === null || selectionEnd === null) return true;
  // A range collapses to one end before the caret travels, so the first press
  // is the field's.
  if (selectionStart !== selectionEnd) return true;
  return back ? selectionStart > 0 : selectionStart < target.value.length;
}

/**
 * Which direction a key press means for the grid, or `undefined` where the key
 * is not the grid's to take.
 *
 * Three separate reasons to decline, gathered here rather than spread through
 * the handler: the key is not an arrow; the key is MODIFIED, and the command
 * primitives bind first, last and by-group to those — this runs before theirs,
 * so claiming one would remove it silently; or the key is horizontal and the
 * search field still has a caret to move with it.
 */
function stepFor(
  event: React.KeyboardEvent<HTMLElement>
): GridStep | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return undefined;
  }
  const step = ARROW_STEPS[event.key];
  if (step === undefined) return undefined;
  const horizontal = step === "left" || step === "right";
  if (horizontal && caretWouldMove(event.target, step === "left")) {
    return undefined;
  }
  return step;
}

/** Sentence describing where the next insert will land. */
function placementLabel(point: InsertionPoint, label?: string): string {
  if (point.kind === "inside-selection") {
    // Names the container, because "inside" is only meaningful if the author
    // knows what it is inside OF — and this is the one placement that differs
    // from what selecting a block usually implies.
    return `Adds inside ${label ?? "the selected block"}`;
  }
  return point.kind === "after-selection"
    ? "Adds after the selected block"
    : "Adds at the end of the page";
}

export function InsertPanel({
  editor,
  definitions,
  nesting,
  categoryOrder,
  onInsert,
}: InsertPanelProps): React.JSX.Element {
  const [query, setQuery] = React.useState("");

  // ONE snapshot, taken per mount, that both the catalog and the default
  // expansion below read. The panel documents its palette as read once per
  // mount rather than subscribed to, and a second reading of the registry
  // taken later is a different list: a plugin registering while the panel is
  // open would leave a row offering one definition's version and props while
  // its children came from another.
  const palette = React.useMemo(
    () => definitions ?? allBlocks(),
    [definitions]
  );
  const catalog = React.useMemo(() => catalogFrom(palette), [palette]);
  const source = React.useMemo(
    () => nesting ?? registryNestingSource(),
    [nesting]
  );

  // Recomputed from the CURRENT document and selection on every render rather
  // than remembered. The position is only valid against the document it was
  // read from, and an undo or a remote edit can move it without the selection
  // changing — a memo keyed on the selection alone would keep a position whose
  // index no longer names the same place.
  const slotSource = React.useMemo(registrySlotSource, []);

  // Derived from the SAME snapshot the catalog is, so the row an author sees
  // and the subtree an insert builds cannot come from two different readings.
  // The palette may be a caller-supplied subset holding a definition the
  // registry does not, and the block being inserted is the one whose
  // declaration is read — so resolving only against the registry would offer
  // that block and then insert it without the children it declares.
  const blockSource = React.useMemo(() => blockSourceFor(palette), [palette]);
  const point = insertionPointFor(
    editor.document,
    editor.selectedId,
    slotSource
  );

  // Computed on every render rather than memoised. `insertionPointFor` builds a
  // fresh target each call, so a memo keyed on it could never hit — it would
  // recompute exactly as often while reading as though it cached. The work is a
  // filter and a group over one array, and the render it happens in is already
  // driven by a keystroke.
  const groups =
    point === null
      ? []
      : // Allowed first, then the query. Both orders yield the same set, but
        // this one keeps the empty state honest: "no blocks match" after a
        // search is a different message from "nothing can go here", and
        // filtering first would collapse them into one.
        groupByCategory(
          filterEntries(allowedEntries(catalog, point.target, source), query),
          categoryOrder
        );

  /*
   * Which tile the panel is describing, held here rather than read back out of
   * the DOM.
   *
   * ONE piece of state for hover and for the keyboard, because the command
   * primitives already collapse them: an item highlights on `pointermove` and
   * on arrow navigation alike, and reports both through `onValueChange`. A
   * panel tracking hover separately would hold a second answer to "which tile
   * is the author on", and the two would disagree the moment a pointer rested
   * over one tile while the keyboard moved to another — which is what happens
   * every time somebody types after reaching for the mouse.
   */
  const [active, setActive] = React.useState<string>();

  /*
   * One document-unique id per entry, for `aria-describedby` to point at.
   *
   * Prefixed from `useId` rather than built from the entry id alone, because
   * two inserters can be mounted at once — a panel and a palette, or two
   * editors side by side — and duplicate ids would have every tile in one
   * describe itself with the other's sentence.
   *
   * Keyed off the CATALOG rather than the filtered groups, so an id belongs to
   * an entry for the life of the mount instead of changing as an author types.
   */
  const idPrefix = React.useId();
  const descriptionIds = React.useMemo(() => {
    const ids = new Map<string, string>();
    for (const entry of catalog) ids.set(entry.id, `${idPrefix}-${entry.id}`);
    return ids;
  }, [catalog, idPrefix]);

  /*
   * The entry the strip describes, falling back to the first one offered.
   *
   * The fallback is what keeps the strip from being blank on the pass before
   * anything has been highlighted, and after a search removes the entry that
   * was. It is DERIVED rather than written into state: a fallback that stored
   * itself would be a second writer racing the primitives' own selection.
   */
  const described =
    entryById(groups, active) ?? groups[0]?.entries[0] ?? undefined;

  const onArrow = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = stepFor(event);
    if (step === undefined) return;
    const next = gridNeighbour(groups, described?.id, step, GRID_COLUMNS);
    if (next === null) return;
    setActive(next);
    /*
     * Consuming the key is what stands the primitives' own handler down: it
     * calls this one first and then skips its own work when the event has been
     * defaulted. Left standing, its linear "next item" would run as well and
     * the highlight would end up one tile past wherever this put it.
     */
    event.preventDefault();
  };

  const insert = (entry: InsertEntry) => {
    if (point === null) return;
    // `nesting` rather than `source`. They differ exactly when the caller
    // supplied no rules: `source` has already defaulted to the REGISTRY, which
    // knows nothing about a supplied definition and so reports every one of its
    // types as unrestricted. Passing it defeats the fallback in
    // `expandSlotDefaults`, which derives the rules from these same
    // definitions — the only source that can see a supplied block's `parent`
    // and its slots' `allow`.
    const node = nodeForEntry(entry, blockSource, nesting);
    // `apply` is the only path a document changes by, so undo covers this
    // insert for free. It answers null when the op is refused, and a refusal
    // must not be reported as an insert — the panel offers only placements the
    // rule permits, so a null here means the document moved underneath it.
    if (editor.apply({ kind: "insert", node, at: point.at }) === null) return;
    // Selecting what was just added is what makes a second insert land after
    // it, so repeated inserts build downward instead of stacking at one point.
    editor.select(node.id);
    onInsert?.(node);
  };

  if (point === null) {
    return (
      <div className="nx-insert-panel" data-empty="unplaceable">
        <p className="nx-insert-panel__note">
          The selected block sits somewhere a new block cannot be addressed.
          Select a different block, or clear the selection to add at the end of
          the page.
        </p>
      </div>
    );
  }

  return (
    <div
      className="nx-insert-panel"
      /* The one column count, handed to the stylesheet rather than spelled
         again in it. Written twice, a change to the layout would move the
         tiles and leave the arrow keys stepping by the old number.

         On the PANEL rather than on each group, because the primitives own the
         element the grid is applied to — their items container — and a
         property set on a wrapper inside it would be inherited by the tiles
         instead of read by the grid. */
      style={{ "--nx-insert-columns": GRID_COLUMNS } as React.CSSProperties}
    >
      <Command
        shouldFilter={false}
        label="Insert a block"
        value={described?.id}
        onValueChange={setActive}
        onKeyDown={onArrow}
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search blocks"
        />
        <p className="nx-insert-panel__placement" aria-live="polite">
          {placementLabel(
            point,
            point.kind === "inside-selection"
              ? getBlock(
                  point.target.at === "slot" ? point.target.parentType : ""
                )?.editor?.label
              : undefined
          )}
        </p>
        <CommandList>
          <CommandEmpty>
            {query.trim() === ""
              ? "No blocks can be added here."
              : `No blocks match "${query.trim()}".`}
          </CommandEmpty>
          {groups.map(group => (
            <CommandGroup key={group.category} heading={group.category}>
              {group.entries.map(entry => (
                <CommandItem
                  // `value` is what cmdk reports on selection. The entry id is
                  // unique across blocks AND their variations, while a label is
                  // not — two plugins may both label a block "Card".
                  key={entry.id}
                  value={entry.id}
                  onSelect={() => insert(entry)}
                  /*
                   * NAMED by the block and DESCRIBED by its sentence, rather
                   * than named by the two run together.
                   *
                   * An element with no label is named from its CONTENTS, and
                   * that computation trims each node and joins them with no
                   * separator — so a label and a description in adjacent spans
                   * are announced as "TextA paragraph of plain text". Whether
                   * any separator appears depends on the elements' `display`,
                   * which makes the spoken name a property of the stylesheet
                   * rather than of the markup.
                   *
                   * Stating both removes the guess: the block's name, then its
                   * sentence, in that order and as two separate things. The
                   * label is exactly the visible text, so a spoken command
                   * still matches what is written on the tile.
                   */
                  aria-label={entry.label}
                  aria-describedby={descriptionIds.get(entry.id)}
                >
                  <BlockIconMark icon={entry.icon} />
                  <span className="nx-insert-panel__label">{entry.label}</span>
                  {/* Kept in the tile and no longer drawn: `aria-describedby`
                      needs an element to point at, and keeping it here is what
                      stops a tile and the sentence describing it from being
                      rendered apart. */}
                  <span
                    className="nx-insert-panel__description"
                    id={descriptionIds.get(entry.id)}
                  >
                    {entry.description}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
        {described === undefined ? null : (
          /* Sighted authors only, and deliberately so. The sentence it shows
             is already the accessible name of the tile it describes, so
             exposing it here as well would have a screen reader read every
             description twice — once on the option and once from a region
             that changed because of it. */
          <p className="nx-insert-panel__describes" aria-hidden="true">
            <b className="nx-insert-panel__describes-name">{described.label}</b>
            {` ${described.description}`}
          </p>
        )}
      </Command>
    </div>
  );
}
