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
import { safeFetch } from "../utils/validate-external-url";

import { classifyFetchFailure } from "./fetch-stored-bytes";
import { StorageReadTooLargeError } from "./read-errors";
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
 */
export class StoredMediaUnreachableError extends Error {
  constructor(
    readonly url: string,
    readonly status: number
  ) {
    super(`Stored object could not be read (status ${String(status)}).`);
    this.name = "StoredMediaUnreachableError";
  }
}

/**
 * Read one stored object, bounded by `maxBytes` whichever route serves it.
 *
 * @param storage - The backend, which may or may not implement `read`
 * @param storagePath - The stored path, which some backends record as a full URL
 * @param maxBytes - The cap both routes run under
 * @returns The object's bytes
 * @throws StorageReadTooLargeError when the object exceeds `maxBytes`
 * @throws StoredMediaUnreachableError when the URL route answers non-2xx
 */
export async function readStoredMediaBytes(
  storage: StoredMediaSource,
  storagePath: string,
  maxBytes: number
): Promise<Buffer> {
  if (typeof storage.read === "function") {
    /*
     * The cap travels INTO the adapter rather than being checked on what comes
     * back: a size checked afterwards has already spent the memory it exists to
     * save. Adapters that find the object oversized refuse it themselves.
     */
    const buffer = await storage.read(storagePath, { maxBytes });
    if (buffer) return buffer;
    // `null` is absence from THIS backend, and the URL route below is a second
    // way of asking rather than a contradiction of it.
  }

  /*
   * Some backends — Vercel Blob among them — record the full public URL as the
   * stored path, so asking for a public URL for one would build an address out
   * of an address.
   */
  const url = storagePath.startsWith("http")
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
      // before a `Response` existed. The object is gone; the status below is
      // the one that never got as far as being read.
      throw new StoredMediaUnreachableError(url, 404);
    }
    throw error;
  }

  if (!response.ok) {
    throw new StoredMediaUnreachableError(url, response.status);
  }
  return Buffer.from(await response.arrayBuffer());
}
