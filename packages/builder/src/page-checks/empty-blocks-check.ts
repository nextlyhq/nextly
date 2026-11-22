/**
 * Blocks left empty, which draw nothing useful on the live page: an Image
 * with no picture, a Button with no link, and a Collection list with no
 * source. Each is found where nothing supplies the missing part, neither a
 * stored value nor a field it is bound to, and opens the setting that does.
 *
 * Read over the blocks the page draws, so a component's own empty block is
 * found too and pointed at its placement, as every check's is.
 *
 * @module page-checks/empty-blocks-check
 */
import {
  COLLECTION_LIST_TYPE,
  isLinkableUrl,
  readListQuery,
  walkNodes,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { fetchableUrl } from "@nextlyhq/blocks-react";

import { imageGroupOf } from "../inspector/content/image-group";

import type { PageCheck, PageCheckResult, ResolvedPage } from "./page-checks";
import { bound, holds } from "./stored-values";

/** The button block, whose link is its `LINK_PROPS`. */
const BUTTON_TYPE = "core/button";

/** An image block with neither a library file nor an address for its picture. */
function emptyImage(
  node: BlockNode,
  page: ResolvedPage
): PageCheckResult | undefined {
  const declared = page.blocks(node.type)?.props;
  if (declared === undefined) return undefined;
  const source = imageGroupOf(
    Object.entries(declared).flatMap(([name, schema]) =>
      schema === undefined ? [] : [{ name, schema }]
    )
  )?.source;
  if (source === undefined) return undefined;
  // A library file or a field supplies the picture; a stored address does
  // only where the renderer would fetch it (`fetchableUrl`), so a
  // `javascript:` or `blob:` address draws nothing here as on the page. The
  // site's own allowed hosts aren't known to the check, so any host passes.
  const supplied =
    holds(node.props[source.media]) ||
    bound(node, source.media) ||
    fetchableUrl(node.props[source.address], undefined) !== undefined ||
    bound(node, source.address);
  if (supplied) return undefined;
  return {
    nodeId: node.id,
    what: "Image has no picture",
    why: "Visitors see an empty space where the picture should be.",
    todo: "Choose a picture, or remove the image.",
    fix: { tab: "content", id: source.media },
  };
}

/**
 * A button that goes nowhere: no address the page would link to, no entry
 * and no field supplying either, and no form job (sending or clearing a
 * form) of its own. An address is judged by the format's own rule
 * (`isLinkableUrl`), which the renderer draws a link by, so a stored
 * `javascript:` address is no link here as it is none on the page.
 */
function emptyButton(node: BlockNode): PageCheckResult | undefined {
  if (node.type !== BUTTON_TYPE) return undefined;
  const linked =
    isLinkableUrl(node.props.href) ||
    bound(node, "href") ||
    (holds(node.props.entryCollection) && holds(node.props.entryId)) ||
    bound(node, "entryId");
  const formJob = node.props.type === "submit" || node.props.type === "reset";
  if (linked || formJob) return undefined;
  return {
    nodeId: node.id,
    what: "Button has no link",
    why: "Pressing it does nothing for visitors.",
    todo: "Add a link, or remove the button.",
    fix: { tab: "content", id: "href" },
  };
}

/** A collection list that names nothing to show: no collection, related entries or custom source. */
function emptyList(node: BlockNode): PageCheckResult | undefined {
  if (node.type !== COLLECTION_LIST_TYPE) return undefined;
  const { query } = readListQuery(node.props);
  if (
    query.collection !== undefined ||
    query.relation !== undefined ||
    query.namedQuery !== undefined
  ) {
    return undefined;
  }
  return {
    nodeId: node.id,
    what: "Collection list has no source",
    why: "It shows no entries, so visitors see nothing there.",
    todo: "Choose what it shows in “Show entries from”.",
    fix: { tab: "content", id: "collection" },
  };
}

/** Every empty Image, Button and Collection list, in page order. */
export const EMPTY_BLOCKS_CHECK: PageCheck = {
  id: "empty-blocks",
  group: "content",
  run: page => {
    const found: PageCheckResult[] = [];
    walkNodes(page.drawn as BlockNode[], node => {
      const result =
        emptyImage(node, page) ?? emptyButton(node) ?? emptyList(node);
      if (result !== undefined) found.push(result);
    });
    return found;
  },
};
