/**
 * Who is asking for a related row, and what has already been resolved for them.
 *
 * Populating a relationship is a read of another collection, so it needs the
 * same things any read needs: the caller, what they are trusted with, the
 * language and lifecycle they asked for, and somewhere to memoise per-request
 * lookups. Every layer that can reach a related row — a collection read, a
 * Single read, a field group, a write response — carries this same set.
 *
 * It was previously declared separately in each of those layers. Adding one
 * concern then meant editing every declaration and auditing every call site for
 * the one that was forgotten, which has happened five times: the caller's
 * authenticated scope, the read locale, two per-request caches, and the
 * Draft/Published intent. Declared once, the next concern is one edit.
 *
 * @module services/collections/related-row-read-context
 */

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { CollectionAccessRules } from "../access";
import type { CompanionSchema } from "../collection-file-manager";

import type { TrustBound } from "./trust-grant";

/**
 * A target collection's read policy, as one expansion needs it.
 *
 * Declared here rather than in the service that resolves it so the context and
 * everything it carries live together, and so a layer that only forwards the
 * cache does not have to import from the service that fills it.
 */
export interface TargetReadPolicy {
  rules: CollectionAccessRules | undefined;
  /**
   * Whether the collection has Draft/Published, so a read of it can resolve the
   * status its rows are filtered by. Taken from the same record the rules come
   * from rather than looked up separately.
   */
  hasStatus: boolean;
}

export interface RelatedRowReadContext {
  /**
   * The caller a related row is judged and redacted for. Absent means
   * anonymous, which is the same answer their own read would get.
   */
  user?: Record<string, unknown>;

  /** Trusted read: stored rules and the lifecycle default are both bypassed. */
  overrideAccess?: boolean;

  /**
   * Which collections `overrideAccess` may actually reach, judged per TARGET.
   *
   * A trusted read that populates a relationship reads the TARGET trusted too,
   * and the target's collection was never named by the caller — it was reached
   * through a field. A caller that has already decided who is asking is
   * entitled to that, and says so with {@link TRUSTS_EVERY_COLLECTION}. A
   * caller serving one fixed audience is in the opposite position: it can state
   * its trusted set up front, and anything outside that set must be read as the
   * audience would read it.
   *
   * **Required, and not nullable.** This was previously
   * `((collection: string) => boolean) | undefined`, where `undefined` meant
   * unbounded — so a context whose author had weighed the question and one
   * whose author never saw it were the same value, and only the second was a
   * bug. The two are now different words. Nothing about the runtime changed:
   * `TRUSTS_EVERY_COLLECTION` reaches every target, exactly as the absent value
   * used to.
   *
   * The requirement is what does the work, not the constant. A route that
   * forgets its bound no longer compiles, which is the failure mode this
   * package has actually shipped — twice, on Singles and on collections, caught
   * by a reviewer both times rather than by the type.
   */
  trusted: TrustBound;

  /**
   * The caller's authenticated scope. A scoped API key is judged on its OWN
   * stamped grant and never on its owner's roles, so a super-admin-owned key
   * must not inherit the bypass its owner's session would get.
   */
  authenticatedScope?: AuthenticatedScope;

  /**
   * The language the surrounding read resolved to, used when a target
   * collection's read rule filters on a localized field.
   *
   * Already resolved by the caller — the requested locale, or the default when
   * none was asked for — because resolving it needs the localization config,
   * which the layers below do not have.
   */
  locale?: string;

  /**
   * The caller's Draft/Published intent, when they asked to see everything.
   *
   * Deliberately narrow. `"all"` is a statement about the caller's trust and
   * propagates; a concrete `draft` or `published` names the lifecycle of the
   * collection being read and says nothing about what it points at, so it does
   * not. Typed so a concrete value cannot be threaded here by mistake.
   */
  status?: "all";

  /**
   * Evaluate the target collection's FIELD read rules on the rows this pulls
   * in. Opt-in because "no caller supplied" and "anonymous caller" are
   * indistinguishable here and demand opposite outcomes.
   */
  enforceFieldAccess?: boolean;

  /**
   * Whose field-level read rules to judge related rows by, when that is NOT the
   * caller.
   *
   * Separate from `user` for the reason the top-level read keeps them apart: a
   * preview's bearer is anonymous and every HOOK must go on seeing them that
   * way, while the FIELDS are judged as the person who shared the link. One
   * identity serving both makes a hook branching on `req.user` produce an
   * editor-only value for an anonymous recipient.
   *
   * Absent means `user`, which is the ordinary case.
   */
  fieldAccessUser?: Record<string, unknown>;

  /**
   * Evaluate the target collection's own read rules, independently of whether
   * fields are redacted. A Single's authorization view wants the second without
   * the first: its rule must read real values, and must still not be shown a row
   * the response will withhold.
   */
  enforceCollectionAccess?: boolean;

  /**
   * WHEN the target's field read rules are applied to a related row.
   *
   * `"fetch"` -- the default -- applies them as the row is loaded. `"assembled"`
   * defers them to the post-assembly pass, which is the order a direct read
   * uses: the row's own field `afterRead` hooks run first, so a rule that masks
   * a value can be judged on the whole row rather than on one a denied sibling
   * has already been cut out of.
   *
   * Deferring is opt-in and the default is the safe one, because only a caller
   * that actually runs the post-assembly pass can promise the rules run at all.
   * A path that expands without it -- a Single, a write response -- leaves this
   * unset and keeps its protection where it is.
   */
  fieldAccessStage?: "fetch" | "assembled";

  /**
   * Ids withheld because a target collection refused this caller, keyed by
   * collection and id.
   *
   * A caller checking its expansion for completeness cannot otherwise tell a
   * deliberate refusal from a load that failed, and would report the first as
   * evidence that went missing.
   */
  withheldByAccess?: Set<string>;

  /**
   * Read policies already resolved during this expansion, so a relationship
   * holding many references reads its target's metadata once rather than once
   * per value. Holds the PENDING lookup: references resolve concurrently, so
   * caching only the settled value helps none of them.
   */
  targetPolicies?: Map<string, Promise<TargetReadPolicy>>;

  /**
   * Companion schemas already looked up during this expansion, for the same
   * reason. Populated only when a rule actually needs a companion filter.
   */
  targetCompanions?: Map<string, Promise<CompanionSchema | null>>;
}
