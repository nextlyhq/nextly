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

import type { Nextly } from "../../init/nextly-instance";
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

/**
 * The two fields this client owns.
 *
 * Removed from every bound signature rather than accepted and ignored. A
 * handler that could write `overrideAccess: true` and see it silently dropped
 * would read the binding as a default it may override; the compiler saying no
 * is what makes it a guarantee.
 */
type AccessFields = "overrideAccess" | "user";

/** One bound operation: the Direct API's own signature, minus what this owns. */
type Bound<TOperation> = TOperation extends (args: infer TArgs) => infer TResult
  ? (args: Omit<TArgs, AccessFields>) => TResult
  : never;

/**
 * The subset of the Direct API this binds.
 *
 * Derived from `Nextly` so the argument and result types are the Direct API's
 * own — a second hand-written shape would drift from it, and the drift would
 * surface as a job handler that compiles against a signature the runtime no
 * longer has.
 */
export type JobContentApi = {
  [K in BoundOperation]: Bound<Nextly[K]>;
};

/** The Direct API surface this needs, named so the runner can inject a double. */
export type JobContentSource = Pick<Nextly, BoundOperation>;

/**
 * Wrap `source` so every bound call carries this job's identity.
 *
 * `source` is the Direct API. Injected rather than imported so the binding can
 * be tested without booting a runtime — the one property worth exercising
 * exhaustively is what reaches the call, and that is observable only from here.
 */
export function createJobContentApi(
  user: UserContext | null,
  source: JobContentSource
): JobContentApi {
  const bound = {} as Record<BoundOperation, unknown>;
  for (const name of BOUND_OPERATIONS) {
    // The generic per-slug signatures cannot be preserved through this loop, so
    // the call is made untyped here and the assembled object is asserted to
    // `JobContentApi` once. The types callers see are the Direct API's own; the
    // erasure is confined to these two lines.
    const operation = source[name] as (args: unknown) => unknown;
    bound[name] = (args: unknown) => {
      const caller = (args ?? {}) as Record<string, unknown>;
      return operation({
        ...caller,
        // Applied AFTER the caller's own arguments, so neither an explicit
        // `overrideAccess: true` nor a spread that lands last can restore the
        // bypass.
        overrideAccess: false,
        ...(user === null ? {} : { user }),
      });
    };
  }
  return bound as JobContentApi;
}
