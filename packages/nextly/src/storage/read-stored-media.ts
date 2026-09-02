/**
 * Read the bytes behind a stored media path, whatever the backend supports.
 *
 * Two routes to the same answer, and which one runs is a property of the
 * ADAPTER rather than of the request: one that implements `read` is asked
 * directly, and one that does not is fetched over its own public URL. Both are
 * bounded by the caller's cap, and both refuse in the same vocabulary — a
 * `StorageReadTooLargeError` — because a caller that has to ask which route ran
 * before it can interpret the failure is a caller that will eventually get it
 * wrong. That is not hypothetical: implementing `read` on the cloud adapters
 * silently moved the email attachment path from the bounded fetch onto an
 * unbounded buffer, and nothing in that change mentioned email.
 *
 * The URL route goes through `safeFetch`, which refuses hosts resolving to
 * private, loopback, link-local and cloud-metadata addresses. It has to: the
 * path can come from a stored field, so an attacker who can write one would
 * otherwise be choosing what this server connects to.
 *
 * @module storage/read-stored-media
 */
import { NextlyError } from "../errors/nextly-error";
import { safeFetch } from "../utils/validate-external-url";

import {
  classifyFetchFailure,
  DEFAULT_READ_TIMEOUT_MS,
} from "./fetch-stored-bytes";
import {
  StorageReadTimeoutError,
  StorageReadTooLargeError,
} from "./read-errors";
import type { StorageReadOptions } from "./types";

/**
 * The part of a storage backend this needs.
 *
 * Structural rather than the full adapter interface, so a caller holding a
 * media storage facade, a bare adapter or a test double can all be read from
 * without one of them having to pretend to be another.
 */
export interface StoredMediaSource {
  /** Present only on backends that can hand back their own bytes. */
  read?: (
    filePath: string,
    options?: StorageReadOptions
  ) => Promise<Buffer | null>;
  /** The address the same object is served from. */
  getPublicUrl: (filePath: string) => string;
}

/**
 * A stored object that could not be reached, as distinct from one that is not
 * there.
 *
 * Carries the status rather than a sentence, so a caller can decide what to say
 * — an API route answering a visitor and an attachment path answering an author
 * owe different explanations for the same failure.
 *
 * A `NextlyError` because this is product code in this package: a caller
 * reaching for `NextlyError.is` must be able to classify what it caught without
 * matching on a class name, and the envelope and structured logging follow from
 * the code rather than from the message.
 */
export class StoredMediaUnreachableError extends NextlyError {
  constructor(
    readonly url: string,
    readonly status: number
  ) {
    super({
      code: "STORAGE_READ_UNREACHABLE",
      publicMessage: "The stored file could not be read.",
      // The URL is operator-side only: it names a bucket and a key, and whoever
      // asked for the file has no use for either.
      logContext: { url, status },
    });
  }
}

/**
 * Whether a stored path is itself an address, rather than a key.
 *
 * Parsed rather than prefix-matched: a key may legitimately begin with those
 * four letters — `http-font.woff2` is a valid object name — and reading it as
 * an address sends it to `safeFetch`, which refuses it, so an ordinary file
 * became unservable on exactly the adapters this fallback exists for.
 */
function isAbsoluteHttpUrl(storagePath: string): boolean {
  try {
    const { protocol } = new URL(storagePath);
    return protocol === "http:" || protocol === "https:";
  } catch {
    // Not a URL at all, which is the ordinary case for a stored key.
    return false;
  }
}

/**
 * Whether a rejection is a platform deadline rather than this package's.
 *
 * Adapters in sibling packages bound their reads with `AbortSignal.timeout`,
 * whose rejection is a `DOMException` this package cannot construct or extend —
 * so it is recognised by name, which is the only thing the runtime guarantees
 * about it.
 */
function isNativeTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/**
 * Read one stored object, bounded by `maxBytes` whichever route serves it.
 *
 * @param storage - The backend, which may or may not implement `read`
 * @param storagePath - The stored path, which some backends record as a full URL
 * @param maxBytes - The cap both routes run under
 * @returns The object's bytes, or `null` when the store says it is not there
 * @throws StorageReadTooLargeError when the object exceeds `maxBytes`
 * @throws StoredMediaUnreachableError when the store answers, but badly
 */
export async function readStoredMediaBytes(
  storage: StoredMediaSource,
  storagePath: string,
  maxBytes: number
): Promise<Buffer | null> {
  if (typeof storage.read === "function") {
    /*
     * The cap travels INTO the adapter rather than being checked on what comes
     * back: a size checked afterwards has already spent the memory it exists to
     * save. Adapters that find the object oversized refuse it themselves.
     */
    /*
     * An adapter that implements `read` is AUTHORITATIVE about absence: `null`
     * from it means the object is not there, and asking its public URL next
     * answers a different question badly. The local adapter's URL is a relative
     * `/uploads/...` path, which `safeFetch` refuses as invalid — so a missing
     * file came back as a blocked external URL rather than as missing.
     *
     * The URL route below is for adapters that cannot read at all.
     */
    try {
      return await storage.read(storagePath, { maxBytes });
    } catch (error) {
      /*
       * An adapter outside this package bounds its own read with
       * `AbortSignal.timeout`, which rejects with a platform `DOMException`
       * named `TimeoutError`. Passed through, the route's error handler sees no
       * `NextlyError` and answers 500 — an internal fault — for a backend that
       * simply did not reply in time, which a caller and a gateway would both
       * treat as retryable if they could read it.
       */
      if (isNativeTimeout(error)) {
        /*
         * The DEADLINE, not the cap. This reader passes only `maxBytes` to the
         * adapter, so the adapter resolved its own deadline from the shared
         * default — which is therefore the true figure, and the one an operator
         * needs when they come to the 504 asking what was waited for.
         */
        throw new StorageReadTimeoutError(storagePath, DEFAULT_READ_TIMEOUT_MS);
      }
      throw error;
    }
  }

  /*
   * Some backends — Vercel Blob among them — record the full public URL as the
   * stored path, so asking for a public URL for one would build an address out
   * of an address.
   */
  const url = isAbsoluteHttpUrl(storagePath)
    ? storagePath
    : storage.getPublicUrl(storagePath);

  let response: Response;
  try {
    response = await safeFetch(url, { maxResponseBytes: maxBytes });
  } catch (error) {
    /*
     * Translated rather than rethrown, so the two routes refuse identically.
     * Left as a `SafeFetchError`, an over-cap fetch would be a different error
     * from an over-cap read of the same object, and every caller would have to
     * know which backend it happened to be talking to.
     *
     * Classified by the SAME function the URL-backed adapters use, because the
     * distinction it draws is not one a second implementation would keep: an
     * over-cap body on a FAILED response — a 500 page, a verbose error document
     * — is a backend outage, and reading the reason alone reports it as the
     * author's file being too big.
     */
    const verdict = classifyFetchFailure(error);
    if (verdict === "oversized") {
      throw new StorageReadTooLargeError(storagePath, maxBytes);
    }
    if (verdict === "absent") {
      // A 404 whose error page was itself over the cap, so `safeFetch` refused
      // before a `Response` existed. Still an absence, and reported as one.
      return null;
    }
    throw error;
  }

  /*
   * ABSENCE, not a fault. A row can outlive its object — a bucket lifecycle
   * rule, a manual cleanup, a concurrent delete — and calling that an upstream
   * failure tells a caller to retry something that will never come back. It
   * also reaches a visitor as 502 for a font that is simply gone, on a response
   * cacheable for a year.
   */
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new StoredMediaUnreachableError(url, response.status);
  }
  return Buffer.from(await response.arrayBuffer());
}
