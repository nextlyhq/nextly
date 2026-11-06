/**
 * The versions workflows hold against retention, through the history's version pins.
 *
 * Two slots per part of a document, a part being a language or the shared part:
 * - `approved:<part>`, the version the part's last approval named. Pinned when it is approved,
 *   moved by the next approval, and kept after the approval is withdrawn, so "since approved"
 *   can still be shown, until a publish of the part releases it.
 * - `entered-review:<part>`, the version the part was in when it last entered review, by a step
 *   or by an edit that returned it there. Moved each time it enters review again, and released
 *   when a publish closes the part's review cycle.
 *
 * The shared part is spelled `*`, which no language code can be (`[A-Za-z0-9_-]+`), so its slots
 * never collide with a language's.
 *
 * @module domains/workflows/workflow-pins
 * @experimental
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { registerVersionPinHolder } from "../versions/version-pins";
import type { VersionRef } from "../versions/versions-repository";

/**
 * The workflows holder: the one handle its slots are pinned, moved and released through.
 *
 * @experimental
 */
export const workflowPins = registerVersionPinHolder({
  name: "workflows",
  label: "Workflows",
});

/** The token a slot names a part by: its language, or `*` for the shared part. */
function partToken(part: string | null): string {
  return part ?? "*";
}

/**
 * The slot holding the version a part's last approval named.
 *
 * @experimental
 */
export function approvedSlot(part: string | null): string {
  return `approved:${partToken(part)}`;
}

/**
 * The slot holding the version a part was in when it last entered review.
 *
 * @experimental
 */
export function enteredReviewSlot(part: string | null): string {
  return `entered-review:${partToken(part)}`;
}

/** Points `slot` of the document at `versionNo`, on the caller's transaction. */
export function pinPart(
  tx: TransactionContext,
  ref: VersionRef,
  slot: string,
  versionNo: number
): Promise<void> {
  return workflowPins.pin(tx, { ref, slot, versionNo });
}

/**
 * Releases both of a part's slots, on the caller's transaction: what a publish of the part does,
 * closing its review cycle.
 *
 * @experimental
 */
export async function releasePartPins(
  tx: TransactionContext,
  ref: VersionRef,
  part: string | null
): Promise<void> {
  await workflowPins.release(tx, { ref, slot: approvedSlot(part) });
  await workflowPins.release(tx, { ref, slot: enteredReviewSlot(part) });
}
