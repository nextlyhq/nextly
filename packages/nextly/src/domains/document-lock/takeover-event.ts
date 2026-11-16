/**
 * A takeover, as the document's history records it.
 *
 * Taking a document over is the one thing the lock does that an editor later
 * asks about ("who took this from me"), so it is the one thing it records. A
 * claim, a renewal, a request for access, a release and a lapse displace
 * nobody and record nothing, which keeps the history about the document
 * rather than about who had it open.
 *
 * The event names the displaced holder by id only. The lock row also keeps a
 * label for them, but that label may be an email address, and a name copied
 * into an event outlives the erasure of a deleted account, which clears only
 * the event's own actor name. The holder is named when history is read
 * (`named-takeovers.ts` in the record of content events).
 *
 * @module domains/document-lock/takeover-event
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import {
  contentEventKind,
  registerContentEventKind,
} from "../content-events/kinds";
import { TAKEOVER_CONTENT_EVENT_KIND } from "../content-events/named-takeovers";
import { recordWriteEvent } from "../content-events/write-event";

import type { DocumentLockClaimant } from "./document-lock-repository";
import type { DocumentRef } from "./types";

/** Register the takeover kind, when it is not registered already. */
function ensureTakeoverContentEventKind(): void {
  if (!contentEventKind(TAKEOVER_CONTENT_EVENT_KIND.name)) {
    registerContentEventKind(TAKEOVER_CONTENT_EVENT_KIND);
  }
}

/**
 * Record that `claimant` took `ref` over from `fromId`, on `tx`, the
 * transaction that replaced the claim. A failure here fails that
 * transaction, so the takeover never stands without its event.
 */
export async function recordTakeoverEvent(
  tx: TransactionContext,
  adapter: Pick<DrizzleAdapter, "getCapabilities">,
  ref: DocumentRef,
  claimant: DocumentLockClaimant,
  fromId: string
): Promise<void> {
  ensureTakeoverContentEventKind();
  await recordWriteEvent(
    tx,
    { adapter },
    {
      // The lock's entry id is the document's own id, for a Single as for an
      // entry, which is the id the document's history is kept under.
      subject: { kind: ref.scopeKind, slug: ref.slug, id: ref.entryId },
      kind: TAKEOVER_CONTENT_EVENT_KIND,
      actor: claimant.actor,
      personName: claimant.personName ?? null,
      payload: { fromId },
    }
  );
}
