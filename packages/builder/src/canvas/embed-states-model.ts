/**
 * What an Embed's empty state, and its Link setting, decide without drawing
 * anything: which canvas boxes are Embeds waiting for a link, what the editor
 * says about a link, and what storing one writes to the block.
 *
 * Kept apart from the overlay (`embed-states.tsx`) and the inspector's Embed
 * section (`embed-sections.tsx`), which both store a link through
 * {@link embedLinkOp} and say the same words about it, so a link pasted on the
 * canvas and one typed in the panel do the same thing.
 *
 * @module canvas/embed-states-model
 */

import {
  BASE_BREAKPOINT,
  findNode,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
  type StyleValues,
} from "@nextlyhq/blocks-engine";
import {
  detectEmbed,
  EMBED_EMPTY_ATTRIBUTE,
  INSTANCE_ATTRIBUTE,
  NODE_ID_ATTRIBUTE,
  type EmbedMatch,
  type EmbedProviderId,
  type EmbedShape,
} from "@nextlyhq/blocks-react";

import type { BuilderOp } from "../op-vocabulary";

/** The block whose empty state this is. */
export const EMBED_BLOCK_TYPE = "core/embed";

/** The words the Embed's empty state and Link setting use, in one place. */
export const EMBED_STATE_WORDS = {
  field: "Paste a YouTube, Vimeo or other link",
  add: "Embed",
  plain: "Shown as a plain frame",
} as const;

/**
 * What a provider's size was taken from, as the detection note says it: a
 * video's proportion, a player's height, a map's frame.
 */
const SIZED_FROM: Readonly<Record<EmbedProviderId, string>> = {
  youtube: "the video",
  vimeo: "the video",
  spotify: "the player",
  "google-maps": "the map",
};

/**
 * What the editor says about a link: the provider it found and that the
 * block was sized for it, or that it will be shown as a plain frame.
 * `undefined` for no link at all.
 */
export function linkNote(link: unknown): string | undefined {
  if (typeof link !== "string" || link.trim() === "") return undefined;
  const match = detectEmbed(link);
  if (match === undefined) return EMBED_STATE_WORDS.plain;
  return `${match.name} detected. Size set from ${SIZED_FROM[match.provider]}.`;
}

/** The Embed named `nodeId`, or `undefined` when there is no such Embed. */
function embedNodeOf(
  document: BlockDocument,
  nodeId: string
): BlockNode | undefined {
  const node = findNode(document.nodes, nodeId);
  return node?.type === EMBED_BLOCK_TYPE ? node : undefined;
}

/** A box an Embed with no link draws on the canvas, and whose it is. */
export interface EmptyEmbedBox {
  readonly nodeId: string;
  readonly element: Element;
}

/**
 * The boxes this page's Embeds draw while they have no link. One inside a
 * placed component is the component's, set where the component is edited,
 * so it is left out, as are boxes naming no Embed of this document.
 */
export function emptyEmbedBoxes(
  root: ParentNode,
  document: BlockDocument
): EmptyEmbedBox[] {
  const found: EmptyEmbedBox[] = [];
  root.querySelectorAll(`[${EMBED_EMPTY_ATTRIBUTE}]`).forEach(element => {
    if (element.hasAttribute(INSTANCE_ATTRIBUTE)) return;
    const nodeId = element.getAttribute(NODE_ID_ATTRIBUTE);
    if (nodeId === null || embedNodeOf(document, nodeId) === undefined) return;
    found.push({ nodeId, element });
  });
  return found;
}

/**
 * The frames this page's Embeds draw once they have a link: each a document
 * of its own, which takes the pointer from the canvas, so the editor covers
 * it to keep a click selecting the block. One inside a placed component is
 * left out, as its box is.
 */
export function embedFrames(
  root: ParentNode,
  document: BlockDocument
): EmptyEmbedBox[] {
  const found: EmptyEmbedBox[] = [];
  root.querySelectorAll(`iframe[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
    if (element.hasAttribute(INSTANCE_ATTRIBUTE)) return;
    const nodeId = element.getAttribute(NODE_ID_ATTRIBUTE);
    if (nodeId === null || embedNodeOf(document, nodeId) === undefined) return;
    found.push({ nodeId, element });
  });
  return found;
}

/** The style values a provider's shape writes on the block, at its base. */
function shapeValues(shape: EmbedShape): Record<string, string | undefined> {
  // A proportion clears a height a player link set before, and a height
  // clears the proportion, so the block takes the new link's shape whatever
  // the last one was.
  return "aspectRatio" in shape
    ? { aspectRatio: shape.aspectRatio, height: undefined }
    : { height: shape.height, aspectRatio: "auto" };
}

/** `styles` with the shape's values written at the base state and size. */
function shapedStyles(
  styles: NodeStyles | undefined,
  shape: EmbedShape
): NodeStyles {
  const base: StyleValues = { ...(styles?.base?.[BASE_BREAKPOINT] ?? {}) };
  for (const [name, value] of Object.entries(shapeValues(shape))) {
    if (value === undefined) delete base[name];
    else base[name] = value;
  }
  return { ...styles, base: { ...styles?.base, [BASE_BREAKPOINT]: base } };
}

/**
 * Storing a link on an Embed, as one step to undo: the link as the author
 * pasted it, and, for a provider the block knows, the provider's shape as the
 * block's own style values, which the author sees and may change.
 *
 * `null` when there is no such Embed, or nothing would change.
 */
export function embedLinkOp(
  document: BlockDocument,
  nodeId: string,
  link: string
): BuilderOp | null {
  const node = embedNodeOf(document, nodeId);
  if (node === undefined) return null;
  const typed = link.trim();
  if (typed === "" || node.props.src === typed) return null;
  const match: EmbedMatch | undefined = detectEmbed(typed);
  return {
    kind: "update",
    id: nodeId,
    patch: {
      props: { ...node.props, src: typed },
      ...(match === undefined
        ? {}
        : { styles: shapedStyles(node.styles, match.shape) }),
    },
  };
}
