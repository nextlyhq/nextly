/**
 * Single entry point for security-sensitive event recording. Callers
 * pass a structured event; the writer persists it to the `audit_log`
 * table via the database adapter.
 *
 * Behaviour contract:
 *
 *   - **Never throws.** Auth handlers must not fail-open or fail-closed
 *     because the audit table is unreachable. A DB failure logs a
 *     structured warning via `getNextlyLogger()` and the request
 *     continues.
 *   - **Append-only by application convention.** This writer never offers an
 *     update path. Operators hardening the table should revoke DELETE and
 *     revoke UPDATE except on the three columns an erasure touches — see the
 *     dialect schema definitions for the exact grants. A blanket UPDATE revoke
 *     stops `eraseActorPersonalData`, which runs inside the user-deletion
 *     transaction, and so stops account deletion outright.
 *   - **Metadata is opaque JSON.** The `metadata` field stays generic
 *     so we can extend coverage without a migration each time. Callers
 *     pass dialect-portable JSON-serialisable values only.
 *
 * Hash-chained tamper-evidence (each row signs (prev_hash, this_row))
 * is intentionally deferred — under concurrent auth events the chain
 * needs a lock-around-write that complicates the hot path. Operators
 * who need cryptographic integrity right now should rely on DB-level
 *
 * @module domains/audit/audit-log-writer
 * @since 1.0.0
 */

import { randomUUID } from "crypto";

import { getColumns } from "drizzle-orm";

import { getDialectTables } from "../../database/index";
import { getNextlyLogger } from "../../observability/logger";

export type AuditEventKind =
  | "csrf-failed"
  | "login-failed"
  | "login-succeeded"
  | "password-changed"
  | "role-assigned"
  | "role-revoked"
  | "user-deleted";

/**
 * The only `logContext` keys an audit row may carry.
 *
 * A `NextlyError`'s `logContext` is an open channel written for operator triage,
 * and the auth failures put an attempted email address and a user id in it. Both
 * identify a person, and a failure event is recorded with NO actor precisely so
 * it cannot say which account was reached — so nothing links such a row to
 * anyone, and the deletion that erases a person's other rows cannot find it.
 * Storing the identifier and then trying to erase it later is the wrong order:
 * it never enters.
 *
 * Default-deny, mirroring how webhook payloads are projected. The keys kept are
 * the ones that describe WHAT happened rather than TO WHOM.
 */
const AUDIT_METADATA_KEYS = ["reason", "originalCode", "legacyCode"] as const;

/**
 * The `reason` values this package itself produces.
 *
 * Allowlisting the KEY is not enough for this one. An `AuthStrategy` is supplied
 * by the application, its failure result carries a free-text `reason`, and the
 * login handler copies that into the error context — so a strategy that put an
 * email or an external account name there would have it stored on a row that
 * has no actor and therefore can never be erased for that person.
 *
 * A value outside this set is dropped rather than stored. The reason still
 * reaches the logger through `logContext`; what it does not do is enter a
 * retained trail nothing can later associate with a subject.
 */
const CORE_AUDIT_REASONS = new Set([
  "user-not-found",
  "password-mismatch",
  "unverified",
  "inactive",
  "locked",
  "strategy-fail",
  "no-strategy-matched",
  "pending-token-invalid",
  "challenge-failed-final",
  "challenge-attempts-exhausted",
  "challenge-user-missing",
]);

/**
 * Copy the allowlisted diagnostic keys out of an error's context.
 *
 * Callers pass the whole `logContext`; anything not listed is dropped rather
 * than stored, so a new key added for logging cannot silently become a new
 * field in the audit trail.
 */
export function projectAuditMetadata(
  context: Record<string, unknown> | undefined
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  if (!context) return projected;
  for (const key of AUDIT_METADATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(context, key)) continue;
    const value = context[key];
    // `reason` is the one allowlisted key whose VALUE is not ours: an
    // application-supplied strategy chooses it. Keep only what this package
    // produces, so free text cannot ride in under an approved name.
    if (key === "reason" && !CORE_AUDIT_REASONS.has(String(value))) continue;
    projected[key] = value;
  }
  return projected;
}

