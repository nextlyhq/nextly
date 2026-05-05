import { BASE_URL } from "./fetcher";

// Fetch a CSRF token from the custom auth server. The server also
// sets the double-submit cookie as a Set-Cookie header, so the
// browser will echo it back on the following POST. Both halves must
// match server-side. Returns an empty string on failure so callers
// can still send the request and let the server respond with a
// structured CSRF_FAILED error.
//
// Wire shape (spec §7.6): the /auth/csrf endpoint emits
// `{ token: "..." }` directly via respondData.
export async function getCsrfToken(): Promise<string> {
  try {
    const res = await fetch(`${BASE_URL}/auth/csrf`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) {
      console.error("CSRF fetch failed with status:", res.status);
      return "";
    }
    const data: { token?: string } = await res.json();
    const token = data.token ?? "";
    if (!token) {
      console.warn("CSRF token not found in response");
    }
    return token;
  } catch (e) {
    console.error("Failed to fetch CSRF token:", e);
    return "";
  }
}
