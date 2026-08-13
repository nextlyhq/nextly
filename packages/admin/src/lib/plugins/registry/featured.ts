/**
 * The curated first screen, in order.
 *
 * A list rather than a flag per entry, so the whole editorial decision reads
 * top to bottom in one place instead of being spread across every entry.
 *
 * The cap is asserted in the test rather than stated in a comment, because a
 * comment does not fail a build and a strip that grows to eight has stopped
 * being a recommendation.
 *
 * @module lib/plugins/registry/featured
 */
export const FEATURED_IDS: string[] = [
  "@nextlyhq/plugin-page-builder",
  "@nextlyhq/plugin-form-builder",
];
