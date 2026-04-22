import { parseApiError } from "./parseApiError";
import { authFetch } from "./refreshInterceptor";

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

  const res = isProtected
    ? await authFetch(fullUrl, fetchOptions)
    : await fetch(fullUrl, fetchOptions);

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
