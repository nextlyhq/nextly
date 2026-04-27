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
 * Navigate the browser to the configured login path unless we're already
 * there. The guard prevents layout-level background polls (e.g. a schema
 * banner's interval fetch) from triggering an infinite reload loop after
 * landing on `/admin/login`.
 */
export function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === loginRedirectPath) return;
  window.location.href = loginRedirectPath;
}

let inFlight: Promise<boolean> | null = null;

/**
 * POST `/auth/refresh` and return whether it succeeded. Concurrent callers
 * share a single in-flight request.
 */
export function refreshAccessToken(): Promise<boolean> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    }
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * `fetch`-shaped helper that silently refreshes the access token on a 401
 * TOKEN_EXPIRED and retries the original request once. On UNAUTHENTICATED or
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
    if (await refreshAccessToken()) {
      return fetch(input, init);
    }
    redirectToLogin();
    return res;
  }

  if (code === "UNAUTHENTICATED" || code === "SESSION_UPGRADED") {
    redirectToLogin();
  }

  return res;
}
