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
 *     update path, but the application holds two privileges an operator
 *     hardening the table must allow for: a column-scoped UPDATE that erases a
 *     deleted account's request identifiers, and DELETE, which retention needs
 *     to prune rows past their window. A blanket UPDATE revoke stops
 *     `eraseActorPersonalData`, which runs inside the user-deletion
 *     transaction, and so stops account deletion outright; revoking DELETE
 *     stops retention silently, since a pass must never fail the request that
 *     offered it. See the dialect schema definitions for the exact grants.
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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { getColumns } from "drizzle-orm";

import { getDialectTables } from "../../database/index";
import { NEXTLY_ERROR_STATUS } from "../../errors/error-codes";
import { NextlyError } from "../../errors/nextly-error";
import { getNextlyLogger } from "../../observability/logger";

import { isAuditReason } from "./audit-reasons";
import {
  insertErasureAware,
  type ErasureAwareDb,
  type ErasureAwareInsert,
} from "./erasure-aware-insert";

export type AuditEventKind =
  | "csrf-failed"
  | "login-failed"
  | "login-succeeded"
  | "password-changed"
  /**
   * A preview link was signed, handing its holder draft read access to one
   * document under the MINTER's permissions.
   *
   * A security event rather than a content one, which is why it belongs here
   * and not in the activity log beside creates and updates: nothing about the
   * document changed, and what was produced is a bearer credential that works
   * for anyone holding it until it expires or the generation moves.
   */
  | "preview-link-minted"
  /** Every preview link ever issued was invalidated, including live sessions. */
  | "preview-links-revoked"
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
 * Whether a retained value is one this package controls.
 *
 * Allowlisting the KEY is not enough for any of them. `reason` is chosen by an
 * application-supplied `AuthStrategy`; `originalCode` and `legacyCode` are
 * copied from an error's own `code`, and that is `NextlyErrorCodeLike` — any
 * string, so a plugin's error names whatever it likes. Either way the value
 * would land on a row with no actor, which no later deletion can find.
 *
 * A value outside its vocabulary is dropped rather than stored. It still
 * reaches the logger through `logContext`; what it does not do is enter a
 * retained trail nothing can associate with a subject.
 */
function isRetainableValue(
  key: (typeof AUDIT_METADATA_KEYS)[number],
  value: unknown
): boolean {
  if (key === "reason") return isAuditReason(value);
  return isCanonicalErrorCode(value);
}

/**
 * Whether a value names a code the canonical status table defines.
 *
 * Own properties only. `in` walks the prototype chain, so `constructor`,
 * `toString` and `__proto__` would pass a membership test they are not members
 * of — and the value being tested is chosen by whoever threw the error.
 */
function isCanonicalErrorCode(value: unknown): boolean {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(NEXTLY_ERROR_STATUS, value)
  );
}

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
    // Reading the key can itself throw: `logContext` is written by application
    // code, which may expose a getter or a Proxy trap. This runs inside the
    // auth handlers' catch blocks, so an escaping exception costs the caller
    // both the typed error response and the audit row — a key that cannot be
    // read is simply not retained.
    let value: unknown;
    try {
      if (!Object.prototype.hasOwnProperty.call(context, key)) continue;
      value = context[key];
    } catch {
      continue;
    }
    if (!isRetainableValue(key, value)) continue;
    projected[key] = value;
  }
  return projected;
}

/**
 * Build the metadata of a recorded failure from the error that caused it.
 *
 * The three handlers that record one — login, challenge resolution, initial
 * password — assembled this themselves and so could disagree; the code in
 * particular was stored unchecked while the context beside it was projected.
 * Deciding it once means a value cannot reach the row by a route that forgot
 * to ask.
 *
 * A code the canonical table does not define is reported as an internal
 * failure, which is the status `NextlyError` already resolves such a code to.
 */
