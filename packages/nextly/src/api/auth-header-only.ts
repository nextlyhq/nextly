import { NextlyError } from "../errors";

/**
 * Throws AUTH_REQUIRED when the request lacks an Authorization header.
 *
 * Hoisted from ~14 inline copies across api routes (F17). The contract test
 * in Task 12 relies on a single canonical source of this gate.
 */
export function requireAuthHeader(request: Request): void {
  if (!request.headers.get("Authorization")) {
    throw NextlyError.authRequired();
  }
}
