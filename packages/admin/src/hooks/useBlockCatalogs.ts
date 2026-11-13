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
import { useMemo } from "react";
import { z } from "zod";

import { writePluginRoute } from "@admin/hooks/queries/usePluginRouteMutation";
import { isApiError } from "@admin/lib/api/parseApiError";
import type {
  BlockCatalog,
  BlockCatalogItem,
} from "@admin/lib/builder/outline/block-rows";

/**
 * The listing's answer, parsed at the boundary rather than trusted: the
 * admin cannot import the plugin's own contract (the plugin depends on the
 * admin, not the other way), so a changed shape fails here and reads as a
 * listing that could not be read, never as blocks with fields missing.
 */
const LISTING = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      label: z.string(),
      description: z.string(),
      source: z.string().nullable(),
      matchedBy: z.array(z.string()),
      props: z.array(
        z.object({ name: z.string(), label: z.string(), type: z.string() })
      ),
    })
  ),
});

/**
 * Which blocks one allow-list admits, asked of the Page Builder. Sent in the
 * body of a POST that changes nothing, because the list need not fit in a
 * URL, exactly as stored, so the listing judges the policy a save judges;
 * `null` for a field naming none. The address follows the dispatcher's own
 * rule for a plugin route.
 */
async function readListing(
  allow: readonly string[] | undefined
): Promise<readonly BlockCatalogItem[]> {
  const answer = await writePluginRoute<object>({
    plugin: "@nextlyhq/plugin-page-builder",
    path: "/blocks/accepted",
    body: { allow: allow ?? null },
  });
  return LISTING.parse(answer).items;
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
      queryFn: () => readListing(allow),
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
