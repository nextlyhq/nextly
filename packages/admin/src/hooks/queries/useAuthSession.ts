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
import {
  type QueryClient,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  isAuthenticated as checkIsAuthenticated,
  SessionUnavailableError,
} from "@admin/lib/auth/session";
import {
  readSetupState,
  resetSetupStatusCache,
} from "@admin/lib/auth/setup-status";

/** The cache key every reader of the session shares. */
export const authSessionKey = ["auth", "session"] as const;

export interface AuthSession {
  /** Whether the installation has completed first-run setup. */
  isSetup: boolean;
  /** Whether this browser currently holds a valid session. */
  isAuthenticated: boolean;
}

async function verifyAuth(): Promise<AuthSession> {
  const setup = await readSetupState();
  // An installation with no setup has no session to check, and asking anyway
  // would report "not authenticated" for a reason that is not about the caller.
  if (setup.answered && !setup.isSetup) {
    return { isSetup: false, isAuthenticated: false };
  }
  // Throws SessionUnavailableError when the server could not answer, which
  // leaves the query in its error state rather than reporting "signed out".
  const isAuthenticated = await checkIsAuthenticated();
  // A signed-in user means setup is done whatever setup-status said. Signed
  // out with setup unanswered, the visitor could belong on login or on setup,
  // and guessing login would strand the very first visitor of a new install.
  if (!setup.answered && !isAuthenticated) {
    throw new SessionUnavailableError(null);
  }
  return { isSetup: true, isAuthenticated };
}

/** Retries a server that could not answer, twice; never a definite answer. */
function retrySessionCheck(failureCount: number, error: Error): boolean {
  return error instanceof SessionUnavailableError && failureCount < 2;
}

/**
 * The session, as one shared query.
 *
 * An unauthenticated answer is an ANSWER rather than a failure, so it is never
 * retried: that would delay every anonymous surface behind a result already
 * known. Only a server that could not answer is retried ({@link retrySessionCheck}).
 */
export function useAuthSession(): UseQueryResult<AuthSession> {
  return useQuery({
    queryKey: authSessionKey,
    queryFn: verifyAuth,
    staleTime: 5 * 60 * 1000, // don't re-verify on every navigation
    gcTime: 10 * 60 * 1000,
    retry: retrySessionCheck,
    refetchOnWindowFocus: false,
    refetchOnMount: false, // trust the cache within staleTime
  });
}

/**
 * Asks the server again with a new request, even while one is still out.
 *
 * A plain refetch joins the request already in flight when the query has no
 * data yet, and that is exactly the request a starting server is holding, so
 * "Try again" would only reset the message. Cancelling first makes the
 * refetch start a request of its own. Setup status keeps its own pending
 * request for every reader to share, so it is dropped too, or a hung
 * setup-status request would be joined the same way.
 */
export async function restartSessionCheck(
  queryClient: QueryClient
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: authSessionKey });
  resetSetupStatusCache();
  await queryClient.refetchQueries({ queryKey: authSessionKey });
}
