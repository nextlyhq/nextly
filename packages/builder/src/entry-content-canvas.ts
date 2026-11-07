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
  usePreviewedCollection,
  usePreviewedEntry,
  type PreviewedCollection,
  type PreviewedEntry,
} from "./previewed-entry";

/** What the canvas draws a page with, less what is the page's alone. */
type CanvasRender = Omit<PageRendererProps, "document" | "siteStyles">;

/** A field's name in words, where the collection's fields are not known. */
function nameInWords(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return words === "" ? name : words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the collection calls `field`: its label, or its name in words. */
function fieldWords(
  field: string,
  collection: PreviewedCollection | undefined
): string {
  return (
    collection?.blocksFields?.find(each => each.name === field)?.label ??
    nameInWords(field)
  );
}

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
  const words = fieldWords(field, collection);
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
  render: CanvasRender | undefined
): {
  readonly document: BlockDocument;
  readonly render: CanvasRender | undefined;
} {
  const previewed = usePreviewedEntry();
  const collection = usePreviewedCollection();
  const maxNodes = render?.limits?.maxNodes;
  const holds = useMemo(
    () => entryContentPlacements(document.nodes, maxNodes).length > 0,
    [document, maxNodes]
  );
  const drawn = useMemo(
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
          }),
    [document, previewed, holds, maxNodes]
  );
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
