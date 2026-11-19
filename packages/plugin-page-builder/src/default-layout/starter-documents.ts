/**
 * What the starter header and footer hold: a plain header and footer built
 * only from core blocks, so a fresh site's first page already looks like a
 * website.
 *
 * - The header: the site's name linking home, the first five pages (oldest
 *   first) as links, and a "Contact us" button to `/contact`.
 * - The footer: the site's name, a "Pages" column with the first four pages,
 *   and "© <current year> <site name>".
 *
 * The name and the year come from the site binding source, so they follow
 * site settings without anyone editing the starter. The page links are a
 * Collection list of the pages collection, so they follow the pages.
 *
 * Every colour, padding and gap is a design variable (`$token`), never a
 * value, so the starter follows the site's light and dark values and its
 * spacing. Type is left to each block's own defaults, which the site's
 * typography sets. Two literals remain, neither a colour nor a spacing step:
 * the header's one-pixel rule, and the copyright line's word space in `em`,
 * which grows with the text it separates.
 *
 * @module default-layout/starter-documents
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import { sides, styled, token } from "../starter-style";

import type { StarterArea } from "./seed-names";

type Node = Record<string, unknown>;

/** What the site's name reads while site settings name none. */
export const SITE_NAME_FALLBACK = "Your site name";

/** The header's call to action. */
const CONTACT_LABEL = "Contact us";

/** Where the call to action leads: a plain address, edited like any link. */
const CONTACT_ADDRESS = "/contact";

/** How many pages the header links to. */
const HEADER_PAGE_LINKS = 5;

/** How many pages the footer's Pages column links to. */
const FOOTER_PAGE_LINKS = 4;

/** Oldest first, so a site's first pages lead. */
const OLDEST_FIRST = "createdAt";

/** A flex row that wraps onto more lines on a narrow screen. */
const row = (gap: string) => ({
  display: "flex",
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  gap: token(gap),
});

/** A flex column. */
const column = (gap: string) => ({
  display: "flex",
  flexDirection: "column",
  gap: token(gap),
});

/** A link drawn as text: no fill, no padding, in one of the site's colours. */
const textLink = (colour: string) => ({
  backgroundColor: "transparent",
  color: token(colour),
  padding: sides("0"),
});

function node(
  id: string,
  type: string,
  props: Record<string, unknown>,
  extra: Node = {}
): Node {
  return { id, type, version: 1, props, ...extra };
}

/** A plain box: a container for a row or a column. */
function box(
  id: string,
  styles: Record<string, unknown>,
  children: Node[]
): Node {
  return node(
    id,
    "core/box",
    { as: "div", contained: false },
    { styles: styled(styles), slots: { children } }
  );
}

/** The site's name, bound to site settings, with the words shown while unset. */
const siteNameBinding = {
  $bind: "applicationName",
  source: "site",
  fallback: SITE_NAME_FALLBACK,
} as const;

/**
 * The site's pages as links, at most `limit`, oldest first: a Collection list
 * of the pages collection, each entry its title linking to the page.
 */
function pageLinks(
  id: string,
  pagesCollection: string,
  limit: number,
  layout: Record<string, unknown>
): Node {
  return node(
    id,
    "core/collection-loop",
    {
      collection: pagesCollection,
      sort: OLDEST_FIRST,
      limit,
      as: "div",
      contained: false,
    },
    {
      styles: styled(layout),
      slots: {
        children: [
          node(
            `${id}-link`,
            "core/button",
            { label: "Page", entryCollection: pagesCollection },
            {
              bindings: {
                label: { $bind: "title", source: "item", fallback: "Page" },
                entryId: { $bind: "id", source: "item" },
              },
              styles: styled(textLink("color.muted")),
            }
          ),
        ],
      },
    }
  );
}

/** The starter header's tree. */
function headerNodes(pagesCollection: string): Node[] {
  const name = node(
    "starter-header-name",
    "core/button",
    { label: SITE_NAME_FALLBACK, href: "/" },
    {
      bindings: { label: siteNameBinding },
      styles: styled({ ...textLink("color.text"), fontWeight: 700 }),
    }
  );
  const pages = pageLinks(
    "starter-header-pages",
    pagesCollection,
    HEADER_PAGE_LINKS,
    row("space.stack")
  );
  const contact = node("starter-header-contact", "core/button", {
    label: CONTACT_LABEL,
    href: CONTACT_ADDRESS,
  });
  return [
    node(
      "starter-header",
      "core/section",
      { as: "header", contained: true },
      {
        styles: styled({
          backgroundColor: token("color.background"),
          padding: sides(token("space.stack"), token("space.gutter")),
          border: {
            width: {
              blockStart: "0",
              blockEnd: "1px",
              inlineStart: "0",
              inlineEnd: "0",
            },
            style: "solid",
            color: token("color.border"),
          },
        }),
        slots: {
          children: [
            box(
              "starter-header-bar",
              { ...row("space.columns"), justifyContent: "space-between" },
              [
                box("starter-header-start", row("space.columns"), [
                  name,
                  pages,
                ]),
                contact,
              ]
            ),
          ],
        },
      }
    ),
  ];
}

/** The starter footer's tree. */
function footerNodes(pagesCollection: string): Node[] {
  const name = node(
    "starter-footer-name",
    "core/text",
    { text: SITE_NAME_FALLBACK },
    {
      bindings: { text: siteNameBinding },
      styles: styled({ color: token("color.text"), fontWeight: 700 }),
    }
  );
  const pagesColumn = box(
    "starter-footer-pages-column",
    column("space.stack"),
    [
      node(
        "starter-footer-pages-title",
        "core/heading",
        { text: "Pages", level: "h2" },
        {
          // A heading for screen readers, drawn at the text's own size.
          styles: styled({
            color: token("color.text"),
            fontSize: "inherit",
            fontWeight: 700,
          }),
        }
      ),
      pageLinks(
        "starter-footer-pages",
        pagesCollection,
        FOOTER_PAGE_LINKS,
        column("space.stack")
      ),
    ]
  );
  const copyright = box(
    "starter-footer-copyright",
    // The three words of "© 2026 Acme", spaced as words are.
    {
      display: "flex",
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: "0.25em",
    },
    [
      node("starter-footer-copyright-mark", "core/text", { text: "©" }),
      node(
        "starter-footer-copyright-year",
        "core/text",
        { text: "" },
        { bindings: { text: { $bind: "currentYear", source: "site" } } }
      ),
      node(
        "starter-footer-copyright-name",
        "core/text",
        { text: SITE_NAME_FALLBACK },
        { bindings: { text: siteNameBinding } }
      ),
    ]
  );
  return [
    node(
      "starter-footer",
      "core/section",
      { as: "footer", contained: true },
      {
        styles: styled({
          backgroundColor: token("color.surface"),
          color: token("color.muted"),
          padding: sides(token("space.card"), token("space.gutter")),
          ...column("space.stack"),
        }),
        slots: {
          children: [
            box(
              "starter-footer-columns",
              { ...row("space.section-y"), alignItems: "flex-start" },
              [name, pagesColumn]
            ),
            copyright,
          ],
        },
      }
    ),
  ];
}

/**
 * The starter component's document for `area`, its links drawn from the
 * pages collection as the site RESOLVED it (a host may rename it).
 */
export function starterDocument(
  area: StarterArea,
  pagesCollection: string
): BlockDocument {
  const nodes =
    area === "header"
      ? headerNodes(pagesCollection)
      : footerNodes(pagesCollection);
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes,
  } as unknown as BlockDocument;
}
