/**
 * The core blocks' looks, in the site style's code tier.
 *
 * A look (a button's Outline) is a shared style bound to one block type. The
 * core blocks declare theirs in code, so the site receives them as classes
 * its code supplies: shown "In code", never renamed or removed, and stored
 * only once the site edits one, as any code-supplied style is. A class the
 * site's own config states with a look's id is the site's copy and wins.
 *
 * The core blocks' looks are known at config time. Blocks other plugins
 * declare register at init, and the plugin refreshes the code tier with
 * every registered block's looks then, before any request reads it.
 *
 * @module core-looks
 */

import { blockLooks, blockOwnLooks } from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";

import type { SiteStyleData } from "./site-style";

/** What a look reads from a block definition. */
type LookSource =
  Parameters<typeof blockLooks>[0] extends Iterable<infer T> ? T : never;

/**
 * The site's config style with the given blocks' looks among its classes.
 * Appended after the site's own classes, so the read cap, which counts looks
 * apart anyway, never reaches past one of them first.
 */
export function withBlockLooks(
  siteStyle: SiteStyleData | undefined,
  definitions: Iterable<LookSource>
): SiteStyleData {
  const own = siteStyle?.classes ?? [];
  const stated = new Set(own.map(entry => entry.id));
  // Each block's own look too, with no edits: where the site's edits to the
  // block's base are stored once it makes one.
  const definitionList = [...definitions];
  const looks = [
    ...blockOwnLooks(definitionList),
    ...blockLooks(definitionList),
  ].filter(look => !stated.has(look.id));
  return { ...siteStyle, classes: [...own, ...looks] };
}

/**
 * The site's config style with the core blocks' looks: what the code tier
 * holds at config time, before other plugins' blocks register.
 */
export function withCoreLooks(
  siteStyle: SiteStyleData | undefined
): SiteStyleData {
  return withBlockLooks(siteStyle, coreBlocks);
}
