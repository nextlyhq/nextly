/**
 * A value the database holds for the whole install (the stored schema
 * version's count, the general settings row), followed by this process: read
 * at most once per interval per database, the read shared by every caller
 * that arrives while it runs, and read again at once after this process
 * changes it.
 *
 * Every instance of the app reads the same row, so a change made through one
 * is seen by the others when they next read it. The interval is the bound on
 * how long that takes, and what it buys is the read itself: one per interval
 * per database for every caller in the process, where reading on each use
 * sent one per request, or several.
 *
 * - **Read on use, never on a timer.** A serverless instance is frozen
 *   between invocations and a timer set there does not run; reading when a
 *   caller asks works the same on every host.
 * - **One read shared.** Callers arriving while a read is under way, begun
 *   after the last change this process marked, are handed that read
 *   (`coalesce`).
 * - **A change made here is read at once.** {@link markFollowedChanged},
 *   called once a write in this process has committed, makes the next caller
 *   read again rather than answer with the value from before it; a read begun
 *   before the mark is not shared with callers after it.
 * - **A read of its own** (`alone`) for a caller whose decision must reflect
 *   a change made elsewhere a moment ago: it never joins a read begun before
 *   it, and what it reads is kept for everyone, unless a read begun after it
 *   has already been kept.
 * - **Followed once read.** With `followedOnly`, a database never read here
 *   is not read now, and the caller is answered undefined.
 * - **A failed read is the caller's.** A read that rejects rejects every
 *   caller that shared it and keeps nothing, so the next caller reads again;
 *   a value that should stay unknown for the interval after a failure is the
 *   reader's to answer (undefined) instead of rejecting.
 *
 * The state lives on `globalThis` under a name of the caller's: a Next.js
 * server holds several copies of a package's modules, and a state per copy
 * would be several reads per interval, each marked only by the writes made
 * through its own copy.
 *
 * @module shared/lib/followed-value
 */
import { coalesce } from "./coalesce";
import { isWithinLifetime, monotonicNow } from "./lifetime";

/** This process's last read of one database's value. */
interface FollowedReading<T> {
  /** The value read, or undefined where none has been kept. */
  value: T | undefined;
  /** When the kept read finished, on a clock that never steps back. */
  readAt: number | undefined;
  /** How many changes had been marked when the kept read began. */
  marks: number;
  /** The shared reads under way, by the marks count each began at. */
  inFlight: Map<number, Promise<T | undefined>>;
  /** Numbers each read as it begins, so a slower, older read never replaces a newer one. */
  begun: number;
  /** The number of the read whose value is kept. */
  kept: number;
}

/** One followed value: a reading per database, and this process's changes. */
export interface FollowedState<T> {
  /** Moved by {@link markFollowedChanged}: a read begun before a mark is stale. */
  marks: number;
  /** One reading per database handle, gone with it. */
  byDatabase: WeakMap<object, FollowedReading<T>>;
}

/** How a caller asks for a followed value. */
export interface FollowOptions {
  /** How long one read is reused by this process. */
  intervalMs: number;
  /**
   * Read now, unless a read begun after the last mark is under way, which is
   * shared rather than repeated.
   */
  fresh?: boolean;
  /** Read now, never sharing a read begun before this call. */
  alone?: boolean;
  /** Read nothing for a database never read here; answer undefined. */
  followedOnly?: boolean;
}

/** The followed value kept on `globalThis` under `name`, made on first use. */
export function followedState<T>(name: string): FollowedState<T> {
  const holder = globalThis as unknown as Record<
    string,
    FollowedState<T> | undefined
  >;
  holder[name] ??= { marks: 0, byDatabase: new WeakMap() };
  return holder[name];
}

/**
 * Say a write in this process has committed: every database's value is read
 * again by the next caller, so it answers with what that write stored.
 */
export function markFollowedChanged<T>(state: FollowedState<T>): void {
  state.marks += 1;
}

/**
 * `database`'s value as last read, read again through `read` where that read
 * is older than the interval, where a change was marked since it began, or
 * where the caller asks for a read now (`fresh`, `alone`).
 */
export function followValue<T>(
  state: FollowedState<T>,
  database: object,
  read: () => Promise<T | undefined>,
  options: FollowOptions
): Promise<T | undefined> {
  let reading = state.byDatabase.get(database);
  if (reading === undefined) {
    if (options.followedOnly === true) return Promise.resolve(undefined);
    reading = {
      value: undefined,
      readAt: undefined,
      marks: -1,
      inFlight: new Map(),
      begun: 0,
      kept: 0,
    };
    state.byDatabase.set(database, reading);
  }
  const held = reading;
  const marks = state.marks;
  const readNow = (): Promise<T | undefined> => {
    held.begun += 1;
    const number = held.begun;
    return read().then(value => {
      // Kept only when no read begun after this one has been kept already: a
      // slow read finishing late would otherwise put an older value back and
      // have it trusted for another interval.
      if (number > held.kept) {
        held.kept = number;
        held.value = value;
        // Timed from when the read finished: a slow read answers its callers
        // and only schedules the next one.
        held.readAt = monotonicNow();
        held.marks = marks;
      }
      return value;
    });
  };
  if (options.alone === true) return readNow();
  if (held.inFlight.has(marks)) return coalesce(held.inFlight, marks, readNow);
  if (
    options.fresh !== true &&
    held.marks === marks &&
    isWithinLifetime(held.readAt, options.intervalMs)
  ) {
    return Promise.resolve(held.value);
  }
  return coalesce(held.inFlight, marks, readNow);
}
