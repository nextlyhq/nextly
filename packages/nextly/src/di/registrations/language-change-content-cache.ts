/**
 * What the language settings service flushes after a language change commits: every collection
 * and Single in the registries, by slug and `revalidate` setting, and the registered cache
 * revalidator.
 *
 * Each is resolved from the container when a change has committed, not when the service is
 * built: the service is registered before the collection and Single services, and a Next cache
 * adapter registers its revalidator at request time, long after boot.
 *
 * @module di/registrations/language-change-content-cache
 */
import type { LanguageChangeContentCache } from "../../domains/i18n/services/language-settings-service";
import type { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import { NoopRevalidator } from "../../revalidation/noop-revalidator";
import type { CacheRevalidator } from "../../revalidation/types";
import type { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import { container } from "../container";

export function languageChangeContentCache(): LanguageChangeContentCache {
  return {
    // Each registry's slugs and `revalidate` settings only: the opt-out and the extra tags are all
    // the flush reads of a record, and the rest of it (the fields JSON above all) is never needed.
    content: async () => {
      const [collections, singles] = await Promise.all([
        container.has("collectionRegistryService")
          ? container
              .get<CollectionRegistryService>("collectionRegistryService")
              .getAllRevalidateConfigs()
          : [],
        container.has("singleRegistryService")
          ? container
              .get<SingleRegistryService>("singleRegistryService")
              .getAllRevalidateConfigs()
          : [],
      ]);
      return { collections, singles };
    },
    // None where the registered revalidator is the one that flushes nothing (no Next runtime, the
    // CLI), so a language change there reads no registry at all.
    revalidator: () => {
      if (!container.has("cacheRevalidator")) return undefined;
      const revalidator = container.get<CacheRevalidator>("cacheRevalidator");
      return revalidator instanceof NoopRevalidator ? undefined : revalidator;
    },
  };
}
