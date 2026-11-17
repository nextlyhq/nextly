/**
 * How workflows tell the release checks that what their "Not approved" check judges has changed,
 * so a scheduled release holding the documents named is checked again then and stopped before
 * its moment, rather than at it.
 *
 * The release checks hand the function to call once, as the check source is registered (its
 * `signal`); it is kept here, apart from the source, so the modules that change an approval (a
 * step) reach it without importing the source. Each caller calls it after its own transaction
 * has committed, never inside one: the checks read as any reader does, and a stop opens a
 * transaction of its own. Until the source is registered there is nothing to tell, and a call
 * does nothing.
 *
 * Saves need no call: a collection's or Single's save already has the releases holding what it
 * wrote checked again after it commits, which covers an edit that withdraws an approval.
 *
 * @module domains/workflows/release-recheck-signal
 */
import type { ReleaseRecheckTarget } from "../releases/release-recheck";

import { registeredWorkflows } from "./registry";

type Recheck = (target: ReleaseRecheckTarget) => Promise<void>;

let handed: Recheck | null = null;

/** Keeps the function the release checks hand the source as it is registered. */
export function keepReleaseRecheck(recheck: Recheck): void {
  handed = recheck;
}

/**
 * Has the scheduled releases holding what `target` names checked again, and any with a hard
 * problem stopped. Never fails: the release checks log a stop they could not make, and a
 * release's run asks again at its moment.
 */
export async function recheckReleasesHolding(
  target: ReleaseRecheckTarget
): Promise<void> {
  await handed?.(target);
}

/**
 * Has every scheduled release holding a document of a collection or Single with a workflow
 * attached checked again: what a server's start does once its workflows are registered and
 * review state follows them.
 *
 * A start is where two changes land that leave nothing to signal from: approvals withdrawn by a
 * change of definition, which `nextly migrate` may make in another process, and a workflow
 * attached for the first time, which is recorded nowhere, so no start can tell a first
 * attachment from a later one. Checking every attached scope covers both, and a release stopped
 * once is no longer scheduled, so a later start stops and tells nothing twice.
 */
export async function recheckReleasesInWorkflowScopes(): Promise<void> {
  const scopes = registeredWorkflows().flatMap(entry => [
    ...entry.collections.map(slug => ({
      scopeKind: "collection" as const,
      scopeSlug: slug,
    })),
    ...entry.singles.map(slug => ({
      scopeKind: "single" as const,
      scopeSlug: slug,
    })),
  ]);
  if (scopes.length === 0) return;
  await recheckReleasesHolding({ scopes });
}
