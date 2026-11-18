/**
 * What the site's text says against removing a variable: a Site text row
 * pointing at it would lose its size, or its colour, on every page once the
 * variable is gone. Read by the variables remove route and by every other
 * write of the site style that drops a variable, so the two refuse with the
 * same words.
 *
 * Its own module because both of those readers import it, and the site
 * style's storage cannot import the routes built on it.
 *
 * @module site-text-uses
 */
import {
  isPlainRecord,
  resolveTokenPrefix,
  SITE_TEXT_LABELS,
  siteTextUses,
  tokenCustomProperty,
  type SiteTextRole,
} from "@nextlyhq/blocks-engine";

/**
 * One reason against a removal, in the shape the removal refusals read.
 * Stated here rather than imported: this module is reached from the browser
 * entries through the site style's storage, and the routes that declare the
 * shape are not.
 */
interface SiteTextReason {
  readonly id: string;
  readonly message: string;
  readonly used: true;
}

/**
 * The Site text rows using a variable, by its identity: pointed at by its
 * identity, or read through `var()` of its custom property under the set's
 * prefix. `section` is a token set, stored or merged, read whether or not
 * anything validated it. The one reading the refusals and the usage count
 * share.
 */
export function siteTextRowsUsing(
  section: unknown
): (id: string) => readonly SiteTextRole[] {
  const read = isPlainRecord(section) ? section : {};
  const siteText = isPlainRecord(read.siteText) ? read.siteText : undefined;
  const uses = siteTextUses(siteText);
  const { prefix } = resolveTokenPrefix(
    typeof read.prefix === "string" ? read.prefix : undefined
  );
  return id => [
    ...new Set([
      ...(uses.get(id) ?? []),
      ...(uses.get(tokenCustomProperty(id, prefix)) ?? []),
    ]),
  ];
}

/**
 * The reasons the site's text gives against removing each variable, naming
 * the rows ("Display is used by Site text: Heading 1."). `section` is the
 * stored token set as the write would leave it, its rows and its prefix,
 * read whether or not anything validated it.
 */
export function siteTextReasons(
  removable: readonly { readonly id: string; readonly name: string }[],
  section: unknown
): SiteTextReason[] {
  const rowsUsing = siteTextRowsUsing(section);
  return removable.flatMap(({ id, name }) => {
    const roles = rowsUsing(id);
    if (roles.length === 0) return [];
    const rows = roles.map(role => SITE_TEXT_LABELS[role]).join(", ");
    return [
      {
        id,
        message: `${name} is used by Site text: ${rows}.`,
        used: true as const,
      },
    ];
  });
}
