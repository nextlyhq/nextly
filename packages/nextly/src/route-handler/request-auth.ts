/**
 * Request-auth introspection (the plugin-facing seam).
 *
 * `isAuthenticatedApiRequest(req)` answers "is THIS caller carrying a valid
 * session cookie or API key?" — the same check the dispatcher's auth pipeline
 * runs, exposed read-only so a plugin serving a PUBLIC route can distinguish an
 * anonymous visitor from a logged-in one (e.g. the docs plugin showing the full
 * spec to admins and the public-only spec to everyone else). A public route's
 * context carries `user: null` by design, which is why the check reads the
 * request itself.
 *
 * @module route-handler/request-auth
 * @since alpha
 */
import {
  isErrorResponse,
  requireAuthentication,
} from "@nextly/auth/middleware";

/**
 * Whether the request carries a valid session cookie or Bearer API key.
 * Validation is the production pipeline's own (`requireAuthentication`) — no
 * reimplementation to drift from it.
 */
export async function isAuthenticatedApiRequest(
  req: Request
): Promise<boolean> {
  const result = await requireAuthentication(req);
  return !isErrorResponse(result);
}
