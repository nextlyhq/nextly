/**
 * What a surface must put on the box it previews a page inside.
 *
 * @module preview-container
 */

import {
  PREVIEW_VIEWPORT_CONTAINER,
  previewContainerName,
} from "@nextlyhq/blocks-engine";

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
 * Derived from the name the COMPILE was given rather than fixed to the default,
 * because the compile option accepts any usable identifier. Pinned to the
 * constant, a surface previewing under its own name would declare one container
 * while the sheet queried another — both valid, and every responsive rule
 * inactive with nothing to indicate why.
 *
 * Normalised through the compiler's own rule, so a name it would refuse
 * produces the same refusal here: the sheet then compiles published, and a box
 * declaring a container for queries nobody emitted is at worst inert.
 *
 * `inline-size` rather than `size`, because a preview box is sized by its
 * content in the block direction and containing that too would collapse the
 * page's height.
 */
export function previewContainerStyle(
  name?: string
):
  | { readonly containerName: string; readonly containerType: "inline-size" }
  | Record<string, never> {
  const resolved = previewContainerName(name);
  /*
   * NO container when the compiler refused the name, and that symmetry is the
   * whole point rather than a nicety.
   *
   * A refused name makes the compile PUBLISHED: viewport tiers emit `@media`
   * and container tiers emit unnamed `@container` rules. A box that established
   * a query container anyway would let those unnamed rules resolve against IT,
   * so viewport tiers would follow the window while container tiers followed
   * the canvas — a hybrid neither mode intends, and precisely the capture a
   * valid preview is named to prevent.
   *
   * An empty object rather than a thrown error or a null: a caller spreads this
   * onto a style, and the honest answer for "this is not previewing" is that
   * the box carries nothing.
   */
  if (resolved === undefined) return {};
  return Object.freeze({
    containerName: resolved,
    containerType: "inline-size",
  } as const);
}

/**
 * The style for a surface previewing under the default container name.
 *
 * For a caller that compiled with {@link PREVIEW_VIEWPORT_CONTAINER} and has no
 * name of its own to pass.
 */
export const PREVIEW_CONTAINER_STYLE = previewContainerStyle(
  PREVIEW_VIEWPORT_CONTAINER
);
