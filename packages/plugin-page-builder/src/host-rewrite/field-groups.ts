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
 * @module host-rewrite/field-groups
 */
import type { FieldGroupDefinitions } from "../class-usage-blocks-fields";

/** One page of the registry, as the Direct API's `fieldGroups.find` lists it. */
export type FieldGroupPage = (offset: number) => Promise<{
  readonly items: readonly {
    readonly slug: string;
    readonly fields?: unknown;
  }[];
  readonly meta: { readonly hasNext: boolean };
}>;

/** How many field groups one page of the registry lists. */
export const FIELD_GROUPS_PER_PAGE = 200;

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
}

/** Resolves nothing: every reference stays one that may hold a copy. */
const NOTHING: FieldGroupDefinitions = () => undefined;

/** The site's field groups, read once, as the module docblock says. */
export async function readSiteFieldGroups(
  args: SiteFieldGroupsArgs
): Promise<FieldGroupDefinitions> {
  const registry = new Map<string, { readonly fields?: unknown }>();
  const pages = args.pages ?? FIELD_GROUP_PAGES;
  try {
    for (let page = 0; ; page += 1) {
      if (page >= pages) {
        args.warn(
          "[page-builder] the field-group registry holds more groups than a walk lists, so no field group is read through its definition",
          { pages }
        );
        return NOTHING;
      }
      const listed = await args.page(page * FIELD_GROUPS_PER_PAGE);
      for (const group of listed.items) {
        registry.set(group.slug, { fields: group.fields });
      }
      if (!listed.meta.hasNext) break;
    }
  } catch (error) {
    args.warn(
      "[page-builder] the field-group registry could not be read, so no field group is read through its definition",
      { error }
    );
    return NOTHING;
  }
  return slug => registry.get(slug) ?? args.inCode(slug);
}
