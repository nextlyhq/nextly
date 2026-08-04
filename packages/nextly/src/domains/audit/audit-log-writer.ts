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
 *     update path, but the application does hold two privileges an operator
 *     hardening the table must allow for: a column-scoped UPDATE that erases a
 *     deleted account's identifiers, and DELETE, which retention needs to prune
 *     rows past their window. Revoking either does not make the table stricter
 *     so much as break the mechanism that depends on it — silently, in the case
 *     of retention. See the dialect schema definitions for the exact grants.
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

/**
 * Offer a retention pass after an auth event is recorded.
 *
 * Isolated from the write's own error handling on purpose. Resolving a service
 * that an installation never registered is not a failed write, and letting it
 * reach the writer's catch would report a row that was stored perfectly well as
 * having failed.
 *
 * A small budget, because a user is waiting on the login this hangs off. The
 * drain spends the configured one, where nothing is.
 */
async function offerRetentionPass(
  getService: (name: string) => unknown
): Promise<void> {
  try {
    const runner = getService(RETENTION_RUNNER_SERVICE);
    if (!offersRetention(runner)) return;
    await runner.maybeRun(WRITE_PATH_BATCHES);
  } catch {
    /* no runner registered, or nothing configured to prune */
  }
}

/** The service name the DI container registers a retention runner under. */
const RETENTION_RUNNER_SERVICE = "retentionRunner";

/** Batches a pass offered from a request path may take. */
const WRITE_PATH_BATCHES = 1;

/**
 * Whether a resolved service can run a retention pass.
 *
 * A structural check rather than a cast: the container is keyed by string, so
 * the compiler cannot know what a name resolves to, and asserting a shape that
 * was never verified would turn a rename into a runtime failure inside a catch
 * that hides it.
 */
function offersRetention(
  value: unknown
): value is { maybeRun(maxBatches?: number): Promise<void> } {
  return (
    typeof (value as { maybeRun?: unknown } | undefined)?.maybeRun ===
    "function"
  );
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

        // Offer a retention pass, for the same reason content writes do: there
        // is no scheduler to hang one off. Every other trigger is a content
        // mutation, so an installation taking authentication traffic and no
        // content writes — an app whose editing happens elsewhere, or one
        // simply between edits — would never offer one at all, and this is the
        // table that grows with that traffic. The runner gates it, so the
        // common case is one comparison. Failures are absorbed there; a login
        // must not fail because housekeeping could not run.
        await offerRetentionPass(getService);
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
