/**
 * Shared `/auth/setup-status` cache used by both route guards
 * (`PrivateRoute`, `PublicRoute`) and the logout flow. Centralising the
 * fetch + cache + reset trio here gives the admin UI a single source of
 * truth for "has initial setup been completed?" -- if the two guards
 * disagreed on this answer they could redirect the user in opposite
 * directions on transient failures.
 *
 * Cache lifetime: module-scoped, so it survives client-side navigations
 * (where module state persists) but is cleared on a full page reload
 * (where module state is reconstructed). `resetSetupStatusCache()` is
 * called explicitly from the logout path so the next user starts with a
 * clean slate.
 */
import { publicApi } from "../api/publicApi";

let setupStatusCache: boolean | null = null;

/**
 * Fetch the setup status, populating the module cache on first call.
 * Subsequent calls within the same page lifecycle return the cached
 * value without re-hitting the network.
 *
 * On any failure (5xx, 429, network error, invalid response shape) the
 * cache is fail-safed to `true` ("setup complete"). The alternative --
 * synthesising `false` -- would drag authenticated users into the setup
 * wizard on a transient hiccup, which is destructive. Staying on the
 * dashboard or login screen is recoverable on the next request.
 */
export async function checkSetupStatus(): Promise<boolean> {
  if (setupStatusCache !== null) return setupStatusCache;
  try {
    const result = await publicApi.get<{ isSetup: boolean } | undefined>(
      "/auth/setup-status"
    );
    // Require a strict boolean; any other shape (empty body, non-JSON,
    // schema drift) takes the same fail-safe default as the catch branch
    // below. Inlined rather than throwing into the catch -- the admin
    // package doesn't carry a NextlyError dependency, and a bare throw
    // would just be local control flow with no payload.
    setupStatusCache =
      typeof result?.isSetup === "boolean" ? result.isSetup : true;
    return setupStatusCache;
  } catch {
    setupStatusCache = true;
    return setupStatusCache;
  }
}

/**
 * Clear the cached setup status. Called from the logout flow so the
 * next user (potentially a different account, potentially after a DB
 * reset) sees a fresh answer rather than the previous user's.
 */
export function resetSetupStatusCache(): void {
  setupStatusCache = null;
}
