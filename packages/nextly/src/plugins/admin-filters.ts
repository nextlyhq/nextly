/**
 * The filters plugins add to the entry list, checked once and given to the
 * admin as they passed.
 *
 * One reduction for both: the boot check refuses a malformed filter, and the
 * admin meta is built from the same call, so the admin is offered exactly the
 * filters that passed, never one the check never saw. A filter's option
 * narrows the list by a `where` the list read already evaluates, with the
 * caller's access, so a filter can only take rows away.
 *
 * @module plugins/admin-filters
 * @experimental
 */
import {
  type FilterProblem,
  filterShapeProblems,
  snapshotFilter,
} from "../domains/collections/query/filter-shape";
import { NextlyError } from "../errors/nextly-error";
import { judgeConfiguredAddress } from "../shared/address-rule";

import type { PluginListFilterDeclaration } from "./admin-contributions";
import { isWellFormedAdminPlaceName } from "./admin-places";
import type { PluginDefinition } from "./plugin-context";
import { isInPluginNamespace, pluginAdminSlug } from "./plugin-slug";
import { resolutionError } from "./resolution-error";

/** A filter that passed the check, and the plugin that declared it. */
export interface ContributedListFilter extends PluginListFilterDeclaration {
  plugin: string;
}

/** The keys a filter declaration takes, and those an option takes. */
const FILTER_KEYS: ReadonlySet<string> = new Set([
  "name",
  "label",
  "collections",
  "options",
]);
const OPTION_KEYS: ReadonlySet<string> = new Set(["value", "label", "where"]);

/**
 * A key `declared` has that it does not take, or `undefined`. Refused rather
 * than ignored: a misspelled optional key (`collection` for `collections`)
 * would otherwise read as one left out, and offer the filter on every list.
 */
function strayKey(
  declared: object,
  known: ReadonlySet<string>
): string | undefined {
  return Object.keys(declared).find(key => !known.has(key));
}

/** What makes a declared filter unusable, in a sentence, or `undefined`. */
function filterProblem(declared: unknown): string | undefined {
  if (
    typeof declared !== "object" ||
    declared === null ||
    Array.isArray(declared)
  ) {
    return "it is not an object";
  }
  const stray = strayKey(declared, FILTER_KEYS);
  if (stray !== undefined) {
    return `it has the key \`${stray}\`, which a filter does not take`;
  }
  const { label, collections, options } = declared as Record<string, unknown>;
  if (typeof label !== "string" || label.trim() === "")
    return "it has no label";
  const collectionsProblem = collectionsScopeProblem(collections);
  if (collectionsProblem) return collectionsProblem;
  if (!Array.isArray(options) || options.length === 0) {
    return "it offers no options";
  }
  const values = new Set<string>();
  for (const option of options as unknown[]) {
    const problem = optionProblem(option, values);
    if (problem) return problem;
  }
  return undefined;
}

/**
 * What makes a filter's `collections` unusable, or `undefined`. Each slug is
 * judged by the one address rule, as configuration's own collection addresses
 * are, so a name no collection can have ("Tickets", one past the length limit)
 * is refused rather than offered on no list. Only what configuration could
 * never have made is refused: a collection may already exist under an address
 * the rule now refuses for new ones, and a filter may name it.
 */
function collectionsScopeProblem(collections: unknown): string | undefined {
  if (collections === undefined) return undefined;
  if (!Array.isArray(collections)) {
    return "its `collections` is not a list of collection slugs";
  }
  for (const slug of collections as unknown[]) {
    const refusal = judgeConfiguredAddress("collection", slug);
    if (refusal) {
      return `its \`collections\` names no collection: ${refusal.message}`;
    }
  }
  return undefined;
}

/** What makes one option unusable, or `undefined`; `values` holds the ones seen. */
function optionProblem(
  option: unknown,
  values: Set<string>
): string | undefined {
  if (typeof option !== "object" || option === null || Array.isArray(option)) {
    return "an option is not an object";
  }
  const { value, label, where } = option as Record<string, unknown>;
  // Spelled as a place-name segment, so the URL carries it unescaped.
  if (
    typeof value !== "string" ||
    value.includes(".") ||
    !isWellFormedAdminPlaceName(value)
  ) {
    return `the option value ${typeof value === "string" ? `"${value}"` : `given as ${typeof value}`} is not lower-case letters, digits and single dashes`;
  }
  const stray = strayKey(option, OPTION_KEYS);
  if (stray !== undefined) {
    return `the option "${value}" has the key \`${stray}\`, which an option does not take`;
  }
  if (values.has(value)) return `two options have the value "${value}"`;
  values.add(value);
  if (typeof label !== "string" || label.trim() === "") {
    return `the option "${value}" has no label`;
  }
  // The list read's own check: a `where` it would refuse is refused here,
  // before anyone chooses it.
  if (typeof where !== "object" || where === null || Array.isArray(where)) {
    return `the option "${value}" has no \`where\` to narrow by`;
  }
  const problems = whereProblems(where);
  if (problems.length > 0) {
    return `the option "${value}" narrows by a malformed \`where\`: ${problems.map(p => `${p.path}: ${p.message}`).join("; ")}`;
  }
  return undefined;
}

