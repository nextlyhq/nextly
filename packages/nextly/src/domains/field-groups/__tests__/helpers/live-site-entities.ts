/**
 * The site a running server and the storage migration share in the live-site suites: one
 * collection holding one code-first field group, declared once so the server process and the
 * suite boot the same entities. Imports nothing from the test runner, since the server process
 * runs it outside Vitest.
 *
 * @module domains/field-groups/__tests__/helpers/live-site-entities
 */
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../../config";

export const LIVE_COLLECTION = "fglive_posts";
export const LIVE_GROUP = "fglive_card";
/** The legacy table the group's rows live in before the migration. */
export const LIVE_LEGACY_TABLE = `comp_${LIVE_GROUP}`;

export const liveCard = defineFieldGroup({
  slug: LIVE_GROUP,
  fields: [text({ name: "heading" })],
});

export const livePosts = defineCollection({
  slug: LIVE_COLLECTION,
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "card", component: LIVE_GROUP }),
  ],
});

export const LIVE_DECLARED = {
  collections: [livePosts],
  fieldGroups: [liveCard],
};
