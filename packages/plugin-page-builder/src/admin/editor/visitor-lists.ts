/**
 * The canvas's lists read as a visitor reads them, while a document's
 * visibility conditions are applied.
 *
 * The switch decides it, but the canvas's page context, which reads the
 * lists, is made before the switch is: so whether the lists read as a
 * visitor is held here, above both, and follows the switch once it has
 * decided. While they do, a block a list's item decides is judged for each
 * item drawn, as the published page judges it, and one an item hides is
 * drawn as a marker saying why.
 *
 * @module visitor-lists
 */
import type { PageBindings } from "@nextlyhq/blocks-react";
import {
  useItemHiddenAs,
  type ItemHiddenOptions,
} from "@nextlyhq/builder/shell";
import { useDocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useMemo, useState } from "react";

import type { ListEntriesVisitor } from "../../list-entries-contract";
import type { PageRenderInputs } from "../page-render-inputs";

/** Whether the canvas's lists read as a visitor, and the switch's say in it. */
export interface ListsAsVisitor {
  /** The document the lists are read as a visitor of; absent otherwise. */
  readonly visitor: ListEntriesVisitor | undefined;
  /** Told whether the conditions are applied, once the switch decides. */
  readonly follow: (applied: boolean) => void;
}

/**
 * Whether the canvas's lists read as a visitor of the document being edited:
 * the page or template itself, by its collection and id, which the list
 * entries route checks the person may open. Never for a document not yet
 * saved, nor a Single, which the route answers for no visitor.
 */
export function useListsAsVisitor(): ListsAsVisitor {
  const [applied, follow] = useState(false);
  const document = useDocumentIdentity();
  const collection =
    document?.kind === "collection" ? document.slug : undefined;
  const id = document?.kind === "collection" ? document.documentId : undefined;
  const visitor = useMemo(
    () =>
      applied && collection !== undefined && id !== undefined
        ? { collection, id }
        : undefined,
    [applied, collection, id]
  );
  return { visitor, follow };
}

/**
 * Tell `lists` whether the conditions are applied, after each render that
 * changes it, so the next draw reads the lists as the switch now says.
 */
export function useFollowApplied(
  lists: ListsAsVisitor,
  applied: boolean
): void {
  const { follow } = lists;
  useEffect(() => {
    follow(applied);
  }, [follow, applied]);
}

/**
 * The canvas's render inputs while its lists read as a visitor: its context
 * carrying the field shapes a visitor may read, which a list item's
 * conditions are judged by, and what to draw where an item hides a block.
 * The same inputs otherwise.
 */
export function useItemsJudgedRender<
  T extends PageRenderInputs & { readonly bindings: PageBindings },
>(
  render: T,
  judged: boolean,
  options: Omit<ItemHiddenOptions, "fieldShapes">
): T {
  const fieldShapes = render.bindings.fieldShapes;
  const itemHiddenAs = useItemHiddenAs({ ...options, fieldShapes });
  return useMemo(() => {
    if (!judged || render.context === undefined) return render;
    return {
      ...render,
      context: {
        ...render.context,
        ...(fieldShapes === undefined ? {} : { fieldShapes }),
      },
      itemHiddenAs,
    };
  }, [render, judged, fieldShapes, itemHiddenAs]);
}
