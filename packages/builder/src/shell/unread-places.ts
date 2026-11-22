/**
 * Where a block the page's data ran out before is: on the page, or in a
 * header or footer drawn around it, which the page's editor cannot select.
 * One answer for the top bar's meter and Page checks, so both name the same
 * block and offer the same way to it.
 *
 * @module shell/unread-places
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";

import { blockNameOf, type ComponentTitleOf } from "../panels/layers/layers";

/**
 * The region whose stored document holds the block `nodeId`, with the
 * block's name there, when one does. A read names the stored blocks, a
 * component placement among them, so the stored document is what is asked.
 */
export function regionHolding<R>(
  regions: readonly R[],
  nodeId: string,
  storedOf: (region: R) => BlockDocument,
  componentTitle?: ComponentTitleOf
): { readonly region: R; readonly name: string } | undefined {
  for (const region of regions) {
    const name = blockNameOf(storedOf(region), nodeId, componentTitle);
    if (name !== undefined) return { region, name };
  }
  return undefined;
}
