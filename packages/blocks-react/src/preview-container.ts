/**
 * What a surface must put on the box it previews a page inside.
 *
 * @module preview-container
 */

import { PREVIEW_VIEWPORT_CONTAINER } from "@nextlyhq/blocks-engine";

/**
 * The style a previewing surface applies to its own box.
 *
 * BOTH properties, in one value, because either alone does nothing. Naming a
 * container without `container-type` leaves the element at the default
 * `normal`, which is not a size-query container — so every `(max-width: ...)`
 * rule the preview compile emitted stays inactive and resizing the box changes
 * nothing at all. That failure is silent: the sheet is valid, the name matches,
 * and the page simply never responds.
 *
 * Published as one object rather than as the name alone, so the second property
 * cannot be the thing a consumer did not know to look for. `inline-size` rather
 * than `size`, because a preview box is sized by its content in the block
 * direction and containing that too would collapse the page's height.
 */
export const PREVIEW_CONTAINER_STYLE = Object.freeze({
  containerName: PREVIEW_VIEWPORT_CONTAINER,
  containerType: "inline-size",
} as const);
