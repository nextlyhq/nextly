/**
 * Linked entries — an e2e fixture, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`.
 *
 * A collection embedding the link card and the dynamic zone of
 * `related-link-groups`, so the browser test of a related item the editor
 * cannot read covers field groups on an entry as well as on a Single.
 */
import { defineCollection, text } from "nextly/config";

import { relatedLinkGroupFields } from "../field-groups/related-link-groups";

export const LinkedEntries = defineCollection({
  slug: "linked-entries",
  labels: { singular: "Linked entry", plural: "Linked entries" },
  fields: [
    text({ name: "title", label: "Title" }),
    ...relatedLinkGroupFields(),
  ],
});
