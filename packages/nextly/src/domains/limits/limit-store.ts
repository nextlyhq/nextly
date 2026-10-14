/**
 * The limit store: where counts of attempts are kept, for every limit core
 * or a plugin enforces.
 *
 * One contract for every store, so a limit is written once and runs on
 * whichever store the site selected: memory, the database, or an app's own.
 * An update reads the entries for its keys, decides on them and writes them
 * back atomically, on the store's own clock, so instances whose clocks differ
 * still agree on when a window ends.
 *
 * @experimental The contract may change while the limits built on it settle.
 * @module domains/limits/limit-store
 */
import { genericPublicMessage } from "../../errors/error-codes";
import { NextlyError } from "../../errors/nextly-error";
import { isWellFormed } from "../../plugins/security/well-formed";

/** One stored entry: what a limit keeps for one key, and when it lapses. */
export interface StoredLimit {
  /** JSON-serialisable, at most {@link LIMIT_STORE_MAX_VALUE_BYTES} once serialised. */
  value: unknown;
  /** Milliseconds since the epoch on the store's clock, after which the entry is gone. */
  expiresAt: number;
}

/** What an update's `apply` hands back: the entries to write, and its answer. */
export interface LimitUpdate<T> {
  /** Entries to store, keyed by the update's own keys; `null` deletes one. */
  write: ReadonlyMap<string, StoredLimit | null>;
  /** What `update` resolves to. */
  result: T;
}

/**
 * The contract every limit store keeps, and an app's own store implements.
 *
 * @experimental
 */
export interface LimitStore {
  /** Whether every instance of the site sees the same entries. */
  readonly shared: boolean;
  /**
   * Read the live entries for `keys`, call `apply` with them and the store's
   * clock, and write what it returns, with no other update to any of these
   * keys in between, on any instance. An entry past its expiry reads as
   * absent. The write commits on its own: never inside a transaction another
   * flow, or the caller, has open.
   *
   * `apply` runs synchronously and may run more than once when the store
   * retries; it must not have effects of its own.
   */
  update<T>(
    keys: readonly string[],
    apply: (
      current: ReadonlyMap<string, StoredLimit>,
      now: number
    ) => LimitUpdate<T>
  ): Promise<T>;
  /** The live entries for `keys`, judged on the store's own clock. */
  read(keys: readonly string[]): Promise<ReadonlyMap<string, StoredLimit>>;
  /**
   * Remove entries past their expiry, on the store's own clock, and answer
   * how many went. The database store also sweeps on its own.
   */
  sweep(): Promise<number>;
}

/** The most bytes an entry's value may take, serialised as JSON. */
export const LIMIT_STORE_MAX_VALUE_BYTES = 4096;

/** The most keys one call may name. */
export const LIMIT_STORE_MAX_KEYS = 64;

/** The longest key a store accepts, in characters. */
export const LIMIT_STORE_MAX_KEY_LENGTH = 1024;

/** Why a store answered as unavailable. */
export type LimitStoreUnavailableReason =
  /** The store failed, or could not be reached. */
  | "unreachable"
  /** The store did not answer within its time. */
  | "timeout"
  /** The update needed a new entry while the store held its most live ones. */
  | "full";

/** The marker an unavailable answer carries in its log context. */
const UNAVAILABLE_MARKER = "limitStoreUnavailable";

/**
 * The answer a store gives when it cannot count: distinct from admitting and
 * from refusing, so a limit built on it can say so rather than guess.
 *
 * @param reason - Why the store could not answer
 * @param detail - The underlying failure and what to log with it
 */
export function limitStoreUnavailable(
  reason: LimitStoreUnavailableReason,
  detail: { cause?: unknown; logContext?: Record<string, unknown> } = {}
): NextlyError {
  return NextlyError.serviceUnavailable({
    logMessage: `The limit store is unavailable (${reason}).`,
    cause: detail.cause instanceof Error ? detail.cause : undefined,
    logContext: { ...detail.logContext, [UNAVAILABLE_MARKER]: reason },
  });
}

/**
 * Why `error` is a store's unavailable answer, or undefined when it is
 * something else.
 */
