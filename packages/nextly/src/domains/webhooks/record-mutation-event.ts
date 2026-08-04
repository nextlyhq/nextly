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

import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../auth/request-actor";

import { buildEnvelope } from "./envelope";
import {
  recordEvent,
  recordEventInTx,
  type DrizzleEventTx,
} from "./record-event";
import {
  endpointsPresent,
  isWebhookAuditEnabled,
  resolveEventRetentionClass,
  shouldRecordEvent,
} from "./recording-activation";
import { isWebhookRecordingEnabled } from "./recording-policy";
import type { EventRetentionClass } from "./retention-config";
import {
  sensitiveFieldPaths,
  type SensitiveFieldSource,
} from "./sensitive-fields";
import type { WebhookEvent, WebhookEventType, WebhookResource } from "./types";

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
 * Run the recording gates and build the envelope, or return null when the
 * mutation records nothing. Shared by both recorders so the policy (opt-out,
 * endpoint/audit gate, envelope assembly, secret stripping) lives in ONE place
 * regardless of which transaction mechanism appends the row.
 *
 * The gate inputs are read synchronously with NO database access — safe inside
 * a write transaction, where a read would deadlock a single-connection pool,
 * cache a stale snapshot, or poison the transaction. The opt-out keeps
 * PII-bearing content (e.g. form submissions) out of the outbox entirely; the
 * endpoint/audit gate avoids paying the INSERT + full serialization for an event
 * no subscriber would receive. Both fail open until primed and reconcile within
 * the flag TTL across processes; a few events recorded just before the last
 * endpoint is removed are pruned by retention.
 */
function prepareMutationEnvelope(args: RecordMutationEventArgs): {
  envelope: WebhookEvent;
  retentionClass: EventRetentionClass;
} | null {
  if (!resourceRecordingEnabled(args.resource)) {
    return null;
  }
  // Read once and reuse: the gate and the retention class are two decisions
  // from the same facts, and reading the flags twice could straddle a refresh
  // and record a row whose class disagrees with why it was admitted.
  const auditEnabled = isWebhookAuditEnabled();
  const hasEndpoints = endpointsPresent();
  if (
    !shouldRecordEvent({
      collectionAllows: true,
      auditEnabled,
      hasEndpoints,
    })
  ) {
    return null;
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
  return {
    envelope,
    retentionClass: resolveEventRetentionClass({ auditEnabled, hasEndpoints }),
  };
}

export async function recordMutationEvent(
  tx: TransactionContext,
  args: RecordMutationEventArgs
): Promise<boolean> {
  const prepared = prepareMutationEnvelope(args);
  if (!prepared) return false;
  await recordEvent(tx, prepared);
  return true;
}

/**
 * Drizzle-transaction variant of {@link recordMutationEvent}, for services that
 * write through `BaseService.withTransaction` (a Drizzle transaction) instead of
 * the adapter's positional `TransactionContext` — the auth/user service and
 * plugin write paths. Same gates, same envelope, same atomicity; only the row
 * append differs (Drizzle fluent insert vs. the positional context).
 */
export async function recordMutationEventInTx(
  tx: DrizzleEventTx,
  dialect: SupportedDialect,
  args: RecordMutationEventArgs
): Promise<boolean> {
  const prepared = prepareMutationEnvelope(args);
  if (!prepared) return false;
  await recordEventInTx(tx, dialect, prepared);
  return true;
}
