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

/** What setup-status answers, as the admin reads it. */
interface SetupStatus {
  isSetup: boolean;
  /** Whether setup needs its setup token: in production, until it is done. */
  requiresSetupToken: boolean;
}

/**
 * The answer every reader shares: one request per page lifecycle, however
 * many ask and however soon, so the route guards and the setup form can never
 * read setup-status differently.
 */
let setupStatusCache: Promise<SetupStatus> | null = null;

/**
 * On any failure (5xx, 429, network error, invalid response shape) setup is
 * fail-safed to "complete". The alternative -- synthesising `false` -- would
 * drag authenticated users into the setup wizard on a transient hiccup, which
 * is destructive. Staying on the dashboard or login screen is recoverable on
 * the next request. The token is fail-safed to "needed": the form then shows
 * a field the server may ignore, rather than hiding one it requires.
 */
async function fetchSetupStatus(): Promise<SetupStatus> {
  try {
    const result = await publicApi.get<
      { isSetup?: unknown; requiresSetupToken?: unknown } | undefined
    >("/auth/setup-status");
    // Require a strict boolean; any other shape (empty body, non-JSON,
    // schema drift) takes the same fail-safe default as the catch branch
    // below. Inlined rather than throwing into the catch -- the admin
    // package doesn't carry a NextlyError dependency, and a bare throw
    // would just be local control flow with no payload.
    return {
      isSetup: typeof result?.isSetup === "boolean" ? result.isSetup : true,
      requiresSetupToken: result?.requiresSetupToken !== false,
    };
  } catch {
    return { isSetup: true, requiresSetupToken: true };
  }
}

function readSetupStatus(): Promise<SetupStatus> {
  setupStatusCache ??= fetchSetupStatus();
  return setupStatusCache;
}

/** Whether initial setup has been completed. */
export async function checkSetupStatus(): Promise<boolean> {
  return (await readSetupStatus()).isSetup;
}

/** Whether the setup form must ask for the setup token. */
export async function checkSetupTokenRequired(): Promise<boolean> {
  return (await readSetupStatus()).requiresSetupToken;
}

/**
 * Clear the cached setup status. Called from the logout flow so the
 * next user (potentially a different account, potentially after a DB
 * reset) sees a fresh answer rather than the previous user's.
 */
export function resetSetupStatusCache(): void {
  setupStatusCache = null;
}
