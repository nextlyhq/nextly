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

import { currentUserKey, fetchDashboardUser } from "./useDashboardUser";
import { useApi } from "./useApi";

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
 * browser) and refresh the user it is read from.
 */
export function useSetInterfaceLanguage(): (language: string | null) => void {
  const { api } = useApi();
  const queryClient = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: (interfaceLanguage: string | null) =>
      api.protected.patch("/me", { interfaceLanguage }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: currentUserKey }),
  });
  return mutate;
}
