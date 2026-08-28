/**
 * The Direct API, bound to the identity a job resolved.
 *
 * ## The hole this closes
 *
 * `resolveRunAs` establishes who a job runs as and fails closed when it cannot.
 * None of that reaches the work unless the calls the handler makes carry it —
 * and by default they do not. `packages/nextly/AGENTS.md` states it plainly:
 *
 * > `overrideAccess` defaults to `true` (trusted server context). Enforcing
 * > access control requires `overrideAccess: false` plus a `user`.
 *
 * So a handler doing the obvious thing — importing `nextly` and calling
 * `find` — runs every scheduled operation with trusted-system authority while
 * the carefully resolved identity sits unused in its context. The identity
 * design would be decorative.
 *
 * ## Why binding rather than documenting
 *
 * "Remember to pass `{ overrideAccess: false, user }` on every call" is a rule
 * that holds until the first call that forgets, and a forgotten one does not
 * fail — it succeeds with MORE authority. A guarantee that degrades silently
 * toward privilege is not a guarantee.
 *
 * ## Why the bypass cannot be re-enabled through this client
 *
 * A handler passing `overrideAccess: true` is ignored. If it were honoured the
 * binding would be a default rather than a guarantee, and any helper that
 * spread its own options last would quietly restore system authority.
 *
 * A job that genuinely needs trusted access imports `nextly` directly. That is
 * then a visible, deliberate line in the handler rather than an invisible
 * default — which is the whole difference.
 *
 * ## Why no identity means ANONYMOUS, not system
 *
 * A job queued without an identity acts as nobody. Nobody is not the system:
 * leaving `overrideAccess` at its `true` default for that case would make the
 * least-privileged job the most-privileged one.
 *
 * @module domains/jobs/job-content-api
 */

import type { UserContext } from "../collections/services/collection-types";

/**
 * The content operations a job is expected to reach for.
 *
 * Deliberately not the whole Direct API. Authentication and account operations
 * take their own identity arguments and mean something different inside a
 * background job; binding them here would imply a job can log somebody in.
 */
const BOUND_OPERATIONS = [
  "find",
  "findByID",
  "create",
  "update",
  "delete",
  "count",
  "duplicate",
  "findSingle",
  "updateSingle",
  "findSingles",
] as const;

export type BoundOperation = (typeof BOUND_OPERATIONS)[number];

/** The subset of the Direct API this binds, in its own shape. */
export type JobContentApi = {
  [K in BoundOperation]: (args: never) => Promise<unknown>;
};

/**
 * Wrap `source` so every bound call carries this job's identity.
 *
 * `source` is the Direct API. Injected rather than imported so the binding can
 * be tested without booting a runtime — the one property worth exercising
 * exhaustively is what reaches the call, and that is observable only from here.
 */
export function createJobContentApi(
  user: UserContext | null,
  source: Record<BoundOperation, (args: never) => Promise<unknown>>
): JobContentApi {
  const bound = {} as JobContentApi;
  for (const name of BOUND_OPERATIONS) {
    bound[name] = (args: never) => {
      const caller = (args ?? {}) as Record<string, unknown>;
      return source[name]({
        ...caller,
        // Applied AFTER the caller's own arguments, so neither an explicit
        // `overrideAccess: true` nor a spread that lands last can restore the
        // bypass.
        overrideAccess: false,
        ...(user === null ? {} : { user }),
      } as never);
    };
  }
  return bound;
}
