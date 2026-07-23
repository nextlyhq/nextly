/**
 * Webhook domain — delivery (delivery rows to HTTP requests).
 *
 * The drain's second phase. Fan-out turns events into `nextly_webhook_deliveries`
 * rows; this claims the rows that are due, signs and sends each one over the
 * SSRF-safe transport, and records the outcome — marking the delivery delivered,
 * scheduled for a jittered retry, or permanently failed per {@link decideDelivery}.
 *
 * Concurrency: a delivery is claimed with a short lease (`locked_by`/`locked_until`)
 * taken inside its own transaction, then the HTTP request runs with NO transaction
 * open (a network call must never hold a DB lock). The lease keeps a second drain
 * off the row for the request window; SQLite's single-writer transactions make the
 * claim exclusive, and on Postgres/MySQL the lease makes a concurrent double-send
 * rare and harmless (deliveries carry the Standard Webhooks `webhook-id`, so a
 * conformant receiver dedupes). A stronger `FOR UPDATE SKIP LOCKED` claim is a
 * follow-up gated on the adapter growing a row-locking primitive.
 *
 * @module domains/webhooks/deliver
 */

import type { SelectOptions } from "@nextlyhq/adapter-drizzle/types";

import {
  ExternalUrlError,
  SafeFetchError,
  safeFetch,
} from "../../utils/validate-external-url";

import {
  classifyResponse,
  decideDelivery,
  type AttemptOutcome,
} from "./delivery-policy";
import { buildSignatureHeaders } from "./signing";

/** Default number of due deliveries a single `deliverDueDeliveries` call claims. */
const DEFAULT_DELIVER_BATCH = 50;
/** Default lease held on a claimed row while its request is in flight. */
const DEFAULT_LEASE_MS = 60_000; // 1 min
/** Per-request response body cap; a receiver's body is only sampled for diagnostics. */
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024; // 64 KiB
/** Per-request timeout covering connect + response. */
// Fallback when a trigger passes no `requestTimeoutMs`; the product drain paths
// always pass one (see DRAIN_REQUEST_TIMEOUT_MS and the fast-path scheduler).
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000; // 15s

// The per-request budget the durable drain (cron/manual trigger) gives each
// delivery. Exported so the connectivity probe waits exactly as long as the
// path that actually persists retries — a receiver that answers within this
// window is one deliveries reach, and one that exceeds it is not, so the test
// predicts real deliverability instead of a more lenient library default.
export const DRAIN_REQUEST_TIMEOUT_MS = 10_000; // 10s
/** How much of the response body is retained on the row for debugging. */
const RESPONSE_SNIPPET_LIMIT = 500;
/** Cap on the retained per-row attempt log so a flapping endpoint can't grow it unbounded. */
const MAX_ATTEMPT_LOG = 20;

/** A `nextly_webhook_deliveries` row as read back (Drizzle camelCases columns). */
interface DeliveryRow {
  id: string;
  webhookId: string;
  eventId: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lockedBy: string | null;
  lockedUntil: Date | null;
  attempts: unknown;
}

/** The subset of a `nextly_webhooks` row delivery needs (camelCase). */
interface WebhookRow {
  id: string;
  url: string;
  headers: Record<string, string> | null;
  /** Encrypted (not hashed) active signing secrets, primary first. */
  secretHash: string[];
  /** Stored as an integer on SQLite, so it is coerced before it is trusted. */
  enabled: unknown;
}

/** The subset of a `nextly_events` row delivery needs (camelCase). */
interface EventRow {
  id: string;
  payload: unknown;
}

/** One recorded attempt kept on the delivery row's `attempts` log. */
interface AttemptLogEntry {
  at: string;
  outcome: AttemptOutcome;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}

/** The transaction surface the lease claim needs (subset of the adapter tx). */
export interface DeliverTx {
  select<T = unknown>(table: string, options?: SelectOptions): Promise<T[]>;
  update<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    where: { and: Array<{ column: string; op: string; value: unknown }> }
  ): Promise<T[]>;
}

/** The database surface `deliverDueDeliveries` needs (satisfied by the adapter). */
export interface DeliverDatabase {
  select<T = unknown>(table: string, options?: SelectOptions): Promise<T[]>;
  update<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    where: { and: Array<Record<string, unknown>> },
    options?: { returning?: boolean }
  ): Promise<T[]>;
  transaction<T>(fn: (tx: DeliverTx) => Promise<T>): Promise<T>;
}

/** Minimal logger surface; delivery warns on undeliverable rows. */
export interface DeliverLogger {
  warn(message: string, context?: unknown): void;
}

