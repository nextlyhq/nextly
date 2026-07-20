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
import {
  sensitiveFieldNames,
  type SensitiveFieldSource,
} from "./sensitive-fields";
import type { WebhookEventType, WebhookResource } from "./types";

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
}

/**
 * Build the envelope for one mutation and append it to the outbox inside `tx`.
 *
 * The insert shares the caller's transaction, so the event commits with the
 * content change and is never recorded for a write that later rolls back.
 */
export async function recordMutationEvent(
  tx: TransactionContext,
  args: RecordMutationEventArgs
): Promise<void> {
  const envelope = buildEnvelope({
    id: (args.newId ?? (() => crypto.randomUUID()))(),
    type: args.type,
    timestamp: args.timestamp ?? new Date(),
    resource: args.resource,
    data: args.data,
    previous: args.previous ?? null,
    actor: args.actor ?? null,
    sensitiveFields: sensitiveFieldNames(args.fields),
    ...(args.site !== undefined ? { site: args.site } : {}),
  });

  await recordEvent(tx, { envelope });
}
