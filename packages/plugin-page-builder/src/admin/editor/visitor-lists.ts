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
import type {
  BlockDocument,
  BlockNode,
  DefinitionsById,
} from "@nextlyhq/blocks-engine";
import {
  prepareDocumentAsDrawn,
  registeredBlocks,
  type PageBindings,
} from "@nextlyhq/blocks-react";
import {
  useItemHiddenAs,
  type ItemHiddenOptions,
} from "@nextlyhq/builder/shell";
import { useDocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useMemo, useState } from "react";

import type { ListEntriesVisitor } from "../../list-entries-contract";
import type { PageRenderInputs } from "../page-render-inputs";

import type { VisitorLists } from "./canvas-page-context";

/**
 * The blocks a document is drawn with while a list's items are judged, as
 * the renderer itself prepares them (`prepareDocumentAsDrawn`): its shape
 * repaired, its components composed, migrated, gated keeping the blocks a
 * list's item decides, and its addresses repaired, each by the id it is
 * drawn under. So a list a placed component draws is found by the id its own
 * report of what it drew names. None for a document the renderer can't read.
 */
export function drawnNodesOf(
  document: BlockDocument,
  render: Partial<Pick<PageRenderInputs, "styleContext" | "limits">>,
  definitions: DefinitionsById | undefined
): readonly BlockNode[] {
  return (
    prepareDocumentAsDrawn(document, {
      resolver: registeredBlocks(),
      ...(render.styleContext === undefined
        ? {}
        : { styleContext: render.styleContext }),
      ...(definitions === undefined ? {} : { definitions }),
      ...(render.limits === undefined ? {} : { limits: render.limits }),
      itemsDecided: true,
    })?.nodes ?? []
  );
}

/** Whether the canvas's lists read as a visitor, and the switch's say in it. */
export interface ListsAsVisitor {
  /** The document the lists are read as a visitor of; absent otherwise. */
  readonly visitor: ListEntriesVisitor | undefined;
  /**
   * That document, with the blocks the canvas draws while its conditions
   * are applied, a template's previewed entry's composed in, whose lists a
   * visitor may see fewer entries of; absent otherwise.
   */
  readonly lists: VisitorLists | undefined;
  /**
   * Told the blocks the canvas draws while the conditions are applied, once
   * the switch decides, and nothing while they are not.
   */
  readonly follow: (drawn: readonly BlockNode[] | undefined) => void;
}

/**
 * Whether the canvas's lists read as a visitor of the document being edited:
 * the page or template itself, by its collection and id, which the list
 * entries route checks the person may open. Never for a document not yet
 * saved, nor a Single, which the route answers for no visitor.
 */
export function useListsAsVisitor(): ListsAsVisitor {
  const [drawn, follow] = useState<readonly BlockNode[] | undefined>();
  const document = useDocumentIdentity();
  const collection =
    document?.kind === "collection" ? document.slug : undefined;
  const id = document?.kind === "collection" ? document.documentId : undefined;
  const applied = drawn !== undefined;
  const visitor = useMemo(
    () =>
      applied && collection !== undefined && id !== undefined
        ? { collection, id }
        : undefined,
    [applied, collection, id]
  );
  const lists = useMemo(
    () =>
      visitor === undefined || drawn === undefined
        ? undefined
        : { visitor, nodes: drawn },
    [visitor, drawn]
  );
  return { visitor, lists, follow };
}

/**
 * Tell `lists` the blocks the canvas draws while the conditions are applied,
 * or nothing while they are not, after each render that changes them, so the
 * next draw reads the lists as the switch now says.
 */
export function useFollowApplied(
  lists: ListsAsVisitor,
  drawn: readonly BlockNode[] | undefined
): void {
  const { follow } = lists;
  useEffect(() => {
    follow(drawn);
  }, [follow, drawn]);
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
  // The site's zone, read with the shapes, so an item's condition comparing
  // a day starts that day where the published page starts it.
  const timeZone = render.bindings.timeZone;
  const itemHiddenAs = useItemHiddenAs({ ...options, fieldShapes });
  return useMemo(() => {
    if (!judged || render.context === undefined) return render;
    return {
      ...render,
      context: {
        ...render.context,
        ...(fieldShapes === undefined ? {} : { fieldShapes }),
        ...(timeZone === undefined ? {} : { timeZone }),
      },
      itemHiddenAs,
    };
  }, [render, judged, fieldShapes, timeZone, itemHiddenAs]);
}
