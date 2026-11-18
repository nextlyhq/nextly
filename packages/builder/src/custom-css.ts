/**
 * A block's own custom CSS, as the panel reads and writes it: whether a block
 * holds some, the words that name it, and the one op that stores it.
 *
 * The CSS is kept on the node as the author wrote it, with `selector` where
 * the block goes; the engine scopes it when the page is compiled. The panel
 * checks it before storing as a courtesy, and the server judges every write
 * again, so nothing here is the gate.
 *
 * @module custom-css
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";

import type { BuilderOp } from "./op-vocabulary";

/**
 * What the panel needs to offer a block's custom CSS: given only to someone
 * who may change the site's settings, the permission site code is held to.
 * Without it the panel draws no Custom CSS section and never shows the CSS.
 *
 * @experimental Settles with custom CSS.
 */
export interface BlockCustomCssAccess {
  /**
   * Checks a block's CSS as the server will: every line that can't be used,
   * each worded for the author ("Line 3: @import isn't allowed."), in line
   * order; none when it may be stored.
   */
  readonly check: (css: string) => readonly string[];
}

/** The section's name in Advanced, which its fold is remembered by. */
export const CUSTOM_CSS_SECTION = "Custom CSS";

/** The section's key in the Advanced tab's accordion. */
export const CUSTOM_CSS_KEY = "custom-css";

/** The setting's id, as the settings index and an ask for it name it. */
export const CUSTOM_CSS_SETTING = "customCss";

/** The Layers mark's words: its tooltip and its accessible name. */
export const HAS_CUSTOM_CSS = "Has custom CSS";

/**
 * Whether a block holds custom CSS: a stored value with more than white
 * space in it. One answer for the Layers mark, the Style tab's line, the
 * section's value dot and "Only changed".
 */
export function holdsCustomCss(
  node: Pick<BlockNode, "customCss"> | undefined
): boolean {
  return typeof node?.customCss === "string" && node.customCss.trim() !== "";
}

/**
 * The op that stores a block's CSS, or removes it once the box is emptied, so
 * a block whose CSS was cleared keeps no empty value behind. One update, so it
 * is one undoable step.
 */
export function customCssOp(nodeId: string, css: string): BuilderOp {
  return css.trim() === ""
    ? { kind: "update", id: nodeId, patch: {}, unset: ["customCss"] }
    : { kind: "update", id: nodeId, patch: { customCss: css } };
}
