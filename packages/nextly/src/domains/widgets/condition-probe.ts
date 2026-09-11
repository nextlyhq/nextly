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

import type { ReadCaller } from "../../services/dashboard/readable-resources";

import {
  readableCollectionSlugs,
  readableSingleSlugs,
  readerHasContent,
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
}

export function conditionProbe(caller: ReadCaller): ConditionProbe {
  let slugs: Promise<string[]> | undefined;
  let singles: Promise<string[]> | undefined;
  let content: Promise<boolean> | undefined;

  const readableSlugs = (): Promise<string[]> => {
    slugs ??= readableCollectionSlugs(caller);
    return slugs;
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
  };
}
