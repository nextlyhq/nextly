/**
 * What one reader is sent of the contributions and filters plugins declared:
 * the ones that passed the boot check, in each place's order, less what this
 * reader may not see.
 *
 * Left out for a reader, never hidden in the browser: the payload is JSON, so
 * a label, a route or a rule sent and then not drawn has still been told.
 *
 * - A contribution whose `requiredPermission` the reader does not hold is not
 *   sent. A replacement left out gives the built-in part back its place.
 * - A contribution whose rule names a field the reader may not filter on is
 *   not offered on that collection, and an entry-list filter's option whose
 *   `where` the list read would refuse the reader is not offered on that
 *   collection either. Both are asked of the list read's own chain, through
 *   `mayFilter`, so nothing is offered that the read it leads to refuses.
 *
 * @module plugins/admin-contributions-offer
 * @experimental
 */
import type {
  AdminContribution,
  PluginListFilterDeclaration,
} from "./admin-contributions";
import {
  contributedAdminContributions,
  type ContributedAdminContribution,
} from "./admin-place-contributions";
import type { AdminContributionKind } from "./admin-places";
import type { OrderedEntry } from "./contribution-order";
import type { PluginDefinition } from "./plugin-context";
import { rowPredicateFields } from "./row-predicate";
import {
  collectionContributors,
  servedCollectionSlug,
} from "./served-collection-slug";

/** @experimental Who is reading, as the offer asks it. */
export interface ContributionAudience {
  /** Whether the reader holds a contribution's `requiredPermission`. */
  holds: (requiredPermission: unknown) => boolean;
  /**
   * Whether the list read would let the reader filter this collection by
   * `where`. Never throws: a failure to decide answers no.
   */
  mayFilter: (
    collection: string,
    where: Record<string, unknown>
  ) => Promise<boolean>;
  /**
   * The collections a filter or rule that names none is offered on: every
   * collection the admin lists. Empty when they could not be read, so nothing
   * is offered that could not be judged.
   */
  collections: readonly string[];
}

/** `Omit` over each member of a union, so each kind keeps its own fields. */
type OmitEach<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** @experimental A contribution as the admin receives it, already placed. */
export type DeliveredAdminContribution = OmitEach<
  AdminContribution,
  "order" | "before" | "after" | "requiredPermission" | "place"
> & { plugin: string };

/** @experimental One entry of a place's list: a built-in part, or a contribution. */
export type DeliveredAdminEntry =
  | { builtIn: string }
  | DeliveredAdminContribution;

/** @experimental Each place's lists, by kind, as one reader receives them. */
export type AdminContributionsMeta = Record<
  string,
  Partial<Record<AdminContributionKind, DeliveredAdminEntry[]>>
>;

/**
 * A key for a `where` that is the same whatever order its keys were written
 * in, so one question is asked once.
 */
