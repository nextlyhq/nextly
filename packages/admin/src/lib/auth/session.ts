import { BASE_URL } from "../api/fetcher";
import { authFetch } from "../api/refreshInterceptor";

// ─── In-memory session cache ───────────────────────────────────────────────
// Shared across all callers (React Query, imperative checks, etc.)
// Prevents duplicate network requests within the cache window.

interface SessionUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  roleIds: string[];
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
    response = await authFetch(`${BASE_URL}/auth/session`, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
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
  const session = await getSession();
  return Boolean(session?.user?.id);
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