/**
 * The HTTP transport. Defaults to the SSRF-safe {@link safeFetch}; injectable so
 * tests can drive outcomes without real network access.
 */
export type DeliverTransport = (
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: string;
    maxResponseBytes: number;
    timeoutMs: number;
  }
) => Promise<Response>;

export interface DeliverDeps {
  db: DeliverDatabase;
  /**
   * Decrypt one stored signing secret (the `secret_hash` column holds AES-GCM
   * ciphertext, not a hash). Injected so the engine never reads `env` directly
   * and stays unit-testable; the route wiring passes
   * `ct => decrypt(ct, env.NEXTLY_SECRET)`.
   */
  decryptSecret: (ciphertext: string) => string;
  /** HTTP transport. Defaults to {@link safeFetch}. */
  transport?: DeliverTransport;
  /** Max deliveries to claim this pass. Defaults to 50. */
  batchSize?: number;
  /** Lease duration held on a claimed row while its request is in flight (ms). */
  leaseMs?: number;
  /** Per-request timeout in ms. Defaults to 15s. */
  requestTimeoutMs?: number;
  /**
   * Wall-clock cutoff for this pass. Once reached, no further due delivery is
   * claimed or attempted; an already in-flight attempt still completes (bounded
   * by `requestTimeoutMs`). Lets a latency-bounded trigger — a serverless cron
   * tick — stop cleanly instead of running a full batch of hung receivers to
   * completion; the leftover rows are picked up on the next pass. Unbounded when
   * unset.
   */
  deadline?: Date;
  /** Clock; injectable for deterministic tests. */
  now?: () => Date;
  /** Unique id for this drain runner, recorded as the lease owner. */
  runnerId?: string;
  logger?: DeliverLogger;
}

export interface DeliverResult {
  /** Deliveries claimed and attempted this pass. */
  attempted: number;
  /** Deliveries that succeeded (2xx). */
  delivered: number;
  /** Deliveries rescheduled for a later retry. */
  retried: number;
  /** Deliveries marked permanently failed. */
  failed: number;
}

/** Which per-outcome counter a single attempt should increment. */
type OutcomeBucket = "delivered" | "retried" | "failed";

/**
 * Turn a stored event payload into the request body. The payload is the durable
 * envelope `recordEvent` wrote; a corrupt (non-object / unstringifiable) payload
 * is undeliverable and surfaces as `null` so the caller fails the row.
 */
