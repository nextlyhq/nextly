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
  DOCUMENT_FORMAT_VERSION,
  entryBlocksDocumentOf,
  entryContentPlacements,
  type BlockDocument,
  type ComponentLookup,
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
    entryContentLimitsOf(render)
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

/**
 * The page the canvas draws while conditions are applied (`applied`, the
 * page as they leave it): as it is where the host composed the entry into it
 * (`composed` given), else with the entry the seam names composed into it
 * here, as a host that applies conditions to the stored template expects.
 * `undefined` while no conditions are applied.
 *
 * @experimental Settles when collection templates ship.
 */
export function useAppliedDrawing(
  applied: BlockDocument | undefined,
  composed: BlockDocument | undefined,
  render: CanvasRender | undefined
): BlockDocument | undefined {
  const previewed = usePreviewedEntry();
  const composesHere = applied !== undefined && composed === undefined;
  const drawn = useComposedEntryContent(
    applied ?? EMPTY_PAGE,
    composesHere ? previewed : undefined,
    entryContentLimitsOf(render)
  );
  return applied === undefined ? undefined : drawn;
}

/** No page, for the composition asked while no conditions are applied. */
const EMPTY_PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [],
};

/**
 * What the canvas composes an entry's content under: its limits, and the
 * definitions of the components the page places. Held by what it reads, so
 * a render handing the same inputs composes nothing again.
 */
function entryContentLimitsOf(
  render: CanvasRender | undefined
): EntryContentLimits {
  const limits = render?.limits;
  const definitions = render?.definitions;
  return {
    ...(limits === undefined ? {} : { maxNodes: limits.maxNodes }),
    ...(limits === undefined ? {} : { maxDepth: limits.maxDepth }),
    ...(definitions === undefined ? {} : { definitions }),
  };
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
   * or below its depth are never read, and, given the definitions of the
   * components the page places, the template is charged what it draws once
   * they are expanded. A number is the node cap alone, as this took before.
   * The format's own limits where absent.
   */
  limits?: number | EntryContentLimits
): BlockDocument {
  const { maxNodes, maxDepth, definitions } =
    typeof limits === "number" ? { maxNodes: limits } : (limits ?? {});
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
            ...(definitions === undefined ? {} : { definitions }),
          }),
    [document, previewed, holds, maxNodes, maxDepth, definitions]
  );
}

/**
 * What a composition of an entry's content is held to: the page's node cap
 * and depth, and the definitions of the components it places.
 *
 * @experimental Settles when collection templates ship.
 */
export interface EntryContentLimits {
  readonly maxNodes?: number;
  readonly maxDepth?: number;
  readonly definitions?: ComponentLookup;
}
