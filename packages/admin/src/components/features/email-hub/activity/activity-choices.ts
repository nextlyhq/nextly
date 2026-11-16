/**
 * The choices Activity's template and provider filters offer.
 *
 * Named from the hub's own lists where the reader may read templates or
 * providers. A reader who may read deliveries and nothing else still filters:
 * the choices then come from the rows loaded, which already name each
 * template's slug and each provider's id and type. Whatever is chosen stays
 * offered, so a choice never vanishes from its own filter.
 *
 * A delivery's provider without a stored id is a provider that is not
 * stored: one set in the app's code, or one deleted since. The log does not
 * say which, so neither is claimed.
 *
 * @module components/features/email-hub/activity/activity-choices
 */

import type { ActivityRow, ProviderChoice } from "./activity-model";

/** A template the filter offers. */
export interface TemplateOption {
  slug: string;
  label: string;
}

/** A provider the filter offers: a stored one by id, or one not stored by type. */
export interface ProviderOption {
  choice: ProviderChoice;
  label: string;
}

/** How a provider with no stored id is named, in the list and its filter. */
export function notStoredLabel(type: string): string {
  return `${type} (not stored)`;
}

/** A stored provider the reader cannot see the name of: its type and the start of its id. */
function unnamedStoredLabel(type: string, id: string): string {
  return `${type} · ${id.slice(0, 8)}`;
}

/**
 * The templates to offer: the hub's list, by name, when the reader may read
 * it, else every template slug the loaded rows name; the chosen one always.
 */
export function templateChoices(
  list: ReadonlyArray<{ slug: string; name: string }> | undefined,
  rows: readonly ActivityRow[],
  chosen: string | undefined
): TemplateOption[] {
  const options = new Map<string, string>();
  if (list) {
    for (const template of list) options.set(template.slug, template.name);
  } else {
    for (const row of rows) {
      if (row.templateSlug) options.set(row.templateSlug, row.templateSlug);
    }
  }
  if (chosen && !options.has(chosen)) options.set(chosen, chosen);
  return [...options]
    .map(([slug, label]) => ({ slug, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The providers to offer: every stored one by name when the reader may read
 * them, else each stored one the loaded rows name, by type and id; then each
 * provider not stored that the rows name, by type; the chosen one always.
 */
export function providerChoices(
  stored: ReadonlyArray<{ id: string; name: string }> | undefined,
  rows: readonly ActivityRow[],
  chosen: ProviderChoice | undefined
): ProviderOption[] {
  const byId = new Map<string, string>();
  const notStored = new Set<string>();
  if (stored) {
    for (const provider of stored) byId.set(provider.id, provider.name);
  }
  for (const row of rows) {
    if (row.source !== "delivery") continue;
    const { id, type } = row.provider;
    if (id === null) notStored.add(type);
    else if (!stored && !byId.has(id))
      byId.set(id, unnamedStoredLabel(type, id));
  }
  if (chosen) {
    if ("id" in chosen && !byId.has(chosen.id)) byId.set(chosen.id, chosen.id);
    if ("type" in chosen) notStored.add(chosen.type);
  }
  const options: ProviderOption[] = [...byId]
    .map(([id, label]) => ({ choice: { id }, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  for (const type of [...notStored].sort()) {
    options.push({ choice: { type }, label: notStoredLabel(type) });
  }
  return options;
}
