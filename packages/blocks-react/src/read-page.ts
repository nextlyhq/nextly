/**
 * The tree to read and the stylesheet that describes it, resolved together.
 *
 * Together because neither answer is correct alone. Preparing a document drops
 * the nodes the page will not present, and whether anything was dropped is the
 * fact that decides what a STORED stylesheet may still be trusted for — but the
 * prepared tree no longer contains the evidence, so a caller holding only that
 * tree cannot supply it and cannot know it is missing.
 *
 * `PageRenderer` never had the problem: it runs the passes itself and still
 * holds each stage when it resolves styles. A consumer assembling the two by
 * hand holds only the result, and the documented pairing therefore resolved
 * styles with `repairedDocument` left at its default. That is sound for every
 * pruned node whose rules the artifact carries per node, and unsound for the
 * rest of what a pruned node put in the sheet: the block-type tier and the named
 * classes it referenced are keyed by TYPE and by CLASS, not by node, so they
 * stay in `css` with nothing left on the page to justify them.
 *
 * @module read-page
 */
import type {
  BlockDocument,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";

import type {
  DocumentReadStages,
  PrepareDocumentArgs,
} from "./prepare-document";
import { prepareDocumentReadStages, readingViewOf } from "./prepare-document";
import type { PageStyles } from "./styles";
import { resolvePageStyles } from "./styles";

export interface ReadPageArgs extends PrepareDocumentArgs {
  /** The stylesheet artifact stored with the page, when it has one. */
  styles?: PageStyles;
  /**
   * The inputs to compile a fresh sheet, when the caller has them.
   *
   * Its presence is what lets a repaired document be recompiled instead of
   * having its stored sheet withheld, so a caller that can supply it should.
   */
  styleContext?: StyleCompileContext;
  /**
   * Which host-fetch policy is in force for this read.
   *
   * Compared against the stamp the stored artifact carries; a difference means
   * that artifact admitted `url(...)` values under rules that no longer apply.
   */
  fetchPolicyId?: string;
}

export interface PreparedPage {
  /**
   * The tree to render or describe, or `null` when the page presents nothing
   * readable — an envelope this build cannot speak, or a page whose every node
   * resolved to a placeholder.
   */
  document: BlockDocument | null;
  /** The stylesheet for that tree. */
  styles: PageStyles;
}

/**
 * Whether the passes changed the tree in a way a STORED stylesheet cannot
 * describe.
 *
 * Only two of the five stage boundaries count, and which two is the whole
 * content of this function:
 *
 * - **The caps pass**, because a document over its limits is truncated, and the
 *   sheet was compiled from the untruncated one.
 * - **The placeholder pass**, because a node that resolves to a placeholder is
 *   gone for every visitor until the page is republished, while the tiers it
 *   pulled into the sheet stay behind.
 *
 * The other three are excluded deliberately, and two of the exclusions are load
 * bearing rather than cosmetic:
 *
 * - **Migration** allocates unconditionally, so comparing it against the caps
 *   pass is true on every document ever read. Included, every page would report
 *   as repaired and every stored sheet would be withheld on the happy path.
 * - **Condition gating** is the case the per-node `gated` map was built for. Its
 *   rules travel per node and are appended for exactly the survivors, so a
 *   gated node's absence is described rather than unaccounted. Included, every
 *   page carrying a conditioned block would lose its whole stylesheet.
 * - **Address repair** drops a later duplicate of a repeated id, and the
 *   compiler refuses to style duplicated ids at all, so the sheet holds no rules
 *   for what that pass removes.
 */
function storedSheetCannotDescribe(
  document: BlockDocument,
  stages: DocumentReadStages
): boolean {
  return stages.sanitized !== document || stages.prepared !== stages.deduped;
}

/**
 * Read a stored page: its presentable tree and the stylesheet for it.
 *
 * This is the whole documented flow for a consumer outside `PageRenderer`.
 * Preparing the document and resolving its styles as two calls is what leaves
 * the second one unable to see what the first removed — and the gap is silent,
 * because the sheet it produces is a valid sheet describing a tree that is one
 * pass out of date.
 *
 * Returns the reading view of the document, so `null` means "do not present
 * this page" rather than "this page is empty". Styles come back either way: a
 * caller that decides to show a fallback still has the page's scope and class
 * names, which the rest of the system expects to exist.
 */
export function preparePageForRead(
  document: BlockDocument,
  args: ReadPageArgs
): PreparedPage {
  const stages = prepareDocumentReadStages(document, args);
  if (stages === null) {
    // An unreadable envelope has no tree to compile against and no ids to name,
    // so there is nothing to resolve. Answered directly rather than by handing
    // the compiler a document it already refused.
    return {
      document: null,
      styles: { css: "", classes: {} },
    };
  }

  const styles = resolvePageStyles(
    stages.prepared,
    args.styles,
    args.styleContext,
    args.resolver,
    storedSheetCannotDescribe(document, stages),
    { fetchPolicyId: args.fetchPolicyId }
  );

  // Compiled against the PREPARED tree whatever the reading view decides. The
  // two answer different questions: a page presenting nothing but placeholders
  // is not worth showing, but its scope and class names are still the ones the
  // rest of the system expects, and rebuilding them from an empty document would
  // hand the caller a sheet for a page that does not exist.
  return { document: readingViewOf(stages), styles };
}
