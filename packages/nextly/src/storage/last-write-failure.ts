/**
 * The storage adapter's last failed write, as this process saw it.
 *
 * `MediaStorage.upload` records every server-side write it routes: a write
 * that throws leaves a record of when, through which adapter, and a short
 * reason; the next write that succeeds clears it. System health reads it to
 * say whether storage is working, and Needs your attention shows it to a
 * super-admin while it stands.
 *
 * 🔴 PER PROCESS, and kept in memory only: no table, no migration. Each server
 * instance knows its own writes, so a write that failed on one instance is not
 * seen by another, and a restart forgets it. That is the trade for a record
 * that costs nothing on the write path and can never itself fail a write. A
 * direct-to-storage client upload never passes through the server, so it is
 * not recorded either.
 *
 * 🔴 The reason is chosen from a fixed set by the error's code, never copied
 * from its message: an adapter's message can carry a bucket path, a signed URL
 * or a credential, and this record is shown on the dashboard.
 *
 * Held on `globalThis` under a `Symbol.for` key, as the boot state is: Next.js
 * and Turbopack can evaluate this module in more than one server graph, and
 * the route that uploads and the dashboard that reads must see one record.
 *
 * @module storage/last-write-failure
 */

/** The last write that failed, while no later write has succeeded. */
export interface StorageWriteFailure {
  /** When it failed, as an ISO 8601 instant. */
  at: string;
  /** The adapter that refused it, by its type: "local", "s3", "vercel-blob". */
  adapter: string;
  /** One short sentence saying what went wrong, from a fixed set. */
  reason: string;
}

/** The record's one slot for the whole process. */
interface Held {
  failure?: StorageWriteFailure;
}

const SLOT = Symbol.for("nextly.storage.lastWriteFailure");

/** The slot, installed the first time any copy of this module asks. */
function held(): Held {
  if (!Object.prototype.hasOwnProperty.call(globalThis, SLOT)) {
    // Not enumerable, not writable, not configurable: nothing iterating
    // `globalThis` meets it, and nothing can swap it for another object.
    Object.defineProperty(globalThis, SLOT, { value: {} satisfies Held });
  }
  return Reflect.get(globalThis, SLOT) as Held;
}

/** The longest adapter name kept: a type is one short word, so more is noise. */
const ADAPTER_NAME_MAX = 40;

/** The reason for a failure whose code says nothing more particular. */
const UNKNOWN_REASON = "The storage adapter could not save the file.";

/**
 * Each reason, by the codes and names that mean it: Node's network and file
 * system codes, the HTTP statuses storage services answer, and the names the
 * S3 and Blob clients give their errors.
 */
const REASONS: readonly { reason: string; codes: readonly string[] }[] = [
  {
    reason: "The storage service did not answer in time.",
    codes: [
      "ETIMEDOUT",
      "ESOCKETTIMEDOUT",
      "TimeoutError",
      "AbortError",
      "408",
      "504",
    ],
  },
  {
    reason: "The storage service could not be reached.",
    codes: [
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
      "EHOSTUNREACH",
      "502",
      "503",
    ],
  },
  {
    reason: "The storage service refused the credentials or permissions.",
    codes: [
      "EACCES",
      "EPERM",
      "EROFS",
      "AccessDenied",
      "Forbidden",
      "InvalidAccessKeyId",
      "SignatureDoesNotMatch",
      "ExpiredToken",
      "401",
      "403",
    ],
  },
  {
    reason: "There was no room to store the file.",
    codes: [
      "ENOSPC",
      "EDQUOT",
      "EntityTooLarge",
      "QuotaExceeded",
      "413",
      "507",
    ],
  },
];

/** The codes an error carries, wherever its library put them. */
function codesOf(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];
  const fields = error as {
    code?: unknown;
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return [
    fields.code,
    fields.name,
    fields.status,
    fields.statusCode,
    fields.$metadata?.httpStatusCode,
  ].flatMap(value =>
    typeof value === "string" || typeof value === "number"
      ? [String(value)]
      : []
  );
}

/**
 * What went wrong, as one sentence from a fixed set chosen by the error's
 * code. The error's own message is never read: see the module note.
 */
export function storageFailureReason(error: unknown): string {
  const codes = codesOf(error);
  return (
    REASONS.find(({ codes: known }) => codes.some(code => known.includes(code)))
      ?.reason ?? UNKNOWN_REASON
  );
}

/** Record that a write through `adapter` failed with `error`, at `now`. */
export function recordStorageWriteFailure(
  adapter: string,
  error: unknown,
  now: Date = new Date()
): void {
  held().failure = {
    at: now.toISOString(),
    adapter: adapter.slice(0, ADAPTER_NAME_MAX) || "unknown",
    reason: storageFailureReason(error),
  };
}

/** Record that a write succeeded: storage works again, so the failure is cleared. */
export function recordStorageWriteSuccess(): void {
  held().failure = undefined;
}

/** The last failed write, or `undefined` while storage is working. A copy. */
export function lastStorageWriteFailure(): StorageWriteFailure | undefined {
  const failure = held().failure;
  return failure === undefined ? undefined : { ...failure };
}
