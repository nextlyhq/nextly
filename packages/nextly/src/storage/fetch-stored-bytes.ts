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
 * THROWS rather than returning `null` when the fetch fails, and that is the
 * whole reason this is a function rather than three lines inlined twice. A
 * caller's `read` folds "no such key" into `null`, which is an ordinary answer
 * about the store. A transport failure is not: reporting a dropped connection
 * as absence invites a caller to treat a live file as deleted and write a
 * replacement over it. Keeping the two apart is easy to state and easy to lose
 * when the fetch sits inside the same `try` that catches the lookup.
 *
 * The URL is always one the SERVICE issued, never one assembled from a key.
 * These stores mint addresses carrying suffixes the adapter never chose, so a
 * derived URL is a guess at a string another system owns.
 *
 * @param url - The address the storage service reported for this object
 * @param context - What is being read, for the error message: usually the key
 * @param label - The service's name, so a failure says which store answered
 * @returns The object's bytes
 */
export async function fetchStoredBytes(
  url: string,
  context: string,
  label: string
): Promise<Buffer> {
  const response = await fetch(url);
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
