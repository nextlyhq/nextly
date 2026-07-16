"use client";

import { useQuery } from "@tanstack/react-query";

import type { User } from "../types/user";

import { useApi } from "./useApi";

/**
 * Query key for the signed-in user. Anything that changes your own profile
 * (name, avatar) should invalidate this so the chrome reflects it immediately.
 */
export const currentUserKey = ["auth", "me"] as const;

/**
 * The signed-in user, for the dashboard chrome (avatar, name, email).
 *
 * Reads through the query cache rather than fetching into local state, so an
 * edit elsewhere can invalidate `currentUserKey` and have the header update
 * without a reload.
 *
 * @returns User data, loading state, and error state
 *
 * @example
 * ```tsx
 * const { user, isLoading, error } = useDashboardUser();
 *
 * if (isLoading) return <Skeleton />;
 * if (error) return <ErrorMessage />;
 * return <UserDisplay user={user} />;
 * ```
 */
export function useDashboardUser() {
  const { api } = useApi();

  const { data, isLoading, error } = useQuery({
    queryKey: currentUserKey,
    queryFn: async () => {
      const userData = await api.protected.get<User>("/me");
      return {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        // API uses `image` for avatar URL in the admin types
        avatar: userData.image ?? undefined,
      };
    },
  });

  return {
    user: data ?? null,
    isLoading,
    error: error ?? null,
  };
}
