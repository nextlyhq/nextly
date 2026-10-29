/**
 * `deferToRequest` — wait for the incoming request before doing work that
 * depends on it or on the moment it arrives.
 *
 * It awaits `connection()` from `next/server`. Under Cache Components that is
 * the marker a prerender stops at: what follows runs at request time, so an
 * uncached read and the clock it takes are not mistaken for build-time work.
 * Without Cache Components it opts the render out of the route cache, which an
 * uncached read alone does not.
 *
 * `next/server` is loaded through {@link loadNextModule}, so importing this
 * module never forces `next` at load. Two contexts have no request to wait for,
 * and both are passed through rather than refused: Next.js is not installed,
 * and a caller runs outside any request scope (a script, a test), which
 * `connection()` reports by throwing. Only that report is caught.
 *
 * @module runtime/routing/defer-to-request
 */
import { loadNextModule, requireNextApi } from "../next-api";

type Connection = () => Promise<void>;

let cachedConnection: Connection | null | undefined;

function loadConnection(): Connection | null {
  if (cachedConnection === undefined) {
    const mod = loadNextModule("next/server");
    cachedConnection = mod
      ? requireNextApi<Connection>(mod, "next/server", "connection")
      : null;
  }
  return cachedConnection;
}

/** True for `connection()`'s report that no request scope is active. */
function isOutsideRequestScope(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("`connection` was called outside a request scope")
  );
}

/** Wait for the request (a no-op outside one, or where Next.js is absent). */
export async function deferToRequest(): Promise<void> {
  const connection = loadConnection();
  if (connection === null) return;
  try {
    await connection();
  } catch (error) {
    if (isOutsideRequestScope(error)) return;
    throw error;
  }
}
