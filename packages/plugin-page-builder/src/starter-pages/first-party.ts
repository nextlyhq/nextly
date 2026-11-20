/**
 * The starter pages the page builder itself ships, listed beside the ones a
 * site and its plugins register, unless the site hides them with
 * `pageBuilder({ builtInStarterPages: false })`.
 *
 * Each is built from core blocks styled only with the site's variables, so
 * it takes the site's look wherever it is used (`first-party/parts`). Their
 * words are an example business's, written plainly, so a preview and a page
 * just made from one look finished; the author replaces them with their own.
 *
 * @module starter-pages/first-party
 */
import type { StarterPageDefinition } from "@nextlyhq/plugin-sdk/blocks";

import { ABOUT_STARTER } from "./first-party/about";
import { COMING_SOON_STARTER } from "./first-party/coming-soon";
import { CONTACT_STARTER } from "./first-party/contact";
import { LANDING_STARTER } from "./first-party/landing";
import { PRICING_STARTER } from "./first-party/pricing";

/** The page builder's own starter pages, in the order they are offered. */
export const FIRST_PARTY_STARTER_PAGES: readonly StarterPageDefinition[] = [
  LANDING_STARTER,
  ABOUT_STARTER,
  CONTACT_STARTER,
  PRICING_STARTER,
  COMING_SOON_STARTER,
];
