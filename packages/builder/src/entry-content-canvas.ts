/**
 * How the canvas draws a template's Entry content block: with the previewed
 * entry's own blocks content, read-only, or the note that says why there is
 * none.
 *
 * - With an entry previewed, the block draws the entry's `editorValues` for
 *   its field, drafts included, as the person editing reads them: composed
 *   into the block by the engine's own `composeEntryContent`, the one the
 *   published page draws through, so the canvas shows what the page will.
 * - With none to draw, the block draws the canvas's note, in the words the
 *   proposal fixed: "The post’s Body shows here." with no entry previewed,
 *   "<title> has no Body content yet." for an empty field, and the red "The
 *   Body field no longer exists in Posts, so this shows nothing. Choose
 *   another field." for a field the collection no longer has.
 *
 * Only the drawn page changes: the document the editor holds, saves and marks
 * is the template as stored, so nothing of the entry is ever written into it.
 * Outside a template nothing is previewed and the canvas draws the document
 * as it is.
 *
 * @experimental Settles when collection templates ship.
 * @module entry-content-canvas
 */
import {
  composeEntryContent,
  entryBlocksDocumentOf,
  entryContentPlacements,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type {
  EntryContentCanvas,
  EntryContentNote,
  PageContext,
  PageRendererProps,
} from "@nextlyhq/blocks-react";
import { createStandaloneContext } from "@nextlyhq/blocks-react";
import { useMemo } from "react";

import {
  entryFieldRemoved,
  fieldName,
  usePreviewedCollection,
  usePreviewedEntry,
  type PreviewedCollection,
  type PreviewedEntry,
} from "./previewed-entry";

/** What the canvas draws a page with, less what is the page's alone. */
type CanvasRender = Omit<PageRendererProps, "document" | "siteStyles">;

/** The note of a block that names no field yet. */
function unsetNote(
  collection: PreviewedCollection | undefined
): EntryContentNote {
  return collection?.blocksFields?.length === 0
    ? {
        tone: "failed",
        words: `${collection.plural} has no blocks field to show.`,
      }
    : { tone: "muted", words: "Choose the field this shows." };
}

/**
 * The note an Entry content block draws in place of the entry's content,
 * given what is previewed and the field the block names.
 */
function entryContentNote(
  field: string | undefined,
  previewed: PreviewedEntry,
  collection: PreviewedCollection | undefined
): EntryContentNote {
  if (field === undefined) return unsetNote(collection);
  const words = fieldName(field, collection);
  if (entryFieldRemoved(field, collection)) {
    return {
      tone: "failed",
      words: `The ${words} field no longer exists in ${collection?.plural ?? "this collection"}, so this shows nothing. Choose another field.`,
    };
  }
  if (previewed.kind === "none") {
    const singular = collection?.singular ?? "entry";
    return { tone: "muted", words: `The ${singular}’s ${words} shows here.` };
  }
  return {
    tone: "muted",
    lead: previewed.title,
    words: `has no ${words} content yet.`,
  };
}

/**
 * The document and render inputs the canvas draws a template with: the
 * previewed entry's blocks composed into its Entry content block, and the
 * page context telling the block it is on the canvas. Both are the ones
 * given, by identity, outside a template or on a template holding no Entry
 * content block, so the canvas keeps everything it kept.
 *
 * @experimental Settles when collection templates ship.
 */
export function useEntryContentDrawing(
  document: BlockDocument,
  render: CanvasRender | undefined,
  /**
   * `document` as drawn, where the host composed it: drawn as it is, with
   * nothing composed here.
   */
  composed?: BlockDocument
): {
  readonly document: BlockDocument;
  readonly render: CanvasRender | undefined;
} {
  const previewed = usePreviewedEntry();
  const collection = usePreviewedCollection();
  const maxNodes = render?.limits?.maxNodes;
  const holds = useHoldsEntryContent(document, maxNodes);
  // Drawn from the entry the seam names, which a host names only once the
  // canvas's own read of it has answered, so bound values never blink in;
  // nothing is composed where the host hands the page as drawn.
  const own = useComposedEntryContent(
    document,
    composed === undefined ? previewed : undefined,
    render?.limits
  );
  const drawn = composed ?? own;
  const context = render?.context;
  const drawnRender = useMemo((): CanvasRender | undefined => {
    if (previewed === undefined || !holds) return render;
    const canvas: EntryContentCanvas = {
      noteFor: field => entryContentNote(field, previewed, collection),
    };
    const base: PageContext = context ?? createStandaloneContext();
    return { ...render, context: { ...base, entryContentCanvas: canvas } };
  }, [render, context, previewed, collection, holds]);
  return { document: drawn, render: drawnRender };
}

/** Whether `document` holds an Entry content block, asked once per document. */
function useHoldsEntryContent(
  document: BlockDocument,
  maxNodes: number | undefined
): boolean {
  return useMemo(
    () => entryContentPlacements(document.nodes, maxNodes).length > 0,
    [document, maxNodes]
  );
}

/**
 * `document` with `previewed`'s own blocks composed into its Entry content
 * block, as the canvas draws it; `document` itself, by identity, where no
 * entry is given or it holds no such block.
 *
 * The one composition everything about the canvas's template is asked of:
 * the canvas draws it, and the host asks for the sources its bindings and
 * lists read from it, so a bound block inside the entry's content reads its
 * source on the canvas as the published page, which composes first, does.
 *
 * The entry is given rather than read from the seam: a host asking for those
 * sources composes from the entry as its own read has it, since the seam
 * names the entry only once the canvas's read of it has answered, and that
 * read is asked of this composition. Composed from the seam, the read would
 * change its own ask each time it answered, and never settle.
 *
 * @experimental Settles when collection templates ship.
 */
export function useComposedEntryContent(
  document: BlockDocument,
  previewed: PreviewedEntry | undefined,
  /**
   * The limits the canvas draws under: the entry's blocks past its node cap
   * or below its depth are never read. The format's own where absent.
   */
  limits?: { readonly maxNodes?: number; readonly maxDepth?: number }
): BlockDocument {
  const maxNodes = limits?.maxNodes;
  const maxDepth = limits?.maxDepth;
  const holds = useHoldsEntryContent(document, maxNodes);
  return useMemo(
    () =>
      previewed?.kind !== "entry" || !holds
        ? document
        : composeEntryContent(document, {
            // The entry as the person editing reads it, drafts included;
            // read through the engine's own reading of a stored value, so
            // a field holding no document draws the empty note.
            valueOf: name =>
              entryBlocksDocumentOf(previewed.editorValues[name]) ?? undefined,
            ...(maxNodes === undefined ? {} : { maxNodes }),
            ...(maxDepth === undefined ? {} : { maxDepth }),
          }),
    [document, previewed, holds, maxNodes, maxDepth]
  );
}
