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

/**
 * How the filter names a choice by type. The log narrows by a provider's type
 * alone, which takes in every provider of that type, a stored one included,
 * so the choice says so rather than promising only those not stored.
 */
function everyOfTypeLabel(type: string): string {
  return `Every ${type} provider`;
}

/** A stored provider the reader cannot see the name of: its type and the start of its id. */
function unnamedStoredLabel(type: string, id: string): string {
  return `${type} · ${id.slice(0, 8)}`;
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
    if (row.templateSlug) options.set(row.templateSlug, row.templateSlug);
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
 * The providers to offer: every stored one by name when the reader may read
 * them, else each stored one the loaded rows name, by type and id; then, for
 * each provider not stored that the rows name, every provider of its type;
 * the chosen one always.
 */
export function providerChoices(
  stored: ReadonlyArray<{ id: string; name: string }> | undefined,
  rows: readonly ActivityRow[],
  chosen: ProviderChoice | undefined
): ProviderOption[] {
  const byId = storedProviderLabels(stored, rows);
  const notStored = notStoredTypes(rows);
  if (chosen && "id" in chosen && !byId.has(chosen.id)) {
    byId.set(chosen.id, chosen.id);
  }
  if (chosen && "type" in chosen) notStored.add(chosen.type);
  const options: ProviderOption[] = [...byId]
    .map(([id, label]) => ({ choice: { id }, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  for (const type of [...notStored].sort()) {
    options.push({ choice: { type }, label: everyOfTypeLabel(type) });
  }
  return options;
}

/**
 * Each stored provider's label by id: every stored one by name when the
 * reader may read them, else each one the rows name, by type and id.
 */
function storedProviderLabels(
  stored: ReadonlyArray<{ id: string; name: string }> | undefined,
  rows: readonly ActivityRow[]
): Map<string, string> {
  if (stored)
    return new Map(stored.map(provider => [provider.id, provider.name]));
  const labels = new Map<string, string>();
  for (const row of rows) {
    if (row.source === "delivery" && row.provider.id !== null) {
      labels.set(
        row.provider.id,
        unnamedStoredLabel(row.provider.type, row.provider.id)
      );
    }
  }
  return labels;
}

/** The types of the providers not stored that the rows name. */
function notStoredTypes(rows: readonly ActivityRow[]): Set<string> {
  const types = new Set<string>();
  for (const row of rows) {
    if (row.source === "delivery" && row.provider.id === null) {
      types.add(row.provider.type);
    }
  }
  return types;
}
