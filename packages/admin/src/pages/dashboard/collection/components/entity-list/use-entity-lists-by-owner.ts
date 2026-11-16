import type { ListResponse, TableParams } from "@nextlyhq/ui";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { ListOwner } from "@admin/services/list-owner";

/**
 * Reads one page of a list of collections, Singles or field groups for one
 * owner. Each list's own fetcher, which sends the owner to the server.
 */
export type OwnedListFetcher<Row> = (
  params: TableParams,
  owner: ListOwner
) => Promise<ListResponse<Row>>;

/**
 * Everything a list request depends on, as one stable value: page, size,
 * search, sort and the server-side filters. Each of these changes the rows
 * the server answers with, so each has to change the cache key too.
 */
function paramsKey(params: TableParams): string {
  return JSON.stringify({
    page: params.pagination.page,
    pageSize: params.pagination.pageSize,
    search: params.filters?.search ?? "",
    sorting: params.sorting ?? [],
    filters: params.filters?.filters ?? {},
  });
}

/**
 * One page of the SITE's own entities: what the list's table shows. The
 * plugins' entities are left out by the server, so the page and its count
 * describe the same rows.
 *
 * `listKey` is the entity's `lists()` key: the entry sits under it, so
 * whatever refreshes that entity's lists after a create, change or delete
 * refreshes this too.
 */
export function useSiteEntityPage<Row>(
  listKey: readonly unknown[],
  params: TableParams,
  fetchPage: OwnedListFetcher<Row>
): UseQueryResult<ListResponse<Row>, Error> {
  return useQuery<ListResponse<Row>, Error>({
    queryKey: [...listKey, "owner", "site", paramsKey(params)],
    queryFn: () => fetchPage(params, "site"),
  });
}

/** The page size the plugins' entities are read in. */
const PLUGIN_PAGE_SIZE = 100;

/**
 * The most pages of plugin entities read: past it, a server still saying
 * there is more is answered with an error rather than read for ever.
 */
const MAX_PLUGIN_PAGES = 50;

/**
 * Every one of the PLUGINS' entities this reader may read, however many
 * pages that takes: each plugin's section lists all of its own, not the
 * share that fell on one page.
 */
export function usePluginEntities<Row>(
  listKey: readonly unknown[],
  fetchPage: OwnedListFetcher<Row>
): UseQueryResult<Row[], Error> {
  return useQuery<Row[], Error>({
    queryKey: [...listKey, "owner", "plugins", "every"],
    queryFn: async () => {
      const rows: Row[] = [];
      for (let page = 0; page < MAX_PLUGIN_PAGES; page++) {
        const response = await fetchPage(
          {
            pagination: { page, pageSize: PLUGIN_PAGE_SIZE },
            sorting: [],
            filters: {},
          },
          "plugins"
        );
        rows.push(...response.items);
        if (response.meta?.hasNext !== true) return rows;
      }
      throw new Error("Unable to load every plugin entry");
    },
  });
}
