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
import {
  safeFetch,
  SafeFetchError,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RESPONSE_BYTES,
} from "../utils/validate-external-url";

import {
  StorageReadTimeoutError,
  StorageReadTooLargeError,
} from "./read-errors";
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
    const verdict = classifyFetchFailure(error);
    if (verdict === "absent") return null;
    if (verdict === "oversized") {
      throw new StorageReadTooLargeError(
        context,
        resolveReadBounds(options).maxBytes
      );
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

/**
 * What a failed fetch actually says about the object.
 *
 * Its own function because the three answers are the whole point of this module
 * and they are easy to collapse into each other — each collapse having been a
 * real defect here rather than a hypothetical:
 *
 * - ABSENT. A 404 is absence whatever size its body was. `safeFetch` caps while
 *   buffering, so a verbose CDN error page raises before a `Response` exists
 *   and the status check further down is never reached; the object is still
 *   gone, and must not become an error because the page explaining it was long.
 * - OVERSIZED. Only a SUCCESSFUL response that blew the cap. A failed response
 *   can exceed it too, and translating on the reason alone reported a backend
 *   outage as "your file is too big" — a cause the author would act on, wrongly.
 * - UNKNOWN. Everything else, including a too-large refusal carrying NO status:
 *   that means the failure arrived before any status did, which says nothing
 *   about whether the object was oversized.
 */
function classifyFetchFailure(
  error: unknown
): "absent" | "oversized" | "unknown" {
  if (!(error instanceof SafeFetchError)) return "unknown";
  if (error.status === 404) return "absent";
  const successful =
    error.status !== undefined && error.status >= 200 && error.status < 300;
  return error.reason === "response-too-large" && successful
    ? "oversized"
    : "unknown";
}

/** The deadline a stored read runs under when the caller names none. */
export const DEFAULT_READ_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

/** The byte cap a stored read runs under when the caller names none. */
export const DEFAULT_READ_MAX_BYTES = DEFAULT_MAX_RESPONSE_BYTES;

/**
 * The bounds a read actually runs under, defaults filled in.
 *
 * ONE place, because every adapter needs the same answer and the ones that
 * derived it themselves diverged: the URL-backed pair inherited `safeFetch`'s
 * cap and deadline for free, while the local and S3 adapters — which never
 * touch `safeFetch` — applied NO bound at all when the caller named none.
 * `StorageReadOptions` promises the default either way, and a production caller
 * reading media without options got it from two of four backends.
 *
 * Filling the defaults here rather than per adapter is what makes the promise
 * true by construction rather than by four implementations agreeing.
 */
export function resolveReadBounds(options?: StorageReadOptions): {
  maxBytes: number;
  timeoutMs: number;
} {
  return {
    maxBytes: options?.maxBytes ?? DEFAULT_READ_MAX_BYTES,
    timeoutMs: options?.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
  };
}

/**
 * A deadline that aborts with a NextlyError rather than a platform exception.
 *
 * `AbortSignal.timeout` rejects with a `DOMException` named `TimeoutError`, and
 * product code in this package answers in `NextlyError` — so a caller can
 * classify what it caught rather than matching a name the runtime chose. Built
 * here rather than per adapter so every storage deadline says the same thing.
 *
 * The timer is unreferenced so a pending deadline is never a reason the process
 * stays alive, and the returned `cancel` clears it once the read settles — the
 * unref alone would leave one scheduled per read for the whole timeout.
 *
 * @param timeoutMs - How long the read may take
 * @param context - What is being read, carried into the refusal's log side
 */
export function deadlineSignal(
  timeoutMs: number,
  context: string
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new StorageReadTimeoutError(context, timeoutMs));
  }, timeoutMs);
  // Guarded because `unref` is Node's, and this module is bundled for runtimes
  // whose `setTimeout` returns a number.
  (timer as { unref?: () => void }).unref?.();
  return {
    signal: controller.signal,
    /*
     * Called once the read has settled, whichever way it went. `unref` only
     * stops a pending timer holding the process open; it still sits on the
     * timer heap retaining the controller and the path, so a server doing a
     * thousand reads a second keeps thirty seconds of them alive and then runs
     * a thousand aborts that answer nobody.
     */
    cancel: () => {
      clearTimeout(timer);
    },
  };
}

/**
 * Stop waiting on a promise once the deadline fires.
 *
 * For a lookup whose SDK cannot be cancelled. UploadThing 7.7.4's
 * `getFileUrls` reads only `keyType` and forwards no signal, so handing it one
 * bounds nothing — the option is accepted and ignored, which reads as covered
 * and behaves as absent.
 *
 * This RACES rather than cancels, and the difference is worth stating plainly:
 * the underlying request keeps running to completion in the background. What it
 * buys is that `read` returns within the deadline it advertised, instead of
 * holding its caller for as long as a stalled backend feels like. That is the
 * promise the contract actually makes; genuinely cancelling the work needs an
 * SDK that accepts cancellation, and this one does not.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (signal === undefined) return await work;
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(signal.reason as Error);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason as Error), {
        once: true,
      });
    }),
  ]);
}
