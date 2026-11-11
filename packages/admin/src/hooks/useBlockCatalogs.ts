"use client";

/**
 * The registered blocks each blocks field accepts, read from the Page
 * Builder's block listing: one request per distinct allow-list, shared by
 * every field with that list.
 *
 * Which blocks a list admits is the server's answer, by the rule a save keeps
 * them by, never worked out here. A listing the admin cannot reach (the Page
 * Builder is not installed, or predates the listing) is said as such, apart
 * from a read that failed.
 */
import { useQueries } from "@tanstack/react-query";
import { pluginRouteFullPath } from "nextly/config";
import { useMemo } from "react";

import { isApiError } from "@admin/lib/api/parseApiError";
import { protectedApi } from "@admin/lib/api/protectedApi";
import type {
  BlockCatalog,
  BlockCatalogItem,
} from "@admin/lib/builder/outline/block-rows";

/**
 * Where the Page Builder answers its block listing, by the dispatcher's own
 * rule for a plugin route's address.
 */
const BLOCK_LISTING_PATH = pluginRouteFullPath(
  "@nextlyhq/plugin-page-builder",
  "/blocks"
);

/**
 * The listing's address for one allow-list; none asks for every block. The
 * list travels as JSON, exactly as stored, so no entry is split or trimmed
 * on the way and the listing judges the policy a save judges.
 */
function listingPath(allow: readonly string[] | undefined): string {
  return allow === undefined
    ? BLOCK_LISTING_PATH
    : `${BLOCK_LISTING_PATH}?allow=${encodeURIComponent(JSON.stringify(allow))}`;
}

/** The answer of one listing read, as the outline draws it. */
function catalogOf(query: {
  data?: readonly BlockCatalogItem[];
  error: unknown;
  isError: boolean;
}): BlockCatalog {
  if (query.data) return { state: "loaded", items: query.data };
  if (!query.isError) return { state: "loading" };
  return isApiError(query.error) && query.error.status === 404
    ? { state: "unavailable" }
    : { state: "failed" };
}

/** Each read's answer, combined once per change of the reads. */
function combineCatalogs(
  results: readonly {
    data?: readonly BlockCatalogItem[];
    error: unknown;
    isError: boolean;
  }[]
): BlockCatalog[] {
  return results.map(catalogOf);
}

export function useBlockCatalogs(
  /** Each distinct allow-list, by its `blockCatalogKey`. */
  allowLists: ReadonlyMap<string, readonly string[] | undefined>
): ReadonlyMap<string, BlockCatalog> {
  const keys = [...allowLists.keys()];
  const catalogs = useQueries({
    queries: [...allowLists].map(([key, allow]) => ({
      queryKey: ["page-builder", "block-listing", key],
      queryFn: async () =>
        (
          await protectedApi.get<{ items: BlockCatalogItem[] }>(
            listingPath(allow)
          )
        ).items,
      // Registered in code, so fixed while the app runs.
      staleTime: Infinity,
      retry: false,
    })),
    // A module-level function, so the combined answer keeps its identity
    // until a read's answer changes.
    combine: combineCatalogs,
  });
  const keyList = keys.join("\n");
  return useMemo(
    () => new Map(keyList.split("\n").map((key, i) => [key, catalogs[i]])),
    [keyList, catalogs]
  );
}
