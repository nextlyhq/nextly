/**
 * Which colours are in use, for the Colours tab's usage filter, beside what
 * the site's usage index counts (`variable-usage`): the colours the site's
 * own settings name, read from the token set itself, so they count as used
 * at once and whatever the index has reached.
 *
 * @module colour-usage
 */
import {
  customPropertiesReferenced,
  resolveTokenPrefix,
  tokenCustomProperty,
  tokenIdentity,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

/**
 * The variables another variable names through `var()` of the custom
 * property each is written under, by identity: a shadow keeps its colour
 * that way. A variable naming only itself does not count.
 */
export function namedBySite(
  tokens: SiteTokenSet | undefined
): ReadonlySet<string> {
  const { prefix } = resolveTokenPrefix(tokens?.prefix);
  const byProperty = new Map(
    (tokens?.tokens ?? []).map(token => [
      tokenCustomProperty(tokenIdentity(token), prefix),
      tokenIdentity(token),
    ])
  );
  const named = new Set<string>();
  for (const token of tokens?.tokens ?? []) {
    for (const value of Object.values(token.values)) {
      for (const property of propertiesIn(value)) {
        const identity = byProperty.get(property);
        if (identity !== undefined && identity !== tokenIdentity(token)) {
          named.add(identity);
        }
      }
    }
  }
  return named;
}

/** The custom properties a value reads through `var()`; none for no text. */
function propertiesIn(value: unknown): readonly string[] {
  if (typeof value !== "string" || !value.includes("(")) return [];
  return customPropertiesReferenced(value) ?? [];
}
