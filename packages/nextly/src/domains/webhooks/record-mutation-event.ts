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
import type {
  ActivityLogAction,
  ActivityWriteDb,
} from "../../services/dashboard/activity-log-service";
import { markWriteIntegrityFailure } from "../../shared/write-integrity";
import {
  recordMutationActivity,
  type RecordMutationActivityInput,
} from "../audit/record-activity";

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

/**
 * The activity action one event type stands for, or undefined when it stands
 * for none.
 *
 * Only the three primary entry events map. The lifecycle events
 * (`entry.published` and its siblings) and a collection's curated event
 * accompany one of them for the SAME write, so mapping those too would file one
 * change as several. Singles are absent deliberately: the trail's scope column
 * is read as a collection slug by everything that renders it, and a single's
 * slug there would resolve to a collection that does not exist.
 */
const ACTIVITY_ACTIONS: Partial<Record<WebhookEventType, ActivityLogAction>> = {
  "entry.created": "create",
  "entry.updated": "update",
  "entry.deleted": "delete",
};

/**
 * Record the mutation's activity entry, ahead of the outbox gates.
 *
 * Deliberately BEFORE them: the outbox is delivery infrastructure and an
 * install with no endpoints records nothing there, while the trail answers who
 * changed what and has to hold whether or not anyone subscribed. Gating the two
 * together would make an install's audit history a side effect of whether it
 * happened to use webhooks.
 */
async function recordActivity(
  db: () => ActivityWriteDb,
  args: RecordMutationEventArgs
): Promise<void> {
  const action = ACTIVITY_ACTIONS[args.type];
  if (!action || args.resource.kind !== "entry") return;
  await writeActivity(db, {
    action,
    collection: args.resource.collection,
    ...(args.resource.id !== undefined ? { entryId: args.resource.id } : {}),
    // 🔴 DERIVED from the resource the event already carries, not passed
    // separately. The write sites that know a language already record it there
    // for receivers to route on, so taking it from one place means a site
    // cannot report a locale to a subscriber and a different one — or none — to
    // the activity trail. A resource without a locale leaves the column NULL,
    // which the feed reads as the default language: exactly what an unlocalized
    // write, and every row predating the column, already meant.
    ...(args.resource.locale !== undefined
      ? { locale: args.resource.locale }
      : {}),
    data: args.data,
    previous: args.previous ?? null,
    actor: args.actor ?? null,
  });
}

/**
 * Write the entry, failing the surrounding transaction if it cannot be written.
 *
 * The failure is marked before it can reach the bulk workers: they turn an
 * ordinary error raised after a row was written into a soft per-item failure
 * and carry on inside the SAME transaction, which would commit the content
 * change with no entry describing it — the exact outcome recording inside the
 * transaction exists to prevent.
 */
async function writeActivity(
  db: () => ActivityWriteDb,
  input: RecordMutationActivityInput
): Promise<void> {
  try {
    await recordMutationActivity(db, input);
  } catch (err) {
    throw markWriteIntegrityFailure(err);
  }
}

/**
 * Record an entry's activity for a write that appends NO outbox event.
 *
 * The outbox and the trail answer different questions, and a working-draft save
 * is where they diverge: no published document changed, so no subscriber has
 * anything to receive — but a person did edit content, and the trail records
 * people. Recording it through the event seam would either invent a public
 * event for a private edit or, as it did, drop the edit from the trail entirely.
 */
export async function recordEntryActivity(
  tx: TransactionContext,
  input: RecordMutationActivityInput
): Promise<void> {
  await writeActivity(() => tx.getDrizzle(), input);
}

export async function recordMutationEvent(
  tx: TransactionContext,
  args: RecordMutationEventArgs
): Promise<boolean> {
  await recordActivity(() => tx.getDrizzle(), args);
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
  // Widened, not converted: the value IS a dialect-specific Drizzle
  // transaction, whose generic builder types do not structurally match the
  // minimal read/write surface the activity write is written against. The
  // service casts its own handle for the same reason.
  await recordActivity(() => tx as unknown as ActivityWriteDb, args);
  const prepared = prepareMutationEnvelope(args);
  if (!prepared) return false;
  await recordEventInTx(tx, dialect, prepared);
  return true;
}
