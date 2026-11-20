/**
 * The site's languages for Settings › Languages: the list, what making one the
 * default would touch, and one change at a time.
 *
 * Query keys:
 * - `["languages", "list"]`: the languages and whether the configuration locks them
 * - `["languages", "default-preview", code]`: what making `code` the default touches
 *
 * @module hooks/queries/useLanguageSettings
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuthSession } from "@admin/hooks/queries/useAuthSession";
import { ADMIN_WORKSPACE_KEY } from "@admin/hooks/useSchemaUpdateInvalidation";
import {
  changeLanguages,
  listLanguages,
  previewDefaultChange,
} from "@admin/services/languagesApi";
import type {
  DefaultChangeSummary,
  LanguageChange,
  LanguageList,
} from "@admin/types/languages";

const languageKeys = {
  all: () => ["languages"] as const,
  list: () => [...languageKeys.all(), "list"] as const,
  defaultPreviews: () => [...languageKeys.all(), "default-preview"] as const,
  defaultPreview: (code: string) =>
    [...languageKeys.defaultPreviews(), code] as const,
};

/**
 * The languages. Asked only of a signed-in session, as the other settings are:
 * the route answers a visitor 401, and a refused query is asked again by every
 * reader that mounts after it.
 */
export function useLanguageList(): UseQueryResult<LanguageList, Error> {
  const { data: session } = useAuthSession();
  return useQuery<LanguageList, Error>({
    queryKey: languageKeys.list(),
    queryFn: listLanguages,
    enabled: session?.isAuthenticated === true,
    // Another admin, or another server, may have changed the list since.
    refetchOnMount: "always",
  });
}

/**
 * What making `code` the default would touch, or nothing while `code` is
 * undefined. Asked of the current default, it is how much content each
 * language holds, since that change touches nothing. Always read fresh: the
 * counts and the pending changes move with every save.
 */
export function useDefaultChangePreview(
  code: string | undefined
): UseQueryResult<DefaultChangeSummary, Error> {
  const { data: session } = useAuthSession();
  return useQuery<DefaultChangeSummary, Error>({
    queryKey: languageKeys.defaultPreview(code ?? ""),
    queryFn: () => previewDefaultChange(code ?? ""),
    enabled: session?.isAuthenticated === true && code !== undefined,
    refetchOnMount: "always",
  });
}

/**
 * Makes one change. The answer is the list after it, so it replaces the cached
 * list at once. Every summary read before it is stale, and so is the admin's
 * workspace, whose language list the editor and the rail read.
 */
export function useChangeLanguages(): UseMutationResult<
  LanguageList,
  Error,
  LanguageChange
> {
  const queryClient = useQueryClient();
  return useMutation<LanguageList, Error, LanguageChange>({
    mutationFn: change => changeLanguages(change),
    onSuccess: async list => {
      queryClient.setQueryData(languageKeys.list(), list);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: languageKeys.defaultPreviews(),
        }),
        queryClient.invalidateQueries({ queryKey: ADMIN_WORKSPACE_KEY }),
      ]);
    },
  });
}
