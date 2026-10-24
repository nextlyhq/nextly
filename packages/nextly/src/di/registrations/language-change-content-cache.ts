/**
 * What the language settings service flushes after a language change commits: every collection
 * and Single in the registries, and the registered cache revalidator.
 *
 * Each is resolved from the container when a change has committed, not when the service is
 * built: the service is registered before the collection and Single services, and a Next cache
 * adapter registers its revalidator at request time, long after boot.
 *
 * @module di/registrations/language-change-content-cache
 */
import type { LanguageChangeContentCache } from "../../domains/i18n/services/language-settings-service";
import type { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import type { CacheRevalidator } from "../../revalidation/types";
import type { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import { container } from "../container";

export function languageChangeContentCache(): LanguageChangeContentCache {
  return {
    // Both registries, read in full: a language change is a rare admin action, and the records
    // carry the `revalidate` opt-out the flush honours.
    content: async () => {
      const [collections, singles] = await Promise.all([
        container.has("collectionRegistryService")
          ? container
              .get<CollectionRegistryService>("collectionRegistryService")
              .getAllCollections()
          : [],
        container.has("singleRegistryService")
          ? container
              .get<SingleRegistryService>("singleRegistryService")
              .getAllSingles()
          : [],
      ]);
      return { collections, singles };
    },
    revalidator: () =>
      container.has("cacheRevalidator")
        ? container.get<CacheRevalidator>("cacheRevalidator")
        : undefined,
  };
}
