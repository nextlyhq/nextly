/**
 * The one seam a read path uses to ask what a due release makes visible.
 *
 * A read needs two things from the releases domain and must not have to know
 * that: the cheap check that says whether asking is worth it at all, and the
 * lookup that answers. Handing a query service both would put the ORDER of
 * those two in six places — and the order is the whole optimisation. Getting it
 * wrong costs a query per read on a path that is otherwise a single statement.
 *
 * ## The cheap check is the point
 *
 * While no scheduled release has taken effect, no document can be affected, and
 * the entire question is a comparison between two instants. Only when something
 * IS due does a read pay for the lookup. So the common case — which is every
 * read on every site that has never scheduled a release — costs one memo read.
 *
 * ## Why a null object rather than an optional dependency
 *
 * A caller without releases wired gets {@link NO_RELEASE_VISIBILITY}, which
 * answers "nothing" without asking anything. An optional dependency would make
 * every call site write `?? []`, and one that forgot would silently narrow a
 * read rather than fail — the failure mode this whole path exists to avoid.
 *
 * @module domains/releases/release-visibility
 */

import type { VersionScopeKind } from "../../schemas/versions/types";

import { actionsByComponent, componentHold } from "./component-hold";
import { goingLiveHold, type GoingLiveHold } from "./going-live-hold";
import { planReleaseMaterialisation } from "./plan-release-materialisation";
import { isDueAt } from "./release-due";
import type { DueCheck } from "./release-read";
import { NO_DECISIONS } from "./release-scope";
import type { ReleaseDecisions } from "./release-scope";
import { ReleasesRepository } from "./releases-repository";
import type { ReleasesDbApi } from "./releases-repository";
import { transitionCacheFor } from "./transition-cache-registry";

export interface RevealQuery {
  scopeKind: VersionScopeKind;
  scopeSlug: string;
  now: Date;
}

export interface ReleaseVisibility {
  /**
   * What a due release does to the documents in this scope — both directions.
   *
   * Two empty sets are the overwhelmingly common answer, and are reached
   * without a query.
   */
  decisions(query: RevealQuery): Promise<ReleaseDecisions>;
}

/** The lookup half, satisfied by `ReleasesRepository`. */
export interface RevealSource {
  findDueDecisions(input: RevealQuery): Promise<ReleaseDecisions>;
  /** The releases holding the documents decided, and their members, to plan (`withoutHeld`). */
  scheduledMembersFor: ReleasesRepository["scheduledMembersFor"];
  listMembersOf: ReleasesRepository["listMembersOf"];
}

/**
 * Answers "nothing", without asking.
 *
 * For a runtime with no releases wired. Deliberately a real object rather than
 * `undefined`: a missing dependency should not be something each call site
 * remembers to handle.
 */
export const NO_RELEASE_VISIBILITY: ReleaseVisibility = {
  // Not `async () => ...`: there is nothing to await, and declaring it async
  // only to satisfy the interface trips the rule that asks why.
  decisions: () => Promise.resolve(NO_DECISIONS),
};

export function createReleaseVisibility(deps: {
  cache: DueCheck;
  repository: RevealSource;
  /**
   * What holds a document back from going live, asked per read: the registered hold when left
   * out, looked up when a read needs it, so a hold registered after this was built still counts.
   */
  hold?: () => GoingLiveHold;
}): ReleaseVisibility {
  const hold = deps.hold ?? goingLiveHold;
  return {
    async decisions(query: RevealQuery): Promise<ReleaseDecisions> {
      // The cheap check first, always. Reversing these two turns the common
      // case — nothing scheduled anywhere — from a memo read into a query
      // against the members table on every read of every collection.
      if (!(await deps.cache.mayHaveDue(query.now))) return NO_DECISIONS;
      const due = await deps.repository.findDueDecisions(query);
      return withoutHeld(due, query, hold(), deps.repository);
    },
  };
}

/**
 * `due` without the documents of a component the run refuses whole. The run writes a component
 * of due releases all or nothing, and refuses all of it when a document it would publish is held
 * back from going live (`componentHold`), so a read in the window between the moment and the run
 * must project none of that component either: neither the publishes nor the takedowns beside
 * the held document, which the run will not make.
 *
 * Planned as the run plans (`planReleaseMaterialisation`) and asked as the run asks, so the two
 * cannot disagree. Read only when this scope has a decision to make, and only while something is
 * due, which the cheap check above already established.
 *
 * Bounded to the due releases holding a document this read decides, not the whole due backlog:
 * a read pays for its own documents' releases. A component can reach further, through a release
 * that shares a document with one of these but none with this scope; a hold there is not seen
 * here, and the run, which plans every due release, still refuses that component.
 */
async function withoutHeld(
  due: ReleaseDecisions,
  query: RevealQuery,
  hold: GoingLiveHold,
  repository: RevealSource
): Promise<ReleaseDecisions> {
  if (due.reveal.length === 0 && due.hide.length === 0) return due;
  const holding = await repository.scheduledMembersFor({
    documents: [...due.reveal, ...due.hide].map(entryId => ({
      scopeKind: query.scopeKind,
      scopeSlug: query.scopeSlug,
      entryId,
    })),
  });
  const releases = holding.flatMap(({ release }) =>
    release.scheduledAt !== null && isDueAt(release.scheduledAt, query.now)
      ? [release]
      : []
  );
  if (releases.length === 0) return due;
  const plan = planReleaseMaterialisation({
    releases: releases.map(release => ({
      id: release.id,
      // Due releases always carry an instant; the run narrows the same way.
      scheduledAt: release.scheduledAt ?? query.now,
      revision: release.revision,
    })),
    members: await repository.listMembersOf(
      releases.map(release => release.id)
    ),
    now: query.now,
  });
  const decided = new Set([...due.reveal, ...due.hide]);
  const withheld = new Set<string>();
  for (const actions of actionsByComponent(plan)) {
    const here = actions.filter(
      action =>
        action.ref.scopeKind === query.scopeKind &&
        action.ref.scopeSlug === query.scopeSlug &&
        decided.has(action.ref.entryId)
    );
    if (here.length === 0) continue;
    if (
      (await componentHold(documents => hold.held(documents), actions)) !== null
    ) {
      for (const action of here) withheld.add(action.ref.entryId);
    }
  }
  if (withheld.size === 0) return due;
  return {
    reveal: due.reveal.filter(entryId => !withheld.has(entryId)),
    hide: due.hide.filter(entryId => !withheld.has(entryId)),
  };
}

/**
 * The ordinary construction: a repository over this adapter, and a cheap check
 * that memoizes the earliest scheduled instant.
 *
 * Extracted because three services need one — the collection reads, the Single
 * reads and the relationship expansion — and the assembly is not the obvious
 * part. Three hand-written copies would each have to remember that the cache is
 * per SERVICE and not per read: a cache built inside a read reloads the
 * earliest instant on every request and turns the optimisation into a cost.
 */
export function releaseVisibilityFor(db: ReleasesDbApi): ReleaseVisibility {
  const repository = new ReleasesRepository(db);
  // The SHARED memo, not a second one. Two independent windows over one
  // schedule let this seam and the cache bound disagree about whether anything
  // is due, and a page cached during that disagreement outlives the release.
  return createReleaseVisibility({
    cache: transitionCacheFor(db, () => repository.findScheduledTransitions()),
    repository,
  });
}