/**
 * Every problem the list read would find with `where`, judged where the admin
 * sends it: one member of the `and` that joins it to the list's other filters.
 * The read copies a filter before checking its shape and refuses one nested
 * past its bound, so the copy is taken here too, at that depth: a `where` the
 * read would refuse only once joined is refused at start, not on the first
 * choice of it.
 */
function whereProblems(where: object): FilterProblem[] {
  let joined: { and: unknown[] };
  try {
    joined = snapshotFilter({ and: [where] });
  } catch (err) {
    if (!NextlyError.is(err) || err.code !== "VALIDATION_ERROR") throw err;
    // A refusal that names no problem still refuses: the read would.
    const data = err.publicData;
    return data !== undefined && "errors" in data && data.errors.length > 0
      ? data.errors
      : [{ path: "where", code: err.code, message: err.publicMessage }];
  }
  return filterShapeProblems(joined.and[0]);
}

/** The plugin's declared filters as a list, refusing anything else. */
function declaredFilters(plugin: PluginDefinition): readonly unknown[] {
  const declared: unknown = plugin.contributes?.admin?.filters;
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) {
    throw resolutionError(
      "list-filter-invalid",
      `Plugin "${plugin.name}" declares \`contributes.admin.filters\` as something other than a list of filters.`,
      { plugin: plugin.name, filter: undefined }
    );
  }
  return declared;
}

/**
 * A declared filter checked whole: its name a name, in the plugin's own
 * namespace, and the rest usable. Answers it as the declaration it passed as.
 */
function checkedFilter(
  plugin: PluginDefinition,
  filter: unknown
): PluginListFilterDeclaration {
  const name = (filter as { name?: unknown } | null)?.name;
  if (typeof name !== "string" || !isWellFormedAdminPlaceName(name)) {
    throw resolutionError(
      "list-filter-invalid",
      `Plugin "${plugin.name}" declares an entry-list filter named ${typeof name === "string" ? `"${name}"` : `given as ${typeof name}`}, which is not a name: lower-case letters, digits and single dashes, in segments joined by dots, the first being the plugin's slug.`,
      {
        plugin: plugin.name,
        filter: typeof name === "string" ? name : undefined,
      }
    );
  }
  if (!isInPluginNamespace(plugin.name, name)) {
    const slug = pluginAdminSlug(plugin.name);
    throw resolutionError(
      "list-filter-outside-namespace",
      `Plugin "${plugin.name}" declares the entry-list filter "${name}", which must start with "${slug}.".`,
      { plugin: plugin.name, filter: name, expectedPrefix: `${slug}.` }
    );
  }
  const problem = filterProblem(filter);
  if (problem) {
    throw resolutionError(
      "list-filter-invalid",
      `Plugin "${plugin.name}" declares the entry-list filter "${name}", but ${problem}.`,
      { plugin: plugin.name, filter: name }
    );
  }
  return filter as PluginListFilterDeclaration;
}

/**
 * @experimental Every enabled plugin's entry-list filters, refusing one that is
 * outside its plugin's namespace, declared twice, or malformed, naming the
 * plugin and the filter.
 *
 * A disabled plugin's filters are skipped: it is not running, so nothing it
 * declares is offered.
 */
export function contributedListFilters(
  plugins: readonly PluginDefinition[]
): ContributedListFilter[] {
  const filters: ContributedListFilter[] = [];
  const owners = new Map<string, string>();
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    for (const declared of declaredFilters(plugin)) {
      const filter = checkedFilter(plugin, declared);
      const owner = owners.get(filter.name);
      if (owner !== undefined) {
        throw resolutionError(
          "list-filter-duplicate",
          owner === plugin.name
            ? `Plugin "${plugin.name}" declares the entry-list filter "${filter.name}" twice.`
            : `Plugins "${owner}" and "${plugin.name}" both declare the entry-list filter "${filter.name}".`,
          {
            plugin: plugin.name,
            filter: filter.name,
            owners: [owner, plugin.name],
          }
        );
      }
      owners.set(filter.name, plugin.name);
      filters.push({ ...filter, plugin: plugin.name });
    }
  }
  return filters;
}
