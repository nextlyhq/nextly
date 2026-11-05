/**
 * Review state goes with the content it describes, in the transaction that removes the content:
 * a deleted document's every part, and a part whose working draft is discarded.
 *
 * The review states table has no foreign key to content tables, so the code that removes content
 * removes these rows. Only for a collection or Single a workflow is attached to: elsewhere there
 * is no review state (a deploy that detached a workflow removed it), and an install with no
 * workflow may not have the table at all.
 *
 * @module domains/workflows/review-state-cleanup
 * @experimental
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../auth/request-actor";
import {
  recordWriteEvent,
  type WriteEventDeps,
} from "../content-events/write-event";
import { VersionsRepository } from "../versions/versions-repository";

import { workflowAttachedTo } from "./registry";
import {
  ensureReviewStateEventKinds,
  eventParts,
  REVIEW_STATE_EVENT_KINDS,
} from "./review-state-events";
import {
  deleteDocumentReviewStates,
  deletePartReviewState,
  readReviewState,
  type ReviewDocument,
  type ReviewState,
} from "./review-state-repository";
import { releasePartPins } from "./workflow-pins";

/**
 * Removes every part's review state of a deleted document, on the delete's transaction. The
 * versions workflows pinned for it are removed by the delete's own sweep of the document's pins.
 *
 * @experimental
 */
export async function removeDeletedDocumentReviewStates(
  tx: TransactionContext,
  document: ReviewDocument
): Promise<void> {
  if (!workflowAttachedTo(document.scopeKind, document.scopeSlug)) return;
  await deleteDocumentReviewStates(tx, document);
}

/** A discard of one part's working draft, as its write path knows it. */
interface Discard {
  document: ReviewDocument;
  /** The language whose draft was discarded, or null for an untranslated document's. */
  part: string | null;
  actor: RequestActor;
  personName?: string | null;
}

/**
 * The parts a discard leaves with nothing unpublished: the part discarded, and the shared part of
 * a translated document once no language holds a draft, since a draft is what the shared part's
 * pending content is part of. Read on `tx`, after the draft's delete.
 */
async function partsLeftWithoutDraft(
  tx: TransactionContext,
  discard: Discard
): Promise<(string | null)[]> {
  if (discard.part === null) return [null];
  const pending = await new VersionsRepository(tx).findPendingChangeLocales(
    discard.document.scopeKind,
    discard.document.scopeSlug,
    [discard.document.entryId]
  );
  return pending.has(discard.document.entryId)
    ? [discard.part]
    : [discard.part, null];
}

/**
 * Closes the review of each part a discard left with nothing unpublished, on the discard's
 * transaction: its review state is removed, the versions workflows pinned for it are released, as
 * a publish closing its cycle releases them, and one `workflow-discarded` event per stage the
 * parts were in records it as the discarder's act. A part with no review state has no review to
 * close, and records nothing.
 *
 * @experimental
 */
export async function closeReviewOnDiscard(
  tx: TransactionContext,
  deps: WriteEventDeps,
  discard: Discard
): Promise<void> {
  const registered = workflowAttachedTo(
    discard.document.scopeKind,
    discard.document.scopeSlug
  );
  if (!registered) return;
  const closed: ReviewState[] = [];
  for (const part of await partsLeftWithoutDraft(tx, discard)) {
    const state = await readReviewState(tx, { ...discard.document, part });
    if (!state) continue;
    await deletePartReviewState(tx, state);
    await releasePartPins(tx, discard.document, part);
    closed.push(state);
  }
  if (closed.length === 0) return;
  ensureReviewStateEventKinds();
  for (const from of [...new Set(closed.map(state => state.stage))].sort()) {
    await recordWriteEvent(tx, deps, {
      subject: {
        kind: discard.document.scopeKind,
        slug: discard.document.scopeSlug,
        id: discard.document.entryId,
      },
      kind: REVIEW_STATE_EVENT_KINDS.discarded,
      actor: discard.actor,
      personName: discard.personName ?? null,
      parts: eventParts(
        closed.filter(state => state.stage === from).map(state => state.part)
      ),
      fromState: from,
      definitionHash: registered.definitionHash,
    });
  }
}
