/**
 * The core blocks' looks, in the site style's code tier.
 *
 * A look (a button's Outline) is a shared style bound to one block type. The
 * core blocks declare theirs in code, so the site receives them as classes
 * its code supplies: shown "In code", never renamed or removed, and stored
 * only once the site edits one, as any code-supplied style is. A class the
 * site's own config states with a look's id is the site's copy and wins.
 *
 * Looks of blocks other plugins declare are not here: those blocks register
 * at init, after the code tier is resolved.
 *
 * @module core-looks
 */

import { blockLooks } from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";

import type { SiteStyleData } from "./site-style";

/** The site's config style with the core looks among its classes. */
export function withCoreLooks(
  siteStyle: SiteStyleData | undefined
): SiteStyleData {
  const own = siteStyle?.classes ?? [];
  const stated = new Set(own.map(entry => entry.id));
  const looks = blockLooks(coreBlocks).filter(look => !stated.has(look.id));
  return { ...siteStyle, classes: [...looks, ...own] };
}
