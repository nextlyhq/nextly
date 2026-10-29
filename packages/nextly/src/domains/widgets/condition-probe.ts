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

import { callerHoldsAny } from "../../auth/access/route-gate-adapters";
import { COLLECTION_DEFINITION_PERMISSIONS } from "../../auth/collection-definition-policy";
import { wouldReadOwnNewCollection } from "../../auth/new-entity-access-policy";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import {
  callerMayReadAnyRelease,
  callerMayReadReleases,
} from "../releases/releases-widget-source";

import { getStartedDetail, type GetStartedDetail } from "./get-started";
import type { GetStartedAnswer } from "./get-started-steps";
import {
  createDisabledSlugs,
  createVerdict,
  readableOfKind,
  readerHasContent,
  readerMayCreateEntry,
  type ContentAnswer,
} from "./reader-content";

/** A registry read for this reader: the slugs, and whether the registry could be read at all. */
export interface RegistryAnswer {
  slugs: string[];
  reachable: boolean;
}

/** What every condition evaluator is handed. */
export interface ConditionProbe {
  /** Who is asking. Carried so an evaluator needing neither read still has it. */
  readonly caller: ReadCaller;
  /** The collections this reader may read, resolved at most once. */
  readableSlugs(): Promise<string[]>;
  /** The singles this reader may read, resolved at most once. */
  readableSingles(): Promise<string[]>;
  /**
   * The collections this reader may read, and whether the registry could be
   * read: the one read `readableSlugs` is derived from.
   */
  collectionsRead(): Promise<RegistryAnswer>;
  /** The Singles this reader may read, and whether that registry could be read. */
  singlesRead(): Promise<RegistryAnswer>;
  /**
   * Whether this reader can see any row at all, resolved at most once:
   * `"unknown"` when the check ran out of time or the collections could not be
   * listed, which every reader of it treats as not empty.
   */
  hasContent(): Promise<ContentAnswer>;
  /**
   * Whether this reader could write a first entry, resolved at most once.
   *
   * One question: is there a collection they can read and hold `create-<slug>`
   * on? With none in reach the answer is no -- the ability to create a
   * COLLECTION is not a substitute, for the reason the implementation gives.
   */
  mayCreateEntry(): Promise<boolean>;
  /**
   * Whether this reader could create an entry from the dashboard's Create
   * card, resolved at most once: the same decision as {@link mayCreateEntry},
   * over the collections that card offers, which leaves out any whose
   * definition turns creating off (`admin.disableCreate`).
   */
  mayCreateOnDashboard(): Promise<boolean>;
  /**
   * Whether this reader could create a COLLECTION, resolved at most once.
   *
   * Two halves: may they DEFINE one (every grant
   * `auth/collection-definition-policy` names, which the schema route and the
   * dispatcher both enforce), and would they be able to READ the result. The
   * second is what makes the step finishable, and it is not implied by the
   * first -- `auth/new-entity-access-policy` names the roles and grants that
   * reach a new collection.
   */
  mayCreateCollection(): Promise<boolean>;
  /**
   * Whether this reader may read releases, by the releases domain's own rule,
   * resolved at most once. Permissions only: nothing is read.
   */
  mayReadReleases(): Promise<boolean>;
  /**
   * Whether a release exists that this reader may read, resolved at most once:
   * `false` without asking the database when they may read none, and otherwise
   * one id read with a bound of one (`ReleasesService.anyReadable`).
   */
  releasesExist(): Promise<boolean>;
  /**
   * The Get started steps offered to this reader, before their skips, resolved
   * at most once: the one answer the setup condition and the step list both
   * read, so the two cannot disagree.
   */
  getStarted(): Promise<GetStartedAnswer>;
  /**
   * The same answer with the detail the deprecated onboarding read is
   * projected from, resolved at most once: `getStarted` is derived from it.
   */
  getStartedDetail(): Promise<GetStartedDetail>;
}

