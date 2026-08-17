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

import type { EditorState } from "./editor-state";
import {
  allowedEntries,
  catalogFrom,
  filterEntries,
  groupByCategory,
  insertionPointFor,
  nodeForEntry,
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
  /** Notified after a successful insert, with the node that was added. */
  onInsert?: (node: BlockNode) => void;
}

/** Sentence describing where the next insert will land. */
function placementLabel(kind: "after-selection" | "document-end"): string {
  return kind === "after-selection"
    ? "Adds after the selected block"
    : "Adds at the end of the page";
}

export function InsertPanel({
  editor,
  definitions,
  nesting,
  onInsert,
}: InsertPanelProps): React.JSX.Element {
  const [query, setQuery] = React.useState("");

  const catalog = React.useMemo(
    () => catalogFrom(definitions ?? allBlocks()),
    [definitions]
  );
  const source = React.useMemo(
    () => nesting ?? registryNestingSource(),
    [nesting]
  );

  // Recomputed from the CURRENT document and selection on every render rather
  // than remembered. The position is only valid against the document it was
  // read from, and an undo or a remote edit can move it without the selection
  // changing — a memo keyed on the selection alone would keep a position whose
  // index no longer names the same place.
  const point = insertionPointFor(editor.document, editor.selectedId);

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
          filterEntries(allowedEntries(catalog, point.target, source), query)
        );

  const insert = (entry: InsertEntry) => {
    if (point === null) return;
    const node = nodeForEntry(entry);
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
          {placementLabel(point.kind)}
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
                >
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
