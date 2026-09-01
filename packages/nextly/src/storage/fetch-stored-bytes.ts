/**
 * Reading bytes back from a storage service that only exposes them over HTTP.
 *
 * The local adapter reads from disk and S3 reads through its own SDK, so
 * neither needs this. The services that address a file by URL — Vercel Blob,
 * UploadThing — all end up doing the same three things, and doing them the same
 * way matters more than it looks: each step below is a place where the obvious
 * shortcut reports the wrong thing to a caller who may act on it.
 *
 * Built on {@link safeFetch} rather than on a bare `fetch`, because "read a
 * remote object into memory" already has an implementation here that caps the
 * body, bounds the request and refuses an address that resolves somewhere
 * private. A second capped fetch beside it would be two answers to one
 * question, and the two would drift the first time either learned something.
 * Measured: it costs an adapter package about 80K, against the 1MB the whole
 * storage barrel costs.
 *
 * @module storage/fetch-stored-bytes
 */
import { NextlyError } from "../errors/nextly-error";
import { safeFetch, SafeFetchError } from "../utils/validate-external-url";

import { StorageReadTooLargeError } from "./read-errors";
import type { StorageReadOptions } from "./types";

/**
 * Fetch a stored object's bytes from the URL its service issued.
 *
 * Separates the two answers a read can have, which is the whole reason this is
 * a function rather than three lines inlined twice.
 *
 * `null` means the object is NOT THERE — an ordinary fact about the store. A
 * 404 is that answer even when the lookup just succeeded: these stores are
 * remote and concurrent, so an object can be deleted between resolving its
 * address and fetching it. Reporting that ordinary race as a server failure
 * would make a caller handle an error for something its own contract already
 * has a value for.
 *
 * Anything else THROWS. A dropped connection, a 5xx or a refused request says
 * nothing about whether the object exists, and reporting it as absence invites
 * a caller to treat a live file as deleted and write a replacement over it. The
 * two are easy to state apart and easy to lose when the fetch sits inside the
 * same `try` that catches the lookup.
 *
 * The URL is always one the SERVICE issued, never one assembled from a key.
 * These stores mint addresses carrying suffixes the adapter never chose, so a
 * derived URL is a guess at a string another system owns.
 *
 * @param url - The address the storage service reported for this object
 * @param context - What is being read, for the error message: usually the key
 * @param label - The service's name, so a failure says which store answered
 * @param options - Bounds for the read; see {@link StorageReadOptions}
 * @param signal - A deadline ALREADY RUNNING, covering an earlier phase too
 * @returns The object's bytes, or `null` when the store answers 404
 */
export async function fetchStoredBytes(
  url: string,
  context: string,
  label: string,
  options?: StorageReadOptions,
  signal?: AbortSignal
): Promise<Buffer | null> {
  /*
   * Bounds are PASSED THROUGH rather than defaulted here. `safeFetch` already
   * holds the defaults — 10 MiB and 30 seconds — so restating them would put a
   * second set of numbers in the tree that agree today and drift later. A
   * caller with a configured limit of its own, such as the email attachment
   * path, hands its number down instead of being overridden by ours.
   */
  let response: Response;
  try {
    response = await safeFetch(url, {
      ...(options?.maxBytes === undefined
        ? {}
        : { maxResponseBytes: options.maxBytes }),
      /*
       * A caller's signal REPLACES the deadline rather than joining it.
       *
       * These adapters look the object's address up before fetching it, and
       * that lookup can stall too. Starting a fresh timer here would give the
       * fetch its own full budget on top of however long the lookup took, so a
       * read could outlive the deadline the caller was told applied — by
       * roughly double. One signal begun before the lookup governs both phases.
       */
      ...(signal !== undefined
        ? { signal }
        : options?.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.timeoutMs }),
    });
  } catch (error: unknown) {
    /*
     * TRANSLATED, not passed through. `safeFetch` refuses an over-cap body in
     * its own vocabulary, and S3 refuses in the SDK's — so a caller wanting to
     * tell "too large" from "could not read" would have to know which adapter
     * answered. The contract that introduced `maxBytes` owns what exceeding it
     * looks like, so both routes raise the same refusal.
     */
    /*
     * Only an oversized SUCCESSFUL response is an over-cap read.
     *
     * A body can exceed the cap on a failed response too — a 500 page, an error
     * document — and `safeFetch` refuses while buffering, before this code ever
     * sees a status. Translating on the reason alone therefore reported a
     * backend outage as "your file is too big", which is worse than an opaque
     * failure: it names a cause the author would act on, wrongly.
     *
     * An unknown status does NOT translate. It means the failure arrived before
     * any status did, so nothing here can say the object was oversized.
     */
    const oversizedObject =
      error instanceof SafeFetchError &&
      error.reason === "response-too-large" &&
      error.status !== undefined &&
      error.status >= 200 &&
      error.status < 300;

    if (oversizedObject && options?.maxBytes !== undefined) {
      throw new StorageReadTooLargeError(context, options.maxBytes);
    }
    throw error;
  }
  /*
   * Checked BEFORE the general failure branch, because 404 is the one non-OK
   * status that is an answer rather than a fault.
   */
  if (response.status === 404) return null;
  if (!response.ok) {
    /*
     * `internal` rather than a bare error, and the detail goes to the LOG side
     * rather than the public message. A storage backend answering non-OK is not
     * something the caller can fix by changing their request, so the public
     * text stays generic — and the key, status and service name are exactly the
     * things that should not travel to whoever asked for the file.
     */
    throw NextlyError.internal({
      logContext: {
        service: label,
        path: context,
        status: response.status,
        statusText: response.statusText,
      },
    });
  }
  return Buffer.from(await response.arrayBuffer());
}
