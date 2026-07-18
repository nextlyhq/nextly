/**
 * Webhook domain — capture helpers for the content write paths.
 *
 * Turn a content mutation into a delivery envelope: map the acting user to an
 * actor and assemble the entry envelope with its sensitive fields stripped.
 * Pure and storage-agnostic — the write path passes the already-deserialized
 * document (JSON container fields parsed to objects, per `buildEnvelope`'s
 * contract) and the resulting envelope goes to `recordEvent` inside the same
 * transaction. Keeping this here leaves the webhooks domain decoupled from the
 * collections layer's serialization details.
 *
 * @module domains/webhooks/capture
 */

import { buildEnvelope } from "./envelope";
import {
  sensitiveFieldNames,
  type SensitiveFieldSource,
} from "./sensitive-fields";
import type { WebhookActor, WebhookEvent, WebhookEventType } from "./types";

/** Minimal shape of the acting user the write paths carry. */
export interface ActorSource {
  id?: string | null;
}

/**
 * Derive the webhook actor from the acting user. A present user id is a `user`
 * actor; its absence is a `system` actor (a background/unauthenticated write).
 * API-key actors are identified upstream, not on the user context, so they are
 * a later refinement.
 */
export function toWebhookActor(
  user: ActorSource | null | undefined
): WebhookActor {
  if (user && user.id) return { type: "user", id: user.id };
  return { type: "system" };
}

export interface BuildCollectionEnvelopeInput {
  /** Fresh envelope id (also the idempotency key); caller-generated. */
  eventId: string;
  /** Event time; caller-supplied so the builder stays deterministic. */
  timestamp: Date;
  type: WebhookEventType;
  collection: string;
  docId: string;
  /** Current document state, already deserialized (JSON fields as objects). */
  data: Record<string, unknown>;
  /** Prior document state on update/delete; null on create. Same deserialized shape. */
  previous?: Record<string, unknown> | null;
  /** Collection field configs; drives which field names are stripped. */
  fields: readonly SensitiveFieldSource[];
  actor?: WebhookActor | null;
}

/**
 * Build the `entry.*` envelope for a collection mutation, stripping the
 * collection's password/hidden fields from both `data` and `previous`.
 */
export function buildCollectionEnvelope(
  input: BuildCollectionEnvelopeInput
): WebhookEvent {
  return buildEnvelope({
    id: input.eventId,
    timestamp: input.timestamp,
    type: input.type,
    resource: {
      kind: "entry",
      collection: input.collection,
      id: input.docId,
    },
    data: input.data,
    previous: input.previous ?? null,
    actor: input.actor ?? undefined,
    sensitiveFields: sensitiveFieldNames(input.fields),
  });
}