function payloadToBody(payload: unknown): string | null {
  const value =
    typeof payload === "string" ? safeParse(payload) : (payload ?? null);
  if (value === null || typeof value !== "object") return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Append one attempt to the row's capped log, tolerating a non-array stored value. */
function appendAttempt(
  existing: unknown,
  entry: AttemptLogEntry
): AttemptLogEntry[] {
  const log = Array.isArray(existing) ? (existing as AttemptLogEntry[]) : [];
  const next = [...log, entry];
  // Keep only the most recent entries so a permanently-flapping endpoint cannot
  // grow the JSON column without bound.
  return next.slice(-MAX_ATTEMPT_LOG);
}

/**
 * Classify a transport failure (safeFetch threw, so no HTTP status was seen). A
 * blocked/invalid URL is the receiver's misconfiguration and never self-heals, so
 * it fails permanently; a timeout or network error is transient and retries.
 */
function classifyTransportError(err: unknown): {
  outcome: AttemptOutcome;
  message: string;
} {
  if (err instanceof ExternalUrlError) {
    return { outcome: "failed", message: `blocked url: ${err.message}` };
  }
  if (err instanceof SafeFetchError) {
    // timeout / response-too-large / decode-failed are all transient from the
    // producer's side (the receiver may recover), so retry.
    return { outcome: "retry", message: `transport: ${err.reason}` };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { outcome: "retry", message: `transport: ${message}` };
}

/**
 * Claim one due delivery by taking a lease inside a transaction. Returns the row
 * if this runner won the claim, else null (another runner holds it, it is no
 * longer due, or it vanished). The read-check-write runs in one transaction under
 * a `FOR UPDATE` row lock (a no-op on SQLite, whose transactions already
 * serialize writers), so a concurrent claim or a redelivery re-arm cannot slip
 * between the read and the lease write: the claimed row's state — including its
 * `attemptCount` — is the committed state this runner then acts on, never a stale
 * copy a re-arm has since reset.
 */
async function claimDelivery(
  deps: DeliverDeps,
  id: string,
  runnerId: string,
  now: Date,
  leaseMs: number
): Promise<DeliveryRow | null> {
  return deps.db.transaction(async tx => {
    const rows = await tx.select<DeliveryRow>("nextly_webhook_deliveries", {
      where: { and: [{ column: "id", op: "=", value: id }] },
      limit: 1,
      forUpdate: true,
    });
    const row = rows[0];
    if (!row) return null;
    const isDue =
      (row.status === "pending" || row.status === "retrying") &&
      row.nextAttemptAt != null &&
      row.nextAttemptAt.getTime() <= now.getTime();
    const leaseFree =
      row.lockedUntil == null || row.lockedUntil.getTime() <= now.getTime();
    if (!isDue || !leaseFree) return null;
    const lockedUntil = new Date(now.getTime() + leaseMs);
    await tx.update(
      "nextly_webhook_deliveries",
      {
        locked_by: runnerId,
        locked_until: lockedUntil,
        updated_at: now,
      },
      { and: [{ column: "id", op: "=", value: id }] }
    );
    // Reflect the lease just taken onto the returned row so the finalize can
    // fence on ownership: `row.lockedBy` now identifies this runner, letting
    // finalizeDelivery refuse to write if the lease has since been handed off.
    row.lockedBy = runnerId;
    row.lockedUntil = lockedUntil;
    return row;
  });
}

/**
 * Finalize a claimed delivery: write the outcome and release the lease, but only
 * while this runner still owns the lease it took at claim time.
 *
 * The `locked_by` fence matters when a worker overruns its lease: once
 * `locked_until` passes, a redelivery re-arm (which clears `locked_by`) or
 * another drain can take the row over. Without the fence this worker's late,
 * unconditional write would clobber that fresh state — silently replacing a
 * re-armed `pending` with the stale attempt's outcome. Scoping the write to the
 * lease owner makes it a no-op instead, so whoever holds the row now keeps it.
 */
async function finalizeDelivery(
  deps: DeliverDeps,
  row: DeliveryRow,
  now: Date,
  update: Record<string, unknown>
): Promise<void> {
  await deps.db.update(
    "nextly_webhook_deliveries",
    { ...update, locked_by: null, locked_until: null, updated_at: now },
    {
      and: [
        { column: "id", op: "=", value: row.id },
        { column: "lockedBy", op: "=", value: row.lockedBy },
      ],
    }
  );
}

/**
 * Attempt one already-claimed delivery: load its endpoint and event, sign and
 * send the request, and finalize the row with the outcome, returning which
 * counter to increment. Every undeliverable precondition (deleted webhook,
 * missing/unusable payload, missing or undecryptable secret) finalizes the row
 * as a permanent failure. Throwing is reserved for the genuinely unexpected; the
 * caller wraps this in a per-candidate boundary so one bad row cannot abort the
 * batch or strand its lease.
 */
async function attemptDelivery(
  deps: DeliverDeps,
  row: DeliveryRow,
  attemptCount: number,
  claimedAt: Date
): Promise<OutcomeBucket> {
  const now = deps.now ?? (() => new Date());
  const transport = deps.transport ?? safeFetch;
  const timeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  // Load the endpoint and the event. A delivery for a deleted webhook, a
  // disabled one, or a missing event can never be sent, so mark it failed and
  // move on.
  const webhookRows = await deps.db.select<WebhookRow>("nextly_webhooks", {
    where: { and: [{ column: "id", op: "=", value: row.webhookId }] },
    limit: 1,
  });
  const webhook = webhookRows[0];
  const eventRows = await deps.db.select<EventRow>("nextly_events", {
    where: { and: [{ column: "id", op: "=", value: row.eventId }] },
    limit: 1,
  });
  const event = eventRows[0];

  // Disabling is checked here and not only at fan-out because rows can already
  // be queued when it happens: a retry scheduled by an earlier failure, or an
  // event that fanned out moments before. Without this, disabling stops new
  // deliveries but the existing ones keep POSTing until they succeed or
  // exhaust their attempts, which is the opposite of what disabling means.
  //
  // The row is failed rather than held, so re-enabling does not later release a
  // burst of events the receiver has long since stopped expecting. Replaying
  // them is a separate, deliberate act.
  // Truthiness rather than a strict comparison: SQLite stores the flag as 0/1
  // and the other dialects as a boolean.
  const disabled = webhook !== undefined && !webhook.enabled;
  if (!webhook || !event || disabled) {
    const reason = !webhook
      ? "webhook deleted"
      : disabled
        ? "webhook disabled"
        : "event missing";
    deps.logger?.warn(
      `webhook delivery ${row.id} undeliverable (${reason}); marking failed`
    );
    await finalizeDelivery(deps, row, now(), {
      status: "failed",
      attempt_count: attemptCount,
      next_attempt_at: null,
      last_error: reason,
      attempts: appendAttempt(row.attempts, {
        at: claimedAt.toISOString(),
        outcome: "failed",
        error: reason,
      }),
    });
    return "failed";
  }

  const body = payloadToBody(event.payload);
  if (body === null) {
    deps.logger?.warn(
      `webhook delivery ${row.id} undeliverable (unusable event payload); marking failed`
    );
    await finalizeDelivery(deps, row, now(), {
      status: "failed",
      attempt_count: attemptCount,
      next_attempt_at: null,
      last_error: "unusable event payload",
      attempts: appendAttempt(row.attempts, {
        at: claimedAt.toISOString(),
        outcome: "failed",
        error: "unusable event payload",
      }),
    });
    return "failed";
  }

  // A webhook with no stored secret can never be signed (buildSignatureHeaders
  // rejects an empty secret list, which every conformant receiver would too).
  // That is a permanent misconfiguration, so fail rather than throw uncaught
  // and strand the leased row.
  if (webhook.secretHash.length === 0) {
    deps.logger?.warn(
      `webhook delivery ${row.id} undeliverable (webhook has no signing secret); marking failed`
    );
    await finalizeDelivery(deps, row, now(), {
      status: "failed",
      attempt_count: attemptCount,
      next_attempt_at: null,
      last_error: "no signing secret",
      attempts: appendAttempt(row.attempts, {
        at: claimedAt.toISOString(),
        outcome: "failed",
        error: "no signing secret",
      }),
    });
    return "failed";
  }

  // Decrypt the active signing secrets (primary first) and build the Standard
  // Webhooks headers. The delivery id is the stable per-(webhook,event) message
  // id, so a retried delivery reuses it and the receiver can dedupe.
  const timestamp = Math.floor(claimedAt.getTime() / 1000).toString();
  let secrets: string[];
  try {
    secrets = webhook.secretHash.map(ct => deps.decryptSecret(ct));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.warn(
      `webhook delivery ${row.id} could not decrypt signing secret; marking failed`,
      err
    );
    await finalizeDelivery(deps, row, now(), {
      status: "failed",
      attempt_count: attemptCount,
      next_attempt_at: null,
      last_error: `secret decrypt failed: ${message}`,
      attempts: appendAttempt(row.attempts, {
        at: claimedAt.toISOString(),
        outcome: "failed",
        error: "secret decrypt failed",
      }),
    });
    return "failed";
  }

  const signatureHeaders = buildSignatureHeaders({
    id: row.id,
    timestamp,
    body,
    secrets,
  });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(webhook.headers ?? {}),
    ...signatureHeaders,
  };

  // Send with NO transaction open. Determine the attempt outcome from the HTTP
  // status, or from the transport error if safeFetch threw.
  let outcome: AttemptOutcome;
  let statusCode: number | undefined;
  let latencyMs: number | undefined;
  let responseSnippet: string | undefined;
  let errorMessage: string | undefined;

  const sentAt = now();
  try {
    const response = await transport(webhook.url, {
      method: "POST",
      headers,
      body,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
      timeoutMs,
    });
    latencyMs = now().getTime() - sentAt.getTime();
    statusCode = response.status;
    outcome = classifyResponse(response.status);
    try {
      const text = await response.text();
      responseSnippet = text.slice(0, RESPONSE_SNIPPET_LIMIT);
    } catch {
      // The status is what decides the outcome; a body we cannot read is not
      // fatal and is simply not recorded.
    }
    if (outcome !== "delivered") {
      errorMessage = `http ${response.status}`;
    }
  } catch (err) {
    latencyMs = now().getTime() - sentAt.getTime();
    const classified = classifyTransportError(err);
    outcome = classified.outcome;
    errorMessage = classified.message;
  }

  const decision = decideDelivery({
    outcome,
    attemptCount,
    reason: errorMessage,
  });
  const attempts = appendAttempt(row.attempts, {
    at: sentAt.toISOString(),
    outcome,
    statusCode,
    latencyMs,
    error: errorMessage,
  });
  const common = {
    attempt_count: attemptCount,
    last_status_code: statusCode ?? null,
    last_latency_ms: latencyMs ?? null,
    last_error: errorMessage ?? null,
    last_response_snippet: responseSnippet ?? null,
    attempts,
  };

  if (decision.status === "delivered") {
    await finalizeDelivery(deps, row, now(), {
      ...common,
      status: "delivered",
      next_attempt_at: null,
    });
    return "delivered";
  }
  if (decision.status === "retrying") {
    await finalizeDelivery(deps, row, now(), {
      ...common,
      status: "retrying",
      next_attempt_at: new Date(now().getTime() + decision.delayMs),
    });
    return "retried";
  }
  await finalizeDelivery(deps, row, now(), {
    ...common,
    status: "failed",
    next_attempt_at: null,
    last_error: decision.reason,
  });
  return "failed";
}

/**
 * Recover a claimed delivery whose attempt threw unexpectedly. Records the throw
 * as a transient failure so `attempt_count` advances (and the row eventually
 * exhausts to `failed` rather than poison-looping) and releases the lease. A
 * failure to even write this recovery is swallowed and logged: the lease will
 * expire and the row is retried, which is strictly better than letting the throw
 * escape and abort the whole drain.
 */
async function recoverUnexpectedFailure(
  deps: DeliverDeps,
  row: DeliveryRow,
  attemptCount: number,
  message: string
): Promise<OutcomeBucket> {
  const now = deps.now ?? (() => new Date());
  const at = now();
  const decision = decideDelivery({
    outcome: "retry",
    attemptCount,
    reason: message,
  });
  const update =
    decision.status === "retrying"
      ? {
          status: "retrying",
          attempt_count: attemptCount,
          next_attempt_at: new Date(at.getTime() + decision.delayMs),
          last_error: message,
          attempts: appendAttempt(row.attempts, {
            at: at.toISOString(),
            outcome: "retry",
            error: message,
          }),
        }
      : {
          status: "failed",
          attempt_count: attemptCount,
          next_attempt_at: null,
          last_error: decision.status === "failed" ? decision.reason : message,
          attempts: appendAttempt(row.attempts, {
            at: at.toISOString(),
            outcome: "failed",
            error: message,
          }),
        };
  try {
    await finalizeDelivery(deps, row, at, update);
  } catch (err) {
    deps.logger?.warn(
      `webhook delivery ${row.id} could not be finalized after an unexpected error; lease will expire and it will be retried`,
      err
    );
  }
  return decision.status === "retrying" ? "retried" : "failed";
}

/**
 * Claim a batch of due deliveries and attempt each one. Returns per-outcome
 * counts. Bounded work per call (one batch); the caller loops until a pass
 * attempts nothing.
 */
export async function deliverDueDeliveries(
  deps: DeliverDeps
): Promise<DeliverResult> {
  const batchSize = deps.batchSize ?? DEFAULT_DELIVER_BATCH;
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const now = deps.now ?? (() => new Date());
  const runnerId = deps.runnerId ?? crypto.randomUUID();

  const result: DeliverResult = {
    attempted: 0,
    delivered: 0,
    retried: 0,
    failed: 0,
  };

  const claimTime = now();
  // Candidate due rows: pending/retrying, past their next-attempt time, and not
  // currently leased. WHERE/orderBy columns are Drizzle JS property names
  // (camelCase); the adapter resolves them via getColumns.
  const candidates = await deps.db.select<{ id: string }>(
    "nextly_webhook_deliveries",
    {
      where: {
        and: [
          { column: "status", op: "IN", value: ["pending", "retrying"] },
          { column: "nextAttemptAt", op: "<=", value: claimTime },
          {
            or: [
              { column: "lockedUntil", op: "IS NULL", value: null },
              { column: "lockedUntil", op: "<=", value: claimTime },
            ],
          },
        ],
      },
      orderBy: [{ column: "nextAttemptAt", direction: "asc" }],
      limit: batchSize,
    }
  );

  for (const candidate of candidates) {
    // Stop before claiming the next row once the wall-clock budget is spent, so
    // a hung/slow receiver can extend this pass by at most one in-flight request
    // rather than the whole batch. No row is left claimed-but-unattempted: the
    // claim and attempt happen together below.
    if (deps.deadline && now() >= deps.deadline) break;
    const claimedAt = now();
    const row = await claimDelivery(
      deps,
      candidate.id,
      runnerId,
      claimedAt,
      leaseMs
    );
    if (!row) continue; // lost the claim race, no longer due, or gone.
    result.attempted += 1;
    const attemptCount = row.attemptCount + 1;

    // Per-candidate boundary: a row that throws unexpectedly (a DB hiccup,
    // malformed stored headers) is recorded as a transient failure and its lease
    // released, so one bad row can neither abort the batch nor poison-loop by
    // never advancing its attempt count toward the max-attempts cutoff.
    let bucket: OutcomeBucket;
    try {
      bucket = await attemptDelivery(deps, row, attemptCount, claimedAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.warn(
        `webhook delivery ${row.id} threw unexpectedly; recording as a transient failure`,
        err
      );
      bucket = await recoverUnexpectedFailure(deps, row, attemptCount, message);
    }
    result[bucket] += 1;
  }

  return result;
}
