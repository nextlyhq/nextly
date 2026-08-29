/**
 * Moving a document's whole lifecycle — every language at once.
 *
 * ## Why a direction rather than a method per verb
 *
 * "Set this document's status across its locales" is ONE operation with a
 * parameter, not two operations that happen to look alike. The codebase reached
 * for the second shape first: `publishAllLocales` stated the access gate, the
 * row lock, the companion sweep, the version capture, the event fan-out and the
 * cache flush for publishing, and a withdrawal written beside it would have
 * stated all of them again — 745 of its 783 lines carry no direction at all.
 * A third lifecycle verb would have stated them a third time.
 *
 * So the direction is data. A verb picks a target status, an access action and
 * whether it establishes first publication, and inherits every guarantee the
 * other direction already proved.
 *
 * Prior art agrees. Strapi's document service exposes `publish`/`unpublish`
 * taking `locale: '*'` rather than four scope-specific methods; Payload's
 * per-locale status is a flag on one write path, not a parallel one. Directus
 * has no built-in per-language lifecycle at all, and its users hand-roll the
 * asymmetry this module exists to avoid.
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
   * The access rule kind this transition is judged against, checked ON TOP of
   * `update`. Publishing and withdrawing are separate capabilities: someone
   * trusted to put content live is not automatically trusted to take the whole
   * site's translations of it down, and the reverse is likelier still.
   */
  accessAction: "publish" | "unpublish";
  /**
   * Whether this direction can ESTABLISH first publication.
   *
   * True for publishing only. `first_published_at` records when a document
   * first became reachable, which withdrawing it does not change — re-dating or
   * clearing it would make a later republish report a first publication that
   * had already happened.
   */
  stampsFirstPublished: boolean;
  /**
   * What to say when the collection has no lifecycle at all, so there is
   * nothing for this transition to move.
   *
   * Direction-specific because the two sentences are not the same claim. "There
   * was nothing to take down" tells an operator their content is not live;
   * reusing the publish wording would tell them it is.
   */
  nothingToDoMessage: string;
}

/** Put every language of a document live. */
export const PUBLISH_ALL_LOCALES: LifecycleDirection = {
  nextStatus: "published",
  accessAction: "publish",
  stampsFirstPublished: true,
  nothingToDoMessage: "Nothing to publish (collection has no status).",
};

/** Take every language of a document down. */
export const WITHDRAW_ALL_LOCALES: LifecycleDirection = {
  nextStatus: "draft",
  accessAction: "unpublish",
  // A withdrawal never establishes first publication; see the field's note.
  stampsFirstPublished: false,
  nothingToDoMessage: "Nothing to unpublish (collection has no status).",
};

/** The document a lifecycle transition targets, and who is asking. */
export interface AllLocalesLifecycleParams {
  collectionName: string;
  entryId: string;
  user?: UserContext;
  overrideAccess?: boolean;
  /**
   * Set by the REST dispatcher: the route already authorized this POST as
   * `update`, so the preliminary update gate skips its redundant RBAC re-check
   * (its stored rules still run). The lifecycle gate is unaffected.
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
}
