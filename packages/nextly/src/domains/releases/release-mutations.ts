/**
 * Performing a release through the ORDINARY content mutation.
 *
 * ## Why this is thin on purpose
 *
 * Publishing already knows how to publish. `updateEntry` authorizes the
 * transition, runs the hooks, records the outbox event, and — for a
 * draft-split collection — folds the pending working draft into the live write
 * and deletes the sidecar in the same transaction. A materialiser that wrote
 * rows itself would be a second implementation of publishing, and the first one
 * a scheduled publish diverged from would be the one nobody was watching.
 *
 * So this maps a decision onto a call and does nothing else.
 *
 * ## Why it goes through the bound content client
 *
 * The write runs as the member's author, and `createJobContentApi` is where
 * that binding already lives — including clearing every authorization-bearing
 * option so an instance default cannot reinstate one. Binding the identity here
 * instead would be a second place to get that right, and the first version of
 * that binding had five ways through it.
 *
 * ## Why the locale travels
 *
 * A member may name one language. The READ seam deliberately ignores such a
 * member, because per-locale lifecycle is not on the row it filters — but the
 * write can express it, by writing that language's companion row and leaving
 * the main row alone, which is exactly what an ordinary localized publish does.
 * Passing the locale through is what keeps a one-language release from
 * publishing every language.
 *
 * ## Why a document-wide member sends the wildcard
 *
 * A member that names NO language means the document — all of it. Sending
 * `undefined` said something quieter and wrong: "use the default language",
 * which moved the main row and the default translation and left every other
 * translation where it was. A scheduled takedown therefore pulled a page down
 * and went on serving its German version, which is worse than not scheduling
 * it, because the release reported success.
 *
 * {@link EVERY_LOCALE} says the thing that was meant. It rides the ordinary
 * mutation like any other locale, so this module keeps its one job of mapping a
 * decision onto a call — the sweep is the write path's business, and lives
 * beside the write that has to be atomic with it.
 *
 * @module domains/releases/release-mutations
 */

import type { UserContext } from "../collections/services/collection-types";
import { EVERY_LOCALE } from "../i18n/locale-selector";
import { createJobContentApi } from "../jobs/job-content-api";
import type { JobContentSource } from "../jobs/job-content-api";
import type { VersionsRepository } from "../versions/versions-repository";

import type { ReleaseMutations } from "./apply-due-releases";
import type { ReleaseCheckReads } from "./readiness/check-sources";
import type { DocumentRef } from "./releases-repository";

/**
 * The status an unpublish lands on.
 *
 * Not a separate operation: the lifecycle has two values, and the transition
 * gate reads the status a write NAMES — `transitionNextStatus === "published"`
 * is a publish and anything else is an unpublish. Naming the target status is
 * therefore the whole of it.
 */
const WITHDRAWN_STATUS = "draft";

/**
 * A document's lifecycle as stored: the main row's own status and each stored
 * translation's, keyed by locale (empty where it keeps no translations).
 */
export interface ReleaseStoredLifecycle {
  status: string | null;
  languages: ReadonlyMap<string, string | null>;
}

/**
 * What tells whether a release action already stands, answered as its write
 * would answer it.
 */
export interface ReleaseSettlementReads {
  /**
   * The document's lifecycle read from storage, where no read hook can
   * rewrite it; `null` where it cannot be read, which never counts as
   * standing.
   */
  storedLifecycle(ref: DocumentRef): Promise<ReleaseStoredLifecycle | null>;
  /** The access gate the action's write meets, for its author. */
  mayPerform: ReleaseCheckReads["mayPerform"];
}

