/**
 * Plugins' entry-list filters: which a list offers, which the page's URL has
 * chosen, and the `where` each choice adds to the list's request.
 *
 * A choice is kept in the URL as `pf=<filter>:<value>`, one per filter, and is
 * resolved here against the filters the plugins declared, by name and value.
 * A `pf` that names no declared filter or option is ignored, so an edited or
 * stale address can only ever ask for a declared fragment, and that fragment
 * goes into the list's own request, which the server answers with the
 * caller's access: a filter narrows the list and never widens it.
 *
 * @module components/features/entries/EntryList/plugin-filters
 */
import { setSearchParams } from "@admin/lib/navigation";
import type { SearchParams } from "@admin/lib/search-params";
import type { PluginMetadata } from "@admin/types/branding";

/**
 * A filter the toolbar offers, as its plugin declared it: the metadata's own
 * type, so the toolbar reads the contract the server publishes.
 */
export type OfferedListFilter = NonNullable<
  PluginMetadata["listFilters"]
>[number];

/** The URL parameter a chosen option is kept in. */
const PLUGIN_FILTER_PARAM = "pf";

/** The URL's `pf` values, however many it holds. */
export function pluginFilterParamValues(params: SearchParams): string[] {
  const value = params[PLUGIN_FILTER_PARAM];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Each plugin's filters this collection's list offers, in the plugins' order. */
export function listFiltersFor(
  plugins: readonly PluginMetadata[] | undefined,
  collection: string
): OfferedListFilter[] {
  return (plugins ?? []).flatMap(plugin =>
    (plugin.listFilters ?? []).filter(
      filter =>
        filter.collections === undefined ||
        filter.collections.includes(collection)
    )
  );
}

/**
 * The option each offered filter has chosen, by filter name, from the URL's
 * `pf` values. One that names no offered filter, or no option of it, is left
 * out; for a filter named twice, the first stands.
 */
export function chosenPluginFilters(
  offered: readonly OfferedListFilter[],
  params: readonly string[]
): Map<string, string> {
  const chosen = new Map<string, string>();
  for (const param of params) {
    const colon = param.lastIndexOf(":");
    if (colon <= 0) continue;
    const name = param.slice(0, colon);
    const value = param.slice(colon + 1);
    const filter = offered.find(f => f.name === name);
    if (!filter || chosen.has(name)) continue;
    if (!filter.options.some(option => option.value === value)) continue;
    chosen.set(name, value);
  }
  return chosen;
}

/** The `where` each chosen option adds to the list's request, in the toolbar's order. */
export function pluginFilterWheres(
  offered: readonly OfferedListFilter[],
  chosen: ReadonlyMap<string, string>
): Record<string, unknown>[] {
  return offered.flatMap(filter => {
    const value = chosen.get(filter.name);
    const option = filter.options.find(o => o.value === value);
    return option ? [option.where] : [];
  });
}

/** The chosen options as `pf` values, in the toolbar's order. */
function pluginFilterParams(
  offered: readonly OfferedListFilter[],
  chosen: ReadonlyMap<string, string>
): string[] {
  return offered.flatMap(filter => {
    const value = chosen.get(filter.name);
    return value === undefined ? [] : [`${filter.name}:${value}`];
  });
}

/**
 * Keep `chosen` in the page's URL, as the list keeps its other state there:
 * each choice is a history entry, so the back button returns to the choice
 * before it. Every other parameter is kept as it is.
 */
export function writePluginFilterParams(
  offered: readonly OfferedListFilter[],
  chosen: ReadonlyMap<string, string>
): void {
  setSearchParams({
    [PLUGIN_FILTER_PARAM]: pluginFilterParams(offered, chosen),
  });
}