function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.keys(value)
      .sort()
      .map(
        key =>
          `${JSON.stringify(key)}:${stableKey((value as Record<string, unknown>)[key])}`
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * @experimental `mayFilter` for one reader and one payload: each (collection,
 * `where`) asked of the list read once, its refusal read as no, and any
 * failure read as no and reported, so a check that cannot decide never offers
 * and never stops the payload being built.
 */
export function readerFilterVerdict(
  problemsOf: (
    collection: string,
    where: Record<string, unknown>
  ) => Promise<readonly unknown[]>,
  onFailure: (collection: string, error: unknown) => void
): ContributionAudience["mayFilter"] {
  const asked = new Map<string, Promise<boolean>>();
  return (collection, where) => {
    const key = `${collection}\u0000${stableKey(where)}`;
    let verdict = asked.get(key);
    if (verdict === undefined) {
      verdict = problemsOf(collection, where).then(
        problems => problems.length === 0,
        (error: unknown) => {
          onFailure(collection, error);
          return false;
        }
      );
      asked.set(key, verdict);
    }
    return verdict;
  };
}

/** The `where` a rule's fields are judged by: each field, as the read would filter on it. */
function whereNaming(fields: readonly string[]): Record<string, unknown> {
  return { and: fields.map(field => ({ [field]: { exists: true } })) };
}

/** The collections among `candidates` the reader may filter by `where`. */
async function offeredOn(
  candidates: readonly string[],
  where: Record<string, unknown>,
  audience: ContributionAudience
): Promise<string[]> {
  const verdicts = await Promise.all(
    candidates.map(collection => audience.mayFilter(collection, where))
  );
  return candidates.filter((_, i) => verdicts[i]);
}

/** The contribution as this reader receives it, or `undefined` when it is left out. */
async function deliveredFor(
  contribution: ContributedAdminContribution,
  owner: PluginDefinition | undefined,
  contributors: ReadonlyMap<string, PluginDefinition>,
  audience: ContributionAudience
): Promise<DeliveredAdminContribution | undefined> {
  if (
    contribution.requiredPermission !== undefined &&
    !audience.holds(contribution.requiredPermission)
  ) {
    return undefined;
  }
  const {
    order: _order,
    before: _before,
    after: _after,
    requiredPermission: _permission,
    place: _place,
    ...delivered
  } = contribution;
  // Each named collection under the slug the admin serves it as.
  const declared =
    owner && contribution.collections
      ? contribution.collections.map(slug =>
          servedCollectionSlug(owner, slug, contributors)
        )
      : contribution.collections;
  if (contribution.visibleWhen === undefined) {
    return declared ? { ...delivered, collections: declared } : delivered;
  }
  const offered = await offeredOn(
    declared ?? audience.collections,
    whereNaming(rowPredicateFields(contribution.visibleWhen)),
    audience
  );
  return offered.length > 0
    ? { ...delivered, collections: offered }
    : undefined;
}

/** One ordered list as the reader receives it. */
async function deliveredList(
  entries: readonly OrderedEntry[],
  byId: ReadonlyMap<string, ContributedAdminContribution>,
  plugins: ReadonlyMap<string, PluginDefinition>,
  contributors: ReadonlyMap<string, PluginDefinition>,
  audience: ContributionAudience
): Promise<DeliveredAdminEntry[]> {
  const delivered = await Promise.all(
    entries.map(async (entry): Promise<DeliveredAdminEntry | undefined> => {
      if ("builtIn" in entry) return entry;
      const contribution = byId.get(entry.contribution)!;
      const sent = await deliveredFor(
        contribution,
        plugins.get(contribution.plugin),
        contributors,
        audience
      );
      if (sent) return sent;
      return entry.replaces ? { builtIn: entry.replaces } : undefined;
    })
  );
  return delivered.filter(
    (entry): entry is DeliveredAdminEntry => entry !== undefined
  );
}

/**
 * @experimental Every place's contributions as this reader receives them:
 * every place but the login page's for a signed-in reader (`"workspace"`),
 * the login page's alone for the public metadata (`"login"`).
 */
export async function contributionsForReader(
  plugins: readonly PluginDefinition[],
  audience: ContributionAudience,
  scope: "workspace" | "login"
): Promise<AdminContributionsMeta> {
  const { contributions, ordered } = contributedAdminContributions(plugins);
  const byId = new Map(contributions.map(c => [c.id, c]));
  const byName = new Map(plugins.map(p => [p.name, p]));
  const contributors = collectionContributors(plugins);
  const meta: AdminContributionsMeta = {};
  for (const [place, kinds] of ordered) {
    if ((place === "login") !== (scope === "login")) continue;
    const lists: Partial<Record<AdminContributionKind, DeliveredAdminEntry[]>> =
      {};
    for (const [kind, entries] of kinds) {
      const list = await deliveredList(
        entries,
        byId,
        byName,
        contributors,
        audience
      );
      // A list of built-in parts alone says nothing the page does not.
      if (list.some(entry => !("builtIn" in entry))) lists[kind] = list;
    }
    if (Object.keys(lists).length > 0) meta[place] = lists;
  }
  return meta;
}

/**
 * @experimental A plugin's entry-list filters as this reader receives them:
 * on each collection, only the options whose `where` the list read would let
 * the reader filter by, and a filter left with none not offered there.
 * Collections offered the same options are kept together in one entry.
 */
export async function listFiltersForReader(
  filters: readonly PluginListFilterDeclaration[],
  audience: ContributionAudience
): Promise<PluginListFilterDeclaration[]> {
  const offered: PluginListFilterDeclaration[] = [];
  for (const filter of filters) {
    const byOptions = new Map<string, string[]>();
    for (const collection of filter.collections ?? audience.collections) {
      const verdicts = await Promise.all(
        filter.options.map(option =>
          audience.mayFilter(
            collection,
            option.where as Record<string, unknown>
          )
        )
      );
      const values = filter.options
        .filter((_, i) => verdicts[i])
        .map(option => option.value);
      if (values.length === 0) continue;
      const key = values.join("\u0000");
      byOptions.set(key, [...(byOptions.get(key) ?? []), collection]);
    }
    for (const [key, collections] of byOptions) {
      const values = new Set(key.split("\u0000"));
      offered.push({
        ...filter,
        collections,
        options: filter.options.filter(option => values.has(option.value)),
      });
    }
  }
  return offered;
}
