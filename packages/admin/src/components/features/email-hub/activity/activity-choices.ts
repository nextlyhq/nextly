/**
 * The choices Activity's template and provider filters offer.
 *
 * Named from the hub's own lists where the reader may read templates or
 * providers. A reader who may read deliveries and nothing else still filters:
 * the choices then come from the rows loaded, which already name each
 * template's slug and each provider's type. Whatever is chosen stays offered,
 * so a choice never vanishes from its own filter.
 *
 * The Activity narrows by a provider's type, which takes in every provider of
 * it, and separately by where it came from (stored, in code, deleted), so the
 * provider filter offers types rather than single stored providers.
 *
 * @module components/features/email-hub/activity/activity-choices
 */

import { templateSlugOf, type ActivityRow } from "./activity-model";

/** A template the filter offers. */
export interface TemplateOption {
  slug: string;
  label: string;
}

/** A provider type the filter offers. */
export interface ProviderTypeOption {
  type: string;
  label: string;
}

/**
 * The templates to offer: every template slug the loaded rows name, and,
 * when the reader may read the hub's list, every template in it, each named
 * from the list where it is there; the chosen one always. A template deleted
 * since is still named by its rows, by its slug. Layouts and partials are
 * left out: nothing is sent from one.
 */
export function templateChoices(
  list:
    | ReadonlyArray<{ slug: string; name: string; kind?: string }>
    | undefined,
  rows: readonly ActivityRow[],
  chosen: string | undefined
): TemplateOption[] {
  const options = new Map<string, string>();
  for (const row of rows) {
    const slug = templateSlugOf(row);
    if (slug) options.set(slug, slug);
  }
  for (const template of list ?? []) {
    // A layout or a partial is part of an email, never sent on its own, so
    // no delivery is ever sent from one.
    if (template.kind !== undefined && template.kind !== "template") continue;
    options.set(template.slug, template.name);
  }
  if (chosen && !options.has(chosen)) options.set(chosen, chosen);
  return [...options]
    .map(([slug, label]) => ({ slug, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The provider types to offer: the type of every stored provider when the
 * reader may read them, every type the loaded rows name, and the chosen one
 * always. Each reads "Every <type> provider", since choosing it takes in
 * every provider of that type, stored, in code or deleted.
 */
export function providerTypeChoices(
  stored: ReadonlyArray<{ type: string }> | undefined,
  rows: readonly ActivityRow[],
  chosen: string | undefined
): ProviderTypeOption[] {
  const types = new Set<string>();
  for (const provider of stored ?? []) types.add(provider.type);
  for (const row of rows) if (row.provider) types.add(row.provider.type);
  if (chosen) types.add(chosen);
  return [...types]
    .sort()
    .map(type => ({ type, label: `Every ${type} provider` }));
}
