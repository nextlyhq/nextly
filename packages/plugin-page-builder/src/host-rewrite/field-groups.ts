/**
 * The site's field groups as a walk reads them: by slug, each with the fields
 * its definition declares, so a document embedding a group of plain fields is
 * known to hold no copy of a component.
 *
 * The registry is what core builds a group's table and reads its schema from,
 * and a group declared in code is synced into it at start, so the registry's
 * definition wins for its slug: an admin may have edited a code-declared
 * group, adding a blocks field. The code's declaration answers only for a
 * slug the registry, read to the end, does not hold.
 *
 * Read to the end, or not at all. A registry that cannot be read, or that
 * holds more than the walk lists, may hold an edited definition for any slug,
 * so then NOTHING is resolved: every reference stays one that may hold a copy.
 * A slug no source knows answers `undefined` the same way.
 *
 * The registry lists by OFFSET, so a group removed behind the walk moves the
 * rest back and one is never read, and one added ahead of it is read twice.
 * The total the first page reports is held, as the Singles registry walk
 * holds its own: a page reporting another total, a page that ends short of
 * it, or a walk that ends with another number of groups than it is read as a
 * registry that could not be read to the end.
 *
 * @module host-rewrite/field-groups
 */
import type { FieldGroupDefinitions } from "../class-usage-blocks-fields";

/** One page of the registry, as the Direct API's `fieldGroups.find` lists it. */
export type FieldGroupPage = (
  offset: number,
  limit: number
) => Promise<{
  readonly items: readonly {
    readonly slug: string;
    readonly fields?: unknown;
  }[];
  readonly meta: { readonly total: number; readonly hasNext: boolean };
}>;

/** How many field groups one page of the registry lists. */
const FIELD_GROUPS_PER_PAGE = 200;

/** How many pages one walk reads before it stops, resolving nothing. */
const FIELD_GROUP_PAGES = 50;

/** What reading the site's field groups needs. */
export interface SiteFieldGroupsArgs {
  /** One page of the registry, from `offset`. */
  readonly page: FieldGroupPage;
  /** The groups declared in code, by slug. */
  readonly inCode: FieldGroupDefinitions;
  /** Told when the registry could not be read to the end. */
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
  /** How many pages may be read; the default is {@link FIELD_GROUP_PAGES}. */
  readonly pages?: number;
  /** How many groups a page lists; the default is {@link FIELD_GROUPS_PER_PAGE}. */
  readonly perPage?: number;
}

/** Resolves nothing: every reference stays one that may hold a copy. */
const NOTHING: FieldGroupDefinitions = () => undefined;

/** The site's field groups, read once, as the module docblock says. */
export async function readSiteFieldGroups(
  args: SiteFieldGroupsArgs
): Promise<FieldGroupDefinitions> {
  try {
    const registry = await readRegistry(args);
    if (registry === null) return NOTHING;
    return slug => registry.get(slug) ?? args.inCode(slug);
  } catch (error) {
    args.warn(
      "[page-builder] the field-group registry could not be read, so no field group is read through its definition",
      { error }
    );
    return NOTHING;
  }
}

/** The registry by slug, read to the end; null, told, where it wasn't. */
async function readRegistry(
  args: SiteFieldGroupsArgs
): Promise<Map<string, { readonly fields?: unknown }> | null> {
  const registry = new Map<string, { readonly fields?: unknown }>();
  const pages = args.pages ?? FIELD_GROUP_PAGES;
  const perPage = args.perPage ?? FIELD_GROUPS_PER_PAGE;
  let expected: number | undefined;
  let read = 0;
  for (let page = 0; ; page += 1) {
    if (page >= pages) {
      args.warn(
        "[page-builder] the field-group registry holds more groups than a walk lists, so no field group is read through its definition",
        { pages }
      );
      return null;
    }
    const listed = await args.page(page * perPage, perPage);
    const total = listed.meta.total;
    expected ??= total;
    read += listed.items.length;
    const atTheEnd = read >= expected || !listed.meta.hasNext;
    if (
      !Number.isInteger(total) ||
      total !== expected ||
      (atTheEnd ? read !== expected : listed.items.length < perPage)
    ) {
      args.warn(
        "[page-builder] the field-group registry changed while it was read, so no field group is read through its definition",
        { expected, total, read }
      );
      return null;
    }
    for (const group of listed.items) {
      registry.set(group.slug, { fields: group.fields });
    }
    if (atTheEnd) break;
  }
  if (registry.size !== expected) {
    args.warn(
      "[page-builder] the field-group registry listed a group twice, so no field group is read through its definition",
      { expected, read: registry.size }
    );
    return null;
  }
  return registry;
}
