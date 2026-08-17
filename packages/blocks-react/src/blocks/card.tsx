/**
 * `core/card` — a container preset that clips its contents to a rounded corner.
 *
 * A preset over the same implementation `core/box`, `core/section` and the
 * columns pair use. It differs from a box in exactly one way, and that way is
 * what it STARTS AS rather than what it can be told to do: a card begins
 * rounded and clipping. Nothing it can be told to do is unavailable to a box,
 * which is the property `container.tsx` argues for and the reason neither
 * Elementor V3's migration-breaking Section/Column nor V4's duplicate
 * Div/Flexbox is reachable from here.
 *
 * **Why the clip is the substance, not the rounding.** A rounded container
 * whose child is an image renders the image's square corners OVER the parent's
 * curve, because a border radius paints the box and does not constrain its
 * descendants. Image-on-top is the commonest card composition on every site
 * this library was derived from, so a card that rounds without clipping is
 * wrong in its most ordinary use. `overflow: hidden` is what makes the rounding
 * mean anything, and the two are declared together for that reason.
 *
 * The cost is stated rather than hidden: a clipping card also clips anything
 * meant to escape it — a dropdown, a tooltip, a badge positioned past the edge.
 * `overflow` is a catalog property this block supports through `dimensions`, so
 * that is a one-value change on the node; it is not a limit of the block.
 *
 * **No default padding, and that is not deference to `container.tsx`.** The
 * shared implementation refuses default padding because every project begins by
 * removing it. A card inverts the complaint — most cards want padding — but
 * padding on the card itself makes a full-bleed image impossible, since the
 * image is inset by exactly the padding meant for the text beneath it. An
 * author adds padding to the card when there is no image, or to a box inside it
 * when there is, and both stay available. A default would remove the second.
 *
 * **No default background or border, because no token can express one.**
 * `defaultSiteTokens()` guarantees `color.text`, `color.background`,
 * `color.primary`, `font.body`, `content.width` and `space.4` — there is no
 * surface colour and no border colour among them. A `{ $token }` reference to a
 * name a site never defines compiles to a `var()` with nothing behind it, and a
 * hardcoded hex is wrong in whichever of light and dark it was not chosen for.
 * So the two properties that would make a card look like a card on a plain page
 * are left to the author until a surface token exists to carry them, and the
 * defaults here are the ones that are correct under every theme.
 *
 * @module blocks/library/card
 */
import { defineBlock } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import { CONTAINER_SUPPORTS, renderContainer } from "./container";
import type { ContainerProps } from "./container";

/** This block's registered name, so the tests name it once. */
export const CARD_BLOCK = "core/card";

/**
 * The rounding, and the clip that makes it mean something.
 *
 * Both properties are in `STYLE_CATALOG`; one that is not is dropped by the
 * compiler rather than passed through, so a declaration naming an unlisted
 * property compiles to nothing while reading as though it worked.
 *
 * The radius is a literal rather than a `{ $token }` because no radius token is
 * guaranteed to exist. Spacing is the opposite case — `space.4` IS in the
 * default set — which is why `core/form` reaches for a token where this reaches
 * for a value.
 */
export const CARD_BASE_STYLES = {
  base: {
    base: {
      borderRadius: "12px",
      overflow: "hidden",
    },
  },
} as const;

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const card = defineBlock<ContainerProps, PageContext>({
  name: CARD_BLOCK,
  version: 1,
  description:
    "A rounded container that clips its contents, so an image sitting at its top edge follows the corner instead of overhanging it.",
  props: {
    // `article` is offered rather than defaulted. It is the right element for a
    // card that is independently distributable — a post, a product — and it is
    // announced as a landmark, which is noise on a card that merely groups a
    // heading and a sentence. The author knows which one theirs is.
    as: { type: "select", options: ["div", "article", "section", "aside"] },
    contained: { type: "checkbox" },
  },
  defaultProps: { as: "div", contained: false },
  example: { props: { as: "div" } },
  slots: {
    children: {
      // No allow-list: a card holds whatever a box holds. Restricting it would
      // be the `core/columns` arrangement, and a row restricts its slot because
      // a column is meaningless elsewhere — nothing about a card's contents is.
      //
      // EMPTY template, for the reason `columns.tsx` records at length: nothing
      // in the repository expands `SlotSpec.template`, and literal node ids
      // would collide (`duplicate-node-id`) the moment something does.
      template: [],
    },
  },
  baseStyles: CARD_BASE_STYLES,
  supports: CONTAINER_SUPPORTS,
  render: renderContainer,
});
