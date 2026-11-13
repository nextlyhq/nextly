/**
 * Whether a collection requires every language to hold its own value for each required translated
 * field before that language is published, as its code declares it (`requireEveryLanguage`).
 *
 * Read from the configuration the app booted with: the option is code-only, like a collection's
 * `access`, so a collection the Schema Builder made never requires it.
 *
 * @experimental
 *
 * @module domains/collections/services/require-every-language
 */
import { container } from "../../../di/container";
import type { NextlyServiceConfig } from "../../../di/register";

/** Whether the collection `slug` declares `requireEveryLanguage: true`. */
export function requiresEveryLanguage(slug: string): boolean {
  // A boot that registered no configuration declares no collection, so none requires it.
  if (!container.has("config")) return false;
  const collections =
    container.get<NextlyServiceConfig>("config").collections ?? [];
  return (
    collections.find(collection => collection.slug === slug)
      ?.requireEveryLanguage === true
  );
}