export function limitStoreUnavailableReason(
  error: unknown
): LimitStoreUnavailableReason | undefined {
  if (!NextlyError.isCode(error, "SERVICE_UNAVAILABLE")) return undefined;
  const reason = error.logContext?.[UNAVAILABLE_MARKER];
  return reason === "unreachable" || reason === "timeout" || reason === "full"
    ? reason
    : undefined;
}

/**
 * A call the calling code got wrong: a programming error, refused before the
 * store does anything.
 */
function misuse(logMessage: string, logContext: Record<string, unknown>) {
  return new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: genericPublicMessage("INTERNAL_ERROR"),
    logMessage,
    logContext,
  });
}

/**
 * The distinct keys a call names, in the order given, after checking each.
 *
 * @throws {NextlyError} `INTERNAL_ERROR` for no keys, too many, or a key that
 *   is not a non-empty string of at most {@link LIMIT_STORE_MAX_KEY_LENGTH}
 */
export function checkLimitKeys(keys: readonly string[]): string[] {
  const distinct = [...new Set(keys)];
  if (distinct.length === 0) {
    throw misuse("A limit store call named no keys.", {});
  }
  if (distinct.length > LIMIT_STORE_MAX_KEYS) {
    throw misuse("A limit store call named too many keys.", {
      keys: distinct.length,
      max: LIMIT_STORE_MAX_KEYS,
    });
  }
  for (const key of distinct) {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > LIMIT_STORE_MAX_KEY_LENGTH
    ) {
      throw misuse("A limit store key must be a non-empty string.", {
        length: typeof key === "string" ? key.length : undefined,
        max: LIMIT_STORE_MAX_KEY_LENGTH,
      });
    }
    // A lone surrogate encodes to UTF-8 as the replacement character, so two
    // different keys would be stored, and counted, as one.
    if (!isWellFormed(key)) {
      throw misuse("A limit store key must be well-formed Unicode.", {});
    }
  }
  return distinct;
}

/** An entry an update writes, its value already serialised. */
export interface SerialisedLimit {
  json: string;
  expiresAt: number;
}

/**
 * Check what an update's `apply` returned against the keys it was given, and
 * serialise each entry it writes.
 *
 * @returns Each written key's entry, or `null` for a deletion
 * @throws {NextlyError} `INTERNAL_ERROR` for a write to a key the update did
 *   not name, an expiry that is not a whole number of milliseconds, or a
 *   value that is not JSON or is larger than {@link LIMIT_STORE_MAX_VALUE_BYTES}
 */
export function serialiseLimitWrite(
  keys: readonly string[],
  write: ReadonlyMap<string, StoredLimit | null>
): Map<string, SerialisedLimit | null> {
  const named = new Set(keys);
  const serialised = new Map<string, SerialisedLimit | null>();
  for (const [key, entry] of write) {
    if (!named.has(key)) {
      throw misuse("A limit store update wrote a key it did not name.", {});
    }
    if (entry === null) {
      serialised.set(key, null);
      continue;
    }
    if (!Number.isSafeInteger(entry.expiresAt)) {
      throw misuse(
        "A limit store entry's expiry must be whole milliseconds since the epoch.",
        { expiresAt: String(entry.expiresAt) }
      );
    }
    // A cycle or a bigint makes `stringify` throw: the caller's mistake, as
    // much as a value with no JSON form, never a store that cannot answer.
    let json: string | undefined;
    try {
      json = JSON.stringify(entry.value);
    } catch {
      json = undefined;
    }
    if (json === undefined) {
      throw misuse("A limit store entry's value must be JSON.", {});
    }
    const bytes = Buffer.byteLength(json, "utf8");
    if (bytes > LIMIT_STORE_MAX_VALUE_BYTES) {
      throw misuse("A limit store entry's value is too large.", {
        bytes,
        max: LIMIT_STORE_MAX_VALUE_BYTES,
      });
    }
    serialised.set(key, { json, expiresAt: entry.expiresAt });
  }
  return serialised;
}

/** Whether `value` keeps the {@link LimitStore} contract, as far as its shape shows. */
export function isLimitStore(value: unknown): value is LimitStore {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.update === "function" &&
    typeof candidate.read === "function" &&
    typeof candidate.sweep === "function" &&
    typeof candidate.shared === "boolean"
  );
}
