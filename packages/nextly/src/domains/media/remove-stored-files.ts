import { isTransientError, withRetry } from "../../storage/retry";

import { storedFilesOf, type MediaFilesRecord } from "./stored-files";

/**
 * Removing a media item's stored files, once its record is gone: the one way
 * every delete does it, of one item or of a folder's.
 */

/** The storage surface removal uses: a delete by stored path, per collection. */
export interface StoredFileRemover {
  delete(filePath: string, collection?: string): Promise<void>;
}

/**
 * A stored path or URL as a log may show it: without the credentials before
 * a host, the query and the fragment, any of which a signed or tokenized URL
 * can carry. What is left still finds the file.
 */
export function storedPathForLog(pathOrUrl: string): string {
  const withoutQuery = pathOrUrl.replace(/[?#].*$/, "");
  // A stored path keeps its spelling; only a URL has credentials to drop.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(withoutQuery)) return withoutQuery;
  try {
    const url = new URL(withoutQuery);
    return `${url.origin}${url.pathname}`;
  } catch {
    return withoutQuery.replace(/\/\/[^/]*@/, "//");
  }
}

/** A stored file that could not be removed, by its path, so it can be found. */
export function warnNotRemoved(
  filePath: string,
  mediaId: string,
  error: unknown
): void {
  console.warn(
    `[MediaService] Could not remove ${storedPathForLog(filePath)} of media ${mediaId}:`,
    error instanceof Error ? error.message : error
  );
}

/**
 * A thumbnail whose stored location the record does not show, by its URL,
 * the one identifier there is: nothing was removed in its place.
 */
export function warnUnlocated(url: string, mediaId: string): void {
  console.warn(
    `[MediaService] Left the thumbnail of media ${mediaId} at ${storedPathForLog(url)}: its stored location could not be worked out from the record.`
  );
}

/**
 * Removes every file stored for a deleted item: the original, every image
 * size and the thumbnail made at upload. Each is removed on its own, retried
 * on a transient failure, so one that fails leaves the others to go, and is
 * named in the log with its item, so the leftover can be found. Never throws:
 * the record is already gone, and a storage failure must not fail its delete.
 */
export async function removeStoredFiles(
  storage: StoredFileRemover,
  record: MediaFilesRecord,
  mediaId: string
): Promise<void> {
  const { paths, unlocated } = storedFilesOf(record);
  for (const url of unlocated) warnUnlocated(url, mediaId);
  await Promise.all(
    paths.map(async filePath => {
      try {
        await withRetry(() => storage.delete(filePath, "media"), {
          maxAttempts: 3,
          baseDelayMs: 500,
          shouldRetry: isTransientError,
          onRetry: (err, attempt) => {
            console.warn(
              `[MediaService] Delete retry ${attempt} for ${storedPathForLog(filePath)}:`,
              err instanceof Error ? err.message : err
            );
          },
        });
      } catch (error) {
        warnNotRemoved(filePath, mediaId, error);
      }
    })
  );
}