export function conditionProbe(caller: ReadCaller): ConditionProbe {
  let collectionsRead: Promise<RegistryAnswer> | undefined;
  let singlesRead: Promise<RegistryAnswer> | undefined;
  let content: Promise<ContentAnswer> | undefined;
  let createEntry: Promise<boolean> | undefined;
  let createOnDashboard: Promise<boolean> | undefined;
  let createCollection: Promise<boolean> | undefined;
  let readReleases: Promise<boolean> | undefined;
  let anyRelease: Promise<boolean> | undefined;
  let started: Promise<GetStartedDetail> | undefined;

  const readCollections = (): Promise<RegistryAnswer> => {
    collectionsRead ??= readableOfKind(caller, "collection");
    return collectionsRead;
  };
  const readSingles = (): Promise<RegistryAnswer> => {
    singlesRead ??= readableOfKind(caller, "single");
    return singlesRead;
  };
  // Derived from the one read, so the slugs and whether they are all of them cannot disagree.
  const readableSlugs = (): Promise<string[]> =>
    readCollections().then(read => read.slugs);

  const mayCreateCollection = (): Promise<boolean> => {
    // 🔴 May create AND would be able to READ what they created. Both halves,
    // because the step completes when this reader can read a collection, and
    // creating one does not grant its creator anything: a caller holding the
    // definition grant and nothing else creates the collection, gains no
    // `read-<slug>` for it, and finds the step still outstanding -- which is
    // the defect this predicate exists to prevent, moved one action later.
    //
    // The readability half is DERIVED from the seeding policy rather than
    // restated here. `wouldReadOwnNewCollection` lives beside the declaration
    // the seeder assigns by, so if creation ever begins granting the creator --
    // or the assignment moves to another role -- this follows instead of
    // silently disagreeing. Asserted in one place, the two could only drift in
    // ways nothing reports: a step hidden after it became finishable, or
    // offered after it stopped being.
    createCollection ??= (async () => {
      // Every grant a definition change asks, each by grant as the routes
      // ask it, no entity's rule read.
      for (const permission of COLLECTION_DEFINITION_PERMISSIONS) {
        const mayDefine = await callerHoldsAny(
          caller.authenticatedScope,
          [permission],
          caller.user
        );
        if (!mayDefine) return false;
      }
      return wouldReadOwnNewCollection({
        userId: caller.user.id,
        isApiKey: caller.authenticatedScope?.actorType === "apiKey",
        permissions: caller.authenticatedScope?.permissions ?? [],
      });
    })();
    return createCollection;
  };

  // Each collection's create decision, made at most once for the request and
  // shared by the onboarding step and the Create card's condition: both ask it,
  // often of the same collections, and asked twice a rule could answer the two
  // differently within one response.
  const createVerdicts = new Map<string, Promise<boolean>>();
  const decideCreate = createVerdict(caller);
  const mayCreateIn = (slug: string): Promise<boolean> => {
    let verdict = createVerdicts.get(slug);
    if (verdict === undefined) {
      verdict = decideCreate(slug);
      createVerdicts.set(slug, verdict);
    }
    return verdict;
  };

  const probe: ConditionProbe = {
    caller,
    readableSlugs,
    readableSingles: () => readSingles().then(read => read.slugs),
    collectionsRead: readCollections,
    singlesRead: readSingles,
    hasContent: () => {
      // Takes the slugs from the same memo rather than resolving its own, which
      // is the duplication this module was added to remove.
      //
      // 🔴 A registry that could not be read is "unknown", never "no content".
      // Counted over the empty list it leaves behind, the answer is `false`, and
      // `false` offers an established site the empty-install cards.
      content ??= readCollections().then(read =>
        read.reachable ? readerHasContent(caller, read.slugs) : "unknown"
      );
      return content;
    },
    mayCreateEntry: () => {
      // From the same memo `hasContent` reads, for the same reason: the create
      // decision is taken over the collections this reader can read, and
      // resolving that list twice is the duplication this module removes.
      // 🔴 NOT composed with `mayCreateCollection`. Being able to create a
      // collection is not being able to write a row in it: seeding a new
      // collection's CRUD permissions assigns them to the super-admin role
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
        readerMayCreateEntry(caller, resolved, mayCreateIn)
      );
      return createEntry;
    },
    mayCreateCollection,
    mayCreateOnDashboard: () => {
      createOnDashboard ??= Promise.all([
        readableSlugs(),
        createDisabledSlugs(),
      ]).then(([readable, disabled]) =>
        readerMayCreateEntry(
          caller,
          readable.filter(slug => !disabled.has(slug)),
          mayCreateIn
        )
      );
      return createOnDashboard;
    },
    mayReadReleases: () => {
      readReleases ??= callerMayReadReleases(caller);
      return readReleases;
    },
    releasesExist: () => {
      // The read only for a reader the releases domain lets read: the same
      // question it would refuse otherwise, answered here as "none".
      anyRelease ??= probe
        .mayReadReleases()
        .then(may => (may ? callerMayReadAnyRelease(caller) : false));
      return anyRelease;
    },
    getStarted: () => probe.getStartedDetail().then(detail => detail.answer),
    getStartedDetail: () => {
      started ??= getStartedDetail(probe);
      return started;
    },
  };
  return probe;
}