/**
 * Report the detail a failure carried but the trail does not retain.
 *
 * Two things the shape of this has to defend against, because `logContext` is
 * an open channel an application hook writes:
 *
 * Its keys are nested rather than spread. Spreading let a hook supply `kind`,
 * `requestId` or `code` and overwrite the classification and correlation this
 * adds — so a failure could be made unsearchable as an auth failure, or
 * attributed to a request that never happened.
 *
 * And it cannot throw. This runs inside the auth handlers' catch blocks, and
 * the default logger serialises with `JSON.stringify`, which throws on a
 * BigInt or a cycle. A second exception there escapes the handler, so the
 * caller gets neither the typed error response nor the audit row — a diagnostic
 * aid taking down the request it exists to explain.
 */
function reportWithheldDetail(err: NextlyError, requestId?: string): void {
  // Read once and reused. Two reads of an accessor-backed property can answer
  // differently, so one that passes `instanceof Error` and then returns
  // undefined would throw on `.message` — inside this try, discarding the whole
  // report including the context and message that were perfectly readable.
  const cause = read(() => err.cause);
  // `.message` is a read of application-supplied state too — an Error subclass
  // can back it with an accessor, so passing `instanceof Error` says nothing
  // about whether reading it is safe.
  const causeMessage =
    cause instanceof Error ? read(() => cause.message) : undefined;
  try {
    getNextlyLogger().warn({
      kind: "auth-failed",
      requestId,
      code: read(() => err.code),
      context: read(() => err.logContext),
      // The operator-only message. The row never keeps it, so this is the only
      // place it is readable, and an error may carry nothing else.
      logMessage: read(() => err.logMessage),
      cause: causeMessage,
    });
  } catch {
    /* an unserialisable context is not a reason to fail the request */
  }
}

/**
 * Report a failure that is not a `NextlyError`.
 *
 * Nothing about it survives into the row beyond `INTERNAL_ERROR`, and the auth
 * handlers do no other logging, so this is the only record that the failure had
 * a shape at all. Non-throwing for the same reason as the typed report: it runs
 * inside a catch block whose contract is that it never fails the request.
 */