export interface AuditEvent {
  kind: AuditEventKind;
  /** The user performing the action; null when unauthenticated (failed login, failed CSRF). */
  actorUserId?: string | null;
  /** The user being acted on; null when not account-scoped. */
  targetUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** JSON-serialisable details. Goes into the dialect's JSON column. */
  metadata?: Record<string, unknown>;
}

export interface AuditLogWriter {
  write(event: AuditEvent): Promise<void>;
}

/**
 * No-op writer used when the DI container is not yet initialised or
 * when the adapter is unavailable. Lets handlers call the writer
 * unconditionally without nil-checking.
 */
export const NULL_AUDIT_LOG_WRITER: AuditLogWriter = {
  async write() {
    /* drop on the floor */
  },
};

/**
 * Build a writer that persists events through the DI-provided database
 * adapter. The factory captures `getService` so the writer resolves
 * the adapter lazily on each write — handlers can be constructed before
 * the DI container finishes initialising.
 */
/**
 * The dialect of the adapter a write is going through.
 *
 * Every Drizzle adapter declares `dialect` directly; `getCapabilities()` is
 * consulted only as a secondary source for adapters that predate it. Returns
 * undefined rather than guessing, because the caller must not fall back to the
 * environment: that is the coupling this exists to remove.
 */
function adapterDialect(adapter: unknown): string | undefined {
  const candidate = adapter as {
    dialect?: unknown;
    getCapabilities?: () => { dialect?: unknown } | undefined;
  };
  if (typeof candidate?.dialect === "string") return candidate.dialect;
  const fromCapabilities = candidate?.getCapabilities?.()?.dialect;
  return typeof fromCapabilities === "string" ? fromCapabilities : undefined;
}

/**
 * Encode `metadata` for whichever column type this dialect uses.
 *
 * The column is `jsonb` on PostgreSQL and `json` on MySQL, where the driver
 * serialises an object itself and handing it a pre-encoded string would store
 * a JSON string rather than an object. On SQLite it is plain `text`, which
 * cannot bind an object at all — the insert fails, and because the writer
 * swallows its own failures the loss is silent.
 *
 * Decided from the column rather than a dialect string so the two stay in step
 * if either schema changes.
 */
function encodeMetadata(
  table: unknown,
  metadata: Record<string, unknown> | undefined
): unknown {
  if (metadata === undefined) return null;
  const column = (
    getColumns(table as Parameters<typeof getColumns>[0]) as Record<
      string,
      { dataType?: string } | undefined
    >
  ).metadata;
  return column?.dataType === "string" ? JSON.stringify(metadata) : metadata;
}

export function buildAuditLogWriter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getService: (name: string) => any
): AuditLogWriter {
  return {
    async write(event: AuditEvent): Promise<void> {
      try {
        const adapter = getService("adapter");
        const db = adapter.getDrizzle();
        // Resolve tables from the adapter actually being written through, not
        // from the process-wide DB_DIALECT: env.ts caches that on first read,
        // so a process whose cache was populated by a different dialect would
        // build rows in the wrong shape for this connection.
        const dialect = adapterDialect(adapter);
        if (!dialect) {
          // Falling back to the environment here would restore exactly the
          // coupling above, and silently: the row would be built for whatever
          // dialect happened to be validated first and the insert would fail
          // inside the catch below. Skipping loudly is the lesser harm.
          getNextlyLogger().warn({
            kind: "audit-log-write-skipped",
            eventKind: event.kind,
            reason: "adapter did not report a dialect",
          });
          return;
        }
        const schema = getDialectTables(dialect);
        const table = (schema as { auditLog?: unknown }).auditLog;
        if (!table) {
          // Dialect tables may not include auditLog if the consumer is
          // running against an older schema bundle. Don't throw.
          return;
        }
        await db.insert(table).values({
          id: randomUUID(),
          kind: event.kind,
          actorUserId: event.actorUserId ?? null,
          targetUserId: event.targetUserId ?? null,
          ipAddress: event.ipAddress ?? null,
          userAgent: event.userAgent ?? null,
          metadata: encodeMetadata(table, event.metadata),
          createdAt: new Date(),
        });
      } catch (err) {
        getNextlyLogger().warn({
          kind: "audit-log-write-failed",
          eventKind: event.kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
