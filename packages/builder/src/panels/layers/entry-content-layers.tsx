"use client";

/**
 * What an Entry content block's Layers row says beside its name: the field
 * it draws, as a list's row says what it shows, and, where the collection no
 * longer has that field, the warning a row marks a problem with.
 *
 * Named by the one derivation the canvas's tab and the inspector use
 * (`fieldName`), so the three never name a field differently.
 *
 * @experimental Settles when collection templates ship.
 * @module entry-content-layers
 */
import {
  entryContentFieldOf,
  entryContentPlacements,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { AlertCircle } from "lucide-react";
import * as React from "react";

import {
  entryFieldRemoved,
  fieldName,
  usePreviewedCollection,
} from "./previewed-entry";

/** One Entry content row's facts: its field's name, and whether it is gone. */
export interface EntryContentRowFacts {
  readonly field: string;
  readonly removed: boolean;
}

/** Each Entry content block's row facts, by its id, from one walk. */
export function useEntryContentRows(
  document: BlockDocument
): ReadonlyMap<string, EntryContentRowFacts> {
  const collection = usePreviewedCollection();
  return React.useMemo(() => {
    const rows = new Map<string, EntryContentRowFacts>();
    for (const { node } of entryContentPlacements(document.nodes)) {
      const field = entryContentFieldOf(node);
      if (field === undefined) continue;
      rows.set(node.id, {
        field: fieldName(field, collection),
        removed: entryFieldRemoved(field, collection),
      });
    }
    return rows;
  }, [document, collection]);
}

/** The field an Entry content row names, and its warning where it is gone. */
export function EntryContentRowFact({
  facts,
}: {
  facts: EntryContentRowFacts | undefined;
}): React.JSX.Element | null {
  if (facts === undefined) return null;
  if (facts.removed) {
    return (
      <span className="nx-layer-row__badge" data-problem="">
        {/* The icon is for the eye; the words are the fact. */}
        <span aria-hidden="true">
          <AlertCircle size={12} />
        </span>
        <span className="nx-sr-only">
          {`${facts.field} no longer exists in this collection`}
        </span>
      </span>
    );
  }
  return <span className="nx-layer-row__tag">{facts.field}</span>;
}
