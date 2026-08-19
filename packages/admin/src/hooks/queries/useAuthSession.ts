"use client";

/**
 * The admin's one answer to "is there a session, and is the installation set
 * up yet".
 *
 * Extracted so the route guard and the data providers ask the SAME query rather
 * than each verifying separately. Two verifications of one fact drift — and
 * here they would drift silently, because both would be right about the server
 * and wrong about each other, leaving a provider acting on a session the guard
 * had already replaced.
 *
 * Sharing the key is what makes it one request: a second caller mounting with
 * this key reads the same cache entry instead of issuing another `/auth/session`.
 *
 * @module hooks/queries/useAuthSession
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { isAuthenticated as checkIsAuthenticated } from "@admin/lib/auth/session";
import { checkSetupStatus } from "@admin/lib/auth/setup-status";

/** The cache key every reader of the session shares. */
export const authSessionKey = ["auth", "session"] as const;

export interface AuthSession {
  /** Whether the installation has completed first-run setup. */
  isSetup: boolean;
  /** Whether this browser currently holds a valid session. */
  isAuthenticated: boolean;
}

async function verifyAuth(): Promise<AuthSession> {
  const isSetup = await checkSetupStatus();
  // An installation with no setup has no session to check, and asking anyway
  // would report "not authenticated" for a reason that is not about the caller.
  if (!isSetup) return { isSetup: false, isAuthenticated: false };
  return { isSetup: true, isAuthenticated: await checkIsAuthenticated() };
}

/**
 * The session, as one shared query.
 *
 * `retry: false` because an unauthenticated answer is an ANSWER rather than a
 * failure, and retrying it would delay every anonymous surface behind a result
 * that is already known.
 */
export function useAuthSession(): UseQueryResult<AuthSession> {
  return useQuery({
    queryKey: authSessionKey,
    queryFn: verifyAuth,
    staleTime: 5 * 60 * 1000, // don't re-verify on every navigation
    gcTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false, // trust the cache within staleTime
  });
}
