/**
 * Turning a stored user id back into the authority a job runs with.
 *
 * This is the access boundary of the jobs domain. Everything else that can go
 * wrong here produces a job that did not run; this produces a job that runs
 * with the WRONG authority, which is a different class of problem.
 *
 * ## An id is not a context
 *
 * The job stored an id when it was queued. Rebuilding a context from that id at
 * execution time necessarily uses the permissions that person holds NOW, not
 * the ones they held when they scheduled the work. That is the right answer —
 * authority withdrawn should take effect — but it means the reconstruction can
 * fail, and how it fails is the whole design:
 *
 * - **Never fall back to a system principal.** A job that cannot establish who
 *   it is must not proceed as somebody more powerful.
 * - **Never silently skip.** A job that quietly does nothing looks exactly like
 *   a job that had nothing to do, and on a release that means "nothing was
 *   published" reported as success.
 * - **Fail terminally, and say why.** The row moves to `failed` with a reason
 *   the admin can show. Retrying would not help: a deleted user does not come
 *   back on the next pass.
 *
 * This is the position the preview-link work reached for the same reason — a
 * request whose actor cannot be identified is REFUSED rather than executed as
 * nobody, because acting as nobody applies no field rules at all.
 *
 * ## Why roles are loaded, not just the id
 *
 * `UserContext` carries a role set, and stored role-based access rules match on
 * it. A context built from the id alone makes every role-gated collection match
 * NOTHING and report itself complete — fail-closed, but silently. On a release
 * read path "nothing is due" is the worst thing to say by accident, because it
 * is indistinguishable from a correct answer.
 *
 * @module shared/lib/resolve-run-as
 */

import { buildUserContext } from "../../auth/user-context";
import type { UserContext } from "../../domains/collections/services/collection-types";

/** The minimum a user must look like for a job to act as them. */
export interface RunAsUser {
  id: string;
  isActive: boolean;
  name?: string;
  email?: string;
}

/**
 * The reads this needs. Injected rather than reaching for a service so the
 * boundary is testable without a database — the one module here whose failure
 * modes are worth exercising exhaustively.
 */
export interface RunAsDeps {
  findUser(id: string): Promise<RunAsUser | null>;
  listRoleSlugs(id: string): Promise<string[]>;
}

/** Why an identity could not be established. Recorded in `last_error`. */
export type RunAsRefusal =
  | "JOB_IDENTITY_UNRESOLVABLE"
  | "JOB_IDENTITY_DISABLED";

export type RunAsResult =
  | { ok: true; user: UserContext | null }
  | { ok: false; reason: RunAsRefusal };

/**
 * Resolve the identity a job runs as.
 *
 * `id === null` resolves to `{ ok: true, user: null }` — a job that genuinely
 * acts as nobody, such as webhook delivery, which reads nothing
 * access-controlled. That is NOT the same answer as "the stored identity is
 * gone", and the difference is the point of this function: collapsing the two
 * turns a deleted author's job into an unauthenticated run.
 */
export async function resolveRunAs(
  deps: RunAsDeps,
  id: string | null
): Promise<RunAsResult> {
  if (id === null) return { ok: true, user: null };

  const user = await deps.findUser(id);
  if (user === null) return { ok: false, reason: "JOB_IDENTITY_UNRESOLVABLE" };
  // A deactivated account cannot sign in; a job continuing to act as one would
  // be a way to keep exercising an authority that was deliberately withdrawn.
  if (!user.isActive) return { ok: false, reason: "JOB_IDENTITY_DISABLED" };

  const roles = await deps.listRoleSlugs(user.id);
  // The canonical constructor, not a second one that happens to agree. A
  // `UserContext` is an open record an access rule is evaluated against, so a
  // path that assembles it differently authorizes differently — which is why
  // `auth/user-context` states that every path builds it there. Building it by
  // hand here dropped `role`, the single-role alias `buildUserContext` derives
  // from `roles[0]`: a rule reading `user.role` then saw `undefined`, denying
  // authorized work, and a negative one like `user.role !== "suspended"`
  // GRANTED work it should have refused. The same argument covers `claims`,
  // which a hand-built context omits entirely.
  return {
    ok: true,
    user: buildUserContext({
      id: user.id,
      name: user.name,
      email: user.email,
      roles,
    }),
  };
}
