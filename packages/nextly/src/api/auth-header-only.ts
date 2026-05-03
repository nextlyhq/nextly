import { NextlyError } from "../errors";

/**
 * Throws AUTH_REQUIRED when the request lacks an Authorization header.
 *
 * Single canonical source of the auth-header gate; the contract test relies
 * on this being the only implementation.
 */
export function requireAuthHeader(request: Request): void {
  if (!request.headers.get("Authorization")) {
    throw NextlyError.authRequired();
  }
}