function reportUntypedFailure(err: unknown, requestId?: string): void {
  try {
    getNextlyLogger().warn({
      kind: "auth-failed",
      requestId,
      code: "INTERNAL_ERROR",
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  } catch {
    /* an unserialisable failure is not a reason to fail the request */
  }
}

/**
 * Read a property of an application-supplied error without letting it throw.
 *
 * These errors are constructed by plugins, so any field may be accessor-backed
 * or proxied. Every read of one happens through here, because a read that
 * escapes takes down the request: this runs inside the auth handlers' catch
 * blocks, where an exception costs the caller the typed response and the audit
 * row alike. A property that cannot be read is simply absent.
 */
function read<T>(get: () => T): T | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}

export function auditFailureMetadata(
  err: unknown,
  requestId?: string
): Record<string, unknown> {
  // An untyped failure is the case with the LEAST in the row and the most in
  // the error: a plugin hook throwing an ordinary Error records nothing but
  // INTERNAL_ERROR, so the message and stack reach the operator here or are
  // lost entirely.
  if (!NextlyError.is(err)) {
    reportUntypedFailure(err, requestId);
    return { code: "INTERNAL_ERROR" };
  }

  // Reported here rather than by each caller, for the same reason the metadata
  // is built here: the two halves are one contract — free text and identifiers
  // go to the operator log, core-controlled values go to the retained trail —
  // and a caller that projects without reporting silently discards the only
  // actionable detail a failure carried. Keeping both in one place is what
  // stops them diverging per handler.
  // Reported whenever anything is withheld, which includes a code the trail
  // will not keep: a plugin naming its own code and carrying no context would
  // otherwise leave INTERNAL_ERROR as the only trace of a failure it alone can
  // explain.
  // Reported whenever anything the error carried does not reach the row: a
  // context that is projected away, a code that is replaced, or a cause the row
  // has nowhere to put. A canonical code with no context still has a cause
  // worth reading, and this is the only place it would be read from.
  // Read once. `code` can be accessor-backed on an application-supplied error,
  // so validating one read and storing another would let a value that failed
  // the check be the one that lands on the row.
  const code: unknown = read(() => err.code);
  const codeIsOurs = isCanonicalErrorCode(code);
  // Every read of an application-supplied error is guarded, the ones in this
  // CONDITION included. An accessor that throws here would escape ahead of the
  // report's own guard, and this runs inside the auth handlers' catch blocks —
  // so the caller would lose both the typed response and the audit row to a
  // check about whether to write a log line.
  const carriesDetail =
    read(() => err.logContext) !== undefined ||
    !codeIsOurs ||
    read(() => err.cause) !== undefined ||
    read(() => err.logMessage) !== undefined;
  if (carriesDetail) reportWithheldDetail(err, requestId);

  return {
    code: codeIsOurs ? code : "INTERNAL_ERROR",
    ...projectAuditMetadata(read(() => err.logContext)),
  };
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
/** The dialects a row can be built for; anything else is not one we support. */
const SUPPORTED_DIALECTS: readonly SupportedDialect[] = [
  "postgresql",
  "mysql",
  "sqlite",
];

function isSupportedDialect(value: unknown): value is SupportedDialect {
  return (
    typeof value === "string" &&
    (SUPPORTED_DIALECTS as readonly string[]).includes(value)
  );
}

function adapterDialect(adapter: unknown): SupportedDialect | undefined {
  const candidate = adapter as {
    dialect?: unknown;
    getCapabilities?: () => { dialect?: unknown } | undefined;
  };
  // Narrowed against the supported set rather than accepted as any string: the
  // row shape and the erasure decision are both chosen from this, so a value
  // that is merely string-typed would pick a branch by accident.
  if (isSupportedDialect(candidate?.dialect)) return candidate.dialect;
  const fromCapabilities = candidate?.getCapabilities?.()?.dialect;
  return isSupportedDialect(fromCapabilities) ? fromCapabilities : undefined;
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

/** The write surface plus the transaction the lock has to be held inside. */
interface TransactionalErasureDb extends ErasureAwareDb {
  transaction<T>(work: (tx: ErasureAwareDb) => Promise<T>): Promise<T>;
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
        // The accounts table the attribution is checked against. Absent on the
        // same older schema bundles that lack `auditLog`, and the erasure
        // decision cannot be made without it.
        const usersTable = (schema as { users?: unknown }).users;
        if (!table || !usersTable) {
          // Dialect tables may not include auditLog if the consumer is
          // running against an older schema bundle. Don't throw.
          return;
        }
        // The address and the client NAME the person, so they are decided by
        // the write rather than stored unconditionally. An attributed event
        // that resolves its actor before a deletion but lands after both that
        // deletion and its post-commit sweep would otherwise keep the deleted
        // person's identifiers permanently — the account they belong to no
        // longer exists for any later erasure to key on. Unattributed events
        // (a failed sign-in for an address owning no account) name nobody and
        // are stored as they are.
        const write = (executor: ErasureAwareDb): Promise<void> =>
          insertErasureAware(executor, dialect, {
            table: table as ErasureAwareInsert["table"],
            users: usersTable as ErasureAwareInsert["users"],
            row: {
              id: randomUUID(),
              kind: event.kind,
              actorUserId: event.actorUserId ?? null,
              targetUserId: event.targetUserId ?? null,
              metadata: encodeMetadata(table, event.metadata),
              createdAt: new Date(),
            },
            identity: {
              ipAddress: event.ipAddress ?? null,
              userAgent: event.userAgent ?? null,
            },
            actorUserId: event.actorUserId ?? null,
          });

        // The lock the decision rests on is only worth anything inside a
        // transaction, and this writer owns none. SQLite takes no lock and its
        // `BEGIN IMMEDIATE` would throw whenever another transaction is open,
        // which here would become a silently missing audit entry.
        if (dialect === "sqlite" || event.actorUserId == null) {
          await write(db as ErasureAwareDb);
        } else {
          await (db as TransactionalErasureDb).transaction(tx => write(tx));
        }

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
