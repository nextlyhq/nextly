/**
 * Where a header & footer set opens in the builder, and the way back.
 *
 * A set opened from the builder's Pages panel carries the address the author
 * left and the name of what was open there, so its Back returns to that page
 * and says so ("Back to Home"). The move is to another document, so it loads
 * the address afresh, through the admin's unsaved-changes guard, as "Edit
 * component" does (`edit-component.ts`).
 *
 * @module admin/editor/set-address
 */
import { SET_BUILDER_VIEW_PATH } from "../../builder-view";

import { addressWithoutSection } from "./builder-address";
import { addressWithReturn } from "./edit-component";

/** A set's own screen in the builder, with no way back named. */
export function setBuilderPath(collection: string, id: string): string {
  return `/admin/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/${SET_BUILDER_VIEW_PATH}`;
}

/**
 * A set's own screen in the builder, opened from `here` (the address the
 * author is at), which its Back returns to, saying `from`.
 */
export function setBuilderAddress(
  collection: string,
  id: string,
  here: { readonly pathname: string; readonly search: string },
  from: string | undefined
): string {
  return addressWithReturn(setBuilderPath(collection, id), {
    // Any section the address names is the author's earlier one: Back
    // returns to the page, not to a block they have since moved from.
    returnTo: addressWithoutSection(`${here.pathname}${here.search}`),
    from,
  });
}
