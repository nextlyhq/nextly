/**
 * A media file's fingerprint: the SHA-256 of its bytes, as 64 lowercase hex
 * characters, stored on its record as `media.sha256`.
 *
 * One definition, used by every path that gives a record its fingerprint: an
 * upload and a Replace hash the bytes they store, and the background fill and
 * an export's "hash when missing" hash what storage holds. Two spellings of
 * "the fingerprint of a file" (another digest, upper-case hex, a hash of the
 * bytes before an SVG was sanitized) would let two records of one file look
 * like two files, which is what the fingerprint exists to rule out.
 *
 * @module domains/media/hash-backfill/content-hash
 */
import { createHash } from "node:crypto";

import { NextlyError } from "../../../errors/nextly-error";
import { DEFAULT_READ_MAX_BYTES } from "../../../storage/fetch-stored-bytes";
import type {
  IStorageAdapter,
  StorageReadOptions,
} from "../../../storage/types";

/** The SHA-256 of `bytes`, as 64 lowercase hex characters. */
export function contentHashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Whether `value` is a fingerprint as `contentHashOf` writes one. */
export function isContentHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/** What reading a stored file needs of a storage: either way of reading it. */
export type StoredFileReading = Partial<
  Pick<IStorageAdapter, "read" | "readStream">
>;

/** How a stored file is read for its fingerprint. */
export interface StoredFileHashOptions {
  /** The byte count the record says is stored. */
  size?: number;
  /**
   * The instant, in epoch ms, by which the read must be done. A read still
   * going then is stopped and refused, so one large file cannot hold its
   * caller past the time it was given.
   */
  deadline?: number;
  /** The wall clock, in epoch ms; injected so a deadline is testable. */
  clock?: () => number;
}

/**
 * The fingerprint of the file storage holds at `filePath`, or `null` when it
 * holds nothing there.
 *
 * Streamed where the storage can stream, so a large video is hashed without
 * being held in memory whole; read whole otherwise. A storage that can do
 * neither is refused rather than answered with `null`, which would report
 * every file of the site as missing while they may all be there.
 *
 * A whole read is capped at the record's `size` or the storage's default cap,
 * whichever is larger: the default is meant for fetched responses and would
 * refuse a video the site accepted, and a size recorded by an older release
 * may understate the file. A stream has no cap; its reader takes the bytes
 * as they come, and stops at `deadline`.
 */
export async function hashOfStoredFile(
  storage: StoredFileReading,
  filePath: string,
  options: StoredFileHashOptions = {}
): Promise<string | null> {
  const clock = options.clock ?? Date.now;
  if (storage.readStream) {
    const timeoutMs = timeLeft(options.deadline, clock);
    const stream = await (timeoutMs === undefined
      ? storage.readStream(filePath)
      : storage.readStream(filePath, { timeoutMs }));
    return stream
      ? hashOfStream(stream, filePath, options.deadline, clock)
      : null;
  }
  if (storage.read) {
    const read = wholeReadOptions(
      options.size,
      timeLeft(options.deadline, clock)
    );
    const bytes = await (read === undefined
      ? storage.read(filePath)
      : storage.read(filePath, read));
    return bytes ? contentHashOf(bytes) : null;
  }
  throw NextlyError.configuration({
    logMessage:
      "The media storage cannot read a stored file back, so a media file's fingerprint cannot be computed from it.",
    logContext: { reason: "storage-cannot-read" },
  });
}

/** The time left before `deadline`, at least 1 ms; none without one. */
function timeLeft(
  deadline: number | undefined,
  clock: () => number
): number | undefined {
  return deadline === undefined ? undefined : Math.max(1, deadline - clock());
}

/** A whole read's cap and time, or none when neither is given. */
function wholeReadOptions(
  size: number | undefined,
  timeoutMs: number | undefined
): StorageReadOptions | undefined {
  if (size === undefined && timeoutMs === undefined) return undefined;
  return {
    ...(size === undefined
      ? {}
      : { maxBytes: Math.max(size, DEFAULT_READ_MAX_BYTES) }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

/** What `withinTime` answers for a promise still pending when time ran out. */
const TIMED_OUT: unique symbol = Symbol("timed out");

/**
 * `pending`, or `TIMED_OUT` once `ms` milliseconds pass first. The timer is
 * unreferenced and cleared, so it never keeps a process alive.
 */
async function withinTime<T>(
  pending: Promise<T>,
  ms: number
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof TIMED_OUT>(resolve => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([pending, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The hash of every chunk of `stream`, stopped and refused at `deadline`.
 *
 * Each read is raced against the time left, not only checked between
 * chunks: storage that answers and then stalls mid-body leaves a read
 * pending with no chunk to wake the check, and only the race ends it.
 */
async function hashOfStream(
  stream: ReadableStream<Uint8Array>,
  filePath: string,
  deadline: number | undefined,
  clock: () => number
): Promise<string> {
  const hash = createHash("sha256");
  const reader = stream.getReader();
  for (;;) {
    const left = deadline === undefined ? undefined : deadline - clock();
    // Checked before each read as well as raced during it: a read that
    // answers at once would beat a timer of no time left.
    if (left !== undefined && left <= 0) {
      await reader.cancel().catch(() => undefined);
      throw pastDeadline(filePath);
    }
    const read = reader.read();
    const next = left === undefined ? await read : await withinTime(read, left);
    if (next === TIMED_OUT) {
      // The read left pending settles when the stream is cancelled; its
      // outcome no longer matters to anyone.
      void read.catch(() => undefined);
      await reader.cancel().catch(() => undefined);
      throw pastDeadline(filePath);
    }
    if (next.done) return hash.digest("hex");
    hash.update(next.value);
  }
}

/** The refusal of a read still going when its time ran out. */
function pastDeadline(filePath: string): NextlyError {
  // Named in the log context: the file was still being read for its
  // fingerprint when the time given for it ran out.
  return NextlyError.internal({
    logContext: { reason: "media-hash-past-deadline", filePath },
  });
}
