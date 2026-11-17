/**
 * The variables the open page uses, for the Colours tab's "Used on this
 * page": its own blocks and settings, and every component it places, at any
 * depth, each read once. Read with the engine's walk (`documentTokenUsage`),
 * the one the site's usage index records documents with, so the filter and
 * the counts agree on what a use is; and from the editor's document, so an
 * edit not yet saved counts at once.
 *
 * @module used-on-page
 */
import {
  componentIdsIn,
  documentTokenUsage,
  resolveTokenPrefix,
  tokenCustomProperty,
  tokenIdentity,
  type BlockDocument,
  type ComponentLookup,
  type DocumentLimits,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

export function usedOnPage(
  document: BlockDocument,
  components: ComponentLookup,
  limits: DocumentLimits,
  tokens: SiteTokenSet | undefined
): ReadonlySet<string> {
  const used = new Set<string>();
  const properties = new Set<string>();
  const seen = new Set<string>();
  const queue: BlockDocument[] = [document];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const usage = documentTokenUsage(next, limits);
    for (const id of usage.ids) used.add(id);
    for (const property of usage.properties) properties.add(property);
    for (const id of componentIdsIn(next.nodes, limits.maxNodes)) {
      // Each component once, so one placed inside itself ends the walk.
      const definition = seen.has(id) ? undefined : components.get(id);
      seen.add(id);
      if (definition !== undefined) queue.push(definition);
    }
  }
  return withNamedProperties(used, properties, tokens);
}

/**
 * The identities used, with each variable a `var()` reads through the custom
 * property it is written under on this site.
 */
function withNamedProperties(
  used: Set<string>,
  properties: ReadonlySet<string>,
  tokens: SiteTokenSet | undefined
): ReadonlySet<string> {
  const { prefix } = resolveTokenPrefix(tokens?.prefix);
  for (const token of tokens?.tokens ?? []) {
    const identity = tokenIdentity(token);
    if (properties.has(tokenCustomProperty(identity, prefix)))
      used.add(identity);
  }
  return used;
}
