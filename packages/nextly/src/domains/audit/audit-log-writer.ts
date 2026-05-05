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
 *   - **Append-only by application convention.** Operators are expected
 *     to revoke UPDATE / DELETE GRANTs on the table in production for
 *     stricter integrity. The writer never offers an update path.
 *   - **Metadata is opaque JSON.** The `metadata` field stays generic
 *     so we can extend coverage without a migration each time. Callers
 *     pass dialect-portable JSON-serialisable values only.
 *
 * Hash-chained tamper-evidence (each row signs (prev_hash, this_row))
 * is intentionally deferred — under concurrent auth events the chain
 * needs a lock-around-write that complicates the hot path. Operators
 * who need cryptographic integrity right now should rely on DB-level
 * GRANT enforcement; a future task can layer a chain on top.
 *
 * @module domains/audit/audit-log-writer
 * @since 1.0.0
 */

import { randomUUID } from "crypto";

import { getDialectTables } from "../../database/index";
import { getNextlyLogger } from "../../observability/logger";

export type AuditEventKind =
  | "csrf-failed"
  | "login-failed"
  | "password-changed"
  | "role-assigned"
  | "role-revoked"
  | "user-deleted";

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
export function buildAuditLogWriter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getService: (name: string) => any
): AuditLogWriter {
  return {
    async write(event: AuditEvent): Promise<void> {
      try {
        const adapter = getService("adapter");
        const db = adapter.getDrizzle();
        const schema = getDialectTables();
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
          metadata: event.metadata ?? null,
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
