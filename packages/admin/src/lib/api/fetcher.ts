import { parseApiError } from "./parseApiError";

// Schema version tracking for cross-flow notification.
// When the server bumps the schema version (e.g., code-first change),
// the admin UI detects the mismatch and dispatches an event to refetch.
declare global {
  interface Window {
    __nextlySchemaVersion?: number;
    __nextlySchemaApplying?: boolean;
  }
}

export const BASE_URL =
  typeof window !== "undefined"
    ? `${window.location.origin}/admin/api`
    : "http://localhost:3000/admin/api"; // SSR fallback

type ApiSuccess<T> = {
  success: true;
  data: T;
  status: number;
};

type ApiErrorResult = {
  success: false;
  error: string;
  status: number;
};

export type ApiResult<T> = ApiSuccess<T> | ApiErrorResult;

// ─── Token refresh interceptor state ─────────────────────────────────────
// Prevents multiple concurrent refresh calls when several API requests
// receive 401 TOKEN_EXPIRED simultaneously.
let isRefreshing = false;
let refreshQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}> = [];

async function attemptTokenRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetcher<T = unknown>(
  path: string,
  options: RequestInit = {},
  isProtected = false
): Promise<T> {
  const fullUrl = `${BASE_URL}${path}`;
  const fetchOptions: RequestInit = {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    credentials: isProtected ? "include" : "same-origin",
    ...options,
  };

  const res = await fetch(fullUrl, fetchOptions);

  // Check X-Nextly-Schema-Version header for cross-flow schema change detection.
  // If the version increased and we didn't just apply changes ourselves,
  // dispatch an event so the UI can refetch collection data.
  const schemaVersionHeader = res.headers.get("X-Nextly-Schema-Version");
  if (schemaVersionHeader && typeof window !== "undefined") {
    const version = parseInt(schemaVersionHeader, 10);
    if (!isNaN(version)) {
      const stored = window.__nextlySchemaVersion;
      if (
        stored !== undefined &&
        version > stored &&
        !window.__nextlySchemaApplying
      ) {
        // Schema changed externally (code-first or another tab)
        window.dispatchEvent(
          new CustomEvent("nextly:schema-updated", { detail: { version } })
        );
      }
      window.__nextlySchemaVersion = version;
    }
  }

  // ─── Token refresh interceptor ───────────────────────────────────────
  // When a protected request returns 401 with TOKEN_EXPIRED, transparently
  // refresh the access token and retry. Uses a mutex to prevent concurrent refreshes.
  if (res.status === 401 && isProtected) {
    let errorBody: { error?: { code?: string } } | null = null;
    try {
      errorBody = await res.clone().json();
    } catch {
      // Not JSON, fall through to normal error handling
    }

    const errorCode = errorBody?.error?.code;

    if (errorCode === "TOKEN_EXPIRED") {
      if (!isRefreshing) {
        isRefreshing = true;
        const refreshed = await attemptTokenRefresh();
        isRefreshing = false;

        if (refreshed) {
          // Retry all queued requests from concurrent 401s
          const queue = [...refreshQueue];
          refreshQueue = [];
          queue.forEach(({ resolve }) =>
            resolve(fetcher(path, options, isProtected))
          );
          // Retry the original request
          return fetcher<T>(path, options, isProtected);
        } else {
          // Refresh failed -- session truly expired
          refreshQueue.forEach(({ reject }) =>
            reject(new Error("Session expired"))
          );
          refreshQueue = [];
          if (typeof window !== "undefined") {
            window.location.href = "/admin/login";
          }
          throw parseApiError(errorBody, 401);
        }
      } else {
        // Another request is already refreshing, queue this one
        return new Promise<T>((resolve, reject) => {
          refreshQueue.push({
            resolve: val => resolve(val as T),
            reject,
          });
        });
      }
    }

    // SESSION_UPGRADED or UNAUTHENTICATED -- redirect to login
    if (errorCode === "SESSION_UPGRADED" || errorCode === "UNAUTHENTICATED") {
      if (typeof window !== "undefined") {
        window.location.href = "/admin/login";
      }
      throw parseApiError(errorBody, 401);
    }
  }

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw parseApiError(json, res.status);
  }

  if (res.status === 204 || res.status === 205 || res.status === 304) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") || "";
  const contentLength = res.headers.get("content-length");

  if (contentLength === "0") {
    return undefined as T;
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    return undefined as T;
  }

  const json = await res.json().catch(() => null);

  if (!json || typeof json !== "object") {
    return undefined as T;
  }

  // Assuming actual data is in json.data.data
  return json.data?.data as T;
}
