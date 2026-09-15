/**
 * Moving a document's whole lifecycle: every language at once.
 *
 * A direction names the status every language ends up in and what to report,
 * and nothing more. The move itself is an ordinary update under the wildcard
 * locale, so the lifecycle permission, hooks, field rules, validation, each
 * language's pending change, the version and the events come from the one
 * write path rather than from a second copy of it.
 *
 * @module domains/collections/services/all-locales-lifecycle
 */

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import type { RequestActor } from "../../../auth/request-actor";

import type { UserContext } from "./collection-types";

/** What a lifecycle transition does, independent of which document it targets. */
export interface LifecycleDirection {
  /** The status every locale ends up in. */
  nextStatus: "published" | "draft";
  /**
   * What to say when the collection has no lifecycle at all, so there is
   * nothing for this transition to move.
   *
   * Direction-specific because the two sentences are not the same claim. "There
   * was nothing to take down" tells an operator their content is not live;
   * reusing the publish wording would tell them it is.
   */
  nothingToDoMessage: string;
  /**
   * What to report when the transition succeeded.
   *
   * Direction-specific for the same reason as {@link nothingToDoMessage}: this
   * string reaches operational logs and API callers, and a takedown that reports
   * "All languages published." tells every reader the opposite of what happened.
   */
  successMessage: string;
}

/** Put every language of a document live. */
export const PUBLISH_ALL_LOCALES: LifecycleDirection = {
  nextStatus: "published",
  nothingToDoMessage: "Nothing to publish (collection has no status).",
  successMessage: "All languages published.",
};

/** Take every language of a document down. */
export const WITHDRAW_ALL_LOCALES: LifecycleDirection = {
  nextStatus: "draft",
  nothingToDoMessage: "Nothing to unpublish (collection has no status).",
  successMessage: "All languages unpublished.",
};

/** The document a lifecycle transition targets, and who is asking. */
export interface AllLocalesLifecycleParams {
  collectionName: string;
  entryId: string;
  user?: UserContext;
  overrideAccess?: boolean;
  /**
   * Set by the REST dispatcher: the route already authorized this POST as
   * `update`, so the preliminary update gate skips its redundant RBAC re-check.
   * The lifecycle gate is unaffected.
   */
  routeAuthorized?: boolean;
  /**
   * A scoped API key is judged on its own `publish-<slug>` / `unpublish-<slug>`
   * grant, not the key owner's — the route authorized this POST only as
   * `update`.
   */
  authenticatedScope?: AuthenticatedScope;
  /** Who performed the transition, recorded on the events and the trail. */
  actor?: RequestActor;
  /** The request this operation's hooks are told about. */
  request?: Request;
  /** Values shared between this operation's hooks. */
  context?: Record<string, unknown>;
}
