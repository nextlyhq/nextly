/**
 * The one refresh of every content source, collections and Singles alike.
 *
 * Its own module because it joins two others: `single-sources.ts` already
 * imports `collection-sources.ts`, so the refresh living in either would make
 * the pair import each other.
 *
 * @module domains/widgets/content-sources
 */

import { refreshCollectionSources } from "./collection-sources";
import { refreshSingleSources } from "./single-sources";

/**
 * Rebuild every content source -- both kinds -- from the live registries.
 *
 * ONE refresh for the two kinds, and the one every request-time consumer
 * calls: the layout and the query endpoint both resolve whatever a reader
 * asks against these sources, and boot publishes none of them. A consumer
 * that refreshed one kind and not the other would answer for a single only
 * when some earlier request happened to have refreshed it -- which is how a
 * `single:` query through the query endpoint was refused as unknown on a cold
 * process while the same query through the layout endpoint ran.
 */
export async function refreshContentSources(): Promise<boolean> {
  const read = await Promise.all([
    refreshCollectionSources(),
    refreshSingleSources(),
  ]);
  // Whether both registries could be read; a consumer that judges what the
  // sources hold needs to know the answer is current, not left standing.
  return read.every(Boolean);
}
