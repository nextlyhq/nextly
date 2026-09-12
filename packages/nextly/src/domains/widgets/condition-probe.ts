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

import { callerMayPerform } from "../../auth/authenticated-scope";
import {
  COLLECTION_DEFINITION_ACTION,
  COLLECTION_DEFINITION_RESOURCE,
} from "../../auth/collection-definition-policy";
import type { ReadCaller } from "../../services/dashboard/readable-resources";

import {
  readableCollectionSlugs,
  readableSingleSlugs,
  readerHasContent,
  readerMayCreateEntry,
} from "./reader-content";

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
   * Whether this reader could write a first entry, resolved at most once.
   *
   * One question: is there a collection they can read and hold `create-<slug>`
   * on? With none in reach the answer is no -- the ability to create a
   * COLLECTION is not a substitute, for the reason the implementation gives.
   */
  mayCreateEntry(): Promise<boolean>;
  /**
   * Whether this reader could create a COLLECTION, resolved at most once.
   *
   * The grant is `auth/collection-definition-policy`'s, which is what the
   * schema route and the dispatcher's definition branch both enforce, asked
   * through the same door they ask through -- so this cannot drift from the
   * refusal a reader would actually meet.
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
    // Through the same decision the entry predicate uses, and for the same
    // reason: a key's stamped grant alone is not what a route enforces.
    createCollection ??= callerMayPerform(
      caller.authenticatedScope,
      COLLECTION_DEFINITION_ACTION,
      COLLECTION_DEFINITION_RESOURCE,
      caller.user
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
      // 🔴 NOT composed with `mayCreateCollection`. Being able to create a
      // collection is not being able to write a row in it: seeding a new
      // collection's CRUD permissions assigns them to `super_admin` alone
      // (`seedPermissionsForCollection`), so a caller holding the definition
      // grant and nothing else does not acquire `create-<new-slug>` -- and may
      // not even be able to READ the collection they just made. Offering the
      // entry step on that basis hands them a step they still cannot finish,
      // which is the defect the predicate exists to prevent, moved one
      // collection later.
      //
      // So with nothing in reach the step is not offered. A step is offered
      // only where the install can point at a way for THIS reader to finish
      // it, and "they might be granted something on a collection that does not
      // exist yet" is not one.
      createEntry ??= readableSlugs().then(resolved =>
        readerMayCreateEntry(caller, resolved)
      );
      return createEntry;
    },
    mayCreateCollection,
  };
}
