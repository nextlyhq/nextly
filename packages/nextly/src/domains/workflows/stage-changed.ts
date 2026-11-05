/**
 * Every change of a part's stage, or of its approval, as a durable event integrations can act on.
 *
 * Each move site calls {@link recordStageChanged} once per part it moved, on the move's own
 * transaction: a step; an edit, or a deploy with a changed definition, withdrawing an approval;
 * a deploy that renames, redirects or detaches; a discard; and the recovery command that moves
 * stranded parts. It appends one `workflow.stage_changed` event to the webhooks outbox, so the
 * event commits with the move or not at all, and the webhook drain delivers it after commit.
 *
 * A publish closing a part's review cycle does not call it here: the publish path that builds
 * that closing calls this same function when it does.
 *
 * Recording follows the outbox's own gate, as every content write's event does: nothing is
 * appended for a collection or Single that opted out of webhook recording, or on an install with
 * no endpoint and no audit trail, where nothing would read it.
 *
 * @module domains/workflows/stage-changed
 * @experimental
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { ContentEventActor } from "../content-events/actor";
import { buildEnvelope } from "../webhooks/envelope";
import { recordEvent } from "../webhooks/record-event";
import {
  endpointsPresent,
  isWebhookAuditEnabled,
  resolveEventRetentionClass,
  shouldRecordEvent,
} from "../webhooks/recording-activation";
import { isWebhookRecordingEnabled } from "../webhooks/recording-policy";
import type { WebhookActor, WebhookResource } from "../webhooks/types";

import type { ReviewDocument } from "./review-state-repository";

/**
 * What moved a part: a step; an edit or a changed definition withdrawing an approval; a deploy
 * that renamed its stage, redirected it out of a removed one, or detached the workflow; a discard
 * of its working draft; or the recovery command.
 *
 * @experimental
 */
export type StageChangeCause =
  | "step"
  | "edit"
  | "definition"
  | "rename"
  | "redirect"
  | "detach"
  | "discard"
  | "recovery";

/**
 * One part's change of stage or approval.
 *
 * @experimental
 */
export interface StageChange {
  document: ReviewDocument;
  /** The part: a language, or null for the shared part. */
  part: string | null;
  /** The stage the part was in. */
  from: string;
  /**
   * The stage it is in now: the same as `from` for an approval withdrawn in place, and null where
   * its review state was removed (a detach or a discard).
   */
  to: string | null;
  cause: StageChangeCause;
  /** Whether the part held an approval the change took away. */
  approvalWithdrawn: boolean;
  /**
   * The hash of the definition the change was made under; for a detach, the one the part's
   * review state was last recorded under, since no definition is attached any more.
   */
  definitionHash: string;
  /** Who moved it, in the outbox's actor shape. */
  actor: WebhookActor | null;
}

/** The type every stage change is recorded under. */
const STAGE_CHANGED = "workflow.stage_changed";

/**
 * The resource an event about `document` is about: an entry of its collection, or its Single,
 * with the part's language where it is one.
 */
function resourceOf(change: StageChange): WebhookResource {
  const { document, part } = change;
  const locale = part === null ? {} : { locale: part };
  return document.scopeKind === "single"
    ? {
        kind: "single",
        slug: document.scopeSlug,
        id: document.entryId,
        ...locale,
      }
    : {
        kind: "entry",
        collection: document.scopeSlug,
        id: document.entryId,
        ...locale,
      };
}

/** The event's data: the document, the part, from and to, why, and the definition's hash. */
function dataOf(change: StageChange): Record<string, unknown> {
  return {
    document: {
      kind: change.document.scopeKind,
      slug: change.document.scopeSlug,
      id: change.document.entryId,
    },
    part: change.part,
    from: change.from,
    to: change.to,
    cause: change.cause,
    approvalWithdrawn: change.approvalWithdrawn,
    definitionHash: change.definitionHash,
  };
}

/**
 * Records one part's change of stage or approval as a `workflow.stage_changed` event in the
 * webhooks outbox, on the move's transaction `tx`: see the module. The gate's inputs are read
 * once, with no database access, so the retention class follows from the same facts that
 * admitted the event.
 *
 * @experimental
 */
export async function recordStageChanged(
  tx: TransactionContext,
  change: StageChange
): Promise<void> {
  const auditEnabled = isWebhookAuditEnabled();
  const hasEndpoints = endpointsPresent();
  const collectionAllows = isWebhookRecordingEnabled(
    change.document.scopeKind,
    change.document.scopeSlug
  );
  if (!shouldRecordEvent({ collectionAllows, auditEnabled, hasEndpoints })) {
    return;
  }
  const envelope = buildEnvelope({
    id: crypto.randomUUID(),
    type: STAGE_CHANGED,
    timestamp: new Date(),
    resource: resourceOf(change),
    data: dataOf(change),
    actor: change.actor,
  });
  await recordEvent(tx, {
    envelope,
    retentionClass: resolveEventRetentionClass({ auditEnabled, hasEndpoints }),
  });
}

/**
 * The outbox's actor for an actor as the record of content events keeps it: a person as a user,
 * an API key as itself, and anything the outbox has no kind for (a release, an agent, a
 * plugin-defined person, the system) as the system, as a write's own event records them.
 *
 * @experimental
 */
export function webhookActorOfEvent(actor: ContentEventActor): WebhookActor {
  if (actor.kind === "person") return { type: "user", id: actor.id };
  if (actor.kind === "apiKey") return { type: "apiKey", id: actor.id };
  return { type: "system" };
}
