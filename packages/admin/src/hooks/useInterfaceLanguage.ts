"use client";

/**
 * The signed-in person's own interface language: reading it, and setting it
 * through their own profile (`PATCH /me`), the one place it is set.
 *
 * Read through the same query as the chrome's user (`currentUserKey`), so the
 * menu, the header and the interface language agree on one answer and a save
 * refreshes all three at once.
 *
 * @module hooks/useInterfaceLanguage
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import { getErrorMessage } from "@admin/lib/errors/error-types";
import { useT } from "@admin/lib/i18n/I18nProvider";

import { useApi } from "./useApi";
import { currentUserKey, fetchDashboardUser } from "./useDashboardUser";

/**
 * The stored interface language: a language tag, `null` to follow the
 * browser, or `undefined` while unknown (not yet read, or not asked for).
 *
 * @param enabled - Whether to ask: false on the signed-out screens, where
 *   there is nobody to ask about and `/me` could only fail.
 */
export function useStoredInterfaceLanguage(
  enabled: boolean
): string | null | undefined {
  const { api } = useApi();
  const { data } = useQuery({
    queryKey: currentUserKey,
    queryFn: () => fetchDashboardUser(api),
    enabled,
  });
  return data?.interfaceLanguage;
}

/**
 * Save the person's own interface language (a tag, or `null` to follow the
 * browser) and refresh the user it is read from. A save that fails says so,
 * with the server's reason, since the menu has closed by then and the person
 * would otherwise take the choice as made.
 */
export function useSetInterfaceLanguage(): (language: string | null) => void {
  const { api } = useApi();
  const queryClient = useQueryClient();
  const t = useT();
  const { mutate } = useMutation({
    mutationFn: (interfaceLanguage: string | null) =>
      api.protected.patch("/me", { interfaceLanguage }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: currentUserKey }),
    onError: error =>
      toast.error(t("nextly.userMenu.saveFailed"), {
        description: getErrorMessage(error),
      }),
  });
  return mutate;
}
