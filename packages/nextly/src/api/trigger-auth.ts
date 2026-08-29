/**
 * Who may pull a scheduler trigger.
 *
 * A trigger is a side-effecting endpoint a scheduler calls on an interval and an
 * operator can call by hand: the webhook drain, the job runner, and whatever
 * drains next. Every one of them faces the same question — is this caller a
 * scheduler holding the shared secret, or a human with the permission to do this
 * by hand? — and the answer has enough security reasoning in it that a second
 * copy would be a second place for that reasoning to be wrong.
 *
 * The webhook drain answered it first and this is its answer, moved rather than
 * rewritten. What varies between triggers is one thing: which permission a
 * human needs. That is a parameter; everything else below is shared.
 *
 * @module api/trigger-auth
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { validateOrigin } from "../auth/csrf/validate";
import {
  isErrorResponse,
  type AuthContext,
  type ErrorResponse,
} from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { NextlyError } from "../errors/nextly-error";
import { env } from "../shared/lib/env";

/**
 * Minimum length for a secret that may authorize a trigger.
 *
 * Enforced HERE rather than only in the env schema, so a platform-wide
 * `CRON_SECRET` too short to be a safe authorizer is ignored rather than
 * accepted — and its length never blocks app boot for a deployment that does not
 * use any trigger.
 */
const MIN_TRIGGER_SECRET_LENGTH = 32;

/** The bearer token on the request, or null when there is no bearer header. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

/**
 * Constant-time string compare. Both sides are hashed to a fixed length first so
 * `timingSafeEqual` never throws on a length mismatch and the comparison leaks
 * neither the secret's length nor its content through timing.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

/**
 * The permission check for the human path, supplied by the trigger.
 *
 * The middleware's OWN return type rather than a structural approximation of
 * it: a hand-written `{ authMethod?: string }` would be a second description of
 * `AuthContext`, and `isErrorResponse` narrows the real union rather than
 * whatever shape happened to be written here.
 */
export type TriggerPermissionCheck = (
  request: Request
) => Promise<AuthContext | ErrorResponse>;

/**
 * Authorize a scheduler trigger, or throw.
 *
 * TWO PATHS, and the difference between them is the whole security argument.
 *
 * A scheduler presents a shared secret as a bearer token — Nextly's
 * `NEXTLY_DRAIN_SECRET` or Vercel Cron's `CRON_SECRET`, which is what Vercel
 * actually sends. Compared constant-time against each configured value. A bearer
 * token is not sent on a cross-site request, so this path is not CSRF-exposed,
 * and a non-matching bearer falls through to be tried as an API key below.
 *
 * A human uses the session or an API key, and that path is POST-ONLY. A GET can
 * be driven by a cross-site top-level navigation carrying the victim's
 * `SameSite=Lax` session cookie, so letting a GET reach the session path would
 * make this a CSRF trigger. A `SameSite=Lax` cookie is not sent on a cross-site
 * POST, which is the same baseline the rest of the session-authenticated REST
 * API relies on.
 *
 * On top of `SameSite=Lax`, the cookie path also requires a same-origin
 * `Origin`/`Referer`, so a same-site or misconfigured browser context cannot
 * forge a side-effecting trigger. API-key auth is exempt: it carries no ambient
 * cookie and sends no browser `Origin`.
 */
export async function authorizeTrigger(
  request: Request,
  options: {
    /** What a human needs to pull this trigger by hand. */
    requirePermission: TriggerPermissionCheck;
    /** Distinguishes this trigger's refusals in the log. */
    reason: string;
  }
): Promise<void> {
  const presented = bearerToken(request);
  if (presented) {
    for (const secret of [env.NEXTLY_DRAIN_SECRET, env.CRON_SECRET]) {
      if (
        secret &&
        secret.length >= MIN_TRIGGER_SECRET_LENGTH &&
        constantTimeEqual(presented, secret)
      ) {
        return;
      }
    }
  }

  if (request.method.toUpperCase() === "GET") {
    throw NextlyError.forbidden({
      logContext: { reason: `${options.reason}-get-requires-secret` },
    });
  }

  const authResult = await options.requirePermission(request);
  if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

  if (
    authResult.authMethod !== "api-key" &&
    !validateOrigin(request, env.NEXTLY_ALLOWED_ORIGINS_PARSED)
  ) {
    throw NextlyError.forbidden({
      logContext: { reason: `${options.reason}-origin-mismatch` },
    });
  }
}
