/**
 * Reading bytes back from a storage service that only exposes them over HTTP.
 *
 * The local adapter reads from disk and S3 reads through its own SDK, so
 * neither needs this. The services that address a file by URL — Vercel Blob,
 * UploadThing — all end up doing the same three things, and doing them the same
 * way matters more than it looks: each step below is a place where the obvious
 * shortcut reports the wrong thing to a caller who may act on it.
 *
 * @module storage/fetch-stored-bytes
 */
import { NextlyError } from "../errors/nextly-error";

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
 * @returns The object's bytes, or `null` when the store answers 404
 */
export async function fetchStoredBytes(
  url: string,
  context: string,
  label: string
): Promise<Buffer | null> {
  const response = await fetch(url);
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
