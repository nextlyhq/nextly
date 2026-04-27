import { useState, useEffect } from "react";

import type { User } from "../types/user";

import { useApi } from "./useApi";

/**
 * Custom hook to fetch and manage dashboard user information
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
  const [user, setUser] = useState<{
    id: string;
    name: string;
    email: string;
    avatar?: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { api } = useApi();

  useEffect(() => {
    async function fetchUser() {
      try {
        setIsLoading(true);
        setError(null);

        const userData = await api.protected.get<User>("/me");

        setUser({
          id: userData.id,
          name: userData.name,
          email: userData.email,
          // API uses `image` for avatar URL in the admin types
          avatar: userData.image ?? undefined,
        });
      } catch (err) {
        console.error("User data fetch failed:", err);
        setError(
          err instanceof Error ? err : new Error("Failed to fetch user data")
        );
      } finally {
        setIsLoading(false);
      }
    }

    fetchUser();
    // Reason: api is stable from useApi() — including it would cause unnecessary
    // re-fetches. This effect should only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    user,
    isLoading,
    error,
  };
}
