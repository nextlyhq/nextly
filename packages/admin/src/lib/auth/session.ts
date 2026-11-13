import { BASE_URL } from "../api/fetcher";
import { authFetch } from "../api/refreshInterceptor";
import { takeStartupResponse } from "../api/startup-request";

// ─── In-memory session cache ───────────────────────────────────────────────
// Shared across all callers (React Query, imperative checks, etc.)
// Prevents duplicate network requests within the cache window.

interface SessionUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  /**
   * The roles the session's token was minted with. Absent where the app's
   * own `determineUser` resolved the person, which names no roles.
   */
  roleIds?: string[];
  [key: string]: unknown;
}

interface Session {
  user?: SessionUser;
  [key: string]: unknown;
}

/**
 * The server could not say whether there is a session: it answered with an
 * error other than "not signed in" (a 5xx, 504 or 429), or the request never
 * reached it.
 *
 * Kept apart from "signed out" on purpose. A server that is still starting
 * answers late or with a 5xx, and reading that as "no session" would send a
 * signed-in person to the login screen; the admin shows the server as
 * unavailable instead and lets them try again.
 */
export class SessionUnavailableError extends Error {
  constructor(readonly status: number | null) {
    super(
      status === null
        ? "The server could not be reached."
        : `The server answered ${status}.`
    );
    this.name = "SessionUnavailableError";
  }
}

/** Only these answers mean the request reached the server and holds no session. */
function isSignedOutStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Whether a refusal says the access token has expired, which a refresh can
 * answer, rather than that nobody is signed in.
 */
function isExpiredToken(body: unknown): boolean {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return code === "TOKEN_EXPIRED";
}

let cachedSession: Session | null = null;
let cacheTimestamp = 0;
const SESSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes (matches React Query staleTime)

function isCacheValid(): boolean {
  return (
    cachedSession !== null && Date.now() - cacheTimestamp < SESSION_CACHE_TTL
  );
}

/**
 * The session, or `null` when the server says there is none.
 *
 * @throws SessionUnavailableError when the server could not answer the
 * question, so the caller can tell "signed out" from "not answered yet".
 */
export async function getSession(): Promise<Session | null> {
  if (isCacheValid()) {
    return cachedSession;
  }

  let response: Response;
  try {
    // From the startup request when it carries the answer: a session, or the
    // plain "signed out". An expired token is left to the request below, whose
    // own handling refreshes it.
    const fromStartup = await takeStartupResponse(
      "/auth/session",
      part =>
        (part.status >= 200 && part.status < 300) ||
        (isSignedOutStatus(part.status) && !isExpiredToken(part.body))
    );
    response =
      fromStartup ??
      (await authFetch(`${BASE_URL}/auth/session`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      }));
  } catch {
    throw new SessionUnavailableError(null);
  }

  if (!response.ok) {
    if (!isSignedOutStatus(response.status)) {
      // Not cached: the next ask goes back to the server, which may be up by then.
      throw new SessionUnavailableError(response.status);
    }
    cachedSession = null;
    cacheTimestamp = Date.now();
    return null;
  }

  let json: { data?: Session } & Session;
  try {
    json = await response.json();
  } catch {
    // An OK status with a body that isn't JSON is a proxy or platform page in
    // front of the server, not the server's answer.
    throw new SessionUnavailableError(response.status);
  }
  // New custom auth returns { data: { user: { ... } } }
  const session: Session = json.data || json;
  cachedSession = session;
  cacheTimestamp = Date.now();
  return session;
}

/**
 * Check if user is authenticated by validating session with the server.
 * Custom auth uses stateless JWT -- if the session endpoint returns a user, they're authenticated.
 *
 * @throws SessionUnavailableError when the server could not answer.
 */
export async function isAuthenticated(): Promise<boolean> {
  return (await sessionStanding()).isAuthenticated;
}

/** What the session says about who is signed in here. */
export interface SessionStanding {
  /** Whether this browser holds a valid session. */
  isAuthenticated: boolean;
  /**
   * Whether the signed-in account holds any role. An account with none (one
   * that registered itself, say) has no staff work to do here; the server
   * refuses its actions, and the admin says so rather than drawing screens
   * whose every action would be refused.
   */
  hasRole: boolean;
  /** The signed-in account's email, for saying who is signed in. */
  email: string | null;
}

/** The session's standing, from one read of it. */
export async function sessionStanding(): Promise<SessionStanding> {
  const user = (await getSession())?.user;
  const isAuthenticated = Boolean(user?.id);
  return {
    isAuthenticated,
    // Only a session that names its roles, and names none, is role-less: one
    // that names none at all (the app's own `determineUser`) is not known to
    // lack one, and the server still refuses whatever it may not do.
    hasRole: isAuthenticated && (user?.roleIds?.length ?? 1) > 0,
    email: isAuthenticated ? (user?.email ?? null) : null,
  };
}

/**
 * Get the current user ID from the session
 * @throws Error if user is not authenticated
 */
export async function getCurrentUserId(): Promise<string> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized: Please log in to continue");
  }
  return session.user.id;
}

/**
 * Invalidate the session cache (call on logout or session change)
 */
export function invalidateSessionCache(): void {
  cachedSession = null;
  cacheTimestamp = 0;
}
