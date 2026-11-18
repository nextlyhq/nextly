/**
 * The starter pages the page builder itself ships, listed beside the ones a
 * site and its plugins register, unless the site hides them with
 * `pageBuilder({ builtInStarterPages: false })`.
 *
 * Each is built from core blocks styled only with the site's variables, so
 * it takes the site's look wherever it is used. The set is empty until its
 * first pages are added; the mechanism that lists, previews and copies them
 * does not wait on it.
 *
 * @module starter-pages/first-party
 */
import type { StarterPageDefinition } from "@nextlyhq/plugin-sdk/blocks";

/** The page builder's own starter pages, in the order they are offered. */
export const FIRST_PARTY_STARTER_PAGES: readonly StarterPageDefinition[] = [];
