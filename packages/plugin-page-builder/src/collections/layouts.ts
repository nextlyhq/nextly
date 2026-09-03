/**
 * Named bundles saying which component fills each area around a page.
 *
 * A Layout is the only place the header/footer ROLE is stated. The components
 * it names are ordinary component definitions, so "Landing" pointing at the
 * same header as "Default" — under a different variant — is one row rather
 * than a second copy of the header.
 *
 * ## Areas are rows, not columns
 *
 * `areas` is a repeater of `{ area, component, variant }` rather than a
 * `header` column beside a `footer` column. Both shapes hold today's two
 * areas; they differ on the third. An announcement bar or a sidebar is a new
 * entry in the shared area list under the repeater, and a new column under the
 * other — so the shape that costs a migration per area is the one that makes
 * adding an area look expensive, which is the opposite of what this feature is
 * supposed to make cheap.
 *
 * A repeater also gives each row a real component picker in the admin, which a
 * single JSON column does not, and a relationship the database can see: a
 * component named by a Layout is a reference rather than an id inside a blob
 * nothing checks.
 *
 * ## There is no `isDefault` field here yet
 *
 * Which Layout a page ends up with is resolved through a chain — the site's
 * default, then the collection's, then the page's own override. None of that
 * chain is read by anything yet, and the site-default half needs a write path
 * rather than a flag: exactly one row may hold it, so setting it on one row has
 * to clear it from the others in the same transaction, the way a default email
 * provider is demoted. A boolean column with nothing enforcing that invariant
 * would let two rows both claim to be the default and leave whatever reads them
 * first to decide, so it lands with the resolver and the demotion, together.
 *
 * @module collections/layouts
 */
import type { RepeaterFieldValue } from "nextly/config";
import {
  defineCollection,
  relationship,
  repeater,
  select,
  text,
  textarea,
} from "nextly/config";

import { layoutAreaOptions } from "./areas";
import { COMPONENTS_SLUG } from "./components";

/** The slug layouts are stored under. */
export const LAYOUTS_SLUG = "layouts";

/**
 * Refuse a Layout that fills one area twice.
 *
 * Reads the rows rather than counting them: a row whose `area` is still empty
 * is the author mid-edit, and the `required` on that select is what speaks to
 * it. Only values actually chosen can collide.
 */
function rejectRepeatedAreas(value: RepeaterFieldValue): string | true {
  const chosen: string[] = [];
  for (const row of value ?? []) {
    const area = (row as { area?: unknown }).area;
    if (typeof area === "string" && area !== "") chosen.push(area);
  }

  const seen = new Set<string>();
  for (const area of chosen) {
    // Names the offending area rather than reporting that "an area" repeats.
    // The rows carry no visible index, so a message without the name leaves
    // the author scanning a list to find which two they have to reconcile.
    if (seen.has(area)) return `Two rows both fill the ${area} area`;
    seen.add(area);
  }
  return true;
}

/**
 * The plugin-owned `layouts` collection.
 *
 * Holds no blocks field. A Layout is a set of REFERENCES rather than a
 * document — nothing about it is authored on a canvas — so giving it a tree
 * would offer an editor for content it does not have.
 */
export function layoutsCollection() {
  return defineCollection({
    slug: LAYOUTS_SLUG,
    labels: { singular: "Layout", plural: "Layouts" },
    fields: [
      text({ name: "title", required: true }),
      text({ name: "slug", required: true, unique: true }),
      textarea({ name: "description" }),
      repeater({
        name: "areas",
        // An area is a POSITION, so two rows claiming one is not a richer
        // layout — it is a question with two answers. Without this the write
        // succeeds and the ambiguity is handed to the resolver, which will
        // pick whichever row it happens to reach first and render a second
        // header on every page carrying the Layout. Refused at the write
        // instead, where the author is still looking at the two rows.
        validate: rejectRepeatedAreas,
        fields: [
          select({
            name: "area",
            required: true,
            options: layoutAreaOptions(),
          }),
          relationship({
            name: "component",
            required: true,
            relationTo: COMPONENTS_SLUG,
          }),
          // Which of the component's named variants this Layout places. Left
          // empty to place the component as defined, which is what a Layout
          // that only wants the header does.
          text({ name: "variant" }),
        ],
      }),
    ],
    // A Layout decides what wraps every page assigned to it, so publishing one
    // is a site-wide act and gets the same draft-then-publish step a component
    // does.
    status: true,
    versions: { drafts: true },
    admin: { useAsTitle: "title" },
  });
}
