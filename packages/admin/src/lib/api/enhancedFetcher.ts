import { BASE_URL } from "./fetcher";
import { parseApiError } from "./parseApiError";
import { authFetch } from "./refreshInterceptor";

export async function enhancedFetcher<T = unknown, M = unknown>(
  path: string,
  options: RequestInit = {},
  isProtected = false
): Promise<{ data: T; meta?: M }> {
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

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw parseApiError(json, res.status);
  }

  // 204/205/304 responses must not include a response body.
  if (res.status === 204 || res.status === 205 || res.status === 304) {
    return { data: undefined as T };
  }

  const contentType = res.headers.get("content-type") || "";
  const contentLength = res.headers.get("content-length");

  // Some runtimes/proxies return 200 with an empty body.
  if (contentLength === "0") {
    return { data: undefined as T };
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    return { data: undefined as T };
  }

  const json = await res.json().catch(() => null);

  if (!json || typeof json !== "object") {
    return { data: undefined as T };
  }

  // Handle response with success/message structure
  if (json.data?.success === false) {
    const apiMessage =
      (json.data && (json.data.error || json.data.message)) || "Request failed";
    throw new Error(apiMessage);
  }

  // Return data and optional meta
  return {
    data: json.data?.data as T,
    meta: json.data?.meta as M | undefined,
  };
}
