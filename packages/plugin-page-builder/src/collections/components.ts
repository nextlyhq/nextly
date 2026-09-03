/**
 * Definitions an author builds once and places many times.
 *
 * A component is placed by REFERENCE: a page stores one node naming this
 * document, and the tree is resolved when the page is read. So editing a
 * component changes every page carrying it, which is the property patterns
 * deliberately do not have.
 *
 * ## A header is a component
 *
 * There is no separate document kind for a site header or footer. A Layout
 * names which component fills each of its areas, so the ROLE lives on the
 * placement rather than on the document, and a header inherits everything a
 * component has: per-instance editable fields, variants, drafts, a usage count.
 *
 * The alternative — a second document type for regions — was measured against
 * the products that ship it, and the same complaint follows every one of them:
 * a region built as a weaker thing cannot be edited by the people who need to
 * edit it, because the machinery that makes a component editable was never
 * built twice. Adding an announcement bar or a sidebar later is a new AREA on
 * the Layout, not a new kind of document.
 *
 * `area` below is the hint that keeps the two uses apart in the UI without
 * making them different things.
 *
 * @module collections/components
 */
import { defineCollection, select, text, textarea } from "nextly/config";

import { blocks } from "../fields/blocksHelper";

import { layoutAreaOptions } from "./areas";

/** The slug component definitions are stored under. */
export const COMPONENTS_SLUG = "components";

/**
 * The plugin-owned `components` collection.
 *
 * Takes no options, for the reason patterns takes none: a component is never
 * served at an address of its own. It reaches a visitor only inside a page or
 * a Layout, so it has no preview path and nothing for a host to configure.
 */
export function componentsCollection() {
  return defineCollection({
    slug: COMPONENTS_SLUG,
    labels: { singular: "Component", plural: "Components" },
    fields: [
      text({ name: "title", required: true }),
      text({ name: "slug", required: true, unique: true }),
      textarea({ name: "description" }),
      text({ name: "category" }),
      // Which Layout position this component suits, if any. It orders the
      // pickers and does not gate them: a component marked `header` can still
      // be placed inline on a page that wants its navigation baked in, and one
      // marked for nothing is an ordinary in-page component offered
      // everywhere.
      select({ name: "area", options: layoutAreaOptions() }),
      blocks({
        name: "content",
        label: "Component",
        blocks: { kinds: ["component"] },
      }),
    ],
    // The published/draft split is what separates editing a component from
    // shipping it. A page read for a visitor resolves the PUBLISHED
    // definition, so an author can rework a header for as long as they like
    // without every page carrying the work in progress; publishing is the
    // single act that moves it to every one of them.
    status: true,
    versions: { drafts: true },
    admin: { useAsTitle: "title" },
  });
}
