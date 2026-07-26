/**
 * Webhook domain — the mutation-seam recording helper.
 *
 * One call every write path uses to make a change observable: it derives the
 * collection's sensitive field names, builds the envelope, and appends the
 * durable outbox row inside the caller's transaction. Centralizing it keeps the
 * seams uniform — a write path supplies only what it already has (the assembled
 * document, the prior state, the actor) and never assembles an envelope itself,
 * so a policy change (a new stripped field, a new envelope key) lands in one
 * place instead of a dozen call sites.
 *
 * @module domains/webhooks/record-mutation-event
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../auth/request-actor";

import { buildEnvelope } from "./envelope";
import { recordEvent } from "./record-event";
import { isWebhookRecordingEnabled } from "./recording-policy";
import {
  sensitiveFieldPaths,
  type SensitiveFieldSource,
} from "./sensitive-fields";
import type { WebhookEventType, WebhookResource } from "./types";

/**
 * Whether the changed resource opted out of webhook recording. Resolves the
 * per-entity policy from the event `resource`: an entry is gated by its
 * collection slug, a single by its own slug. Other kinds (media, user, ...)
 * carry no per-entity opt-out and always record.
 */
function resourceRecordingEnabled(resource: WebhookResource): boolean {
  if (resource.kind === "entry") {
    return isWebhookRecordingEnabled("collection", resource.collection);
  }
  if (resource.kind === "single" && resource.slug !== undefined) {
    return isWebhookRecordingEnabled("single", resource.slug);
  }
  return true;
}

/** Arguments for recording one mutation as a durable outbox event. */
export interface RecordMutationEventArgs {
  type: WebhookEventType;
  resource: WebhookResource;
  /**
   * The just-written document in READ SHAPE — JSON container fields already
   * parsed to objects/arrays. Recursive secret stripping only descends into
   * real objects, so a field still held as a JSON string would ship unstripped.
   */
  data: Record<string, unknown>;
  /** Prior state for update/delete/status changes; null on create. */
  previous?: Record<string, unknown> | null;
  /** The collection/single field config, used to derive what must be stripped. */
  fields: readonly SensitiveFieldSource[];
  /** Who performed the write. */
  actor?: RequestActor | null;
  /** Origin site from config, when configured. */
  site?: string;
  /** Event time; defaults to now. Injectable so tests stay deterministic. */
  timestamp?: Date;
  /** Event id generator; defaults to a random UUID. Injectable for tests. */
  newId?: () => string;
  /** Status delta for a lifecycle event; forwarded to the envelope. */
  statusChange?: { from: string | null; to: string };
}

/**
 * Build the envelope for one mutation and append it to the outbox inside `tx`.
 *
 * The insert shares the caller's transaction, so the event commits with the
 * content change and is never recorded for a write that later rolls back.
 *
 * @returns `true` when an outbox event was appended; `false` when the resource
 * opted out of recording. Callers gate their post-commit webhook work (fast
 * drain, retention pass) on this, so an opted-out write schedules nothing.
 */
export async function recordMutationEvent(
  tx: TransactionContext,
  args: RecordMutationEventArgs
): Promise<boolean> {
  // Collection/single opt-out: a resource whose entity set `webhooks: false`
  // records nothing, so PII-bearing content (e.g. form submissions carrying
  // ipAddress/userAgent) never enters the outbox or the delivery path. Enforced
  // here at the single seam so every write path inherits it.
  if (!resourceRecordingEnabled(args.resource)) {
    return false;
  }

  const envelope = buildEnvelope({
    id: (args.newId ?? (() => crypto.randomUUID()))(),
    type: args.type,
    timestamp: args.timestamp ?? new Date(),
    resource: args.resource,
    data: args.data,
    previous: args.previous ?? null,
    actor: args.actor ?? null,
    sensitiveFields: sensitiveFieldPaths(args.fields),
    ...(args.site !== undefined ? { site: args.site } : {}),
    ...(args.statusChange !== undefined
      ? { statusChange: args.statusChange }
      : {}),
  });

  await recordEvent(tx, { envelope });
  return true;
}
