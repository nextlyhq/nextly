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
import { filterShapeProblems } from "../domains/collections/query/filter-shape";

import type { PluginListFilterDeclaration } from "./admin-contributions";
import { isWellFormedAdminPlaceName } from "./admin-places";
import type { PluginDefinition } from "./plugin-context";
import { isInPluginNamespace, pluginAdminSlug } from "./plugin-slug";
import { resolutionError } from "./resolution-error";

/** A filter that passed the check, and the plugin that declared it. */
export interface ContributedListFilter extends PluginListFilterDeclaration {
  plugin: string;
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
  const { label, collections, options } = declared as Record<string, unknown>;
  if (typeof label !== "string" || label.trim() === "")
    return "it has no label";
  if (
    collections !== undefined &&
    !(
      Array.isArray(collections) &&
      collections.every(slug => typeof slug === "string" && slug !== "")
    )
  ) {
    return "its `collections` is not a list of collection slugs";
  }
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
  if (typeof value !== "string" || !isWellFormedAdminPlaceName(value)) {
    return `the option value ${typeof value === "string" ? `"${value}"` : `given as ${typeof value}`} is not lower-case letters, digits and single dashes`;
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
  const problems = filterShapeProblems(where);
  if (problems.length > 0) {
    return `the option "${value}" narrows by a \`where\` the list cannot apply: ${problems.map(p => `${p.path}: ${p.message}`).join("; ")}`;
  }
  return undefined;
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
 * outside its plugin's namespace, declared twice, or that offers an option the
 * list cannot apply, naming the plugin and the filter.
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
          `Plugins "${owner}" and "${plugin.name}" both declare the entry-list filter "${filter.name}".`,
          { filter: filter.name, owners: [owner, plugin.name] }
        );
      }
      owners.set(filter.name, plugin.name);
      filters.push({ ...filter, plugin: plugin.name });
    }
  }
  return filters;
}
