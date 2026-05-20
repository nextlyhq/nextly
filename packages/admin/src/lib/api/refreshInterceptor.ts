import { BASE_URL } from "./fetcher";

interface AuthErrorBody {
  error?: { code?: string } | string;
  data?: { code?: string };
}

/**
 * The server emits two 401 body shapes:
 *   - `/auth/session` handler: `{ error: { code, message } }`
 *   - middleware-wrapped errors: `{ data: { code, message, error, ... } }`
 */
function extractAuthCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as AuthErrorBody;
  if (typeof b.error === "object" && b.error?.code) return b.error.code;
  if (b.data?.code) return b.data.code;
  return null;
}

/**
 * Read the auth error code from a 401 Response body. Uses `response.clone()`
 * so the caller can still read the body afterwards.
 */
export async function readAuthErrorCode(
  response: Response
): Promise<string | null> {
  try {
    return extractAuthCode(await response.clone().json());
  } catch {
    return null;
  }
}

/**
 * Same as `readAuthErrorCode` but accepts a JSON string — for XHR paths that
 * expose `responseText` rather than a Response object.
 */
export function readAuthErrorCodeFromText(text: string): string | null {
  try {
    return extractAuthCode(JSON.parse(text));
  } catch {
    return null;
  }
}

// ─── Login redirect path (configurable) ────────────────────────────────────
// Self-hosters may mount the admin UI under a different base path (e.g.
// `/dashboard` instead of `/admin`). They can call `setLoginRedirectPath()`
// once at bootstrap to override the default without forking.
let loginRedirectPath = "/admin/login";

export function setLoginRedirectPath(path: string): void {
  loginRedirectPath = path;
}

/**
 * Routes where a 401 on a protected query is EXPECTED (because the user
 * isn't logged in yet, by design) and must NOT trigger a redirect to
 * login. Without this guard the setup wizard ping-pongs forever:
 *
 *   1. /admin/setup mounts → GeneralSettingsSyncProvider fires
 *      `useGeneralSettings` (protected) → 401 with AUTH_REQUIRED.
 *   2. authFetch sees the code → redirectToLogin() → /admin/login.
 *   3. /admin/login mounts → PublicRoute checks setup-status,
 *      sees no users → navigateTo("/admin/setup"). Bounce.
 */
const NO_REDIRECT_PUBLIC_PATHS = new Set([
  "/admin/login",
  "/admin/setup",
  "/admin/register",
  "/admin/forgot-password",
  "/admin/reset-password",
  "/admin/verify-email",
]);

/**
 * Navigate the browser to the configured login path unless we're already
 * on a public-auth route. The guard prevents layout-level background
 * queries (admin-meta, general-settings, etc.) from triggering an
 * infinite reload loop while the user is mid auth-flow.
 */
export function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (NO_REDIRECT_PUBLIC_PATHS.has(window.location.pathname)) return;
  window.location.href = loginRedirectPath;
}

/**
 * Outcome of a `/auth/refresh` attempt. The tri-state lets `authFetch`
 * distinguish "session is dead, redirect" from "server hiccupped, keep
 * the session and surface the error to the caller."
 *
 * - `ok`           refresh succeeded; retry the original request.
 * - `auth_failed`  refresh returned 401 (invalid token, expired refresh
 *                  token, binding mismatch, ...). Server has already
 *                  cleared cookies via `clearAndDeny`; redirect to login.
 * - `transient`    refresh failed for a non-auth reason (5xx, network
 *                  error). Cookies are intact server-side; do NOT
 *                  redirect -- the caller's original 401 propagates so
 *                  the user keeps their session and can retry.
 */
export type RefreshResult = "ok" | "auth_failed" | "transient";

let inFlight: Promise<RefreshResult> | null = null;

/**
 * POST `/auth/refresh` and report the outcome. Concurrent callers share
 * a single in-flight request.
 */
export function refreshAccessToken(): Promise<RefreshResult> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) return "ok";
      // 401 is the only response that means "your session is invalid":
      // the server's `clearAndDeny` path emits 401 + Set-Cookie clears.
      // Everything else (503 SERVICE_UNAVAILABLE on DB hiccup, 5xx, ...)
      // is transient and must not log the user out.
      return res.status === 401 ? "auth_failed" : "transient";
    } catch {
      // Network error -- cannot reach the server. Definitively transient.
      return "transient";
    }
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * `fetch`-shaped helper that silently refreshes the access token on a 401
 * TOKEN_EXPIRED and retries the original request once. On AUTH_REQUIRED or
 * SESSION_UPGRADED it redirects to the login page. Any other response is
 * returned as-is.
 *
 * Every authenticated admin call should route through this primitive. Call
 * sites that use `window.fetch` directly for protected endpoints bypass the
 * refresh flow and surface a raw 401 to the user on expiry.
 *
 * The retry is capped at one attempt: if the refresh succeeds but the retried
 * request still returns 401, we return that second response unchanged rather
 * than looping (which could happen if the server rejects the freshly issued
 * cookie — clock skew, domain mismatch, etc.).
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);

  if (res.status !== 401) return res;

  const code = await readAuthErrorCode(res);

  if (code === "TOKEN_EXPIRED") {
    const refresh = await refreshAccessToken();
    if (refresh === "ok") {
      return fetch(input, init);
    }
    if (refresh === "auth_failed") {
      redirectToLogin();
    }
    // "transient": surface the original 401 without redirecting -- the
    // session is still valid server-side, so logging the user out on a
    // momentary server hiccup would be destructive.
    return res;
  }

  if (code === "AUTH_REQUIRED" || code === "SESSION_UPGRADED") {
    redirectToLogin();
  }

  return res;
}