export function createReleaseMutations(deps: {
  /** The Direct API. Injected for the reason the applier's own deps are. */
  contentApi: JobContentSource;
  /** Where a document's pending working drafts are read. */
  drafts: Pick<VersionsRepository, "listWorkingDraftLocales">;
  /**
   * The stored lifecycle and the write's access gate. Without them nothing is
   * reported settled, since the document read reports only the default
   * language, through its read hooks, and judges no author; `applied` then
   * reads the document back as it always has.
   */
  settlement?: ReleaseSettlementReads;
}): ReleaseMutations {
  const write = async (
    ref: DocumentRef,
    user: UserContext,
    status: string
  ): Promise<void> => {
    const content = createJobContentApi(user, deps.contentApi);
    // A member that names no language means the whole document; see the module
    // note. `undefined` would mean "the default language" and leave the rest live.
    const locale = ref.locale ?? EVERY_LOCALE;

    if (ref.scopeKind === "single") {
      await content.updateSingle({
        slug: ref.scopeSlug as never,
        data: { status },
        locale,
      });
      return;
    }

    await content.update({
      collection: ref.scopeSlug as never,
      id: ref.entryId,
      data: { status },
      locale,
    });
  };

  /** The stored lifecycle of whatever a document read returned. */
  const statusOf = (doc: unknown): string | undefined => {
    if (doc === null || typeof doc !== "object") return undefined;
    const status = (doc as Record<string, unknown>).status;
    return typeof status === "string" ? status : undefined;
  };

  const currentStatus = async (
    ref: DocumentRef
  ): Promise<string | undefined> => {
    // TRUSTED, and deliberately not through the bound client. This read is not
    // the member's action — it asks the database whether a write committed, so
    // that a post-commit hook failure is not replayed forever. Running it as the
    // author would deny it whenever that person may publish this scope but has
    // no independent READ permission on it, and the verification would then
    // report every committed write as failed for exactly the roles most likely
    // to own a scheduled publish.
    //
    // Only where no settlement reads are given: this read runs the scope's
    // read hooks and reports the default language alone, which those reads
    // do not.
    const content = deps.contentApi;
    const locale = ref.locale ?? undefined;

    if (ref.scopeKind === "single") {
      const doc = await content.findSingle({
        slug: ref.scopeSlug as never,
        locale,
        overrideAccess: true,
        // The stored lifecycle, not what a published read would admit: a due
        // release is applied AT READ TIME, so a bounded read would report the
        // document as published whether or not this write landed.
        status: "all",
      } as never);
      return statusOf(doc);
    }

    const doc = await content.findByID({
      collection: ref.scopeSlug as never,
      id: ref.entryId,
      locale,
      overrideAccess: true,
      status: "all",
    } as never);
    return statusOf(doc);
  };

  /** Whether a stored lifecycle is the one an action leaves behind. */
  const reached = (
    status: string | undefined,
    effect: "publish" | "unpublish"
  ): boolean =>
    effect === "publish" ? status === "published" : status === WITHDRAWN_STATUS;

  const mutations: ReleaseMutations = {
    publish: ({ ref, user }) => write(ref, user, "published"),
    unpublish: ({ ref, user }) => write(ref, user, WITHDRAWN_STATUS),
    applied: async ({ ref, effect }) =>
      reached(await currentStatus(ref), effect),
  };
  const settlement = deps.settlement;
  if (settlement === undefined) return mutations;

  /**
   * Whether the action stands as its write would leave it, for this author:
   * the author passes the gate the write meets, and the stored main row and
   * every stored translation already have the status the action leaves. The
   * gate first, as the write asks it first: a document already live does not
   * excuse an author who may no longer publish it.
   */
  const stands = async (
    ref: DocumentRef,
    effect: "publish" | "unpublish",
    user: UserContext
  ): Promise<boolean> => {
    if (!(await settlement.mayPerform(user, ref, effect))) return false;
    const stored = await settlement.storedLifecycle(ref);
    if (stored === null) return false;
    if (!reached(stored.status ?? undefined, effect)) return false;
    for (const status of stored.languages.values()) {
      if (!reached(status ?? undefined, effect)) return false;
    }
    return true;
  };

  return {
    ...mutations,
    // The same question after a write: a refused write leaves a document
    // that was already live standing, and that is no proof the author's
    // action was performed.
    applied: ({ ref, effect, user }) => stands(ref, effect, user),
    settled: async ({ ref, effect, user }) => {
      if (!(await stands(ref, effect, user))) return false;
      // A held working draft, in any language, is content the write would
      // still promote, so the action is not a no-op while one exists. Every
      // language, because a member names the whole document.
      const held = await deps.drafts.listWorkingDraftLocales({
        scopeKind: ref.scopeKind,
        scopeSlug: ref.scopeSlug,
        entryId: ref.entryId,
      });
      return held.length === 0;
    },
  };
}
