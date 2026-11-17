/**
 * The blocks Site text's Buttons and Captions rows reach.
 *
 * Headings, Body, Links and the `figcaption` element have an element of their
 * own, so the engine writes those rows in its element tier. A button does
 * not: the Button block draws an `a` or a `button` with its own default
 * typography (`inherit`, so both look alike), and the form draws its submit
 * as a part. A caption the Image block draws is a part with its own default
 * size. So these two rows are laid over the code's default styles of the
 * blocks that draw one, in the block-type default tier: below the site's
 * edit of a block's own style, a block style, a shared style and the block's
 * own values, and touching only the size and line height, so a button keeps
 * its padding and colours.
 *
 * @module site-text-blocks
 */
import {
  overlaidStyles,
  resolveSiteText,
  siteTextStyles,
  type BlockPart,
  type NodeStyles,
  type SiteTextMap,
  type SiteTextRole,
} from "@nextlyhq/blocks-engine";

/** Where a row lands: a block type's root, or one of its parts. */
interface Receiver {
  readonly type: string;
  readonly part?: string;
  readonly role: Extract<SiteTextRole, "button" | "caption">;
}

/**
 * Every block in this library that draws a button or a caption. A Gallery's
 * captions are its Images' own, and a caption in rich text is a
 * `figcaption`, which the element tier reaches. A Quote's attribution is a
 * `figcaption` too, but its part's own size comes after the element tier,
 * so the row is laid over the part as it is over an Image's caption.
 */
const RECEIVERS: readonly Receiver[] = [
  { type: "core/button", role: "button" },
  { type: "core/form", part: "submit", role: "button" },
  { type: "core/image", part: "caption", role: "caption" },
  { type: "core/quote", part: "attribution", role: "caption" },
];

/** What each receiving row writes, where the site set it. */
function rowStyles(
  siteText: SiteTextMap | undefined
): Partial<Record<Receiver["role"], NodeStyles>> {
  const rows = resolveSiteText(siteText);
  const out: Partial<Record<Receiver["role"], NodeStyles>> = {};
  for (const role of ["button", "caption"] as const) {
    const styles = siteTextStyles(role, rows[role]);
    if (styles !== undefined) out[role] = styles;
  }
  return out;
}

/**
 * The block types' default styles with the Buttons row laid over every type
 * whose root is a button. Only types the record already holds, which are the
 * ones the page draws; unchanged where the row is empty.
 */
export function withSiteTextBases(
  bases: Record<string, NodeStyles>,
  siteText: SiteTextMap | undefined
): Record<string, NodeStyles> {
  const rows = rowStyles(siteText);
  for (const { type, part, role } of RECEIVERS) {
    const styles = rows[role];
    if (part !== undefined || styles === undefined) continue;
    if (!Object.hasOwn(bases, type)) continue;
    bases[type] = overlaidStyles(bases[type], styles);
  }
  return bases;
}

/**
 * The block types' parts with the Buttons and Captions rows laid over each
 * part that draws a button or a caption. A new record wherever a row
 * applies, since the parts are the definitions' own objects.
 */
export function withSiteTextParts(
  parts: Record<string, Readonly<Record<string, BlockPart>>>,
  siteText: SiteTextMap | undefined
): Record<string, Readonly<Record<string, BlockPart>>> {
  const rows = rowStyles(siteText);
  for (const { type, part, role } of RECEIVERS) {
    const styles = rows[role];
    if (part === undefined || styles === undefined) continue;
    const own = Object.hasOwn(parts, type) ? parts[type] : undefined;
    const drawn =
      own !== undefined && Object.hasOwn(own, part) ? own[part] : undefined;
    if (own === undefined || drawn === undefined) continue;
    parts[type] = {
      ...own,
      [part]: {
        ...drawn,
        baseStyles: overlaidStyles(drawn.baseStyles, styles),
      },
    };
  }
  return parts;
}
