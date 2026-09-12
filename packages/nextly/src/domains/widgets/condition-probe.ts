/**
 * The reads a condition makes, resolved ONCE per layout request.
 *
 * 🔴 Two conditions ask overlapping questions of the same rows, and both are on
 * the default dashboard: `content:empty` wants to know whether this reader can
 * see anything, and `onboarding:incomplete` wants that plus the collections it
 * was derived from. Asked independently that is three authorization traversals
 * and two counted reads per collection for ONE layout read — and the traversal
 * is the expensive half, since it resolves the caller's permissions against
 * every collection.
 *
 * Sharing them by calling one helper from the other is what produced the
 * duplication: `onboardingSteps` resolved the slugs, then handed the caller to
 * a function that resolved them again. A probe passed down instead makes the
 * sharing structural — an evaluator cannot accidentally re-resolve, because it
 * has no caller to re-resolve from.
 *
 * Lazy and MEMOISED ON THE PROMISE rather than on its value, so two evaluators
 * running concurrently under `Promise.allSettled` join the same in-flight read
 * instead of starting a second one. Memoising after the await would leave a
 * window in which both see nothing cached and both go to the database, which is
 * the exact case this exists for.
 *
 * Its lifetime is one request. Nothing here is cached across requests: a
 * collection created between two dashboard loads must change the answer, and a
 * probe that outlived the request would report the older one.
 *
 * @module domains/widgets/condition-probe
 */

import {
  callerHoldsPermission,
  readAccessCaller,
} from "../../auth/entity-read-access";
import type { ReadCaller } from "../../services/dashboard/readable-resources";

import {
  readableCollectionSlugs,
  readableSingleSlugs,
  readerHasContent,
  readerMayCreateEntry,
} from "./reader-content";

/**
 * The permission `POST /api/collections/schema` requires to create a collection.
 *
 * Named here rather than spelled at the call site so the two cannot drift: if
 * that endpoint's guard changes, this is the one place that has to follow, and
 * a reader offered a step whose endpoint refuses them is the defect the
 * per-step predicate exists to prevent.
 */
const COLLECTION_CREATE_PERMISSION = "manage-settings";

/** What every condition evaluator is handed. */
export interface ConditionProbe {
  /** Who is asking. Carried so an evaluator needing neither read still has it. */
  readonly caller: ReadCaller;
  /** The collections this reader may read, resolved at most once. */
  readableSlugs(): Promise<string[]>;
  /** The singles this reader may read, resolved at most once. */
  readableSingles(): Promise<string[]>;
  /** Whether this reader can see any row at all, resolved at most once. */
  hasContent(): Promise<boolean>;
  /**
   * Whether this reader could write a first entry at all, resolved at most once.
   *
   * Two routes, and the answer is whichever applies: a collection they can
   * already read and hold `create-<slug>` on, or -- with none in reach -- the
   * ability to make one to put the entry in. Answering the first alone would
   * withhold the step from an administrator on a fresh install, who has no
   * collection yet and is precisely the reader about to make one.
   */
  mayCreateEntry(): Promise<boolean>;
  /**
   * Whether this reader could create a COLLECTION, resolved at most once.
   *
   * `manage-settings` is what the schema endpoint requires, asked through the
   * same door it asks through, so this cannot drift from the refusal a reader
   * would actually meet. Unlike the entry answer there is no "could not ask"
   * case: the permission is the whole question and it is always decidable.
   */
  mayCreateCollection(): Promise<boolean>;
}

export function conditionProbe(caller: ReadCaller): ConditionProbe {
  let slugs: Promise<string[]> | undefined;
  let singles: Promise<string[]> | undefined;
  let content: Promise<boolean> | undefined;
  let createEntry: Promise<boolean> | undefined;
  let createCollection: Promise<boolean> | undefined;

  const readableSlugs = (): Promise<string[]> => {
    slugs ??= readableCollectionSlugs(caller);
    return slugs;
  };

  const mayCreateCollection = (): Promise<boolean> => {
    createCollection ??= callerHoldsPermission(
      COLLECTION_CREATE_PERMISSION,
      readAccessCaller(caller)
    );
    return createCollection;
  };

  return {
    caller,
    readableSlugs,
    readableSingles: () => {
      singles ??= readableSingleSlugs(caller);
      return singles;
    },
    hasContent: () => {
      // Takes the slugs from the same memo rather than resolving its own, which
      // is the duplication this module was added to remove.
      content ??= readableSlugs().then(resolved =>
        readerHasContent(caller, resolved)
      );
      return content;
    },
    mayCreateEntry: () => {
      // From the same memo `hasContent` reads, for the same reason: the create
      // decision is taken over the collections this reader can read, and
      // resolving that list twice is the duplication this module removes.
      createEntry ??= readableSlugs().then(resolved =>
        // 🔴 With NOTHING in reach there is no create grant to find, and an
        // empty walk answering "no" would be an absence read as a refusal.
        // The honest question then is the next one along: could this reader
        // make the collection the entry would go in? That is what an
        // administrator on a fresh install does, in that order.
        resolved.length === 0
          ? mayCreateCollection()
          : readerMayCreateEntry(caller, resolved)
      );
      return createEntry;
    },
    mayCreateCollection,
  };
}
