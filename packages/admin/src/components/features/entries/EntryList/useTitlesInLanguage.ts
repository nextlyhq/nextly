/**
 * The titles of the rows on screen in a language the reader chose, for the entry list's
 * "Titles in" control.
 *
 * A read of its own, beside the list's: the page's rows by id, in that language, with no
 * fallback and no relations. Its own rather than the list read sent in that language, for two
 * reasons. The list read asks every language's state and is judged in every language, so a
 * reader the server lets read Spanish but not every language would lose the whole list for
 * choosing Spanish titles. And with no fallback, a title the language does not have comes back
 * empty instead of as the default language's, so the list never presents a default title as a
 * translation.
 *
 * The server judges this read for that language and for each row, as any read: a row it may not
 * show in that language is not returned, a field it may not show is not in the row, and a
 * language it may not show refuses the read. The list shows a title in the chosen language only
 * where this read returned one.
 *
 * @module components/features/entries/EntryList/useTitlesInLanguage
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { shouldRetryQuery } from "@admin/lib/api/query-retry";
import { entryApi, entryKeys, type FindParams } from "@admin/services/entryApi";

export interface TitlesInLanguage {
  /**
   * Each returned row's title in the language, by id. A row the read did not return is absent.
   * Undefined while no language is chosen or the read has not answered; empty once it failed.
   */
  titles: ReadonlyMap<string, unknown> | undefined;
  /** Whether the read in that language was refused or failed. */
  failed: boolean;
}

export function useTitlesInLanguage({
  collectionSlug,
  locale,
  titleField,
  ids,
  enabled,
}: {
  collectionSlug: string;
  /** The language chosen. */
  locale: string;
  /** The field the list's title column shows; none leaves nothing to read. */
  titleField: string | undefined;
  /** The rows on screen, by id. */
  ids: readonly string[];
  /** Whether a language other than the default is chosen. */
  enabled: boolean;
}): TitlesInLanguage {
  // An empty `in` is refused by the server, and there is nothing to read anyway.
  const asked = enabled && ids.length > 0 && titleField !== undefined;
  const query = useQuery({
    // Under the collection's list keys, so whatever refreshes the list after a change refreshes
    // these titles too.
    queryKey: [
      ...entryKeys.listsByCollection(collectionSlug),
      "titles-in",
      locale,
      titleField,
      ids,
    ],
    queryFn: () => {
      const params: FindParams = {
        page: 1,
        limit: ids.length,
        status: "all",
        where: { id: { in: [...ids] } },
        locale,
        fallbackLocale: "none",
        depth: 0,
      };
      return entryApi.find(collectionSlug, params);
    },
    enabled: asked,
    staleTime: 30_000,
    // The admin's own rule for a read, whatever the client's default: a refusal is the server's
    // answer for this reader and language and is not asked again, while a failure another try
    // may answer differently (no response, a timeout, a server error) is.
    retry: shouldRetryQuery,
  });
  const failed = asked && query.isError;
  const titles = useMemo(() => {
    if (!asked || titleField === undefined) return undefined;
    // A read that failed again offers nothing, even where an earlier one answered: the query
    // keeps that earlier answer, and its titles may be ones the reader may no longer read.
    if (failed) return new Map<string, unknown>();
    return query.data
      ? new Map(
          query.data.items.map(item => [String(item.id), item[titleField]])
        )
      : undefined;
  }, [asked, failed, query.data, titleField]);
  return { titles, failed };
}
