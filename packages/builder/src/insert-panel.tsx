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
import type { InsertDragEntry } from "./canvas-drag";
import type { EditorState } from "./editor-state";
import {
  allowedEntries,
  blockSourceFor,
  catalogFrom,
  filterEntries,
  groupByCategory,
  insertionPointFor,
  nodeForEntry,
  registrySlotSource,
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
  /**
   * Begins a drag carrying an entry, when the host has a canvas to drop onto.
   *
   * Optional, and its absence changes nothing: the rows still insert on click,
   * which is the route WCAG 2.2 SC 2.5.7 requires and the one this only ever
   * supplements. A panel mounted without a canvas — a story, a test — simply
   * has nothing to drag onto.
   *
   * The node is built HERE, by a thunk the drag calls at the release, because
   * this panel's definitions are one snapshot taken per mount. Resolving the
   * type again inside the drag would read the registry a second time, and the
   * row an author dragged could then differ from the subtree that lands.
   */
  beginInsertDrag?: (
    event: React.PointerEvent<HTMLElement>,
    entry: InsertDragEntry
  ) => void;
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
  beginInsertDrag,
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
    <div className="nx-insert-panel">
      <Command shouldFilter={false} label="Insert a block">
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
                  // Beside `onSelect`, never instead of it. A press stays a
                  // click until it has travelled far enough to mean a drag, so
                  // this does not consume the row's own activation — and a host
                  // that supplies no drag leaves the row exactly as it was.
                  onPointerDown={event => {
                    beginInsertDrag?.(event, {
                      blockName: entry.blockName,
                      makeNode: () => nodeForEntry(entry, blockSource, nesting),
                      // The same notification the click path sends, so a host
                      // cannot see one kind of insert and miss the other.
                      onInserted: onInsert,
                    });
                  }}
                >
                  <BlockIconMark icon={entry.icon} />
                  <span className="nx-insert-panel__label">{entry.label}</span>
                  <span className="nx-insert-panel__description">
                    {entry.description}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </div>
  );
}
