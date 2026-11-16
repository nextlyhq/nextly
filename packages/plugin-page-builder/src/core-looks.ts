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
 * every registered block's looks then, before any request reads it. The
 * canvas and the published page's site style both take theirs from
 * {@link withRegisteredLooks}, so a look the canvas shows is one the
 * published page has a rule for.
 *
 * @module core-looks
 */

import { allBlocks, blockLooks, blockOwnLooks } from "@nextlyhq/blocks-engine";
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

/**
 * The site's config style with the looks of every block this process knows:
 * each registered block, other plugins' among them, and the core blocks even
 * before anything has registered them.
 *
 * The core blocks lead, as the plugin registers them first, so a booted
 * process reads exactly its registry's order. They are kept when the registry
 * is empty, as it is between a boot's clear and its registration, because a
 * page rendered then would otherwise lose every core look it wears.
 */
export function withRegisteredLooks(
  siteStyle: SiteStyleData | undefined
): SiteStyleData {
  const registered = allBlocks();
  const names = new Set(registered.map(definition => definition.name));
  const unregisteredCore = coreBlocks.filter(
    definition => !names.has(definition.name)
  );
  return withBlockLooks(siteStyle, [...unregisteredCore, ...registered]);
}
