/**
 * Which content types carry the plugin's `seo` group: the one answer every
 * part of the plugin reads, from the tab and the problem list to the sitemap's
 * checks and the settings' Content types tab.
 *
 * A site that names its types (`collections`, `singles`) gets exactly those.
 * A site that names none gets every collection and Single it defines, Schema
 * Builder types included, which only the start knows: core's record of the
 * types the plugin's scope added the group to (`typesExtendedBy`), so a type
 * left out in the configuration, or one that kept a field of its own named
 * `seo`, is never among them.
 *
 * Read on each use rather than once, because a Schema Builder type gets the
 * group at the start after it is made, and a development reload can change
 * the configuration's types.
 *
 * @module seo-types
 */
import { typesExtendedBy } from "@nextlyhq/plugin-sdk";

import { singleKey } from "./problems/page-types";
import { SEO_PLUGIN_NAME } from "./settings/contract";
import { SEO_GROUP } from "./tab/typed";

/** The content types the `seo` group is on, read when asked. */
export interface SeoTypes {
  /** The collections, by slug. */
  readonly collections: readonly string[];
  /** The Singles, by slug. */
  readonly singles: readonly string[];
  /** Every one by the key its pages are kept under: a slug, or `single:<slug>`. */
  readonly keys: readonly string[];
  /**
   * Whether the site named its types, rather than leaving SEO on every type.
   * Parts that must be known before the site starts (declared permissions,
   * the dashboard card's gate) are built from the names only then.
   */
  readonly named: boolean;
}

/** The types a site named, fixed for as long as the plugin runs. */
export function namedSeoTypes(
  collections: readonly string[],
  singles: readonly string[]
): SeoTypes {
  const keys = [...collections, ...singles.map(singleKey)];
  return { collections, singles, keys, named: true };
}

/** The collections and Singles core says the plugin's scope added the group to. */
function extended(): { collections: string[]; singles: string[] } {
  const collections: string[] = [];
  const singles: string[] = [];
  for (const type of typesExtendedBy(SEO_PLUGIN_NAME, SEO_GROUP)) {
    (type.kind === "collection" ? collections : singles).push(type.slug);
  }
  return { collections, singles };
}

/** Every type the site defines that the scope reached, as the start resolved them. */
function everySeoType(): SeoTypes {
  return {
    get collections() {
      return extended().collections;
    },
    get singles() {
      return extended().singles;
    },
    get keys() {
      const { collections, singles } = extended();
      return [...collections, ...singles.map(singleKey)];
    },
    named: false,
  };
}

/** The options that say which types get SEO. */
export interface SeoTypeOptions {
  collections?: readonly string[];
  singles?: readonly string[];
  exclude?: readonly string[];
  include?: readonly string[];
  pagePermissions?: boolean;
}

/** Each slug once, in the order first given. */
const once = (slugs: readonly string[] | undefined): string[] => [
  ...new Set(slugs ?? []),
];

/**
 * Which types the options give SEO to. A site naming `collections` or
 * `singles` keeps exactly those; `include` and `exclude` say what to change
 * about every type, so beside a list they are refused rather than ignored.
 * Page permissions are declared per type before the site starts, so they
 * need the types named.
 */
export function seoTypesOf(options: SeoTypeOptions): SeoTypes {
  if (options.collections === undefined && options.singles === undefined) {
    if (options.pagePermissions === true) {
      throw new Error(
        "seoPlugin: pagePermissions declares a permission for each type when the site starts, " +
          "so it needs the types named in `collections` and `singles`."
      );
    }
    return everySeoType();
  }
  for (const name of ["include", "exclude"] as const) {
    if (options[name] !== undefined) {
      throw new Error(
        `seoPlugin: \`${name}\` applies where no \`collections\` or \`singles\` are named. ` +
          "Add the type to those lists, or take it out of them, instead."
      );
    }
  }
  // Each slug once: a repeated one would make the fold add `seo` twice (a
  // duplicate-field error), and list the same pages twice in the sitemap.
  return namedSeoTypes(once(options.collections), once(options.singles));
}

/** One `contributes.extend` clause adding `fields`. */
export interface SeoExtendClause<F> {
  target: string[] | { every: ("collection" | "single")[]; except?: string[] };
  fields: F[];
}

/**
 * The `extend` clauses that add the group: the named types where the site
 * names them, else every type, after a clause naming each included plugin
 * collection, which the scope then leaves out so no type gets it twice.
 */
export function seoExtendClauses<F>(
  options: SeoTypeOptions,
  types: SeoTypes,
  fields: F[]
): SeoExtendClause<F>[] {
  if (types.named) {
    return [{ target: [...types.collections, ...types.singles], fields }];
  }
  const include = once(options.include);
  const except = once([...once(options.exclude), ...include]);
  return [
    ...(include.length === 0 ? [] : [{ target: include, fields }]),
    {
      target: {
        every: ["collection", "single"],
        ...(except.length === 0 ? {} : { except }),
      },
      fields,
    },
  ];
}

/**
 * The types the `extend` clauses leave without the group: each the
 * every-type clause names under `except` that no clause naming types gives
 * the group instead. Read from the clauses themselves, so what the admin is
 * told is out is what the schema leaves out. Nothing is out where the site
 * names its types, since no clause then covers every type.
 */
export function typesLeftOut<F>(clauses: SeoExtendClause<F>[]): string[] {
  const given = new Set(
    clauses.flatMap(clause =>
      Array.isArray(clause.target) ? clause.target : []
    )
  );
  return clauses.flatMap(clause =>
    Array.isArray(clause.target)
      ? []
      : (clause.target.except ?? []).filter(slug => !given.has(slug))
  );
}
