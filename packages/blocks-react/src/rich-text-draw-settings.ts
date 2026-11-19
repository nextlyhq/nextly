/**
 * What a passage is drawn under: the host's policy for its media, the reader
 * of what each node draws of its children, and the ids its headings are
 * drawn with.
 *
 * @module rich-text-draw-settings
 */
import type { RichTextNode } from "@nextlyhq/blocks-engine";

import type { BlockHostPolicy } from "./context";

/** What a passage is drawn under: the host's policy for the media inside it. */
export interface DrawSettings {
  readonly host: BlockHostPolicy | undefined;
  /**
   * What each node draws of its children, read once per node for the whole
   * render: the views take their children only from it, and so does the walk
   * that finds the passage's headings.
   */
  readonly parts: PartsReader;
  /**
   * The id each heading is drawn with, by the node drawn, when the caller
   * handed anchors: the page outline's, matched to the headings the walk
   * finds with this render's own `parts`, in the order it finds them.
   */
  readonly anchors?: ReadonlyMap<RichTextNode, string>;
}

/**
 * What the renderer draws of a node's children: those it draws inside the
 * node's own element, and those it draws after it, as its siblings (the block
 * content a heading or a disclosure label cannot hold).
 */
export interface DrawnParts {
  readonly inside: readonly RichTextNode[];
  readonly after: readonly RichTextNode[];
}

/** `drawnParts`, read once per node. */
export type PartsReader = (node: RichTextNode) => DrawnParts;
