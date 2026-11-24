/**
 * The site a running server and the storage migration share in the live-site suites: one
 * collection holding one code-first field group, translated, declared once so the server process
 * and the suite boot the same entities. Imports nothing from the test runner, since the server process
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

/** The site's languages: the group's translations live in a companion table beside its own. */
export const LIVE_LOCALIZATION = { locales: ["en", "de"], defaultLocale: "en" };

export const liveCard = defineFieldGroup({
  slug: LIVE_GROUP,
  // Translated, so a read takes its translations from the companion table, which the migration
  // renames with the group's own.
  localized: true,
  fields: [
    text({ name: "heading" }),
    text({ name: "tagline", localized: true }),
  ],
});

export const livePosts = defineCollection({
  slug: LIVE_COLLECTION,
  // Each save keeps a version, whose snapshot carries the group under its wire key: rows the
  // storage migration's content rewrite has to rewrite.
  versions: true,
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "card", component: LIVE_GROUP }),
  ],
});

export const LIVE_DECLARED = {
  collections: [livePosts],
  fieldGroups: [liveCard],
};
