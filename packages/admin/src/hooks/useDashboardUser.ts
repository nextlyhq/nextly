"use client";

import { useQuery } from "@tanstack/react-query";

import type { User } from "../types/user";

import { useApi } from "./useApi";

/**
 * Query key for the signed-in user. Anything that changes your own profile
 * (name, avatar) should invalidate this so the chrome reflects it immediately.
 */
export const currentUserKey = ["auth", "me"] as const;

/** The signed-in user as the chrome and the interface language read them. */
export interface DashboardUser {
  id: string;
  name: string;
  email: string;
  // API uses `image` for avatar URL in the admin types
  avatar: string | undefined;
  /** Their own interface language; null follows the browser, then English. */
  interfaceLanguage: string | null;
}

/**
 * Read the signed-in user from `GET /me`. The one fetch behind
 * `currentUserKey`, so every reader of that key caches the same shape.
 */
export async function fetchDashboardUser(
  api: ReturnType<typeof useApi>["api"]
): Promise<DashboardUser> {
  const userData = await api.protected.get<User>("/me");
  return {
    id: userData.id,
    name: userData.name,
    email: userData.email,
    avatar: userData.image ?? undefined,
    interfaceLanguage: userData.interfaceLanguage ?? null,
  };
}

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
export function useDashboardUser(): {
  user: DashboardUser | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { api } = useApi();

  const { data, isLoading, error } = useQuery({
    queryKey: currentUserKey,
    queryFn: () => fetchDashboardUser(api),
  });

  return {
    user: data ?? null,
    isLoading,
    error: error ?? null,
  };
}
