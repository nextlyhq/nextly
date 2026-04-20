import { BASE_URL } from "../api/fetcher";

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

let cachedSession: Session | null = null;
let cacheTimestamp = 0;
const SESSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes (matches React Query staleTime)

function isCacheValid(): boolean {
  return (
    cachedSession !== null && Date.now() - cacheTimestamp < SESSION_CACHE_TTL
  );
}

export async function getSession(): Promise<Session | null> {
  if (isCacheValid()) {
    return cachedSession;
  }

  try {
    const response = await fetch(`${BASE_URL}/auth/session`, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      cachedSession = null;
      cacheTimestamp = Date.now();
      return null;
    }

    const json = await response.json();
    // New custom auth returns { data: { user: { ... } } }
    const session: Session = json.data || json;
    cachedSession = session;
    cacheTimestamp = Date.now();
    return session;
  } catch {
    return null;
  }
}

/**
 * Check if user is authenticated by validating session with the server.
 * Custom auth uses stateless JWT -- if the session endpoint returns a user, they're authenticated.
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
